'use client';

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { formatDistance } from '@/lib/geo';
import type { Coordinates, Place } from '@/types/domain';

type Deal = { place: Place; distanceMeters: number };

type Props = {
  coords: Coordinates | null;
  onPick: (deal: Deal) => void;
};

/**
 * "Jetzt günstig" – kurzfristige Angebote. Wird nur angezeigt,
 * wenn es tatsächlich welche gibt; sonst bleibt die Startseite leer und ruhig.
 */
export function DealsStrip({ coords, onPick }: Props) {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [isMock, setIsMock] = useState(false);

  useEffect(() => {
    if (!coords) return;
    let cancelled = false;

    fetch(`/api/deals?lat=${coords.lat.toFixed(4)}&lon=${coords.lon.toFixed(4)}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setDeals((data.deals ?? []).slice(0, 4));
        setIsMock(Boolean(data.isMock));
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [coords?.lat, coords?.lon]);

  if (deals.length === 0) return null;

  return (
    <section className="space-y-2.5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[0.95rem] font-bold tracking-tight">⚡ Jetzt günstig</h2>
        {isMock ? <span className="text-[0.7rem] text-ink-faint">Demo</span> : null}
      </div>

      <div className="-mx-[1.15rem] edge-fade">
        <div className="scroll-x px-[1.15rem]">
          {deals.map((deal, index) => (
            <motion.button
              key={deal.place.id}
              type="button"
              onClick={() => onPick(deal)}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 + index * 0.05, duration: 0.35 }}
              whileTap={{ scale: 0.97 }}
              style={{ scrollSnapAlign: 'start' }}
              className="flex w-[13.5rem] shrink-0 items-center gap-3 rounded-3xl bg-canvas-raised p-3.5 text-left shadow-card hairline"
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-mint-100 text-xl" aria-hidden>
                {deal.place.emoji}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[0.92rem] font-semibold">
                  {deal.place.kind}
                </span>
                <span className="block truncate text-[0.78rem] text-mint-700">
                  {deal.place.deal?.label}
                </span>
                <span className="block text-[0.74rem] text-ink-faint">
                  {formatDistance(deal.distanceMeters)}
                </span>
              </span>
            </motion.button>
          ))}
        </div>
      </div>
    </section>
  );
}
