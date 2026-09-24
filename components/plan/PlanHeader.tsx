'use client';

import { motion } from 'motion/react';
import { weatherEmoji } from '@/engine/weatherRules';
import { formatClock } from '@/lib/time';
import { wegSumme } from '@/lib/wege';
import { Clock } from '@/components/ui/icons';
import { useLocale } from '@/components/LocaleProvider';
import { dayLabel, distance, duration, planPrice, planTitle, stationCount } from '@/lib/i18n/format';
import type { Mobility, Plan } from '@/types/domain';

const UNTERWEGS_EMOJI: Record<Mobility, string> = {
  walk: '🚶',
  bike: '🚲',
  transit: '🚇',
  car: '🚗',
};

type Props = {
  plan: Plan;
  onTimeClick: () => void;
};

/**
 * Kopf der Planseite. Auf einen Blick: wann es losgeht, wann ihr fertig seid,
 * wie lange es dauert, wie viele Stationen, wie weit und was es kostet.
 * Gezeigt wird nur, was wirklich bekannt ist – keine Scheingenauigkeit.
 */
export function PlanHeader({ plan, onTimeClick }: Props) {
  const { t } = useLocale();
  const tz = plan.tzOffsetMin;
  const von = plan.departISO ?? plan.startISO;
  const bis = plan.returnHome?.arriveISO ?? plan.endISO;

  const stationen = stationCount(plan);

  const weg = wegSumme(plan);
  const wegText =
    weg.meter <= 0
      ? null
      : weg.routing === 'none'
        ? t.plan.airline(distance(t, weg.meter))
        : `${t.common.approx} ${distance(t, weg.meter)}`;

  // Das Budget war für die Gruppe gemeint – also steht hier auch die Summe
  // für die Gruppe, nicht der Betrag pro Kopf.
  const preis = planPrice(t, plan.cost, plan.currency);

  const wetter =
    plan.weatherAtCreation && plan.weatherAtCreation.condition !== 'unknown'
      ? `${weatherEmoji(plan.weatherAtCreation)} ${Math.round(plan.weatherAtCreation.temperatureC)} °C`
      : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="space-y-2.5"
    >
      <button
        type="button"
        onClick={onTimeClick}
        className="tap -ml-1 inline-flex items-center gap-1.5 rounded-full py-1 pl-1 pr-1.5 text-[0.95rem] font-semibold text-brand-600"
      >
        <Clock size={16} />
        {/* "Heute"/"Morgen" hängt an der Uhr des Geräts – kurz vor Mitternacht
            kann der Server anders zählen als der Browser. */}
        <span className="tabular-nums" suppressHydrationWarning>
          {dayLabel(t, von, tz ?? 0)} · {formatClock(von, 'de', tz)}–{formatClock(bis, 'de', tz)}
        </span>
        <span className="ml-1 rounded-full bg-brand-50 px-2 py-0.5 text-[0.72rem] font-semibold">
          {t.plan.changeTime}
        </span>
      </button>

      <div>
        <h1 className="text-[1.9rem] font-bold leading-tight tracking-[-0.025em]">{planTitle(t, plan)}</h1>
        <p className="mt-1 text-[0.95rem] text-ink-muted">
          {duration(t, plan.totalDurationMin)} · {t.plan.stops(stationen)}
          {plan.returnHome ? ` · ${t.plan.inclReturn}` : ''}
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {wegText ? (
          <Fakt>
            {UNTERWEGS_EMOJI[plan.request.mobility]} {wegText}
          </Fakt>
        ) : null}
        <Fakt>💶 {preis}</Fakt>
        {wetter ? <Fakt>{wetter}</Fakt> : null}
      </div>
    </motion.div>
  );
}

function Fakt({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-canvas-raised px-3 py-1.5 text-[0.8rem] font-medium text-ink-soft shadow-card hairline">
      {children}
    </span>
  );
}
