'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Activity, Heart, TreePine, Users, Utensils } from '@/components/ui/icons';
import { useLocale } from '@/components/LocaleProvider';
import type { PlanPhase } from '@/lib/planClient';

/**
 * Die Abschnitte der Planung, in der Reihenfolge, in der sie laufen.
 * Der Text kommt aus dem Wörterbuch, der Fortschritt vom Server.
 */
const PHASEN: PlanPhase[] = ['orte', 'wetter', 'wege', 'plan'];

/** Was gerade zusammengestellt wird – dieselben Kategorien wie im Produkt. */
const MOTIVE = [Heart, Users, Utensils, Activity, TreePine];

type Props = {
  open: boolean;
  /** Aktueller Abschnitt laut Server. */
  phase: PlanPhase | null;
};

/**
 * Ladezustand der Planung.
 *
 * Kein Spinner: Der Nutzer soll sehen, dass gerade ein Abend zusammengestellt
 * wird. Der Fortschrittsbalken folgt echten Servermeldungen – dauert ein
 * Abschnitt nur Millisekunden, springt die Anzeige auch sofort weiter.
 */
export function PlanningOverlay({ open, phase }: Props) {
  const { t } = useLocale();
  const SCHRITTE = PHASEN.map((p) => ({ phase: p, kurz: t.overlay.phases[p].short, text: t.overlay.phases[p].text }));
  const [motiv, setMotiv] = useState(0);

  useEffect(() => {
    if (!open) {
      setMotiv(0);
      return;
    }
    const timer = setInterval(() => setMotiv((i) => (i + 1) % MOTIVE.length), 1100);
    return () => clearInterval(timer);
  }, [open]);

  const index = phase ? SCHRITTE.findIndex((s) => s.phase === phase) : -1;
  // Vor der ersten Meldung steht der erste Schritt an.
  const aktiv = index < 0 ? 0 : index;
  const letzterSchritt = aktiv === SCHRITTE.length - 1;
  const Motiv = MOTIVE[motiv];

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[60] flex flex-col items-center justify-center px-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          role="status"
          aria-live="polite"
        >
          {/* Warmer, ruhiger Hintergrund statt hartem Überblenden. */}
          <div
            className="absolute inset-0 bg-canvas/95 backdrop-blur-[3px]"
            style={{
              backgroundImage:
                'radial-gradient(28rem 20rem at 50% 38%, rgba(255,196,166,0.38), transparent 70%), radial-gradient(22rem 18rem at 50% 62%, rgba(205,178,239,0.26), transparent 70%)',
            }}
          />

          <div className="relative flex flex-col items-center">
            {/* Kreis */}
            <div className="relative grid h-[6.5rem] w-[6.5rem] place-items-center">
              <span
                aria-hidden
                className="absolute inset-0 rounded-full opacity-70 blur-xl"
                style={{
                  background:
                    'conic-gradient(from 0deg, rgba(255,159,111,0.55), rgba(205,178,239,0.45), rgba(255,159,111,0.55))',
                }}
              />
              {/* Der rotierende Ring: ein offener Bogen, kein Spinner-Kringel. */}
              <motion.span
                aria-hidden
                className="absolute inset-0 rounded-full"
                style={{
                  background:
                    'conic-gradient(from 0deg, transparent 0deg, rgba(241,92,28,0.9) 90deg, transparent 200deg)',
                  WebkitMask:
                    'radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))',
                  mask: 'radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))',
                }}
                animate={{ rotate: 360 }}
                transition={{ duration: 2.6, repeat: Infinity, ease: 'linear' }}
              />

              {/* Überblenden statt Nacheinander: Das alte Icon geht, während
                  das neue schon kommt – der Kreis ist nie leer. */}
              <span className="relative grid h-[5rem] w-[5rem] place-items-center rounded-full bg-canvas-raised shadow-card">
                <AnimatePresence initial={false}>
                  <motion.span
                    key={motiv}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 1.15 }}
                    transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                    className="absolute inset-0 grid place-items-center text-brand-500"
                  >
                    <Motiv size={30} />
                  </motion.span>
                </AnimatePresence>
              </span>
            </div>

            {/* Haupttext */}
            <p className="mt-7 max-w-[19rem] text-center text-[1.02rem] font-semibold leading-snug tracking-tight">
              {letzterSchritt
                ? t.overlay.almost
                : t.overlay.searching}
            </p>

            {/* Aktueller Abschnitt */}
            <div className="mt-1.5 h-5">
              <AnimatePresence mode="wait">
                <motion.p
                  key={aktiv}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.22 }}
                  className="text-center text-[0.84rem] text-ink-muted"
                >
                  {SCHRITTE[aktiv].text}
                </motion.p>
              </AnimatePresence>
            </div>

            {/* Fortschritt in vier Schritten */}
            <div className="mt-6 flex items-center gap-1.5">
              {SCHRITTE.map((schritt, i) => (
                <div key={schritt.phase} className="flex flex-col items-center gap-1.5">
                  <span className="relative block h-[3px] w-11 overflow-hidden rounded-full bg-line">
                    <motion.span
                      className="absolute inset-y-0 left-0 rounded-full bg-brand-500"
                      initial={false}
                      animate={{ width: i < aktiv ? '100%' : i === aktiv ? '60%' : '0%' }}
                      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                      style={{ opacity: i < aktiv ? 0.4 : 1 }}
                    />
                  </span>
                  <span
                    className={[
                      'text-[0.66rem] font-medium transition-colors duration-300',
                      i === aktiv ? 'text-brand-600' : i < aktiv ? 'text-ink-faint' : 'text-ink-faint/60',
                    ].join(' ')}
                  >
                    {schritt.kurz}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
