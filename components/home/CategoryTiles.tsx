'use client';

import { motion } from 'motion/react';
import type { Category } from '@/types/domain';

const TILES: Array<{ category: Category; emoji: string; label: string; tint: string }> = [
  { category: 'food', emoji: '🍕', label: 'Essen', tint: 'from-brand-100 to-brand-200/70' },
  { category: 'activity', emoji: '🎳', label: 'Aktivität', tint: 'from-sky-100 to-sky-300/60' },
  { category: 'cinema', emoji: '🎬', label: 'Kino', tint: 'from-plum-100 to-plum-300/60' },
  { category: 'cafe', emoji: '☕', label: 'Café', tint: 'from-sun-100 to-sun-300/60' },
  { category: 'nature', emoji: '🌳', label: 'Draußen', tint: 'from-mint-100 to-mint-300/60' },
  { category: 'gaming', emoji: '🎮', label: 'Gaming', tint: 'from-plum-100 to-sky-300/50' },
];

type Props = {
  onPick: (category: Category) => void;
  disabled?: boolean;
};

/** Kurzer Weg für Leute, die schon wissen, worauf sie Lust haben. */
export function CategoryTiles({ onPick, disabled }: Props) {
  return (
    <div className="-mx-[1.15rem] edge-fade">
      <div className="scroll-x px-[1.15rem]">
        {TILES.map((tile, index) => (
          <motion.button
            key={tile.category}
            type="button"
            disabled={disabled}
            onClick={() => onPick(tile.category)}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.34 + index * 0.035, duration: 0.35 }}
            whileTap={{ scale: 0.95 }}
            style={{ scrollSnapAlign: 'start' }}
            className={`tap flex h-[5.6rem] w-[5.4rem] shrink-0 flex-col items-center justify-center gap-1.5 rounded-3xl bg-gradient-to-br ${tile.tint} shadow-card disabled:opacity-50`}
          >
            <span className="text-2xl" aria-hidden>
              {tile.emoji}
            </span>
            <span className="text-[0.78rem] font-semibold text-ink-soft">{tile.label}</span>
          </motion.button>
        ))}
      </div>
    </div>
  );
}
