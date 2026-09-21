import { estimateTravelMinutes, haversineMeters, searchRadiusMeters } from '@/lib/geo';
import { shortId } from '@/lib/id';
import {
  dayPartOf,
  formatClock,
  isOpenDuring,
  processOffsetMin,
  roundUpToQuarter,
  seasonOf,
} from '@/lib/time';
import type { RouteQuery, RoutingProvider } from '@/providers/types';
import type {
  Category,
  Coordinates,
  Place,
  Plan,
  PlanNote,
  PlanRequest,
  PlanStep,
  PlanVariantKey,
  UserPreferences,
  WeatherForecast,
  WeatherSlice,
} from '@/types/domain';
import type { ProviderSet } from '@/providers/registry';
import { aggregateCost } from './budget';
import { passesHardFilters } from './hardFilters';
import { planSummary, planTitle, stepReason, tourSummary, tourTitle } from './narrative';
import { scorePlace, VARIANTS, variantByKey } from './scoring';
import { buildSlots } from './slots';
import type { PlanContext, Slot, VariantProfile } from './types';
import { weatherModeOf } from './weatherRules';

const BUDGET_CAPS: Record<PlanRequest['budget'], number | undefined> = {
  free: 5,
  low: 25,
  medium: 60,
  high: 120,
  any: undefined,
};

/** Findet die Wetter-Stunde, die einem Zeitpunkt am nächsten liegt. */
export function weatherAt(forecast: WeatherForecast, iso: string): WeatherSlice | null {
  if (!forecast.hourly.length) return forecast.now ?? null;
  const target = new Date(iso).getTime();
  let best = forecast.hourly[0];
  let bestDiff = Math.abs(new Date(best.time).getTime() - target);
  for (const slice of forecast.hourly) {
    const diff = Math.abs(new Date(slice.time).getTime() - target);
    if (diff < bestDiff) {
      best = slice;
      bestDiff = diff;
    }
  }
  // Mehr als 6 Stunden entfernt: lieber nichts behaupten.
  return bestDiff > 6 * 3600_000 ? null : best;
}

export async function createPlanContext(
  request: PlanRequest,
  preferences: UserPreferences,
  providers: ProviderSet,
  overrides?: { radiusMeters?: number },
): Promise<PlanContext> {
  const start = roundUpToQuarter(new Date(request.startISO));
  const isTour = request.mode === 'tour';
  const radiusMeters =
    overrides?.radiusMeters ??
    (isTour ? tourRadiusMeters(request.availableMinutes) : searchRadiusMeters(request.mobility, request.availableMinutes));

  // Parallel laden – Geschwindigkeit ist hier das Feature.
  // Bei Touren kommen die Sehenswürdigkeiten als eigene Abfrage dazu; die
  // normalen Orte braucht die Tour trotzdem – für Pausen und Geheimtipps.
  const [places, events, weather, sights] = await Promise.all([
    providers.places.search({
      center: request.origin,
      radiusMeters,
      openAtISO: start.toISOString(),
      limit: 400,
      locale: request.language,
    }),
    providers.events
      .search({
        center: request.origin,
        radiusMeters,
        fromISO: start.toISOString(),
        toISO: new Date(start.getTime() + request.availableMinutes * 60_000).toISOString(),
        limit: 5,
      })
      .catch(() => [] as Place[]),
    providers.weather.forecast(request.origin, 24),
    isTour
      ? providers.places
          .search({ center: request.origin, radiusMeters, theme: 'sights', limit: 500 })
          .catch(() => [] as Place[])
      : Promise.resolve(undefined),
  ]);

  const latestEnd = computeLatestEnd(request, start);

  // Ortszeit: bevorzugt vom Wetterdienst (kennt die Zeitzone des Ortes),
  // sonst vom Gerät des Nutzers, zuletzt vom Server.
  const tzOffsetMin =
    weather.utcOffsetSeconds !== undefined
      ? Math.round(weather.utcOffsetSeconds / 60)
      : (request.tzOffsetMin ?? processOffsetMin(start));

  return {
    request,
    preferences,
    pool: [...places, ...events],
    weather,
    season: seasonOf(start, request.origin.lat),
    dayPart: dayPartOf(start, tzOffsetMin),
    start,
    latestEnd,
    radiusMeters,
    budgetCap: request.budgetPerPerson ?? BUDGET_CAPS[request.budget],
    sights,
    tzOffsetMin,
  };
}

