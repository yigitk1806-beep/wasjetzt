'use client';

import { motion } from 'motion/react';
import { formatClock, formatDuration } from '@/lib/time';
import { formatDistance } from '@/lib/geo';
import { PRICE_LEVEL_LABEL } from '@/providers/activityProfiles';
import type { Mobility, Plan, PlanStep, PriceInfo } from '@/types/domain';

const MOBILITY_EMOJI: Record<Mobility, string> = {
  walk: '🚶',
  bike: '🚲',
  transit: '🚇',
  car: '🚗',
};

type Props = {
  steps: PlanStep[];
  currency: string;
  /** Uhrzeiten in Ortszeit des Plans, nicht in der Zeit des Geräts. */
  tzOffsetMin?: number;
  onReplace: (step: PlanStep) => void;
  highlightIds?: string[];
  /** Wann es losgeht – steht vor dem ersten Weg. */
  departISO?: string;
  /** Rückweg, wenn eine Heimkehrzeit gesetzt ist. */
  returnHome?: Plan['returnHome'];
  mobility?: Mobility;
};

/**
 * Der Plan als Zeitleiste: Aufbruch, Weg, Station von–bis, Weg, Station …,
 * und am Ende – mit Heimkehrzeit – der Rückweg. So sieht man ohne Rechnen,
 * wann man wo ist.
 */
export function PlanTimeline({
  steps,
  currency,
  tzOffsetMin,
  onReplace,
  highlightIds = [],
  departISO,
  returnHome,
  mobility = 'walk',
}: Props) {
  return (
    <ol className="space-y-1">
      {steps.map((step, index) => (
        <li key={step.id}>
          {step.travelFromPrevious.durationMin > 0 || (index === 0 && departISO) ? (
            <Weg
              aufbruch={index === 0 && departISO ? formatClock(departISO, 'de', tzOffsetMin) : undefined}
              mode={step.travelFromPrevious.mode}
              leg={step.travelFromPrevious}
            />
          ) : null}

          <motion.article
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.06 * index, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className={[
              'flex gap-3 rounded-3xl bg-canvas-raised p-3.5 shadow-card',
              highlightIds.includes(step.id) ? 'ring-2 ring-sun-300' : 'hairline',
            ].join(' ')}
          >
            <span
              className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-canvas-sunk text-xl"
              aria-hidden
            >
              {step.place.emoji}
            </span>

            <div className="min-w-0 flex-1">
              <p className="text-[0.8rem] font-semibold tabular-nums text-ink-soft">
                {formatClock(step.startISO, 'de', tzOffsetMin)}–{formatClock(step.endISO, 'de', tzOffsetMin)}
                <span className="font-normal text-ink-faint"> · {formatDuration(step.durationMin)}</span>
              </p>
              <h3 className="mt-0.5 truncate text-[1rem] font-semibold leading-tight">
                {step.place.name}
              </h3>
              <p className="mt-0.5 text-[0.8rem] text-ink-muted">
                {step.place.kind} · {formatPrice(step.price, currency)}
              </p>
              {!step.openingHoursKnown ? (
                <p className="mt-1 text-[0.76rem] text-sun-700">Öffnungszeiten nicht verfügbar</p>
              ) : null}

              <p className="mt-2 text-[0.8rem] leading-snug text-ink-soft">{step.reason}</p>

              {step.place.deal ? (
                <p className="mt-1.5 inline-block rounded-full bg-mint-100 px-2.5 py-1 text-[0.74rem] font-medium text-mint-700">
                  {step.place.deal.label}
                </p>
              ) : null}

              <button
                type="button"
                onClick={() => onReplace(step)}
                className="tap mt-2.5 inline-flex items-center gap-1.5 rounded-xl bg-canvas-sunk px-3 py-1.5 text-[0.78rem] font-semibold text-ink-soft"
              >
                <span aria-hidden>🔄</span> Ersetzen
              </button>
            </div>
          </motion.article>
        </li>
      ))}

      {returnHome ? (
        <li>
          <Weg mode={mobility} leg={returnHome} />
          <div className="flex items-center gap-3 rounded-3xl bg-canvas-sunk px-3.5 py-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-canvas-raised text-xl" aria-hidden>
              🏠
            </span>
            <p className="text-[0.9rem] font-semibold">
              Zuhause {returnHome.estimated ? 'ca. ' : 'um '}
              <span className="tabular-nums">{formatClock(returnHome.arriveISO, 'de', tzOffsetMin)}</span>
            </p>
          </div>
        </li>
      ) : null}
    </ol>
  );
}

/** Zeile zwischen zwei Stationen. „ca." nur dort, wo die Zeit wirklich geschätzt ist. */
function Weg({
  aufbruch,
  mode,
  leg,
}: {
  aufbruch?: string;
  mode: Mobility;
  leg: { durationMin: number; distanceMeters: number; estimated: boolean };
}) {
  return (
    <div className="flex items-center gap-2 py-1.5 pl-[3.75rem] text-[0.76rem] text-ink-faint">
      {aufbruch ? (
        <span className="font-semibold tabular-nums text-ink-muted">Los um {aufbruch} ·</span>
      ) : null}
      {leg.durationMin > 0 ? (
        <>
          <span aria-hidden>{MOBILITY_EMOJI[mode]}</span>
          <span>
            {leg.estimated ? 'ca. ' : ''}
            {formatDuration(leg.durationMin)} · {formatDistance(leg.distanceMeters)}
          </span>
        </>
      ) : (
        <span>direkt hier</span>
      )}
    </div>
  );
}

/**
 * Preisdarstellung. Eurobeträge erscheinen nur, wenn die Quelle sie wirklich
 * liefert; andernfalls gibt es das geschätzte Niveau als € / €€ / €€€.
 */
export function formatPrice(price: PriceInfo, currency: string): string {
  const symbol = currency === 'EUR' ? '€' : currency;

  if (price.perPerson) {
    const { min, max } = price.perPerson;
    if (max === 0) return 'kostenlos';
    return min === max ? `${min} ${symbol}` : `${min}–${max} ${symbol}`;
  }

  if (price.level === 0) return price.levelEstimated ? 'meist kostenlos' : 'kostenlos';
  return `${PRICE_LEVEL_LABEL[price.level]} geschätzt`;
}
