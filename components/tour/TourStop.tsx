'use client';

import { motion } from 'motion/react';
import { formatDistance } from '@/lib/geo';
import { clockFromMinutes, formatClock, formatDuration, openUntil } from '@/lib/time';
import { formatPrice } from '@/components/plan/PlanTimeline';
import { Clock, Coffee, DoorOpen, Footprints, Navigation, Refresh } from '@/components/ui/icons';
import type { Mobility, PlanStep } from '@/types/domain';
import { useWiki } from './useWiki';

const UNTERWEGS: Record<Mobility, string> = {
  walk: 'zu Fuß',
  bike: 'mit dem Rad',
  transit: 'mit Bus & Bahn',
  car: 'mit dem Auto',
};

type Props = {
  step: PlanStep;
  /** Laufende Nummer unter den Sehenswürdigkeiten; `null` bei Pausen. */
  number: number | null;
  isLast: boolean;
  currency: string;
  tzOffsetMin?: number;
  /** Gerade unterwegs zu dieser Station. */
  current?: boolean;
  /** Schon besucht. */
  done?: boolean;
  highlight?: boolean;
  onReplace: (step: PlanStep) => void;
  index: number;
};

/** Eine Station der Tour: Eindruck, Eckdaten, zwei Aktionen. */
export function TourStop({
  step,
  number,
  isLast,
  currency,
  tzOffsetMin,
  current = false,
  done = false,
  highlight = false,
  onReplace,
  index,
}: Props) {
  const travel = step.travelFromPrevious;

  return (
    <li className="relative">
      {/* Weg von der vorigen Station */}
      {travel.durationMin > 0 ? (
        <div className="relative flex items-center gap-2 py-2.5 pl-12 text-[0.78rem] text-ink-muted">
          <Linie />
          <Footprints size={15} className="shrink-0 text-ink-faint" />
          <span>
            {travel.estimated ? 'ca. ' : ''}
            {formatDuration(travel.durationMin)} {UNTERWEGS[travel.mode]} ·{' '}
            {formatDistance(travel.distanceMeters)}
          </span>
        </div>
      ) : null}

      <div className="relative pl-12">
        {!isLast ? <Linie from="top-4" /> : null}
        <Marker number={number} current={current} done={done} />

        {number === null ? (
          <Pause
            step={step}
            currency={currency}
            tzOffsetMin={tzOffsetMin}
            onReplace={onReplace}
            highlight={highlight || current}
          />
        ) : (
          <Station
            step={step}
            currency={currency}
            tzOffsetMin={tzOffsetMin}
            onReplace={onReplace}
            highlight={highlight || current}
            index={index}
          />
        )}
      </div>
    </li>
  );
}

function Linie({ from = 'top-0' }: { from?: string }) {
  return (
    <span
      aria-hidden
      className={`absolute bottom-0 left-[1.1rem] ${from} w-[2px] rounded-full bg-gradient-to-b from-brand-200 to-line`}
    />
  );
}

function Marker({ number, current, done }: { number: number | null; current: boolean; done: boolean }) {
  if (number === null) {
    return (
      <span className="absolute left-[0.35rem] top-3 grid h-8 w-8 place-items-center rounded-full bg-sun-100 text-sun-700 ring-4 ring-canvas">
        <Coffee size={15} />
      </span>
    );
  }
  return (
    <span
      className={[
        'absolute left-0 top-3 grid h-[2.35rem] w-[2.35rem] place-items-center rounded-full text-[0.95rem] font-bold tabular-nums ring-4 ring-canvas',
        current
          ? 'bg-gradient-to-b from-brand-400 to-brand-600 text-white shadow-brand'
          : done
            ? 'bg-mint-100 text-mint-700'
            : 'bg-ink text-white',
      ].join(' ')}
    >
      {number}
    </span>
  );
}

type StationProps = {
  step: PlanStep;
  currency: string;
  tzOffsetMin?: number;
  onReplace: (step: PlanStep) => void;
  highlight: boolean;
  index?: number;
};

