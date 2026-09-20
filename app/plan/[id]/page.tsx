import Link from 'next/link';
import { getPlanStore } from '@/db/planStore';
import { PlanView } from '@/components/plan/PlanView';

export const dynamic = 'force-dynamic';

export default async function PlanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const plan = await getPlanStore().get(id);

  if (!plan) return <PlanNotFound />;

  return <PlanView initialPlan={plan} />;
}

/** Abgelaufene oder unbekannte Links landen hier – ohne Sackgasse. */
function PlanNotFound() {
  return (
    <main className="shell flex min-h-[70dvh] flex-col items-center justify-center gap-4 text-center">
      <span className="text-4xl" aria-hidden>
        🕗
      </span>
      <h1 className="text-[1.5rem] font-bold tracking-tight">Diesen Plan gibt es nicht mehr.</h1>
      <p className="max-w-[24rem] text-[0.92rem] text-ink-muted">
        Geteilte Pläne laufen nach einer Weile ab. Erstell dir in ein paar Sekunden einen neuen.
      </p>
      <Link
        href="/"
        className="tap mt-2 inline-flex h-12 items-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 px-6 font-semibold text-white shadow-lift"
      >
        Neuen Plan machen
      </Link>
    </main>
  );
}