/**
 * Umkreis für Besichtigungstouren. Zu Fuß schafft man in zwei Stunden
 * keine fünf Kilometer Umweg – der Radius wächst deshalb mit der Zeit.
 */
function tourRadiusMeters(availableMinutes: number): number {
  if (availableMinutes <= 120) return 1300;
  if (availableMinutes <= 240) return 2000;
  return 2500;
}

function computeLatestEnd(request: PlanRequest, start: Date): Date {
  const byBudget = new Date(start.getTime() + request.availableMinutes * 60_000);
  if (!request.mustBeHomeByISO) return byBudget;
  const home = new Date(request.mustBeHomeByISO);
  return home < byBudget ? home : byBudget;
}

type BuildResult = {
  steps: PlanStep[];
  droppedSlots: number;
};

function buildSteps(ctx: PlanContext, profile: VariantProfile): BuildResult {
  const slots = buildSlots(ctx);
  const steps: PlanStep[] = [];
  const usedPlaceIds = new Set<string>();
  const usedCategories: Category[] = [];

  let cursor = new Date(ctx.start);
  let location: Coordinates = ctx.request.origin;
  let spentMin = 0;
  let dropped = 0;
  const usedReasons: string[] = [];

  for (let i = 0; i < slots.length; i += 1) {
    const slot = slots[i];
    const isLast = i === slots.length - 1;
    const reserve = reserveMinutesFor(ctx, isLast, location);

    const picked = pickForSlot({
      ctx,
      slot,
      profile,
      cursor,
      location,
      spentMin,
      usedPlaceIds,
      usedCategories,
      previousCategory: steps[steps.length - 1]?.place.category,
      reserveMinutes: reserve,
      usedReasons,
    });

    if (!picked) {
      dropped += 1;
      continue;
    }

    steps.push(picked.step);
    usedReasons.push(picked.step.reason);
    usedPlaceIds.add(picked.step.place.id);
    usedCategories.push(picked.step.place.category);
    cursor = new Date(picked.step.endISO);
    location = picked.step.place.location;
    spentMin += picked.step.price.perPerson?.min ?? 0;
  }

  return { steps, droppedSlots: dropped };
}

export function reserveMinutesFor(ctx: PlanContext, isLast: boolean, from: Coordinates): number {
  if (!isLast) return 0;
  if (!ctx.request.mustBeHomeByISO) return 0;
  const home = ctx.request.homeLocation ?? ctx.request.origin;
  const distance = haversineMeters(from, home);
  return estimateTravelMinutes(distance, ctx.request.mobility);
}

type PickInput = {
  ctx: PlanContext;
  slot: Slot;
  profile: VariantProfile;
  cursor: Date;
  location: Coordinates;
  spentMin: number;
  usedPlaceIds: Set<string>;
  usedCategories: Category[];
  previousCategory?: Category;
  reserveMinutes: number;
  /** Bereits vergebene Begründungen – verhindert dreimal denselben Satz. */
  usedReasons: string[];
  /** Orte, die zusätzlich ausgeschlossen werden (z. B. beim Ersetzen). */
  excludeIds?: Set<string>;
};

type Picked = { step: PlanStep; score: number };

/** Sucht den besten Ort für einen Slot. Zwei Durchläufe: erst rollentreu, dann offen. */
function pickForSlot(input: PickInput): Picked | null {
  const strict = pickFromPool(input, input.slot.roles);
  if (strict) return strict;
  // Zweiter Versuch: Rollen aufweichen, damit der Nutzer trotzdem etwas bekommt.
  const relaxed = pickFromPool(input, undefined);
  return relaxed;
}

