'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import { loadRecentPlans, type RecentPlan } from '@/lib/clientStore';

export default function PlansPage() {
  const [plans, setPlans] = useState<RecentPlan[] | null>(null);

  useEffect(() => {
    setPlans(loadRecentPlans());
  }, []);

  return (
    <main className="shell space-y-5 pt-8">
      <h1 className="text-[2rem] font-bold tracking-[-0.03em]">Deine Pläne</h1>

      {plans === null ? (
        <div className="space-y-2.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-20 rounded-3xl" />
          ))}
        </div>
      ) : plans.length === 0 ? (
        <div className="rounded-3xl bg-canvas-raised p-6 text-center shadow-card hairline">
          <span className="text-3xl" aria-hidden>
            ✨
          </span>
          <p className="mt-3 text-[0.95rem] font-semibold">Noch nichts geplant.</p>
          <p className="mt-1 text-[0.86rem] text-ink-muted">
            Sobald du einen Plan startest, taucht er hier auf.
          </p>
          <Link
            href="/"
            className="tap mt-4 inline-flex h-11 items-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 px-5 text-[0.92rem] font-semibold text-white shadow-lift"
          >
            Jetzt los
          </Link>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {plans.map((plan, index) => (
            <motion.li
              key={plan.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.04, duration: 0.35 }}
            >
              <Link
                href={`/plan/${plan.id}`}
                className="tap flex items-center gap-3 rounded-3xl bg-canvas-raised p-4 shadow-card hairline"
              >
                <span className="text-lg" aria-hidden>
                  {plan.emojis.slice(0, 3).join(' ')}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{plan.title}</span>
                  <span className="block truncate text-[0.82rem] text-ink-muted">
                    {plan.summary}
                  </span>
                  <span className="block text-[0.74rem] text-ink-faint">
                    {new Date(plan.startISO).toLocaleDateString('de', {
                      weekday: 'short',
                      day: '2-digit',
                      month: '2-digit',
                    })}
                  </span>
                </span>
              </Link>
            </motion.li>
          ))}
        </ul>
      )}

      <p className="text-[0.76rem] leading-relaxed text-ink-faint">
        Die Liste liegt nur in diesem Browser. Geteilte Pläne selbst verfallen nach 24 Stunden.
      </p>
    </main>
  );
}
