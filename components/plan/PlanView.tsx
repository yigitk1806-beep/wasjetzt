'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import { Button } from '@/components/ui/Button';
import dynamic from 'next/dynamic';
import { PlanTimeline } from './PlanTimeline';

// Leaflet wird erst im Browser geladen – die Plan-Seite ist sofort da,
// die Karte rückt nach.
const PlanMap = dynamic(() => import('./PlanMap').then((m) => m.PlanMap), {
  ssr: false,
  loading: () => <div className="skeleton h-[17.5rem] rounded-3xl" />,
});
import { ReplaceSheet } from './ReplaceSheet';
import { ShareSheet } from './ShareSheet';
import { GroupPanel } from './GroupPanel';
import { FeedbackSheet } from './FeedbackSheet';
import { PlanHeader } from './PlanHeader';
import { TimeSheet } from './TimeSheet';
import { recordPlanStarted, recordRejection } from '@/lib/clientStore';
import { replacePlanStep } from '@/lib/planClient';
import type { Plan, PlanStep } from '@/types/domain';

type Props = { initialPlan: Plan };

export function PlanView({ initialPlan }: Props) {
  const router = useRouter();
  const [plan, setPlan] = useState(initialPlan);
  const [replacing, setReplacing] = useState<PlanStep | null>(null);
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [started, setStarted] = useState(false);
  const [weatherAlert, setWeatherAlert] = useState<{ stepIds: string[] } | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);

  // Wetterwache: prüft beim Öffnen und danach alle 10 Minuten.
  useEffect(() => {
    let cancelled = false;

    const check = () => {
      fetch(`/api/plan/${plan.id}/weather-check`)
        .then((res) => res.json())
        .then((data) => {
          if (cancelled) return;
          if (data.changed && data.affectedStepIds?.length) {
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

  const handleReplace = useCallback(
    async (hint: string) => {
      if (!replacing) return;
      setReplaceError(null);
      const result = await replacePlanStep(plan.id, replacing.id, hint);

      if (result.plan) {
        recordRejection(replacing.place.category, hint);
        setPlan(result.plan);
        setReplacing(null);
        return;
      }
      setReplaceError(result.message ?? result.error ?? 'Keine Alternative gefunden.');
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

  function start() {
    recordPlanStarted(plan);
    setStarted(true);
  }

  return (
    <>
      <header className="shell safe-top flex items-center justify-between pt-3">
        <Link
          href="/"
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
          <span aria-hidden>↗</span> Teilen
        </button>
      </header>

      <main className="shell space-y-5 pb-28 pt-3">
        <PlanHeader plan={plan} onTimeClick={() => setTimeOpen(true)} />

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
                  ⚠️
                </span>
                <div className="flex-1">
                  <p className="text-[0.9rem] font-semibold">Das Wetter hat sich geändert.</p>
                  <p className="mt-0.5 text-[0.84rem] text-ink-soft">
                    Der geplante Outdoor-Teil könnte nass werden.
                  </p>
                  <div className="mt-2.5 flex gap-2">
                    <Button size="sm" loading={adjusting} onClick={() => void adjustForWeather()}>
                      Plan anpassen
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

        <PlanTimeline
          steps={plan.steps}
          currency={plan.currency}
          tzOffsetMin={plan.tzOffsetMin}
          onReplace={(step) => {
            setReplaceError(null);
            setReplacing(step);
          }}
          highlightIds={weatherAlert?.stepIds ?? []}
          departISO={plan.departISO}
          returnHome={plan.returnHome}
          mobility={plan.request.mobility}
        />

        <PlanMap
          origin={plan.request.origin}
          steps={plan.steps}
          mobility={plan.request.mobility}
          returnHome={plan.returnHome}
          home={plan.request.homeLocation}
        />

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

        {/* Andere Richtung – nur, wenn es echte Alternativen gibt. */}
        {plan.siblings && plan.siblings.length > 1 ? (
          <section className="space-y-2.5">
            <h2 className="text-[0.95rem] font-bold tracking-tight">Andere Richtung</h2>
            <div className="-mx-[1.15rem] edge-fade">
              <div className="scroll-x px-[1.15rem]">
                {plan.siblings.map((sibling) => (
                  <button
                    key={sibling.id}
                    type="button"
                    disabled={sibling.id === plan.id}
                    onClick={() => router.push(`/plan/${sibling.id}`)}
                    className={[
                      'tap shrink-0 rounded-2xl px-4 py-2.5 text-[0.88rem] font-semibold',
                      sibling.id === plan.id
                        ? 'bg-ink text-white'
                        : 'bg-canvas-raised text-ink-soft hairline shadow-card',
                    ].join(' ')}
                  >
                    {sibling.emoji} {sibling.title}
                  </button>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        <GroupPanel plan={plan} onPlanChange={setPlan} />

        {plan.containsMockData ? (
          <p className="rounded-2xl bg-canvas-sunk px-3.5 py-3 text-[0.76rem] leading-relaxed text-ink-faint">
            Demo-Daten: Orte, Preise und Öffnungszeiten in diesem Plan sind Beispiele und
            gehören zu keinem echten Betrieb. Wetter und Entfernungen sind echt berechnet.
          </p>
        ) : null}
      </main>

      {/* Eine Hauptaktion. */}
      <div className="fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-canvas via-canvas/95 to-transparent pt-6">
        <div className="shell safe-bottom flex gap-2">
          {started ? (
            <Button size="lg" full variant="secondary" onClick={() => setFeedbackOpen(true)}>
              Wie war&apos;s?
            </Button>
          ) : (
            <Button size="lg" full onClick={start} icon={<span aria-hidden>🚀</span>}>
              Los geht&apos;s
            </Button>
          )}
        </div>
      </div>

      <ReplaceSheet
        step={replacing}
        onClose={() => setReplacing(null)}
        onReplace={handleReplace}
        error={replaceError}
      />
      <ShareSheet plan={plan} open={shareOpen} onClose={() => setShareOpen(false)} />
      <TimeSheet plan={plan} open={timeOpen} onClose={() => setTimeOpen(false)} onPlanChange={setPlan} />
      <FeedbackSheet plan={plan} open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
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