/**
 * Harte Regeln gegen Wiederholung.
 *
 * Früh am Morgen hat oft nur eine Art von Ort offen. Ohne diese Regeln füllte
 * der Plan jeden freien Platz damit – drei Cafés hintereinander. Ein kürzerer
 * Plan ist ehrlicher als ein aufgefüllter.
 *
 *  - dieselbe Art nie zweimal direkt hintereinander (Ausnahme: Bars – von
 *    einer Kneipe in die nächste zu ziehen ist ein echtes Abendprogramm),
 *  - höchstens zweimal pro Plan,
 *  - der aufgeweichte zweite Suchdurchlauf darf nur Arten nehmen, die im Plan
 *    noch gar nicht vorkommen – er soll Lücken füllen, nicht verdoppeln.
 */
function abwechslungOk(category: Category, input: PickInput, aufgeweicht: boolean): boolean {
  const schonDa = input.usedCategories.filter((c) => c === category).length;
  if (aufgeweicht && schonDa > 0) return false;
  if (schonDa >= 2) return false;
  if (input.previousCategory === category && category !== 'bar') return false;
  return true;
}

function pickFromPool(input: PickInput, roles: Category[] | undefined): Picked | null {
  const { ctx, slot, profile, cursor, location, spentMin } = input;
  let best: Picked | null = null;

  for (const place of ctx.pool) {
    if (input.usedPlaceIds.has(place.id)) continue;
    if (input.excludeIds?.has(place.id)) continue;
    if (roles && !roles.includes(place.category)) continue;
    if (!abwechslungOk(place.category, input, roles === undefined)) continue;

    const distanceMeters = haversineMeters(location, place.location);
    const travelMin =
      distanceMeters < 40 ? 0 : estimateTravelMinutes(distanceMeters, ctx.request.mobility);
    const startAt = roundToFive(new Date(cursor.getTime() + travelMin * 60_000));
    const durationMin = place.typicalDurationMin;
    const startISO = startAt.toISOString();
    const weatherAtStart = weatherAt(ctx.weather, startISO);

    const filter = passesHardFilters({
      place,
      ctx,
      start: startAt,
      durationMin,
      distanceMeters,
      spentMin,
      weatherAtStart,
      reserveMinutes: input.reserveMinutes,
    });
    if (!filter.ok) continue;

    const scored = scorePlace({
      place,
      ctx,
      slot,
      distanceMeters,
      weatherAtStart,
      usedCategories: input.usedCategories,
      previousCategory: input.previousCategory,
      profile,
    });

    // Wer deutlich länger dauert als geplant, wird leicht abgewertet.
    const overrun = Math.max(0, durationMin - slot.targetMinutes - 20);
    const travelPenalty = travelMin > 25 ? (travelMin - 25) / 25 : 0;
    const total = scored.total - (overrun / 60) * 0.8 - travelPenalty * 0.6;

    if (!best || total > best.score) {
      const endISO = new Date(startAt.getTime() + durationMin * 60_000).toISOString();
      best = {
        score: total,
        step: {
          id: shortId(6),
          place,
          startISO,
          endISO,
          durationMin,
          travelFromPrevious: {
            mode: ctx.request.mobility,
            distanceMeters: Math.round(distanceMeters),
            durationMin: travelMin,
            estimated: true,
          },
          price: { ...place.price },
          openingHoursKnown: place.openingHours !== null,
          reason: stepReason(place, ctx, weatherAtStart, distanceMeters, input.usedReasons),
        },
      };
    }
  }

  return best;
}

export function roundToFive(date: Date): Date {
  const d = new Date(date);
  d.setSeconds(0, 0);
  const rest = d.getMinutes() % 5;
  if (rest !== 0) d.setMinutes(d.getMinutes() + (5 - rest));
  return d;
}

