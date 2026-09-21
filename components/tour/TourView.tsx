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
import { formatPrice } from '@/components/plan/PlanTimeline';
import { ReplaceSheet, type ReplaceOption } from '@/components/plan/ReplaceSheet';
import { ShareSheet } from '@/components/plan/ShareSheet';
import { GroupPanel } from '@/components/plan/GroupPanel';
import { FeedbackSheet } from '@/components/plan/FeedbackSheet';
import { weatherEmoji } from '@/engine/weatherRules';
import { formatClock, formatDuration } from '@/lib/time';
import { recordPlanStarted } from '@/lib/clientStore';
import { replacePlanStep, requestPlanStreamed, type PlanPhase } from '@/lib/planClient';
import type { Plan, PlanStep, TourTweak } from '@/types/domain';
import { TourStop, navigationUrl } from './TourStop';

const PlanMap = dynamic(() => import('@/components/plan/PlanMap').then((m) => m.PlanMap), {
  ssr: false,
  loading: () => <div className="skeleton h-[16rem] rounded-3xl" />,
});

/** Beim Ersetzen einer Sehenswürdigkeit – nur, was hier Sinn ergibt. */
const ERSETZEN: ReplaceOption[] = [
  { hint: 'any', emoji: '🔄', label: 'Etwas anderes', relevant: () => true },
  {
    hint: 'indoor',
    emoji: '🏛️',
    label: 'Lieber drinnen',
    relevant: (step) => step.place.indoorOutdoor !== 'indoor' && Boolean(step.place.themes?.length),
  },
  {
    hint: 'new',
    emoji: '💎',
    label: 'Ein Geheimtipp',
    relevant: (step) => Boolean(step.place.themes?.length),
  },
  {
    hint: 'cheaper',
    emoji: '🆓',
    label: 'Kostenlos',
    relevant: (step) => step.place.price.level > 0 && Boolean(step.place.themes?.length),
  },
];

/** Die ganze Tour in eine Richtung drehen – ohne Formular. */
const ANPASSEN: Array<{ tweak: TourTweak; emoji: string; label: string }> = [
  { tweak: 'less-walk', emoji: '👟', label: 'Weniger laufen' },
  { tweak: 'museum', emoji: '🏛️', label: 'Mehr Museen' },
  { tweak: 'photo', emoji: '📸', label: 'Mehr Fotospots' },
  { tweak: 'free', emoji: '🆓', label: 'Nur kostenlos' },
  { tweak: 'calm', emoji: '😌', label: 'Entspannter' },
];

type Props = { initialPlan: Plan };

export function TourView({ initialPlan }: Props) {
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
      setReplaceError(
        result.message ?? result.error ?? 'Hier in der Nähe gibt es gerade keine passende Alternative.',
      );
    },
    [plan.id, replacing],
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
    const response = await requestPlanStreamed(
      {
        lat: r.origin.lat,
        lon: r.origin.lon,
        originLabel: r.originLabel,
        startISO: new Date().toISOString(),
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
    setTweakError(response.message ?? response.error ?? 'Dafür finde ich hier gerade keine Tour.');
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
          aria-label="Zurück"
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
          <Share size={16} /> Teilen
        </button>
      </header>

      <main className="shell space-y-5 pb-32 pt-3">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="text-[0.9rem] font-medium text-brand-600">Deine Tour ist fertig.</p>
          <h1 className="mt-1 text-[1.9rem] font-bold leading-tight tracking-[-0.025em]">
            {plan.title}
          </h1>
          <p className="mt-1.5 text-[0.95rem] text-ink-muted">{plan.summary}</p>
        </motion.div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[0.86rem] text-ink-soft">
          <span className="font-semibold tabular-nums">
            {formatClock(plan.startISO, 'de', plan.tzOffsetMin)} –{' '}
            {formatClock(plan.endISO, 'de', plan.tzOffsetMin)}
          </span>
          <span className="text-ink-faint">·</span>
          <span>{formatDuration(plan.totalDurationMin)}</span>
          <span className="text-ink-faint">·</span>
          <span>{formatPrice(plan.cost, plan.currency)}</span>
          {plan.weatherAtCreation && plan.weatherAtCreation.condition !== 'unknown' ? (
            <>
              <span className="text-ink-faint">·</span>
              <span>
                {weatherEmoji(plan.weatherAtCreation)} {Math.round(plan.weatherAtCreation.temperatureC)} °C
              </span>
            </>
          ) : null}
        </div>

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
                  <p className="text-[0.9rem] font-semibold">Es soll regnen.</p>
                  <p className="mt-0.5 text-[0.84rem] text-ink-soft">
                    Ich kann die Stationen unter freiem Himmel gegen etwas Überdachtes tauschen.
                  </p>
                  <div className="mt-2.5 flex gap-2">
                    <Button size="sm" loading={adjusting} onClick={() => void adjustForWeather()}>
                      Tour anpassen
                    </Button>
                    <Button size="sm" variant="quiet" onClick={() => setWeatherAlert(null)}>
                      Passt schon
                    </Button>
                  </div>
                </div>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <PlanMap origin={plan.request.origin} steps={plan.steps} mobility={plan.request.mobility} />

        <ol aria-label={`${stationen} Stationen`}>
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
            />
          ))}
        </ol>

        {plan.notes.length > 0 ? (
          <ul className="space-y-1.5">
            {plan.notes.map((note, index) => (
              <li
                key={`${note.kind}-${index}`}
                className="flex gap-2 rounded-2xl bg-canvas-sunk px-3.5 py-2.5 text-[0.84rem] text-ink-soft"
              >
                <span aria-hidden>{NOTE_EMOJI[note.kind]}</span>
                <span>{note.text}</span>
              </li>
            ))}
          </ul>
        ) : null}

        <section className="space-y-2.5">
          <h2 className="text-[0.95rem] font-bold tracking-tight">Tour anpassen</h2>
          <div className="-mx-[1.15rem] edge-fade">
            <div className="scroll-x px-[1.15rem]">
              {ANPASSEN.map((option) => (
                <Chip
                  key={option.tweak}
                  emoji={option.emoji}
                  disabled={regenerating}
                  onClick={() => void anpassen(option.tweak)}
                >
                  {option.label}
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
          Orte und Öffnungszeiten: OpenStreetMap. Bilder und Beschreibungen: Wikipedia.
          Gehzeiten sind geschätzt.
        </p>
      </main>

      {/* Eine Hauptaktion – sie wächst mit der Tour mit. */}
      <div className="fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-canvas via-canvas/95 to-transparent pt-6">
        <div className="shell safe-bottom">
          {!gestartet ? (
            <Button size="lg" full onClick={starten} icon={<span aria-hidden>🚀</span>}>
              Tour starten
            </Button>
          ) : fertig ? (
            <Button size="lg" full variant="secondary" onClick={() => setFeedbackOpen(true)}>
              Wie war&apos;s?
            </Button>
          ) : (
            <Button size="lg" full onClick={weiter}>
              <span className="truncate">
                {naechster
                  ? `Weiter: ${nummern[position + 1] ?? 'Pause'} · ${naechster.place.name}`
                  : 'Tour beenden'}
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
        note="Der Rest der Tour bleibt, nur die Zeiten danach verschieben sich."
      />
      <ShareSheet plan={plan} open={shareOpen} onClose={() => setShareOpen(false)} />
      <FeedbackSheet plan={plan} open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
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
