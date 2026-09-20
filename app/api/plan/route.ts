import { NextResponse } from 'next/server';
import { getPlanStore } from '@/db/planStore';
import {
  buildPlan,
  buildPlanVariants,
  createPlanContext,
  refinePlanRouting,
} from '@/engine/planBuilder';
import { variantByKey } from '@/engine/scoring';
import { getProviders } from '@/providers/registry';
import { normalizePlanRequest, normalizePreferences, RequestError } from '@/lib/requestSchema';
import type { Mood } from '@/types/domain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Erstellt einen Plan. Body: { ...PlanRequest-Felder, preferences?, variants?, surprise? }
 * Antwort: { plan, variants }
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Ungültiger Body.' }, { status: 400 });
  }

  const input = (body ?? {}) as Record<string, unknown>;

  try {
    const providers = getProviders();
    const preferences = normalizePreferences(input.preferences);

    // Freitext zuerst auswerten – er darf explizite Felder ergänzen.
    let merged = { ...input } as Record<string, unknown>;
    let understood: string[] = [];

    if (typeof input.rawText === 'string' && input.rawText.trim()) {
      const intent = await providers.language.parse(input.rawText, preferences.language);
      understood = intent.understood;
      merged = {
        ...merged,
        party: input.party ?? intent.party,
        groupSize: input.groupSize ?? intent.groupSize,
        budget: input.budget ?? intent.budget,
        budgetPerPerson: input.budgetPerPerson ?? intent.budgetPerPerson,
        availableMinutes: input.availableMinutes ?? intent.availableMinutes,
        mobility: input.mobility ?? intent.mobility,
        focusCategory: input.focusCategory ?? intent.focusCategory,
        preferNovelty: input.preferNovelty ?? intent.preferNovelty,
        moods: mergeMoods(input.moods, intent.moods),
      };
      if (intent.homeByMinutes !== undefined) {
        merged.mustBeHomeByISO =
          input.mustBeHomeByISO ?? homeByFrom(intent.homeByMinutes, merged.startISO);
      }
    }

    if (input.surprise === true) {
      merged = applySurprise(merged, preferences);
    }

    const planRequest = normalizePlanRequest(merged);
    const ctx = await createPlanContext(planRequest, preferences, providers);

    const wantVariants = input.variants !== false;
    const plans = wantVariants ? buildPlanVariants(ctx) : [buildPlan(ctx)].filter(Boolean);

    if (!plans.length || !plans[0]) {
      return NextResponse.json(
        {
          error: 'no-plan',
          message: 'Dafür finde ich gerade nichts Passendes.',
          understood,
        },
        { status: 200 },
      );
    }

    // Jede Variante kennt ihre Geschwister, damit die UI ohne Neuplanung
    // umschalten kann.
    const siblings = plans.filter(Boolean).map((plan) => ({
      variant: plan!.variant,
      id: plan!.id,
      title: variantByKey(plan!.variant).title,
      emoji: variantByKey(plan!.variant).emoji,
    }));
    for (const plan of plans) {
      if (plan) plan.siblings = siblings;
    }

    // Echte Reisezeiten für die tatsächlich gewählten Wege nachziehen.
    const routed = await Promise.all(
      plans.map((plan) => refinePlanRouting(ctx, plan!, providers.routing)),
    );

    const store = getPlanStore();
    // Der Speicher ergänzt beim Sichern das Ablaufdatum – deshalb wird mit
    // den gespeicherten Kopien geantwortet, nicht mit den Originalen.
    const saved = await Promise.all(routed.map((plan) => store.save(plan)));

    return NextResponse.json({
      plan: saved[0],
      variants: saved.slice(1),
      understood,
      usesMockPlaces: providers.places.isMock,
      weatherSource: ctx.weather.source,
    });
  } catch (error) {
    if (error instanceof RequestError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('[api/plan] unerwarteter Fehler', error);
    return NextResponse.json(
      { error: 'Die Planung ist fehlgeschlagen. Versuch es gleich nochmal.' },
      { status: 500 },
    );
  }
}

function mergeMoods(explicit: unknown, parsed: Mood[]): Mood[] {
  const list = Array.isArray(explicit) ? (explicit as Mood[]) : [];
  return Array.from(new Set([...list, ...parsed]));
}

function homeByFrom(minutesSinceMidnight: number, startISO: unknown): string {
  const base = typeof startISO === 'string' ? new Date(startISO) : new Date();
  const target = new Date(base);
  target.setHours(0, 0, 0, 0);
  target.setMinutes(minutesSinceMidnight);
  // Liegt die Uhrzeit vor dem Start, ist der nächste Tag gemeint.
  if (target <= base) target.setDate(target.getDate() + 1);
  return target.toISOString();
}

/** "Überrasch mich": zufällige, aber zur Tageszeit passende Stimmung. */
function applySurprise(
  input: Record<string, unknown>,
  preferences: ReturnType<typeof normalizePreferences>,
): Record<string, unknown> {
  const hour = new Date(
    typeof input.startISO === 'string' ? input.startISO : Date.now(),
  ).getHours();

  const pool: Mood[] =
    hour < 12
      ? ['chill', 'nature', 'food', 'new']
      : hour < 17
        ? ['action', 'nature', 'chill', 'new']
        : ['action', 'food', 'party', 'date', 'new'];

  // Abgelehnte Kategorien beeinflussen die Auswahl mit.
  const filtered = pool.filter((mood) => {
    if (mood === 'food') return (preferences.dislikes.food ?? 0) < 0.6;
    if (mood === 'party') return (preferences.dislikes.bar ?? 0) < 0.6;
    return true;
  });
  const chosen = filtered.length ? filtered : pool;
  const mood = chosen[Math.floor(Math.random() * chosen.length)];

  return {
    ...input,
    moods: [mood],
    preferNovelty: true,
    party: input.party ?? preferences.defaultParty,
    mobility: input.mobility ?? preferences.defaultMobility,
  };
}
