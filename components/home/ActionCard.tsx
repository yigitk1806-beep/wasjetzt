'use client';

import { motion } from 'motion/react';
import type { ReactNode } from 'react';

type Props = {
  emoji: string;
  title: string;
  hint: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
  delay?: number;
  trailing?: ReactNode;
};

/** Eine große, eindeutige Aktion pro Karte. */
export function ActionCard({
  emoji,
  title,
  hint,
  onClick,
  primary = false,
  disabled = false,
  delay = 0,
  trailing,
}: Props) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      whileTap={{ scale: 0.975 }}
      className={[
        'group relative flex w-full items-center gap-4 overflow-hidden rounded-3xl px-5 text-left',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
        'disabled:opacity-50',
        primary
          ? 'py-5 text-white shadow-lift bg-gradient-to-br from-brand-400 via-brand-500 to-brand-600'
          : 'py-4 bg-canvas-raised text-ink shadow-card hairline',
      ].join(' ')}
    >
      {primary ? (
        <span
          aria-hidden
          className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/18 blur-2xl"
        />
      ) : null}

      <span
        className={[
          'grid shrink-0 place-items-center rounded-2xl',
          primary ? 'h-13 w-13 bg-white/18 text-2xl' : 'h-11 w-11 bg-canvas-sunk text-xl',
        ].join(' ')}
        style={primary ? { height: '3.25rem', width: '3.25rem' } : undefined}
        aria-hidden
      >
        {emoji}
      </span>

      <span className="min-w-0 flex-1">
        <span
          className={[
            'block font-bold tracking-tight',
            primary ? 'text-[1.28rem]' : 'text-[1.05rem]',
          ].join(' ')}
        >
          {title}
        </span>
        <span
          className={[
            'mt-0.5 block text-[0.85rem] leading-snug',
            primary ? 'text-white/85' : 'text-ink-muted',
          ].join(' ')}
        >
          {hint}
        </span>
      </span>

      {trailing ?? (
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden
          className={[
            'shrink-0 transition-transform duration-200 group-hover:translate-x-0.5',
            primary ? 'text-white/70' : 'text-ink-faint',
          ].join(' ')}
        >
          <path
            d="m9 6 6 6-6 6"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </motion.button>
  );
}
