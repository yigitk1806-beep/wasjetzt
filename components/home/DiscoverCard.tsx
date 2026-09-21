'use client';

import { motion } from 'motion/react';

type Props = {
  onClick: () => void;
  disabled?: boolean;
  delay?: number;
};

/**
 * Einstieg in den Sehenswürdigkeiten-Modus. Bewusst anders gefärbt als die
 * drei Hauptaktionen: kein weiterer Plan-Knopf, sondern eine Einladung,
 * die eigene Stadt anzuschauen.
 */
export function DiscoverCard({ onClick, disabled = false, delay = 0 }: Props) {
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
        'group relative flex w-full items-center gap-4 overflow-hidden rounded-3xl px-5 py-4 text-left',
        'bg-gradient-to-br from-sky-100 via-canvas-raised to-mint-100 shadow-card hairline',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
        'disabled:opacity-50',
      ].join(' ')}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute -right-6 -top-8 h-28 w-28 rounded-full bg-sky-300/25 blur-2xl"
      />

      <span
        className="relative grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/85 text-[1.55rem] shadow-card"
        aria-hidden
      >
        🏛️
      </span>

      <span className="relative min-w-0 flex-1">
        <span className="block text-[1.05rem] font-bold tracking-tight">Sehenswürdigkeiten</span>
        <span className="mt-0.5 block text-[0.85rem] leading-snug text-ink-muted">
          Entdecke deine Stadt – als fertige Tour
        </span>
      </span>

      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden
        className="relative shrink-0 text-ink-faint transition-transform duration-200 group-hover:translate-x-0.5"
      >
        <path
          d="m9 6 6 6-6 6"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </motion.button>
  );
}
