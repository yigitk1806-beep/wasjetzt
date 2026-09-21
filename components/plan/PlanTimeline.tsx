'use client';

import { motion } from 'motion/react';
import { formatClock, formatDuration } from '@/lib/time';
import { formatDistance } from '@/lib/geo';
import { PRICE_LEVEL_LABEL } from '@/providers/activityProfiles';
import type { Mobility, PlanStep, PriceInfo } from '@/types/domain';

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
};

/** Der Plan als Zeitstrahl: Uhrzeit links, Aktivität rechts, Wege dazwischen. */
export function PlanTimeline({ steps, currency, tzOffsetMin, onReplace, highlightIds = [] }: Props) {
  return (
    <ol className="space-y-1">
      {steps.map((step, index) => (
        <li key={step.id}>
          {step.travelFromPrevious.durationMin > 0 ? (
            <div className="flex items-center gap-2 py-1.5 pl-[3.75rem] text-[0.76rem] text-ink-faint">
              <span aria-hidden>{MOBILITY_EMOJI[step.travelFromPrevious.mode]}</span>
              {/* "ca." nur dort, wo die Zeit wirklich geschätzt ist.
                  formatDuration macht aus 90 Minuten "1 Std. 30 Min." – in der
                  Oberfläche steht nie eine reine Minutenzahl über einer Stunde. */}
              <span>
                {step.travelFromPrevious.estimated ? 'ca. ' : ''}
                {formatDuration(step.travelFromPrevious.durationMin)} ·{' '}
                {formatDistance(step.travelFromPrevious.distanceMeters)}
              </span>
            </div>
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
            <div className="flex w-[3rem] shrink-0 flex-col items-center pt-0.5">
              <span className="text-[0.92rem] font-bold tabular-nums">
                {formatClock(step.startISO, 'de', tzOffsetMin)}
              </span>
              <span className="mt-0.5 text-[0.68rem] text-ink-faint tabular-nums">
                {formatDuration(step.durationMin)}
              </span>
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-start gap-2">
                <span className="text-xl leading-none" aria-hidden>
                  {step.place.emoji}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-[1rem] font-semibold leading-tight">
                    {step.place.name}
                  </h3>
                  <p className="mt-0.5 text-[0.8rem] text-ink-muted">
                    {step.place.kind} · {formatPrice(step.price, currency)}
                  </p>
                  {!step.openingHoursKnown ? (
                    <p className="mt-1 text-[0.76rem] text-sun-700">
                      Öffnungszeiten nicht verfügbar
                    </p>
                  ) : null}
                </div>
              </div>

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
    </ol>
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
