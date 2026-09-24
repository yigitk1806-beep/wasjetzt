'use client';

import { useRef, useState } from 'react';
import { useLocale } from '@/components/LocaleProvider';
import type { SequenceKind } from '@/types/domain';

/** Reihenfolge, in der die Positionen zum Hinzufügen angeboten werden. */
const ALLE: SequenceKind[] = [
  'food', 'action', 'cafe', 'bar', 'cinema', 'culture',
  'shopping', 'nature', 'gaming', 'sport', 'wellness', 'event',
];

export const SEQUENCE_EMOJI: Record<SequenceKind, string> = {
  food: '🍝',
  cafe: '☕',
  bar: '🍸',
  action: '🎯',
  cinema: '🎬',
  culture: '🖼️',
  nature: '🌳',
  shopping: '🛍️',
  wellness: '🧖',
  gaming: '🎮',
  sport: '🏃',
  event: '🎪',
};

const MAX = 5;

type Props = {
  value: SequenceKind[];
  onChange: (value: SequenceKind[]) => void;
};

/**
 * „Wie soll euer Ablauf sein?" – die Reihenfolge zum Ansehen und Verschieben.
 *
 * Pflicht ist das nicht: Wer einfach schreibt „erst essen, dann Action",
 * bekommt die Liste schon gefüllt und muss hier nichts tun. Wer mag, schiebt
 * sie um. Auf dem Handy über die Pfeile, am Rechner zusätzlich per Ziehen –
 * Ziehen allein wäre auf Touch zu fummelig.
 */
export function SequenceEditor({ value, onChange }: Props) {
  const { t } = useLocale();
  const gezogen = useRef<number | null>(null);
  const [ueber, setUeber] = useState<number | null>(null);

  function verschieben(von: number, nach: number) {
    if (nach < 0 || nach >= value.length || von === nach) return;
    const kopie = [...value];
    const [raus] = kopie.splice(von, 1);
    kopie.splice(nach, 0, raus);
    onChange(kopie);
  }

  return (
    <div className="space-y-2.5">
      <p className="px-1 text-[0.8rem] text-ink-muted">{t.sequence.hint}</p>

      {value.length > 0 ? (
        <ol className="space-y-1">
          {value.map((kind, i) => (
            <li key={`${kind}-${i}`}>
              <div
                draggable
                onDragStart={() => {
                  gezogen.current = i;
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setUeber(i);
                }}
                onDragEnd={() => {
                  gezogen.current = null;
                  setUeber(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (gezogen.current !== null) verschieben(gezogen.current, i);
                  gezogen.current = null;
                  setUeber(null);
                }}
                className={[
                  'flex items-center gap-2.5 rounded-2xl bg-canvas-raised px-3 py-2.5 shadow-card hairline',
                  ueber === i ? 'ring-2 ring-brand-300' : '',
                ].join(' ')}
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ink text-[0.72rem] font-bold text-white tabular-nums">
                  {i + 1}
                </span>
                <span aria-hidden className="text-base">
                  {SEQUENCE_EMOJI[kind]}
                </span>
                <span className="min-w-0 flex-1 truncate text-[0.92rem] font-semibold">
                  {t.sequence.kinds[kind]}
                </span>

                <Knopf label={t.sequence.up} disabled={i === 0} onClick={() => verschieben(i, i - 1)}>
                  ↑
                </Knopf>
                <Knopf
                  label={t.sequence.down}
                  disabled={i === value.length - 1}
                  onClick={() => verschieben(i, i + 1)}
                >
                  ↓
                </Knopf>
                <Knopf
                  label={t.sequence.remove}
                  onClick={() => onChange(value.filter((_, n) => n !== i))}
                >
                  ✕
                </Knopf>
              </div>
              {i < value.length - 1 ? (
                <div className="py-0.5 pl-[0.7rem] text-[0.8rem] text-ink-faint" aria-hidden>
                  ↓
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}

      {value.length < MAX ? (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {ALLE.filter((k) => !value.includes(k)).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => onChange([...value, kind])}
              aria-label={`${t.sequence.add}: ${t.sequence.kinds[kind]}`}
              className="tap rounded-full bg-canvas-sunk px-3 py-1.5 text-[0.8rem] font-medium text-ink-soft"
            >
              <span aria-hidden>{SEQUENCE_EMOJI[kind]}</span> {t.sequence.kinds[kind]}
            </button>
          ))}
        </div>
      ) : null}

      {value.length > 0 ? (
        <button
          type="button"
          onClick={() => onChange([])}
          className="tap px-1 text-[0.78rem] font-medium text-ink-muted underline underline-offset-2"
        >
          {t.sequence.clear}
        </button>
      ) : null}
    </div>
  );
}

function Knopf({
  label,
  children,
  onClick,
  disabled = false,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="tap grid h-8 w-8 shrink-0 place-items-center rounded-full bg-canvas-sunk text-[0.9rem] text-ink-soft disabled:opacity-30"
    >
      {children}
    </button>
  );
}
