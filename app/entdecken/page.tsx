'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import { PlanningOverlay } from '@/components/PlanningOverlay';
import { StartPointSheet } from '@/components/location/StartPointSheet';
import { MapPin } from '@/components/ui/icons';
import {
  TimeField,
  clockFromMin,
  minutesOf,
  nextQuarter,
  startDay,
  startMinutes,
  useNowClock,
} from '@/components/ui/TimeField';
import { useLocale } from '@/components/LocaleProvider';
import { DEVICE_LOCATION_LABEL, errorText } from '@/lib/i18n/format';
import { useLocation } from '@/hooks/useLocation';
import { requestPlanStreamed, type PlanPhase } from '@/lib/planClient';
import type { SightTheme } from '@/types/domain';

/**
 * Sehenswürdigkeiten: eine Frage, ein Tipp – dann steht die Tour.
 *
 * Die Dauer ist vorausgewählt und nur ein schmaler Schalter; wer sie nicht
 * ändern will, braucht von der Startseite genau zwei Tipps bis zur Tour.
 */

type Auswahl = {
  key: 'wahrzeichen' | 'kultur' | 'parks' | 'fotos' | 'ueberraschung';
  emoji: string;
  interests: SightTheme[];
  tint: string;
};

const AUSWAHL: Auswahl[] = [
  {
    key: 'wahrzeichen',
    emoji: '🏛️',
    interests: ['classic'],
    tint: 'from-brand-100 to-sun-100',
  },
  {
    key: 'kultur',
    emoji: '🎨',
    interests: ['museum', 'history'],
    tint: 'from-plum-100 to-sky-100',
  },
  {
    key: 'parks',
    emoji: '🌳',
    interests: ['park'],
    tint: 'from-mint-100 to-sky-100',
  },
  {
    key: 'fotos',
    emoji: '📸',
    interests: ['photo'],
    tint: 'from-sky-100 to-plum-100',
  },
  {
    key: 'ueberraschung',
    emoji: '✨',
    interests: [],
    tint: 'from-sun-100 to-brand-100',
  },
];

const DAUER = [{ minutes: 120 }, { minutes: 210 }, { minutes: 300 }, { minutes: 480 }] as const;

