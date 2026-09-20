import { NextResponse } from 'next/server';
import { getPlanStore } from '@/db/planStore';
import {
  createPlanContext,
  refinePlanRouting,
  replaceStep,
  type ReplaceHint,
} from '@/engine/planBuilder';
import { getProviders } from '@/providers/registry';
import { normalizePreferences } from '@/lib/requestSchema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HINTS: ReplaceHint[] = [
  'any', 'cheaper', 'faster', 'romantic', 'action', 'indoor', 'new',
];

/** Ersetzt genau eine Aktivität. Der Rest des Plans bleibt bestehen. */
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
    /* leerer Body ist erlaubt */
  }

  const stepId = typeof body.stepId === 'string' ? body.stepId : null;
  if (!stepId) return NextResponse.json({ error: 'stepId fehlt.' }, { status: 400 });

  const hint: ReplaceHint =
    typeof body.hint === 'string' && (HINTS as string[]).includes(body.hint)
      ? (body.hint as ReplaceHint)
      : 'any';

  try {
    const providers = getProviders();
    const preferences = normalizePreferences(body.preferences);
    const ctx = await createPlanContext(plan.request, preferences, providers);
    const next = replaceStep(ctx, plan, stepId, hint);

    if (!next) {
      return NextResponse.json(
        { error: 'no-alternative', message: 'Dafür finde ich gerade keine Alternative.' },
        { status: 200 },
      );
    }

    const routed = await refinePlanRouting(ctx, next, providers.routing);
    const saved = await store.save(routed);
    return NextResponse.json({ plan: saved });
  } catch (error) {
    console.error('[api/plan/replace]', error);
    return NextResponse.json({ error: 'Ersetzen fehlgeschlagen.' }, { status: 500 });
  }
}
