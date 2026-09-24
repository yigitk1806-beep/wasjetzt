'use client';

import { motion } from 'motion/react';
import { useLocale } from '@/components/LocaleProvider';
import { DEVICE_LOCATION_LABEL } from '@/lib/i18n/format';
import type { Dictionary } from '@/lib/i18n';
import type { PlanRequest } from '@/types/domain';

type Props = {
  request: PlanRequest;
  onChange: () => void;
  busy?: boolean;
};

/**
 * „Wir starten von …" – die erste Zeile des fertigen Plans.
 *
 * Der Startpunkt ist keine Nebensache: Von ihm hängen Reihenfolge, Wege und
 * Zeiten ab. Deshalb steht er sichtbar oben und lässt sich von dort direkt
 * ändern, statt in den Einstellungen zu verschwinden.
 */
export function StartPointBar({ request, onChange, busy = false }: Props) {
  const { t } = useLocale();

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="flex items-center gap-2.5 rounded-2xl bg-canvas-sunk px-3.5 py-2.5"
    >
      <span aria-hidden className="text-base">
        📍
      </span>
      <p className="min-w-0 flex-1 text-[0.86rem] leading-snug text-ink-soft">
        {t.plan.startTitle(startLabel(t, request))}
      </p>
      <button
        type="button"
        onClick={onChange}
        disabled={busy}
        className="tap shrink-0 rounded-xl bg-canvas-raised px-3 py-1.5 text-[0.78rem] font-semibold text-brand-600 shadow-card hairline disabled:opacity-60"
      >
        {t.plan.changeStart}
      </button>
    </motion.div>
  );
}

/**
 * Beim GPS-Start gibt es keine Adresse, die wir ehrlich nennen könnten –
 * dann heißt es „dein aktueller Standort". Ältere Pläne kennen das Merkmal
 * noch nicht; dort verrät es die gespeicherte Bezeichnung.
 */
export function startLabel(t: Dictionary, request: PlanRequest): string {
  const vomGeraet =
    request.originFromDevice ??
    (request.originLabel === DEVICE_LOCATION_LABEL || !request.originLabel);
  return vomGeraet ? t.plan.startDevice : request.originLabel;
}
