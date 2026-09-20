'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, type ReactNode } from 'react';

type Props = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** Sheet füllt maximal diesen Anteil der Höhe. */
  maxHeight?: string;
};

/** Bottom Sheet – die Standard-Interaktion auf dem Smartphone. */
export function Sheet({ open, onClose, title, children, maxHeight = '86vh' }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-ink/25 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-[var(--shell-max)]"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 420, damping: 38 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 110 || info.velocity.y > 650) onClose();
            }}
          >
            <div
              className="rounded-t-4xl bg-canvas-raised shadow-lift"
              style={{ maxHeight }}
            >
              <div className="flex justify-center pt-3">
                <span className="h-1.5 w-11 rounded-full bg-line" />
              </div>
              {title ? (
                <h2 className="px-5 pt-3 text-lg font-semibold tracking-tight">{title}</h2>
              ) : null}
              <div
                className="overflow-y-auto px-5 pb-[calc(env(safe-area-inset-bottom,0px)+1.25rem)] pt-3"
                style={{ maxHeight: `calc(${maxHeight} - 3.5rem)` }}
              >
                {children}
              </div>
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
