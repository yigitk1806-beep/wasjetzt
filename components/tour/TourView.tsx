'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { AnimatePresence, motion } from 'motion/react';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Share } from '@/components/ui/icons';
import { PlanningOverlay } from '@/components/PlanningOverlay';
import { ReplaceSheet, type ReplaceOption } from '@/components/plan/ReplaceSheet';
import { ShareSheet } from '@/components/plan/ShareSheet';
import { GroupPanel } from '@/components/plan/GroupPanel';
import { FeedbackSheet } from '@/components/plan/FeedbackSheet';
import { PlanHeader } from '@/components/plan/PlanHeader';
import { StartPointBar, startLabel } from '@/components/plan/StartPointBar';
import { StartPointSheet, type StartPoint } from '@/components/location/StartPointSheet';
import { TimeSheet } from '@/components/plan/TimeSheet';
import { useLocation } from '@/hooks/useLocation';
import { formatClock } from '@/lib/time';
import { useLocale } from '@/components/LocaleProvider';
import { duration, errorText, noteText } from '@/lib/i18n/format';
import { recordPlanStarted } from '@/lib/clientStore';
import { replacePlanStep, replanFrom, requestPlanStreamed, type PlanPhase } from '@/lib/planClient';
import type { Plan, PlanStep, TourTweak } from '@/types/domain';
import { TourStop, navigationUrl } from './TourStop';

const PlanMap = dynamic(() => import('@/components/plan/PlanMap').then((m) => m.PlanMap), {
  ssr: false,
  loading: () => <div className="skeleton h-[16rem] rounded-3xl" />,
});

/** Beim Ersetzen einer Sehenswürdigkeit – nur, was hier Sinn ergibt. */
const ERSETZEN: ReplaceOption[] = [
  { hint: 'any', emoji: '🔄', label: (t) => t.replace.tourOptions.any, relevant: () => true },
  {
    hint: 'indoor',
    emoji: '🏛️',
    label: (t) => t.replace.tourOptions.indoor,
    relevant: (step) => step.place.indoorOutdoor !== 'indoor' && Boolean(step.place.themes?.length),
  },
  {
    hint: 'new',
    emoji: '💎',
    label: (t) => t.replace.tourOptions.new,
    relevant: (step) => Boolean(step.place.themes?.length),
  },
  {
    hint: 'cheaper',
    emoji: '🆓',
    label: (t) => t.replace.tourOptions.cheaper,
    relevant: (step) => step.place.price.level > 0 && Boolean(step.place.themes?.length),
  },
];

/** Die ganze Tour in eine Richtung drehen – ohne Formular. */
const ANPASSEN = [
  { tweak: 'less-walk', emoji: '👟' },
  { tweak: 'museum', emoji: '🏛️' },
  { tweak: 'photo', emoji: '📸' },
  { tweak: 'free', emoji: '🆓' },
  { tweak: 'calm', emoji: '😌' },
] as const satisfies ReadonlyArray<{ tweak: TourTweak; emoji: string }>;

type Props = { initialPlan: Plan };

