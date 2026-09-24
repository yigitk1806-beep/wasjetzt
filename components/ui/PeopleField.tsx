'use client';

import { useEffect, useRef, useState } from 'react';
import { Chip } from '@/components/ui/Chip';
import { useLocale } from '@/components/LocaleProvider';

const SCHNELL = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const MAX = 50;

type Props = {
  value: number;
  onChange: (value: number) => void;
};

/**
 * Wie viele seid ihr? Die häufigen Zahlen direkt antippbar, jede andere über
 * den Stepper oder „10+". Die Zahl ist kein Beiwerk: Sie entscheidet mit,
 * welche Orte überhaupt sinnvoll sind und wie sich das Budget aufteilt.
 */
export function PeopleField({ value, onChange }: Props) {
  const { t } = useLocale();
  const [eigene, setEigene] = useState(value > 9);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (value > 9) setEigene(true);
  }, [value]);

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-2">
        {SCHNELL.map((n) => (
          <Chip
            key={n}
            selected={!eigene && value === n}
            onClick={() => {
              setEigene(false);
              onChange(n);
            }}
          >
            {n}
          </Chip>
        ))}
        <Chip
          selected={eigene}
          onClick={() => {
            setEigene(true);
            if (value < 10) onChange(10);
            setTimeout(() => inputRef.current?.focus(), 60);
          }}
        >
          {t.build.peopleMore}
        </Chip>
      </div>

      {/* Stepper: jede Zahl erreichbar, ohne Tastatur. */}
      <div className="flex items-center gap-3">
        <Stepper
          label="−"
          onClick={() => onChange(Math.max(1, value - 1))}
          disabled={value <= 1}
        />
        {eigene ? (
          <input
            ref={inputRef}
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX}
            value={value}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) onChange(Math.max(1, Math.min(MAX, Math.round(n))));
            }}
            aria-label={t.build.peopleCustom}
            className="w-20 rounded-2xl bg-canvas-sunk px-3 py-2 text-center text-base font-semibold tabular-nums outline-none ring-brand-300 focus:ring-2"
          />
        ) : (
          <span className="min-w-20 text-center text-[0.95rem] font-semibold tabular-nums">
            {t.build.peopleValue(value)}
          </span>
        )}
        <Stepper
          label="+"
          onClick={() => {
            const next = Math.min(MAX, value + 1);
            if (next > 9) setEigene(true);
            onChange(next);
          }}
          disabled={value >= MAX}
        />
      </div>
    </div>
  );
}

function Stepper({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label === '+' ? '+1' : '-1'}
      className="tap grid h-10 w-10 shrink-0 place-items-center rounded-full bg-canvas-sunk text-lg font-semibold text-ink-soft disabled:opacity-40"
    >
      {label}
    </button>
  );
}
