'use client';

import { useEffect, useState } from 'react';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import {
  TimeField,
  clockFromMin,
  minutesOf,
  jetztText,
  nextQuarter,
  startLabel,
  useNowClock,
} from '@/components/ui/TimeField';
import { localClock, localDayDiff } from '@/lib/time';
import { retimePlan } from '@/lib/planClient';
import type { Plan } from '@/types/domain';

type Props = {
  plan: Plan;
  open: boolean;
  onClose: () => void;
  onPlanChange: (plan: Plan) => void;
};

/**
 * Startzeit und Heimkehr eines fertigen Plans ändern. Der Plan wird dabei
 * verschoben, nicht neu erfunden – nur Stationen, die zur neuen Zeit nicht
 * mehr passen, tauscht der Server aus.
 */
export function TimeSheet({ plan, open, onClose, onPlanChange }: Props) {
  const jetzt = useNowClock();
  const [start, setStart] = useState<string | null>(null);
  const [home, setHome] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Beim Öffnen die Werte des Plans zeigen.
  useEffect(() => {
    if (!open) return;
    const tz = plan.tzOffsetMin ?? 0;
    const abfahrt = new Date(plan.departISO ?? plan.startISO);
    const inZukunft = abfahrt.getTime() - Date.now() > 10 * 60_000;
    setStart(inZukunft ? localClock(abfahrt, tz) : null);
    setHome(plan.request.mustBeHomeByISO ? localClock(new Date(plan.request.mustBeHomeByISO), tz) : null);
    setError(null);
  }, [open, plan]);

  async function uebernehmen() {
    setBusy(true);
    setError(null);
    const result = await retimePlan(plan.id, start, home);
    setBusy(false);
    if (result.plan) {
      onPlanChange(result.plan);
      onClose();
      return;
    }
    setError(result.message ?? result.error ?? 'Das hat nicht geklappt.');
  }

  const tz = plan.tzOffsetMin ?? 0;
  const tagOffset = localDayDiff(new Date(plan.departISO ?? plan.startISO), new Date(), tz);
  const heimVorschlag = clockFromMin(
    Math.round(((start ? minutesOf(start) : jetzt ? minutesOf(jetzt) : 720) + Math.max(120, plan.totalDurationMin)) / 30) * 30,
  );

  return (
    <Sheet open={open} onClose={() => (busy ? undefined : onClose())} title="Zeit ändern">
      <div className="space-y-2.5">
        <TimeField
          icon="🕐"
          label="Wann starten?"
          value={start}
          emptyText={jetztText(jetzt)}
          valueText={(v) => startLabel(v)}
          actionText="Startzeit ändern"
          resetText="Jetzt"
          pickerDefault={nextQuarter(jetzt)}
          onChange={setStart}
        />
        <TimeField
          icon="🏠"
          label="Zuhause bis"
          value={home}
          emptyText="Keine feste Endzeit"
          valueText={(v) => `${v} Uhr`}
          actionText="Festlegen"
          resetText="Keine"
          pickerDefault={heimVorschlag}
          commitOnBlur
          onChange={setHome}
        />
      </div>

      <p className="mt-3 text-[0.8rem] leading-relaxed text-ink-muted">
        {tagOffset > 0 ? 'Der Plan liegt auf morgen. ' : ''}
        Die Stationen bleiben – nur was zur neuen Zeit geschlossen hat oder nicht mehr passt,
        wird ersetzt.
      </p>

      {error ? (
        <p className="mt-3 rounded-2xl bg-brand-50 px-4 py-3 text-[0.86rem] text-brand-700">{error}</p>
      ) : null}

      <div className="mt-4">
        <Button size="lg" full loading={busy} loadingLabel="Wird verschoben" onClick={() => void uebernehmen()}>
          Übernehmen
        </Button>
      </div>
    </Sheet>
  );
}