function buildNotes(ctx: PlanContext, steps: PlanStep[], dropped: number): PlanNote[] {
  const notes: PlanNote[] = [];
  const mode = weatherModeOf(ctx.weather.now);

  if (mode === 'wet') {
    const outdoor = steps.filter((s) => s.place.indoorOutdoor === 'outdoor').length;
    notes.push({
      kind: 'weather',
      text:
        outdoor === 0
          ? 'Alles drinnen – bei dem Wetter die bessere Wahl.'
          : 'Ein Teil ist draußen. Zieht euch was Wasserdichtes an.',
    });
  }

  if (ctx.request.mustBeHomeByISO && steps.length > 0) {
    notes.push({
      kind: 'time',
      text: `Rückweg ist eingerechnet – ihr seid rechtzeitig zuhause.`,
    });
  }

  const cost = aggregateCost(steps.map((s) => s.price));
  if (ctx.budgetCap !== undefined && cost.perPerson && cost.perPerson.max > ctx.budgetCap) {
    notes.push({
      kind: 'budget',
      text: 'Im oberen Bereich kann es knapp über eurem Budget liegen.',
    });
  }

  const unknownHours = steps.filter((s) => !s.openingHoursKnown).length;
  if (unknownHours > 0) {
    notes.push({
      kind: 'availability',
      text:
        unknownHours === 1
          ? 'Für einen Punkt sind keine Öffnungszeiten hinterlegt – vorher kurz prüfen.'
          : `Für ${unknownHours} Punkte sind keine Öffnungszeiten hinterlegt – vorher kurz prüfen.`,
    });
  }

  if (dropped > 0 && steps.length > 0) {
    notes.push({
      kind: 'availability',
      text: 'Für einen weiteren Programmpunkt war gerade nichts Passendes offen.',
    });
  }

  return notes;
}

export function buildPlan(
  ctx: PlanContext,
  variant: PlanVariantKey = 'balanced',
): Plan | null {
  const profile = variantByKey(variant);
  let { steps, droppedSlots } = buildSteps(ctx, profile);

  // Früh am Morgen hat kaum etwas offen. Statt aufzugeben, wird der Beginn
  // stundenweise verschoben – solange noch Zeit im Budget bleibt.
  let verschobenUm = 0;
  while (steps.length === 0 && verschobenUm < 4) {
    verschobenUm += 1;
    const start = new Date(ctx.start.getTime() + verschobenUm * 60 * 60_000);
    if (start >= ctx.latestEnd) break;
    ({ steps, droppedSlots } = buildSteps(
      { ...ctx, start, dayPart: dayPartOf(start, ctx.tzOffsetMin) },
      profile,
    ));
  }

  if (steps.length === 0) return null;
  const plan = assemblePlan(ctx, steps, profile.key, droppedSlots);
  if (verschobenUm > 0) {
    plan.notes.unshift({
      kind: 'time',
      text: `Um diese Uhrzeit hat noch kaum etwas geöffnet – der Plan beginnt deshalb um ${formatClock(steps[0].startISO, 'de', ctx.tzOffsetMin)} Uhr.`,
    });
  }
  return plan;
}

export function assemblePlan(
  ctx: PlanContext,
  steps: PlanStep[],
  variant: PlanVariantKey,
  droppedSlots = 0,
  existing?: Partial<
    Pick<Plan, 'id' | 'shareCode' | 'participants' | 'meetingPoint' | 'createdAtISO' | 'siblings'>
  >,
): Plan {
  const startISO = steps[0].startISO;
  const endISO = steps[steps.length - 1].endISO;
  const cost = aggregateCost(steps.map((s) => s.price));
  const isTour = ctx.request.mode === 'tour';

  return {
    id: existing?.id ?? shortId(10),
    shareCode: existing?.shareCode ?? shortId(6),
    title: isTour ? tourTitle(ctx) : planTitle(ctx),
    summary: isTour ? tourSummary(steps) : planSummary(steps, ctx),
    variant,
    mode: isTour ? 'tour' : 'evening',
    steps,
    startISO,
    endISO,
    totalDurationMin: Math.round(
      (new Date(endISO).getTime() - new Date(startISO).getTime()) / 60000,
    ),
    cost,
    currency: ctx.request.currency,
    request: ctx.request,
    weatherAtCreation: ctx.weather.now ?? null,
    createdAtISO: existing?.createdAtISO ?? new Date().toISOString(),
    notes: buildNotes(ctx, steps, droppedSlots),
    meetingPoint: existing?.meetingPoint,
    participants: existing?.participants ?? [],
    containsMockData: steps.some((s) => s.place.source === 'mock'),
    tzOffsetMin: ctx.tzOffsetMin,
    siblings: existing?.siblings,
  };
}

