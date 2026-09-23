'use client';

import { motion } from 'motion/react';
import { formatClock } from '@/lib/time';
import { useLocale } from '@/components/LocaleProvider';
import { distance, duration, kind, price, reason } from '@/lib/i18n/format';
import type { Mobility, Plan, PlanStep } from '@/types/domain';

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
  const { t } = useLocale();

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
                <span className="font-normal text-ink-faint"> · {duration(t, step.durationMin)}</span>
              </p>
              <h3 className="mt-0.5 truncate text-[1rem] font-semibold leading-tight">
                {step.place.name}
              </h3>
              <p className="mt-0.5 text-[0.8rem] text-ink-muted">
                {kind(t, step.place.kind)} · {price(t, step.price, currency)}
              </p>
              {!step.openingHoursKnown ? (
                <p className="mt-1 text-[0.76rem] text-sun-700">{t.plan.hoursUnknown}</p>
              ) : null}

              <p className="mt-2 text-[0.8rem] leading-snug text-ink-soft">{reason(t, step)}</p>

              {step.place.deal ? (
                <p className="mt-1.5 inline-block rounded-full bg-mint-100 px-2.5 py-1 text-[0.74rem] font-medium text-mint-700">
                  {t.home.dealDiscount(step.place.deal.discountPercent)}
                </p>
              ) : null}

              <button
                type="button"
                onClick={() => onReplace(step)}
                aria-label={t.plan.replaceAria(step.place.name)}
                className="tap mt-2.5 inline-flex items-center gap-1.5 rounded-xl bg-canvas-sunk px-3 py-1.5 text-[0.78rem] font-semibold text-ink-soft"
              >
                <span aria-hidden>🔄</span> {t.plan.replace}
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
            <p className="text-[0.9rem] font-semibold tabular-nums">
              {t.plan.homeAt(formatClock(returnHome.arriveISO, 'de', tzOffsetMin), returnHome.estimated)}
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
  const { t } = useLocale();
  return (
    <div className="flex items-center gap-2 py-1.5 pl-[3.75rem] text-[0.76rem] text-ink-faint">
      {aufbruch ? (
        <span className="font-semibold tabular-nums text-ink-muted">{t.plan.departAt(aufbruch)}</span>
      ) : null}
      {leg.durationMin > 0 ? (
        <>
          <span aria-hidden>{MOBILITY_EMOJI[mode]}</span>
          <span>
            {leg.estimated ? `${t.common.approx} ` : ''}
            {duration(t, leg.durationMin)} · {distance(t, leg.distanceMeters)}
          </span>
        </>
      ) : (
        <span>{t.plan.directHere}</span>
      )}
    </div>
  );
}
