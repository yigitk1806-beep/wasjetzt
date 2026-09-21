import { NextResponse } from 'next/server';
import { getPlanStore } from '@/db/planStore';
import { createPlanContext, refinePlanRouting } from '@/engine/planBuilder';
import { retimePlan } from '@/engine/retime';
import { getProviders } from '@/providers/registry';
import { normalizePreferences } from '@/lib/requestSchema';
import { localClock, parseClock } from '@/lib/time';
import type { PlanRequest } from '@/types/domain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Legt einen bestehenden Plan auf eine neue Startzeit (und optional eine neue
 * Heimkehrzeit). Die Stationen bleiben, wo es geht – siehe `retimePlan`.
 *
 * Body: { startLocal: "14:30" | null, homeByLocal?: "21:00" | null }
 *  - startLocal null → jetzt
 *  - homeByLocal fehlt → bisherige Heimkehrzeit bleibt; null → keine
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const store = getPlanStore();
  const plan = await store.get(id);
  if (!plan) return NextResponse.json({ error: 'not-found' }, { status: 404 });

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    /* leerer Body = jetzt starten */
  }

  const startLocal = parseClock(body.startLocal) !== null ? String(body.startLocal) : undefined;
  let homeByLocal: string | undefined;
  if (body.homeByLocal === null) {
    homeByLocal = undefined;
  } else if (parseClock(body.homeByLocal) !== null) {
    homeByLocal = String(body.homeByLocal);
  } else if (plan.request.mustBeHomeByISO) {
    // Bisherige Heimkehrzeit als Uhrzeit mitnehmen – wird der Start auf morgen
    // gelegt, gilt sie dann eben morgen.
    homeByLocal = localClock(new Date(plan.request.mustBeHomeByISO), plan.tzOffsetMin ?? 0);
  }

  const neu: PlanRequest = {
    ...plan.request,
    startISO: new Date().toISOString(),
    startLocal,
    homeByLocal,
    mustBeHomeByISO: undefined,
    tzOffsetMin: plan.tzOffsetMin ?? plan.request.tzOffsetMin,
  };

  try {
    const providers = getProviders();
    const ctx = await createPlanContext(neu, normalizePreferences(body.preferences), providers);
    const result = retimePlan(ctx, plan);

    if (!result) {
      return NextResponse.json(
        {
          error: 'no-fit',
          message: 'Zu dieser Zeit passt von diesem Plan nichts mehr – erstell lieber einen neuen.',
        },
        { status: 200 },
      );
    }

    const routed = await refinePlanRouting(ctx, result.plan, providers.routing);
    const saved = await store.save(routed);
    return NextResponse.json({ plan: saved, ersetzt: result.ersetzt, weggelassen: result.weggelassen });
  } catch (error) {
    console.error('[api/plan/retime]', error);
    return NextResponse.json({ error: 'Verschieben fehlgeschlagen.' }, { status: 500 });
  }
}