/**
 * Erzeugt bis zu drei deutlich unterschiedliche Varianten.
 * Varianten, die inhaltlich identisch zur Hauptvariante sind, werden verworfen –
 * drei fast gleiche Karten helfen niemandem.
 */
export function buildPlanVariants(ctx: PlanContext): Plan[] {
  const plans: Plan[] = [];
  const signatures = new Set<string>();

  for (const profile of VARIANTS) {
    const plan = buildPlan(ctx, profile.key);
    if (!plan) continue;
    const signature = plan.steps.map((s) => s.place.id).join('|');
    if (signatures.has(signature)) continue;
    signatures.add(signature);
    plans.push(plan);
  }

  return plans;
}

/**
 * Ersetzt die geschätzten Reisezeiten des fertigen Plans durch echtes Routing.
 *
 * Warum erst hier und nicht schon bei der Suche: Für jeden Slot werden
 * hunderte Kandidaten bewertet – die alle zu routen wäre weder bezahlbar noch
 * schnell. Die Geometrie-Schätzung reicht zum Aussortieren völlig; erst der
 * tatsächlich gewählte Weg lohnt eine echte Abfrage. Das sind zwei bis vier
 * Anfragen pro Plan.
 *
 * Verändert echtes Routing den Zeitplan so, dass ein Ort dann geschlossen
 * hätte oder das Zeitfenster reißt, bleibt der ursprüngliche Plan stehen.
 * Eine genauere Fahrzeit darf den Plan nicht kaputt machen.
 */
export async function refinePlanRouting(
  ctx: PlanContext,
  plan: Plan,
  routing: RoutingProvider,
): Promise<Plan> {
  if (plan.steps.length === 0) return plan;

  const queries: RouteQuery[] = [];
  let from: Coordinates = ctx.request.origin;
  for (const step of plan.steps) {
    queries.push({ from, to: step.place.location, mode: ctx.request.mobility });
    from = step.place.location;
  }

  let legs;
  try {
    legs = await routing.routeMany(queries);
  } catch {
    return plan;
  }
  // Wenn nichts echt geroutet wurde, ändert sich auch nichts.
  if (!legs.some((leg) => !leg.estimated)) return plan;

  const steps: PlanStep[] = [];
  let cursor = new Date(ctx.start);
  for (let i = 0; i < plan.steps.length; i += 1) {
    const old = plan.steps[i];
    const leg = legs[i];

    // Ist der echte Weg kürzer als geschätzt, wird der Termin NICHT vorgezogen:
    // Die ursprüngliche Zeit ist bereits gegen die Öffnungszeiten geprüft, und
    // früher ankommen heißt im Zweifel vor verschlossener Tür stehen. Nur
    // längere Wege verschieben den Plan nach hinten.
    const earliest = roundToFive(new Date(cursor.getTime() + leg.durationMin * 60_000));
    const original = new Date(old.startISO);
    const startAt = earliest > original ? earliest : original;
    const endAt = new Date(startAt.getTime() + old.durationMin * 60_000);

    steps.push({
      ...old,
      startISO: startAt.toISOString(),
      endISO: endAt.toISOString(),
      travelFromPrevious: leg,
    });
    cursor = endAt;
  }

  const lastStep = steps[steps.length - 1];
  const reserve = reserveMinutesFor(ctx, true, lastStep.place.location);
  const finish = new Date(new Date(lastStep.endISO).getTime() + reserve * 60_000);
  if (finish > ctx.latestEnd) return plan;

  for (const step of steps) {
    if (!step.place.openingHours) continue;
    if (!isOpenDuring(step.place.openingHours, new Date(step.startISO), step.durationMin, ctx.tzOffsetMin)) {
      return plan;
    }
  }

  return assemblePlan(ctx, steps, plan.variant, 0, {
    id: plan.id,
    shareCode: plan.shareCode,
    participants: plan.participants,
    meetingPoint: plan.meetingPoint,
    createdAtISO: plan.createdAtISO,
    siblings: plan.siblings,
  });
}

