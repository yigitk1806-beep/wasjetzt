'use client';

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
 * die Stepper-Zeile – dort steht die Zahl immer als Eingabefeld, damit man
 * sie auch überschreiben kann, statt zwölfmal auf „+" zu tippen.
 *
 * Die Zahl ist kein Beiwerk: Sie entscheidet mit, welche Orte sinnvoll sind,
 * und sie teilt das Gesamtbudget auf.
 */
export function PeopleField({ value, onChange }: Props) {
  const { t } = useLocale();

  function setzen(n: number) {
    onChange(Math.max(1, Math.min(MAX, Math.round(n))));
  }

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-2">
        {SCHNELL.map((n) => (
          <Chip key={n} selected={value === n} onClick={() => setzen(n)}>
            {n}
          </Chip>
        ))}
        <Chip selected={value > 9} onClick={() => setzen(Math.max(10, value))}>
          {t.build.peopleMore}
        </Chip>
      </div>

      <div className="flex items-center gap-2.5">
        <Stepper label="−" onClick={() => setzen(value - 1)} disabled={value <= 1} />
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX}
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n) && e.target.value !== '') setzen(n);
          }}
          aria-label={t.build.people}
          className="w-16 rounded-2xl bg-canvas-sunk px-2 py-2 text-center text-base font-semibold tabular-nums outline-none ring-brand-300 focus:ring-2"
        />
        <span className="text-[0.9rem] text-ink-muted">{t.build.peopleValue(value)}</span>
        <Stepper label="+" onClick={() => setzen(value + 1)} disabled={value >= MAX} />
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
