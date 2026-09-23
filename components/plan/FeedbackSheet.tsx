'use client';

import { useLocale } from '@/components/LocaleProvider';
import { useState } from 'react';
import { Sheet } from '@/components/ui/Sheet';
import { Chip } from '@/components/ui/Chip';
import { recordFeedback, type FeedbackReason } from '@/lib/clientStore';
import type { Plan } from '@/types/domain';

const REASONS: Array<{ value: FeedbackReason; emoji: string }> = [
  { value: 'price', emoji: '💰' },
  { value: 'distance', emoji: '📍' },
  { value: 'atmosphere', emoji: '❤️' },
  { value: 'quality', emoji: '⭐' },
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
  const { t } = useLocale();
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
    <Sheet open={open} onClose={onClose} title={t.feedback.title}>
      {done ? (
        <p className="py-6 text-center text-[1rem] font-semibold">{t.feedback.thanks}</p>
      ) : verdict === null ? (
        <div className="flex gap-3 py-2">
          <button
            type="button"
            onClick={() => submit('up')}
            className="tap flex-1 rounded-3xl bg-mint-100 py-7 text-3xl"
            aria-label={t.feedback.good}
          >
            👍
          </button>
          <button
            type="button"
            onClick={() => setVerdict('down')}
            className="tap flex-1 rounded-3xl bg-canvas-sunk py-7 text-3xl"
            aria-label={t.feedback.bad}
          >
            👎
          </button>
        </div>
      ) : (
        <div className="space-y-3 py-1">
          <p className="text-[0.9rem] text-ink-muted">{t.feedback.why}</p>
          <div className="flex flex-wrap gap-2">
            {REASONS.map((reason) => (
              <Chip
                key={reason.value}
                emoji={reason.emoji}
                onClick={() => submit('down', reason.value)}
              >
                {t.feedback.reasons[reason.value]}
              </Chip>
            ))}
            <Chip tone="soft" onClick={() => submit('down')}>
              {t.feedback.skip}
            </Chip>
          </div>
        </div>
      )}
    </Sheet>
  );
}
