'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  selected?: boolean;
  emoji?: string;
  children: ReactNode;
  tone?: 'default' | 'soft';
};

/** Auswahl-Chip: große Tap-Fläche, klarer Zustand, kein Formular-Look. */
export function Chip({
  selected = false,
  emoji,
  tone = 'default',
  className = '',
  children,
  ...rest
}: Props) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={[
        'tap inline-flex shrink-0 items-center gap-1.5 rounded-2xl px-3.5 py-2.5',
        'text-[0.9rem] font-medium leading-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
        selected
          ? 'bg-ink text-white shadow-lift'
          : tone === 'soft'
            ? 'bg-canvas-sunk text-ink-soft hover:bg-line'
            : 'bg-canvas-raised text-ink-soft hairline hover:border-ink-faint',
        className,
      ].join(' ')}
      {...rest}
    >
      {emoji ? <span className="text-base leading-none">{emoji}</span> : null}
      <span>{children}</span>
    </button>
  );
}
