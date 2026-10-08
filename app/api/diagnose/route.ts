import { NextResponse } from 'next/server';
import { createPlanContext } from '@/engine/planBuilder';
import { buildSlots } from '@/engine/slots';
import { scorePlace, variantByKey } from '@/engine/scoring';
import { normalizePlanRequest, normalizePreferences, RequestError } from '@/lib/requestSchema';
import { getProviders } from '@/providers/registry';
import { haversineMeters } from '@/lib/geo';
import { passesHardFilters } from '@/engine/hardFilters';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Zeigt, wie eine Eingabe bewertet wird – Absicht, Slots, beste Kandidaten
 * und die Punktzahl je Kriterium.
 *
 * Existiert, weil „zwei Eingaben liefern denselben Plan" von außen nicht zu
 * beurteilen ist: Es kann heißen, dass die Eingabe ignoriert wird, oder dass
 * dieselben Orte tatsächlich für beide die besten sind. Nur die Punktzahlen
 * unterscheiden das.
 *
 * Bewusst ohne Nebenwirkung: Es wird nichts gespeichert und kein Plan gebaut.
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'bad-json' }, { status: 400 });
  }

  try {
    const planRequest = normalizePlanRequest(body);
    const preferences = normalizePreferences(body.preferences);
    const ctx = await createPlanContext(planRequest, preferences, getProviders());
    const profile = variantByKey('balanced');
    const slots = buildSlots(ctx);

    const wieViele = Math.min(10, Math.max(1, Number(body.top) || 5));

    return NextResponse.json({
      intent: ctx.intent,
      // Welche Tageszeit die Engine angenommen hat. Von außen sonst nur am
      // Plantitel ablesbar – und den gibt es nur, wenn ein Plan zustande kam.
      dayPart: ctx.dayPart,
      radiusMeters: ctx.radiusMeters,
      budgetCapProPerson: ctx.budgetCap,
      poolGroesse: ctx.pool.length,
      slots: slots.map((slot) => {
        const kandidaten = ctx.pool
          .filter((place) => slot.roles.includes(place.category))
          .filter((place) => !place.sightseeing || ctx.request.focusCategory === 'culture')
          .map((place) => {
            const distanceMeters = haversineMeters(ctx.request.origin, place.location);
            const bewertet = scorePlace({
              place,
              ctx,
              slot,
              distanceMeters,
              weatherAtStart: ctx.weather.now,
              usedCategories: [],
              profile,
            });
            // Warum ein hoch bewerteter Ort trotzdem nicht im Plan landet,
            // ist von außen sonst nicht zu sehen: Das Ranking sagt nur, wie
            // gut er passt, die harten Filter sagen, ob er überhaupt geht.
            const filter = passesHardFilters({
              place,
              ctx,
              start: ctx.start,
              durationMin: slot.targetMinutes,
              distanceMeters,
              spentMin: 0,
              weatherAtStart: ctx.weather.now,
              reserveMinutes: 0,
            });
            return {
              name: place.name,
              art: place.kind,
              kategorie: place.category,
              meter: Math.round(distanceMeters),
              punkte: Number(bewertet.total.toFixed(3)),
              abgelehnt: filter.ok ? null : filter.reason,
              oeffnungszeiten: place.openingHours ?? null,
              einzeln: Object.fromEntries(
                Object.entries(bewertet.breakdown).map(([k, v]) => [k, Number((v ?? 0).toFixed(3))]),
              ),
            };
          })
          .sort((a, b) => b.punkte - a.punkte);

        return {
          rolle: slot.label,
          bedarf: slot.need,
          kategorien: slot.roles,
          pflicht: !slot.optional,
          kandidaten: kandidaten.length,
          top: kandidaten.slice(0, wieViele),
        };
      }),
    });
  } catch (error) {
    if (error instanceof RequestError) {
      return NextResponse.json({ error: error.code }, { status: 400 });
    }
    console.error('[api/diagnose]', error);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
