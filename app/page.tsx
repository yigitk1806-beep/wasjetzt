'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'motion/react';
import { TopBar } from '@/components/TopBar';
import { PlanningOverlay } from '@/components/PlanningOverlay';
import { ActionCard } from '@/components/home/ActionCard';
import { CategoryTiles } from '@/components/home/CategoryTiles';
import { DiscoverCard } from '@/components/home/DiscoverCard';
import { DealsStrip } from '@/components/home/DealsStrip';
import { LocationSheet } from '@/components/location/LocationSheet';
import { useLocale } from '@/components/LocaleProvider';
import { useLocation } from '@/hooks/useLocation';
import { useWeather } from '@/hooks/useWeather';
import { loadRecentPlans, suggestRoutine, type RecentPlan } from '@/lib/clientStore';
import { requestPlanStreamed, type PlanPhase, type PlanRequestInput } from '@/lib/planClient';
import type { Category } from '@/types/domain';

export default function HomePage() {
  const router = useRouter();
  const { t } = useLocale();
  const { location, status, requestDevice, setManual } = useLocation();
  const weather = useWeather(location?.location ?? null);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<PlanPhase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentPlan[]>([]);
  const [routineHint, setRoutineHint] = useState<string | null>(null);

  // Ortsdaten schon beim Lesen der Startseite laden, damit "Jetzt los"
  // nicht auf das Netz warten muss.
  useEffect(() => {
    if (!location) return;
    void fetch('/api/prefetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(location.location),
    }).catch(() => undefined);
  }, [location?.location.lat, location?.location.lon]);

  useEffect(() => {
    setRecent(loadRecentPlans().slice(0, 1));
    const routine = suggestRoutine(new Date().getDay());
    if (routine) {
      const moodLabel = routine.moods[0];
      setRoutineHint(
        moodLabel ? `Wie sonst ${WEEKDAY[new Date().getDay()]}: ${MOOD_LABEL[moodLabel]}?` : null,
      );
    }
  }, []);

  const go = useCallback(
    async (extra: Partial<PlanRequestInput>) => {
      if (!location) {
        setSheetOpen(true);
        return;
      }
      setBusy(true);
      setPhase(null);
      setError(null);

      const response = await requestPlanStreamed({
        lat: location.location.lat,
        lon: location.location.lon,
        originLabel: location.label,
        startISO: new Date().toISOString(),
        ...extra,
      }, setPhase);

      if (response.plan) {
        router.push(`/plan/${response.plan.id}`);
        return;
      }

      setBusy(false);
      setPhase(null);
      setError(response.message ?? response.error ?? t.plan.empty);
    },
    [location, router, t.plan.empty],
  );

  const disabled = !location;

  return (
    <>
      <TopBar
        locationLabel={location?.label ?? null}
        locating={status === 'locating'}
        weather={weather.now}
        onLocationClick={() => setSheetOpen(true)}
      />

      <main className="shell space-y-7 pt-8">
        <motion.h1
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="text-balance text-[2.5rem] font-bold leading-[1.06] tracking-[-0.03em]"
        >
          {t.home.headline}
        </motion.h1>

        {status === 'unavailable' && !location ? (
          <motion.button
            type="button"
            onClick={() => setSheetOpen(true)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="tap flex w-full items-center gap-3 rounded-2xl bg-sun-100 px-4 py-3.5 text-left text-[0.88rem] text-ink-soft"
          >
            <span aria-hidden>📍</span>
            <span className="flex-1">{t.location.denied}</span>
            <span className="font-semibold text-brand-600">{t.location.choose}</span>
          </motion.button>
        ) : null}

        <div className="space-y-3">
          <ActionCard
            emoji="⚡"
            title={t.home.now}
            hint={t.home.nowHint}
            primary
            delay={0.08}
            disabled={disabled}
            onClick={() => void go({})}
          />
          <ActionCard
            emoji="✨"
            title={t.home.build}
            hint={t.home.buildHint}
            delay={0.14}
            disabled={disabled}
            onClick={() => router.push('/planen')}
          />
          <ActionCard
            emoji="🎲"
            title={t.home.surprise}
            hint={t.home.surpriseHint}
            delay={0.2}
            disabled={disabled}
            onClick={() => void go({ surprise: true })}
          />
          <DiscoverCard delay={0.26} onClick={() => router.push('/entdecken')} />
        </div>

        {error ? (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="rounded-2xl bg-brand-50 px-4 py-3 text-[0.87rem] text-brand-700"
          >
            {error}
          </motion.p>
        ) : null}

        {routineHint ? (
          <button
            type="button"
            onClick={() => void go({})}
            className="tap w-full rounded-2xl bg-canvas-sunk px-4 py-3 text-left text-[0.86rem] text-ink-soft"
          >
            💡 {routineHint}
          </button>
        ) : null}

        <section className="space-y-2.5">
          <h2 className="text-[0.95rem] font-bold tracking-tight">{t.home.nearby}</h2>
          <CategoryTiles
            disabled={disabled}
            onPick={(category: Category) =>
              void go({ focusCategory: category, singleActivity: category === 'cafe' })
            }
          />
        </section>

        <DealsStrip
          coords={location?.location ?? null}
          onPick={(deal) => void go({ focusCategory: deal.place.category })}
        />

        {recent.length > 0 ? (
          <section className="space-y-2.5">
            <h2 className="text-[0.95rem] font-bold tracking-tight">{t.home.lastPlan}</h2>
            {recent.map((plan) => (
              <Link
                key={plan.id}
                href={`/plan/${plan.id}`}
                className="tap flex items-center gap-3 rounded-3xl bg-canvas-raised p-4 shadow-card hairline"
              >
                <span className="text-lg" aria-hidden>
                  {plan.emojis.slice(0, 3).join(' ')}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.95rem] font-semibold">{plan.title}</span>
                  <span className="block truncate text-[0.8rem] text-ink-muted">
                    {plan.summary}
                  </span>
                </span>
              </Link>
            ))}
          </section>
        ) : null}
      </main>

      <LocationSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onPick={setManual}
        onUseDevice={() => void requestDevice()}
      />
      <PlanningOverlay open={busy} phase={phase} />
    </>
  );
}

const WEEKDAY = ['sonntags', 'montags', 'dienstags', 'mittwochs', 'donnerstags', 'freitags', 'samstags'];

const MOOD_LABEL: Record<string, string> = {
  date: 'etwas Romantisches',
  action: 'etwas mit Action',
  chill: 'etwas Entspanntes',
  party: 'etwas zum Feiern',
  food: 'etwas Essen',
  nature: 'raus in die Natur',
  gaming: 'etwas zum Zocken',
  new: 'etwas Neues',
};