export type ReplaceHint = 'any' | 'cheaper' | 'faster' | 'romantic' | 'action' | 'indoor' | 'new';

/**
 * Ersetzt genau einen Schritt. Alles davor bleibt unverändert;
 * die Zeiten danach werden neu berechnet.
 */
export function replaceStep(
  ctx: PlanContext,
  plan: Plan,
  stepId: string,
  hint: ReplaceHint = 'any',
): Plan | null {
  const index = plan.steps.findIndex((s) => s.id === stepId);
  if (index < 0) return null;

  const slots = buildSlots(ctx);
  const slot = slots[Math.min(index, slots.length - 1)] ?? slots[slots.length - 1];
  const profile = profileForHint(hint, plan.variant);

  const before = plan.steps.slice(0, index);
  const cursor = before.length ? new Date(before[before.length - 1].endISO) : new Date(ctx.start);
  const location = before.length
    ? before[before.length - 1].place.location
    : ctx.request.origin;
  const spentMin = before.reduce((sum, s) => sum + (s.price.perPerson?.min ?? 0), 0);

  const exclude = new Set(plan.steps.map((s) => s.place.id));
  const usedPlaceIds = new Set(before.map((s) => s.place.id));

  const adjustedSlot: Slot = applyHintToSlot(slot, hint);

  const picked = pickForSlot({
    ctx,
    slot: adjustedSlot,
    profile,
    cursor,
    location,
    spentMin,
    usedPlaceIds,
    usedCategories: before.map((s) => s.place.category),
    previousCategory: before[before.length - 1]?.place.category,
    reserveMinutes: reserveMinutesFor(ctx, index === plan.steps.length - 1, location),
    usedReasons: before.map((s) => s.reason),
    excludeIds: exclude,
  });

  if (!picked) return null;

  const newSteps = [...before, picked.step];
  // Die restlichen Schritte behalten ihre Orte, bekommen aber neue Zeiten.
  let runningCursor = new Date(picked.step.endISO);
  let runningLocation = picked.step.place.location;

  for (const old of plan.steps.slice(index + 1)) {
    const distanceMeters = haversineMeters(runningLocation, old.place.location);
    const travelMin =
      distanceMeters < 40 ? 0 : estimateTravelMinutes(distanceMeters, ctx.request.mobility);
    const startAt = roundToFive(new Date(runningCursor.getTime() + travelMin * 60_000));
    const endAt = new Date(startAt.getTime() + old.durationMin * 60_000);
    newSteps.push({
      ...old,
      startISO: startAt.toISOString(),
      endISO: endAt.toISOString(),
      travelFromPrevious: {
        mode: ctx.request.mobility,
        distanceMeters: Math.round(distanceMeters),
        durationMin: travelMin,
        estimated: true,
      },
    });
    runningCursor = endAt;
    runningLocation = old.place.location;
  }

  return assemblePlan(ctx, newSteps, plan.variant, 0, {
    id: plan.id,
    shareCode: plan.shareCode,
    participants: plan.participants,
    meetingPoint: plan.meetingPoint,
    createdAtISO: plan.createdAtISO,
    siblings: plan.siblings,
  });
}

function profileForHint(hint: ReplaceHint, current: PlanVariantKey): VariantProfile {
  switch (hint) {
    case 'cheaper':
      return variantByKey('cheap');
    case 'romantic':
      return variantByKey('romantic');
    case 'action':
      return variantByKey('action');
    default:
      return variantByKey(current);
  }
}

function applyHintToSlot(slot: Slot, hint: ReplaceHint): Slot {
  switch (hint) {
    case 'faster':
      return { ...slot, targetMinutes: Math.max(30, Math.round(slot.targetMinutes * 0.6)) };
    case 'indoor':
      return { ...slot, roles: ['cinema', 'gaming', 'activity', 'culture', 'cafe', 'food'] };
    case 'new':
      return { ...slot, roles: ['event', 'gaming', 'culture', 'activity', 'sport'] };
    default:
      return slot;
  }
}