function Station({ step, currency, tzOffsetMin, onReplace, highlight, index = 0 }: StationProps) {
  const wiki = useWiki(step.place.wikipedia);
  const beschreibung = wiki?.text ?? step.reason;
  const laedt = wiki === undefined;

  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 * index, duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
      className={[
        'overflow-hidden rounded-3xl bg-canvas-raised shadow-card',
        highlight ? 'ring-2 ring-brand-300' : 'hairline',
      ].join(' ')}
    >
      <Eindruck bild={wiki?.bild ?? null} laedt={laedt} emoji={step.place.emoji} name={step.place.name} />

      <div className="p-4">
        <div className="flex items-center gap-1.5 text-[0.78rem] font-medium text-ink-muted">
          <Clock size={14} className="text-ink-faint" />
          <span className="tabular-nums">{formatClock(step.startISO, 'de', tzOffsetMin)}</span>
          <span className="text-ink-faint">·</span>
          <span>{formatDuration(step.durationMin)} Aufenthalt</span>
        </div>

        <h3 className="mt-1 text-[1.12rem] font-bold leading-snug tracking-tight">
          {step.place.name}
        </h3>
        <p className="mt-0.5 text-[0.8rem] text-ink-muted">
          {step.place.kind} · {formatPrice(step.price, currency)}
        </p>

        {laedt ? (
          <div className="mt-2.5 space-y-1.5" aria-hidden>
            <div className="skeleton h-3 w-full rounded-full" />
            <div className="skeleton h-3 w-4/5 rounded-full" />
          </div>
        ) : (
          <p className="mt-2 text-[0.87rem] leading-relaxed text-ink-soft">
            <span className="line-clamp-3">{beschreibung}</span>
            {wiki?.link ? (
              <a
                href={wiki.link}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-0.5 inline-block text-[0.7rem] text-ink-faint underline-offset-2 hover:underline"
              >
                Quelle: Wikipedia
              </a>
            ) : null}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Oeffnung step={step} tzOffsetMin={tzOffsetMin} />
        </div>

        <div className="mt-3.5 flex items-center gap-2">
          <a
            href={navigationUrl(step)}
            target="_blank"
            rel="noopener noreferrer"
            className="tap inline-flex h-9 items-center gap-1.5 rounded-xl bg-canvas-sunk px-3 text-[0.8rem] font-semibold text-ink-soft"
          >
            <Navigation size={14} /> Hinführen
          </a>
          <button
            type="button"
            onClick={() => onReplace(step)}
            className="tap inline-flex h-9 items-center gap-1.5 rounded-xl bg-canvas-sunk px-3 text-[0.8rem] font-semibold text-ink-soft"
          >
            <Refresh size={14} /> Ersetzen
          </button>
        </div>
      </div>
    </motion.article>
  );
}

/**
 * Bild aus dem Wikipedia-Artikel. Ohne Bild gibt es eine ruhige Fläche mit
 * dem Symbol der Art – nie ein Foto, das nicht diesen Ort zeigt.
 */
function Eindruck({
  bild,
  laedt,
  emoji,
  name,
}: {
  bild: string | null;
  laedt: boolean;
  emoji: string;
  name: string;
}) {
  if (laedt) return <div className="skeleton aspect-[16/9] w-full" aria-hidden />;

  if (bild) {
    return (
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-canvas-sunk">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={bild}
          alt={name}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
      </div>
    );
  }

  return (
    <div
      className="grid h-20 w-full place-items-center bg-gradient-to-br from-sky-100 via-canvas-sunk to-mint-100"
      aria-hidden
    >
      <span className="text-[2rem] leading-none">{emoji}</span>
    </div>
  );
}

function Oeffnung({ step, tzOffsetMin }: { step: PlanStep; tzOffsetMin?: number }) {
  const hours = step.place.openingHours;

  if (!hours) {
    return (
      <Hinweis tone="sun">
        <DoorOpen size={14} /> Öffnungszeiten nicht verfügbar
      </Hinweis>
    );
  }

  const bis = openUntil(hours, new Date(step.startISO), tzOffsetMin ?? 0);
  if (bis === null) {
    // Die Tourplanung prüft das – kommt es trotzdem vor (Tour später
    // geöffnet), lieber deutlich sagen als schweigen.
    return (
      <Hinweis tone="brand">
        <DoorOpen size={14} /> Zu dieser Zeit geschlossen
      </Hinweis>
    );
  }

  const tage = Object.values(hours);
  const rundUmDieUhr =
    tage.length === 7 && tage.every((ivs) => ivs?.some((iv) => iv.openMin === 0 && iv.closeMin >= 1440));
  return (
    <Hinweis tone="mint">
      <DoorOpen size={14} />
      {rundUmDieUhr
        ? 'Rund um die Uhr geöffnet'
        : bis === 1440
          ? 'Geöffnet bis Mitternacht'
          : `Geöffnet bis ${clockFromMinutes(bis)}`}
    </Hinweis>
  );
}

function Hinweis({ tone, children }: { tone: 'mint' | 'sun' | 'brand'; children: React.ReactNode }) {
  const farben = {
    mint: 'bg-mint-100 text-mint-700',
    sun: 'bg-sun-100 text-sun-700',
    brand: 'bg-brand-50 text-brand-700',
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.74rem] font-medium ${farben[tone]}`}
    >
      {children}
    </span>
  );
}

/** Kompakte Zeile für eine Kaffee- oder Mittagspause. */
function Pause({ step, currency, tzOffsetMin, onReplace, highlight }: StationProps) {
  return (
    <div
      className={[
        'flex items-center gap-3 rounded-3xl bg-canvas-raised px-4 py-3.5 shadow-card',
        highlight ? 'ring-2 ring-brand-300' : 'hairline',
      ].join(' ')}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[0.76rem] font-medium text-ink-muted">
          <span className="tabular-nums">{formatClock(step.startISO, 'de', tzOffsetMin)}</span> ·{' '}
          {step.reason.replace(/\.$/, '')}
        </p>
        <p className="truncate text-[0.95rem] font-semibold">{step.place.name}</p>
        <p className="text-[0.78rem] text-ink-muted">
          {step.place.kind} · {formatDuration(step.durationMin)} · {formatPrice(step.price, currency)}
        </p>
      </div>
      <button
        type="button"
        onClick={() => onReplace(step)}
        aria-label={`${step.place.name} ersetzen`}
        className="tap grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-canvas-sunk text-ink-soft"
      >
        <Refresh size={15} />
      </button>
    </div>
  );
}

/** Route von hier (Gerätestandort) zur Station in der Karten-App. */
function navigationUrl(step: PlanStep): string {
  const { lat, lon } = step.place.location;
  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api', '1');
  url.searchParams.set('destination', `${lat.toFixed(5)},${lon.toFixed(5)}`);
  url.searchParams.set('travelmode', TRAVEL_MODE[step.travelFromPrevious.mode]);
  return url.toString();
}

const TRAVEL_MODE: Record<Mobility, string> = {
  walk: 'walking',
  bike: 'bicycling',
  transit: 'transit',
  car: 'driving',
};

export { navigationUrl };
