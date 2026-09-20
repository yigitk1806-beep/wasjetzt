'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';

const LINES = [
  'Ich schaue, was gerade offen ist …',
  'Wetter und Wege prüfen …',
  'Ich stelle etwas zusammen …',
];

/**
 * Wartezustand mit Haltung: kurz, freundlich, ohne Fortschrittsbalken-Theater.
 * Wechselt die Zeile nur, solange es tatsächlich dauert.
 */
export function ThinkingOverlay({ open }: { open: boolean }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!open) {
      setIndex(0);
      return;
    }
    const timer = setInterval(() => {
      setIndex((i) => Math.min(i + 1, LINES.length - 1));
    }, 1400);
    return () => clearInterval(timer);
  }, [open]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-canvas/92 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <div className="relative flex h-24 w-24 items-center justify-center">
            <span className="absolute inset-0 animate-breathe rounded-full bg-gradient-to-br from-brand-200 to-plum-300 blur-xl" />
            <span className="relative text-4xl" aria-hidden>
              ✨
            </span>
          </div>

          <AnimatePresence mode="wait">
            <motion.p
              key={index}
              className="mt-6 px-8 text-center text-[0.98rem] font-medium text-ink-soft"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25 }}
            >
              {LINES[index]}
            </motion.p>
          </AnimatePresence>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
