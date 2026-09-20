'use client';

import { useState } from 'react';
import { Sheet } from '@/components/ui/Sheet';
import { Chip } from '@/components/ui/Chip';
import { recordFeedback, type FeedbackReason } from '@/lib/clientStore';
import type { Plan } from '@/types/domain';

const REASONS: Array<{ value: FeedbackReason; emoji: string; label: string }> = [
  { value: 'price', emoji: '💰', label: 'Zu teuer' },
  { value: 'distance', emoji: '📍', label: 'Zu weit' },
  { value: 'atmosphere', emoji: '❤️', label: 'Atmosphäre' },
  { value: 'quality', emoji: '⭐', label: 'Qualität' },
];

type Props = {
  plan: Plan;
  open: boolean;
  onClose: () => void;
};

/**
 * Feedback in zwei Schritten: Daumen, optional ein Grund.
 * Beides landet nur lokal und steuert die nächsten Vorschläge.
 */
export function FeedbackSheet({ plan, open, onClose }: Props) {
  const [verdict, setVerdict] = useState<'up' | 'down' | null>(null);
  const [done, setDone] = useState(false);

  function submit(value: 'up' | 'down', reason?: FeedbackReason) {
    for (const step of plan.steps) {
      recordFeedback(step.place.category, value, reason);
    }
    setDone(true);
    setTimeout(() => {
      setDone(false);
      setVerdict(null);
      onClose();
    }, 900);
  }

  return (
    <Sheet open={open} onClose={onClose} title="Wie war's?">
      {done ? (
        <p className="py-6 text-center text-[1rem] font-semibold">Danke – merke ich mir. 👍</p>
      ) : verdict === null ? (
        <div className="flex gap-3 py-2">
          <button
            type="button"
            onClick={() => submit('up')}
            className="tap flex-1 rounded-3xl bg-mint-100 py-7 text-3xl"
            aria-label="Gut"
          >
            👍
          </button>
          <button
            type="button"
            onClick={() => setVerdict('down')}
            className="tap flex-1 rounded-3xl bg-canvas-sunk py-7 text-3xl"
            aria-label="Nicht gut"
          >
            👎
          </button>
        </div>
      ) : (
        <div className="space-y-3 py-1">
          <p className="text-[0.9rem] text-ink-muted">Woran lag's?</p>
          <div className="flex flex-wrap gap-2">
            {REASONS.map((reason) => (
              <Chip
                key={reason.value}
                emoji={reason.emoji}
                onClick={() => submit('down', reason.value)}
              >
                {reason.label}
              </Chip>
            ))}
            <Chip tone="soft" onClick={() => submit('down')}>
              Sag ich nicht
            </Chip>
          </div>
        </div>
      )}
    </Sheet>
  );
}