export function TourView({ initialPlan }: Props) {
  const { t } = useLocale();
  const router = useRouter();
  const [plan, setPlan] = useState(initialPlan);
  const [replacing, setReplacing] = useState<PlanStep | null>(null);
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [weatherAlert, setWeatherAlert] = useState<{ stepIds: string[] } | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [phase, setPhase] = useState<PlanPhase | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [tweakError, setTweakError] = useState<string | null>(null);
  const [timeOpen, setTimeOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const { setManual, requestDevice } = useLocation();

  // Wo man gerade steht: -1 = noch nicht gestartet.
  const [position, setPosition] = useState(-1);
  const speicher = `wasjetzt.tour.${plan.id}`;

  useEffect(() => {
    try {
      const gespeichert = window.localStorage.getItem(speicher);
      if (gespeichert !== null) setPosition(Number(gespeichert));
    } catch {
      /* ohne Speicher beginnt die Tour einfach von vorn */
    }
  }, [speicher]);

  const merken = useCallback(
    (wert: number) => {
      setPosition(wert);
      try {
        window.localStorage.setItem(speicher, String(wert));
      } catch {
        /* nicht schlimm */
      }
    },
    [speicher],
  );

  // Wetterwache wie beim Abendplan: beim Öffnen und alle 10 Minuten.
  useEffect(() => {
    let cancelled = false;
    const check = () => {
      fetch(`/api/plan/${plan.id}/weather-check`)
        .then((res) => res.json())
        .then((data) => {
          if (!cancelled && data.changed && data.affectedStepIds?.length) {
            setWeatherAlert({ stepIds: data.affectedStepIds });
          }
        })
        .catch(() => undefined);
    };
    check();
    const timer = setInterval(check, 10 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [plan.id]);

  // Nummern nur für Sehenswürdigkeiten – Pausen zählen nicht mit.
  const nummern = useMemo(() => {
    let n = 0;
    return plan.steps.map((step) => (step.place.themes?.length ? (n += 1) : null));
  }, [plan.steps]);
  const stationen = nummern.filter((n) => n !== null).length;

  const handleReplace = useCallback(
    async (hint: string) => {
      if (!replacing) return;
      setReplaceError(null);
      const result = await replacePlanStep(plan.id, replacing.id, hint);
      if (result.plan) {
        setPlan(result.plan);
        setReplacing(null);
        return;
      }
      setReplaceError(errorText(t, result, t.tour.replaceFailed));
    },
    [plan.id, replacing, t],
  );

  const adjustForWeather = useCallback(async () => {
    if (!weatherAlert?.stepIds.length) return;
    setAdjusting(true);
    let current = plan;
    for (const stepId of weatherAlert.stepIds) {
      const result = await replacePlanStep(current.id, stepId, 'indoor');
      if (result.plan) current = result.plan;
    }
    setPlan(current);
    setWeatherAlert(null);
    setAdjusting(false);
  }, [plan, weatherAlert]);

  async function anpassen(tweak: TourTweak) {
    setTweakError(null);
    setRegenerating(true);
    setPhase(null);
    const r = plan.request;
    // Die neue Tour behält die gewählte Zeit, solange sie noch vor uns liegt.
    const abfahrt = new Date(plan.departISO ?? plan.startISO);
    const startISO = (abfahrt.getTime() > Date.now() ? abfahrt : new Date()).toISOString();
    const heim = r.mustBeHomeByISO && new Date(r.mustBeHomeByISO) > new Date(startISO) ? r.mustBeHomeByISO : undefined;
    const response = await requestPlanStreamed(
      {
        lat: r.origin.lat,
        lon: r.origin.lon,
        originLabel: r.originLabel,
        startISO,
        mustBeHomeByISO: heim,
        availableMinutes: r.availableMinutes,
        mobility: r.mobility,
        budget: r.budget,
        mode: 'tour',
        interests: r.interests,
        tourTweak: tweak,
      },
      setPhase,
    );
    if (response.plan) {
      router.push(`/plan/${response.plan.id}`);
      return;
    }
    setRegenerating(false);
    setPhase(null);
    setTweakError(errorText(t, response, t.tour.tweakFailed));
  }

  /** Anderer Startpunkt: Die Tour wird um den neuen Punkt herum neu gebaut. */
  async function startWechseln(next: StartPoint) {
    if (!next.fromDevice) setManual(next.label, next.location);
    setTweakError(null);
    setRegenerating(true);
    setPhase(null);

    const response = await replanFrom(plan, next, setPhase);
    if (response.plan) {
      router.push(`/plan/${response.plan.id}`);
      return;
    }
    setRegenerating(false);
    setPhase(null);
    setTweakError(errorText(t, response, t.tour.tweakFailed));
  }

  function oeffnen(url: string) {
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function starten() {
    recordPlanStarted(plan);
    merken(0);
    const erste = plan.steps[0];
    if (erste) oeffnen(navigationUrl(erste));
  }

  function weiter() {
    const naechste = position + 1;
    if (naechste >= plan.steps.length) {
      merken(plan.steps.length);
      setFeedbackOpen(true);
      return;
    }
    merken(naechste);
    oeffnen(navigationUrl(plan.steps[naechste]));
  }

  const gestartet = position >= 0;
  const fertig = position >= plan.steps.length;
  const naechster = gestartet && !fertig ? plan.steps[position + 1] : undefined;

  return (
    <>
      <header className="shell safe-top flex items-center justify-between pt-3">
        <Link
          href="/entdecken"
          className="tap -ml-2 grid h-10 w-10 place-items-center rounded-full text-ink-soft"
          aria-label={t.common.back}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="m15 6-6 6 6 6"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Link>
        <button
          type="button"
          onClick={() => setShareOpen(true)}
          className="tap -mr-2 flex h-10 items-center gap-1.5 rounded-full px-3 text-[0.86rem] font-semibold text-ink-soft"
        >
          <Share size={16} /> {t.common.share}
        </button>
      </header>

      <main className="shell space-y-5 pb-32 pt-3">
        <PlanHeader plan={plan} onTimeClick={() => setTimeOpen(true)} />

        <StartPointBar
          request={plan.request}
          busy={regenerating}
          onChange={() => setStartOpen(true)}
        />

        <AnimatePresence>
          {weatherAlert ? (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="flex items-start gap-3 rounded-3xl bg-sun-100 p-4">
                <span className="text-xl" aria-hidden>
                  🌧️
                </span>
                <div className="flex-1">
                  <p className="text-[0.9rem] font-semibold">{t.tour.rainTitle}</p>
                  <p className="mt-0.5 text-[0.84rem] text-ink-soft">{t.tour.rainHint}</p>
                  <div className="mt-2.5 flex gap-2">
                    <Button size="sm" loading={adjusting} onClick={() => void adjustForWeather()}>
                      {t.tour.adjust}
                    </Button>
                    <Button size="sm" variant="quiet" onClick={() => setWeatherAlert(null)}>
                      {t.plan.fine}
                    </Button>
                  </div>
                </div>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <PlanMap
          origin={plan.request.origin}
          steps={plan.steps}
          mobility={plan.request.mobility}
          returnHome={plan.returnHome}
          home={plan.request.homeLocation}
          originLabel={startLabel(t, plan.request)}
        />

        <ol aria-label={t.tour.stationsAria(stationen)}>
          {plan.steps.map((step, index) => (
            <TourStop
              key={step.id}
              step={step}
              number={nummern[index]}
              isLast={index === plan.steps.length - 1}
              currency={plan.currency}
              tzOffsetMin={plan.tzOffsetMin}
              current={gestartet && index === position}
              done={gestartet && index < position}
              highlight={weatherAlert?.stepIds.includes(step.id) ?? false}
              onReplace={(s) => {
                setReplaceError(null);
                setReplacing(s);
              }}
              index={index}
              departISO={index === 0 ? plan.departISO : undefined}
            />
          ))}
          {plan.returnHome ? (
            <li className="relative pl-12">
              <div className="flex items-center gap-2 py-2.5 text-[0.78rem] text-ink-muted">
                <span aria-hidden>🚶</span>
                <span>{t.plan.returnWay(duration(t, plan.returnHome.durationMin), plan.returnHome.estimated)}</span>
              </div>
              <div className="flex items-center gap-3 rounded-3xl bg-canvas-sunk px-4 py-3">
                <span aria-hidden className="text-xl">🏠</span>
                <p className="text-[0.92rem] font-semibold tabular-nums">
                  {t.plan.homeAt(
                    formatClock(plan.returnHome.arriveISO, 'de', plan.tzOffsetMin),
                    plan.returnHome.estimated,
                  )}
                </p>
              </div>
            </li>
          ) : null}
        </ol>

        {plan.notes.length > 0 ? (
          <ul className="space-y-1.5">
            {plan.notes.map((note, index) => (
              <li
                key={`${note.kind}-${index}`}
                className="flex gap-2 rounded-2xl bg-canvas-sunk px-3.5 py-2.5 text-[0.84rem] text-ink-soft"
              >
                <span aria-hidden>{NOTE_EMOJI[note.kind]}</span>
                <span>{noteText(t, note)}</span>
              </li>
            ))}
          </ul>
        ) : null}

        <section className="space-y-2.5">
          <h2 className="text-[0.95rem] font-bold tracking-tight">{t.tour.adjustTitle}</h2>
          <div className="-mx-[1.15rem] edge-fade">
            <div className="scroll-x px-[1.15rem]">
              {ANPASSEN.map((option) => (
                <Chip
                  key={option.tweak}
                  emoji={option.emoji}
                  disabled={regenerating}
                  onClick={() => void anpassen(option.tweak)}
                >
                  {t.tour.tweaks[option.tweak]}
                </Chip>
              ))}
            </div>
          </div>
          {tweakError ? (
            <p className="rounded-2xl bg-brand-50 px-4 py-3 text-[0.86rem] text-brand-700">
              {tweakError}
            </p>
          ) : null}
        </section>

        <GroupPanel plan={plan} onPlanChange={setPlan} />

        <p className="px-1 text-[0.72rem] leading-relaxed text-ink-faint">
          {t.tour.sources}
        </p>
      </main>

      {/* Eine Hauptaktion – sie wächst mit der Tour mit. */}
      <div className="fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-canvas via-canvas/95 to-transparent pt-6">
        <div className="shell safe-bottom">
          {!gestartet ? (
            <Button size="lg" full onClick={starten} icon={<span aria-hidden>🚀</span>}>
              {t.tour.start}
            </Button>
          ) : fertig ? (
            <Button size="lg" full variant="secondary" onClick={() => setFeedbackOpen(true)}>
              {t.plan.feedback}
            </Button>
          ) : (
            <Button size="lg" full onClick={weiter}>
              <span className="truncate">
                {naechster
                  ? t.tour.next(String(nummern[position + 1] ?? t.tour.breakLabel), naechster.place.name)
                  : t.tour.finish}
              </span>
            </Button>
          )}
        </div>
      </div>

      <ReplaceSheet
        step={replacing}
        onClose={() => setReplacing(null)}
        onReplace={handleReplace}
        error={replaceError}
        options={ERSETZEN}
        note={t.replace.noteTour}
      />
      <ShareSheet plan={plan} open={shareOpen} onClose={() => setShareOpen(false)} />
      <TimeSheet plan={plan} open={timeOpen} onClose={() => setTimeOpen(false)} onPlanChange={setPlan} />
      <FeedbackSheet plan={plan} open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
      <StartPointSheet
        open={startOpen}
        onClose={() => setStartOpen(false)}
        onPick={(next) => void startWechseln(next)}
        onUseDevice={() => requestDevice()}
        near={plan.request.origin}
      />
      <PlanningOverlay open={regenerating} phase={phase} />
    </>
  );
}

const NOTE_EMOJI: Record<string, string> = {
  info: 'ℹ️',
  weather: '🌦️',
  budget: '💰',
  time: '🕐',
  availability: '📍',
};