export default function EntdeckenPage() {
  const { t } = useLocale();
  const router = useRouter();
  const { location, setManual, requestDevice } = useLocation();
  const [minutes, setMinutes] = useState(210);
  const [minutesTouched, setMinutesTouched] = useState(false);
  const [startAt, setStartAt] = useState<string | null>(null);
  const [homeBy, setHomeBy] = useState<string | null>(null);
  const jetzt = useNowClock();

  // Mit Heimkehrzeit passt sich die Dauer dem Fenster an – solange sie nicht
  // selbst gewählt wurde.
  const startMin = startMinutes(startAt, jetzt);
  const fensterMin =
    homeBy && startMin !== null ? (((minutesOf(homeBy) - startMin) % 1440) + 1440) % 1440 : null;
  useEffect(() => {
    if (fensterMin === null || minutesTouched) return;
    const passend = [...DAUER].reverse().find((d) => d.minutes <= fensterMin) ?? DAUER[0];
    setMinutes(passend.minutes);
  }, [fensterMin, minutesTouched]);
  const [busy, setBusy] = useState<string | null>(null);
  const [phase, setPhase] = useState<PlanPhase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const vorladen = useRef<Promise<unknown> | null>(null);

  // Sehenswürdigkeiten schon laden, während die Auswahl gelesen wird.
  useEffect(() => {
    if (!location) return;
    const laden = (theme?: string) =>
      fetch('/api/prefetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...location.location, ...(theme ? { theme } : {}) }),
      }).catch(() => undefined);
    vorladen.current = Promise.all([laden('sights'), laden()]);
  }, [location?.location.lat, location?.location.lon]);

  async function tour(auswahl: Auswahl) {
    // Ohne Startpunkt keine Tour – erst GPS versuchen, dann fragen.
    let start = location;
    if (!start) {
      start = await requestDevice();
      if (!start) {
        setSheetOpen(true);
        return;
      }
    }
    setBusy(auswahl.key);
    setPhase('orte');
    setError(null);
    const beginn = Date.now();

    // Läuft das Vorladen noch, wird darauf gewartet statt eine zweite,
    // gleichzeitige Abfrage zu starten – die öffentlichen OSM-Server
    // erlauben pro Absender nur wenige gleichzeitig.
    if (vorladen.current) {
      await Promise.race([vorladen.current, new Promise((r) => setTimeout(r, 25_000))]);
    }

    const anfrage = () =>
      requestPlanStreamed(
        {
          lat: start.location.lat,
          lon: start.location.lon,
          originLabel: start.label,
          originFromDevice: start.fromDevice,
          startISO: new Date().toISOString(),
          availableMinutes: minutes,
          startLocal: startAt ?? undefined,
          homeByLocal: homeBy ?? undefined,
          mode: 'tour',
          mobility: 'walk',
          interests: auswahl.interests,
        },
        setPhase,
      );

    let response = await anfrage();
    // Überlastete OSM-Server erholen sich meist in Sekunden – einmal still
    // neu versuchen, bevor der Nutzer eine Fehlermeldung sieht.
    // Nicht, wenn schon lange gewartet wurde – dann lieber ehrlich absagen.
    if (!response.plan && response.error === 'sights-unavailable' && Date.now() - beginn < 30_000) {
      setPhase('orte');
      await new Promise((r) => setTimeout(r, 2500));
      response = await anfrage();
    }

    if (response.plan) {
      router.push(`/plan/${response.plan.id}`);
      return;
    }
    setBusy(null);
    setPhase(null);
    setError(errorText(t, response));
  }

  const ort = location?.label && location.label !== DEVICE_LOCATION_LABEL ? location.label : null;

  return (
    <>
      <header className="shell safe-top flex items-center gap-2 pt-3">
        <button
          type="button"
          onClick={() => router.push('/')}
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
        </button>
        <span className="text-[0.95rem] font-semibold text-ink-soft">{t.discover.title}</span>
      </header>

      <main className="shell space-y-6 pb-16 pt-5">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="space-y-2"
        >
          <h1 className="text-balance text-[2.1rem] font-bold leading-[1.08] tracking-[-0.03em]">
            {t.discover.question}
          </h1>
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="tap -ml-1 inline-flex items-center gap-1.5 rounded-full px-1 py-1 text-[0.88rem] text-ink-muted"
          >
            <MapPin size={15} className="text-brand-500" />
            {location ? (ort ? t.discover.around(ort) : t.discover.aroundYou) : t.discover.chooseLocation}
            <span className="font-semibold text-brand-600">{t.discover.change}</span>
          </button>
        </motion.div>

        {/* Dauer: vorausgewählt, deshalb kein eigener Schritt. */}
        <div
          role="radiogroup"
          aria-label={t.discover.durationAria}
          className="grid grid-cols-4 gap-1 rounded-2xl bg-canvas-sunk p-1"
        >
          {DAUER.map((option) => {
            const aktiv = minutes === option.minutes;
            return (
              <button
                key={option.minutes}
                type="button"
                role="radio"
                aria-checked={aktiv}
                onClick={() => {
                  setMinutes(option.minutes);
                  setMinutesTouched(true);
                }}
                className={[
                  'tap h-10 rounded-xl text-[0.8rem] font-semibold transition-colors',
                  aktiv ? 'bg-canvas-raised text-ink shadow-card' : 'text-ink-muted',
                ].join(' ')}
              >
                {t.discover.durations[option.minutes]}
              </button>
            );
          })}
        </div>

        {/* Start und Heimkehr: vorausgewählt „jetzt" und „offen", ein Tipp
            öffnet den Zeitpicker des Handys. */}
        <div className="-mt-3 flex flex-wrap gap-2">
          <TimeField
            compact
            icon="🕐"
            label={t.time.startLabel}
            value={startAt}
            emptyText={t.time.compactStartNow(jetzt)}
            valueText={(v) => t.time.compactStart(startDay(v), v)}
            actionText={t.time.changeStart}
            resetText={t.time.now}
            pickerDefault={nextQuarter(jetzt)}
            onChange={setStartAt}
          />
          <TimeField
            compact
            icon="🏠"
            label={t.time.homeLabel}
            value={homeBy}
            emptyText={t.time.compactHomeNone}
            valueText={(v) => t.time.compactHome(v)}
            actionText={t.time.homeSet}
            changeText={t.time.change}
            resetText={t.time.homeClear}
            pickerDefault={clockFromMin(Math.round(((startMin ?? 720) + minutes + 30) / 60) * 60)}
            commitOnBlur
            onChange={setHomeBy}
          />
        </div>

        <div className="space-y-3">
          {AUSWAHL.map((auswahl, index) => (
            <motion.button
              key={auswahl.key}
              type="button"
              disabled={busy !== null}
              onClick={() => void tour(auswahl)}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.06 + index * 0.05, duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
              whileTap={{ scale: 0.975 }}
              className="group flex w-full items-center gap-4 rounded-3xl bg-canvas-raised px-4 py-4 text-left shadow-card hairline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-60"
            >
              <span
                className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br ${auswahl.tint} text-[1.7rem]`}
                aria-hidden
              >
                {auswahl.emoji}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[1.06rem] font-bold tracking-tight">
                  {t.discover.options[auswahl.key].title}
                </span>
                <span className="mt-0.5 block text-[0.84rem] leading-snug text-ink-muted">
                  {t.discover.options[auswahl.key].hint}
                </span>
              </span>
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden
                className="shrink-0 text-ink-faint transition-transform duration-200 group-hover:translate-x-0.5"
              >
                <path
                  d="m9 6 6 6-6 6"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </motion.button>
          ))}
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

        <p className="px-1 text-[0.78rem] leading-relaxed text-ink-faint">
          {t.discover.footer(startAt, homeBy)}
        </p>
      </main>

      <StartPointSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onPick={(start) => {
          if (!start.fromDevice) setManual(start.label, start.location);
        }}
        onUseDevice={() => requestDevice()}
        near={location?.location ?? null}
      />
      <PlanningOverlay open={busy !== null} phase={phase} />
    </>
  );
}
