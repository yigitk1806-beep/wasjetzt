'use client';

import { useState } from 'react';
import { Sheet } from '@/components/ui/Sheet';
import { Chip } from '@/components/ui/Chip';
import { Spinner } from '@/components/ui/Button';
import type { PlanStep } from '@/types/domain';

export type ReplaceOption = {
  hint: string;
  emoji: string;
  label: string;
  /** Wird nur angezeigt, wenn sie für diesen Schritt sinnvoll ist. */
  relevant: (step: PlanStep) => boolean;
};

const OPTIONS: ReplaceOption[] = [
  { hint: 'any', emoji: '🔄', label: 'Etwas anderes', relevant: () => true },
  {
    hint: 'cheaper',
    emoji: '💸',
    label: 'Günstiger',
    relevant: (step) => step.place.price.level > 0,
  },
  {
    hint: 'faster',
    emoji: '⏱️',
    label: 'Schneller',
    relevant: (step) => step.durationMin > 60,
  },
  {
    hint: 'romantic',
    emoji: '❤️',
    label: 'Romantischer',
    relevant: (step) => step.place.scores.romantic < 0.7,
  },
  {
    hint: 'action',
    emoji: '🔥',
    label: 'Mehr Action',
    relevant: (step) => step.place.scores.action < 0.6,
  },
  {
    hint: 'indoor',
    emoji: '🏠',
    label: 'Drinnen',
    relevant: (step) => step.place.indoorOutdoor !== 'indoor',
  },
  {
    hint: 'new',
    emoji: '🆕',
    label: 'Etwas Neues',
    relevant: (step) => step.place.scores.novelty < 0.8,
  },
];

type Props = {
  step: PlanStep | null;
  onClose: () => void;
  onReplace: (hint: string) => Promise<void>;
  error?: string | null;
};

/** Anpassungen erscheinen nur, wenn sie zum konkreten Schritt passen. */
export function ReplaceSheet({ step, onClose, onReplace, error }: Props) {
  const [busyHint, setBusyHint] = useState<string | null>(null);

  const options = step ? OPTIONS.filter((option) => option.relevant(step)) : [];

  return (
    <Sheet
      open={Boolean(step)}
      onClose={() => {
        if (!busyHint) onClose();
      }}
      title={step ? `${step.place.emoji} ${step.place.name} ersetzen` : undefined}
    >
      <p className="mb-4 text-[0.88rem] text-ink-muted">
        Der Rest des Plans bleibt so, wie er ist.
      </p>

      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <Chip
            key={option.hint}
            emoji={busyHint === option.hint ? undefined : option.emoji}
            onClick={async () => {
              setBusyHint(option.hint);
              await onReplace(option.hint);
              setBusyHint(null);
            }}
            disabled={busyHint !== null}
          >
            {busyHint === option.hint ? (
              <span className="flex items-center gap-2">
                <Spinner className="h-3.5 w-3.5" /> {option.label}
              </span>
            ) : (
              option.label
            )}
          </Chip>
        ))}
      </div>

      {error ? (
        <p className="mt-4 rounded-2xl bg-brand-50 px-4 py-3 text-[0.86rem] text-brand-700">
          {error}
        </p>
      ) : null}
    </Sheet>
  );
}
