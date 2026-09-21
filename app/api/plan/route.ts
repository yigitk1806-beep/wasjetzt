import { NextResponse } from 'next/server';
import { getPlanStore } from '@/db/planStore';
import {
  buildPlan,
  buildPlanVariants,
  createPlanContext,
  refinePlanRouting,
} from '@/engine/planBuilder';
import { variantByKey } from '@/engine/scoring';
import { buildTour } from '@/engine/tourBuilder';
import { getProviders } from '@/providers/registry';
import { normalizePlanRequest, normalizePreferences, RequestError } from '@/lib/requestSchema';
import { localHour, processOffsetMin } from '@/lib/time';
import type { Mood, Plan } from '@/types/domain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Abschnitte der Planung, in der Reihenfolge, in der sie tatsächlich laufen.
 * Die Oberfläche zeigt damit echten Fortschritt statt einer geschätzten Dauer.
 */
export type PlanPhase = 'orte' | 'wetter' | 'wege' | 'plan';

type PhaseReporter = (phase: PlanPhase) => void;

type PipelineResult =
  | { ok: true; plan: Plan; variants: Plan[]; understood: string[]; weatherSource: string }
  | { ok: false; status: number; error: string; message?: string; understood?: string[] };

/**
 * Erstellt einen Plan. Body: { ...PlanRequest-Felder, preferences?, variants?, surprise? }
 *
 * Mit `?stream=1` kommt die Antwort als Ereignisstrom: erst Fortschritts-
 * meldungen, dann das Ergebnis. Ohne den Parameter bleibt alles wie bisher –
 * eine einzelne JSON-Antwort.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Ungültiger Body.' }, { status: 400 });
  }

  const input = (body ?? {}) as Record<string, unknown>;
  const streamen = new URL(request.url).searchParams.get('stream') === '1';

  if (!streamen) {
    const result = await runPipeline(input, () => undefined);
    return antwort(result);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (typ: string, daten: unknown) => {
        controller.enqueue(encoder.encode(`event: ${typ}\ndata: ${JSON.stringify(daten)}\n\n`));
      };

      try {
        const result = await runPipeline(input, (phase) => send('phase', { phase }));
        send('result', result);
      } catch (error) {
        console.error('[api/plan] Strom abgebrochen', error);
        send('result', { ok: false, status: 500, error: 'Die Planung ist fehlgeschlagen.' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

function antwort(result: PipelineResult) {
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, message: result.message, understood: result.understood },
      { status: result.status },
    );
  }
  return NextResponse.json({
    plan: result.plan,
    variants: result.variants,
    understood: result.understood,
    weatherSource: result.weatherSource,
  });
}

/**
 * Die eigentliche Planung. Unverändert gegenüber vorher – ergänzt nur um
 * Meldungen, an welchem Abschnitt gerade gearbeitet wird.
 */
async function runPipeline(
  input: Record<string, unknown>,
  melde: PhaseReporter,
): Promise<PipelineResult> {
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
          input.mustBeHomeByISO ??
          homeByFrom(intent.homeByMinutes, merged.startISO, clientOffset(input));
      }
    }

    if (input.surprise === true) {
      merged = applySurprise(merged, preferences);
    }

    const planRequest = normalizePlanRequest(merged);

    melde('orte');
    const ctx = await createPlanContext(planRequest, preferences, providers);
    melde('wetter');

    const isTour = planRequest.mode === 'tour';
    const wantVariants = input.variants !== false && !isTour;
    const kandidaten = isTour
      ? [buildTour(ctx)]
      : wantVariants
        ? buildPlanVariants(ctx)
        : [buildPlan(ctx)];
    const plans = kandidaten.filter((p): p is Plan => Boolean(p));

    if (plans.length === 0) {
      return {
        ok: false,
        status: 200,
        error: 'no-plan',
        message: !isTour
          ? 'Dafür finde ich gerade nichts Passendes.'
          : ctx.sightsUnavailable
            ? 'Die Sehenswürdigkeiten konnten gerade nicht geladen werden. Versuch es in ein paar Sekunden nochmal.'
            : 'Hier finde ich gerade zu wenige offene Sehenswürdigkeiten für eine Tour.',
        understood,
      };
    }

    // Jede Variante kennt ihre Geschwister, damit die UI ohne Neuplanung
    // umschalten kann.
    const siblings = plans.map((plan) => ({
      variant: plan.variant,
      id: plan.id,
      title: variantByKey(plan.variant).title,
      emoji: variantByKey(plan.variant).emoji,
    }));
    for (const plan of plans) plan.siblings = siblings;

    melde('wege');
    const routed = await Promise.all(
      plans.map((plan) => refinePlanRouting(ctx, plan, providers.routing)),
    );

    melde('plan');
    const store = getPlanStore();
    // Der Speicher ergänzt beim Sichern das Ablaufdatum – deshalb wird mit
    // den gespeicherten Kopien geantwortet, nicht mit den Originalen.
    const saved = await Promise.all(routed.map((plan) => store.save(plan)));

    return {
      ok: true,
      plan: saved[0],
      variants: saved.slice(1),
      understood,
      weatherSource: ctx.weather.source,
    };
  } catch (error) {
    if (error instanceof RequestError) {
      return { ok: false, status: 400, error: error.message };
    }
    console.error('[api/plan] unerwarteter Fehler', error);
    return {
      ok: false,
      status: 500,
      error: 'Die Planung ist fehlgeschlagen. Versuch es gleich nochmal.',
    };
  }
}

/** Vom Gerät gemeldeter Zeitversatz – der Server selbst läuft auf UTC. */
function clientOffset(input: Record<string, unknown>): number {
  const v = Number(input.tzOffsetMin);
  return Number.isFinite(v) && Math.abs(v) <= 14 * 60 ? v : processOffsetMin();
}

function mergeMoods(explicit: unknown, parsed: Mood[]): Mood[] {
  const list = Array.isArray(explicit) ? (explicit as Mood[]) : [];
  return Array.from(new Set([...list, ...parsed]));
}

/**
 * „Bis 22 Uhr zuhause" → Zeitpunkt. Die Uhrzeit meint die Ortszeit des Nutzers,
 * nicht die des Servers – deshalb über den vom Gerät gemeldeten Versatz.
 */
function homeByFrom(minutesSinceMidnight: number, startISO: unknown, offsetMin: number): string {
  const base = typeof startISO === 'string' ? new Date(startISO) : new Date();
  const lokal = new Date(base.getTime() + offsetMin * 60_000);
  const mitternachtLokal = Date.UTC(lokal.getUTCFullYear(), lokal.getUTCMonth(), lokal.getUTCDate());
  let ziel = mitternachtLokal + minutesSinceMidnight * 60_000 - offsetMin * 60_000;
  // Liegt die Uhrzeit vor dem Start, ist der nächste Tag gemeint.
  if (ziel <= base.getTime()) ziel += 24 * 60 * 60_000;
  return new Date(ziel).toISOString();
}

/** "Überrasch mich": zufällige, aber zur Tageszeit passende Stimmung. */
function applySurprise(
  input: Record<string, unknown>,
  preferences: ReturnType<typeof normalizePreferences>,
): Record<string, unknown> {
  const hour = Math.floor(
    localHour(
      new Date(typeof input.startISO === 'string' ? input.startISO : Date.now()),
      clientOffset(input),
    ),
  );

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
