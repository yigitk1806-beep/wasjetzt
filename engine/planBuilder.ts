import { estimateTravelMinutes, haversineMeters, searchRadiusMeters } from '@/lib/geo';
import { shortId } from '@/lib/id';
import {
  dayPartOf,
  formatClock,
  isOpenDuring,
  nextLocalTime,
  parseClock,
  processOffsetMin,
  roundUpToFive,
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
  TravelLeg,
  UserPreferences,
  WeatherForecast,
  WeatherSlice,
} from '@/types/domain';
import type { ProviderSet } from '@/providers/registry';
import { aggregateCost } from './budget';
import { passesHardFilters } from './hardFilters';
import { planSummary, planTitle, stepReason, tourSummary, tourTitle } from './narrative';
import { begruendung, note } from './texts';
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
  const now = new Date();
  // Vorläufig mit der Zeitzone des Geräts – die des Ortes kennt erst der
  // Wetterdienst. Reicht für die Suche; festgelegt wird weiter unten.
  const vorlaeufig = resolveTimes(request, request.tzOffsetMin ?? processOffsetMin(now), now);
  const isTour = request.mode === 'tour';
  const radiusMeters =
    overrides?.radiusMeters ??
    (isTour ? tourRadiusMeters(request.availableMinutes) : searchRadiusMeters(request.mobility, request.availableMinutes));
  // Die Vorhersage muss bis zum Ende des Plans reichen – auch wenn er erst
  // morgen Nachmittag stattfindet.
  const stunden = Math.min(
    48,
    Math.max(24, Math.ceil((vorlaeufig.latestEnd.getTime() - now.getTime()) / 3_600_000) + 2),
  );

  // Parallel laden – Geschwindigkeit ist hier das Feature.
  // Bei Touren kommen die Sehenswürdigkeiten als eigene Abfrage dazu; die
  // normalen Orte braucht die Tour trotzdem – für Pausen und Geheimtipps.
  const [places, events, weather, sights] = await Promise.all([
    providers.places.search({
      center: request.origin,
      radiusMeters,
      openAtISO: vorlaeufig.start.toISOString(),
      limit: 400,
      locale: request.language,
    }),
    providers.events
      .search({
        center: request.origin,
        radiusMeters,
        fromISO: vorlaeufig.start.toISOString(),
        toISO: vorlaeufig.latestEnd.toISOString(),
        limit: 5,
      })
      .catch(() => [] as Place[]),
    providers.weather.forecast(request.origin, stunden),
    isTour
      ? providers.places
          .search({
            center: request.origin,
            radiusMeters,
            theme: 'sights',
            limit: 500,
            // Bei einer Tour wartet der Nutzer mit sichtbarem Fortschritt –
            // lieber etwas länger als erfundene Sehenswürdigkeiten.
            maxWaitMs: 22_000,
            noFallback: true,
          })
          .catch(() => null)
      : Promise.resolve(undefined),
  ]);

  // Ortszeit: bevorzugt vom Wetterdienst (kennt die Zeitzone des Ortes),
  // sonst vom Gerät des Nutzers, zuletzt vom Server.
  const tzOffsetMin =
    weather.utcOffsetSeconds !== undefined
      ? Math.round(weather.utcOffsetSeconds / 60)
      : (request.tzOffsetMin ?? processOffsetMin(vorlaeufig.start));

  const { start, homeBy, latestEnd } = resolveTimes(request, tzOffsetMin, now);

  // Ab hier gelten nur noch feste Zeitpunkte. Ersetzen und Verschieben
  // arbeiten später mit genau diesen Werten weiter – eine "14:30" darf beim
  // Öffnen am nächsten Tag nicht plötzlich auf übermorgen springen.
  const resolved: PlanRequest = {
    ...request,
    startISO: start.toISOString(),
    mustBeHomeByISO: homeBy?.toISOString(),
    startLocal: undefined,
    homeByLocal: undefined,
  };

  return {
    request: resolved,
    preferences,
    pool: [...places, ...events],
    weather,
    season: seasonOf(start, request.origin.lat),
    dayPart: dayPartOf(start, tzOffsetMin),
    start,
    latestEnd,
    radiusMeters,
    budgetCap: request.budgetPerPerson ?? BUDGET_CAPS[request.budget],
    sights: sights ?? undefined,
    sightsUnavailable: isTour && sights === null,
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

/**
 * Start, Heimkehr und spätestes Ende als feste Zeitpunkte.
 *
 * Uhrzeiten wie "14:30" meinen die Ortszeit des Standorts, nicht die des
 * Servers (UTC) und nicht zwingend die des Geräts. Liegt die Uhrzeit heute
 * schon zurück, ist morgen gemeint – bis auf zehn Minuten Kulanz, dann geht
 * es eben jetzt los.
 */
export function resolveTimes(
  request: PlanRequest,
  offsetMin: number,
  now = new Date(),
): { start: Date; homeBy?: Date; latestEnd: Date } {
  const gewuenscht = parseClock(request.startLocal);
  let start: Date;
  if (gewuenscht !== null) {
    start = nextLocalTime(gewuenscht, now, offsetMin, 10);
    if (start < now) start = roundUpToFive(now);
  } else {
    start = roundUpToFive(new Date(request.startISO));
  }

  const heim = parseClock(request.homeByLocal);
  const homeBy =
    heim !== null
      ? nextLocalTime(heim, new Date(start.getTime() + 60_000), offsetMin)
      : request.mustBeHomeByISO
        ? new Date(request.mustBeHomeByISO)
        : undefined;

  const byBudget = new Date(start.getTime() + request.availableMinutes * 60_000);
  const latestEnd = homeBy && homeBy < byBudget ? homeBy : byBudget;
  return { start, homeBy, latestEnd };
}

/**
 * Weg nach Hause von einem Ort aus – nur, wenn eine Heimkehrzeit gesetzt ist.
 * Geschätzt; echtes Routing kommt erst für den fertigen Plan.
 */
export function homeLeg(
  ctx: PlanContext,
  from: Coordinates,
): { durationMin: number; distanceMeters: number } | null {
  if (!ctx.request.mustBeHomeByISO) return null;
  const home = ctx.request.homeLocation ?? ctx.request.origin;
  const distance = haversineMeters(from, home);
  return {
    distanceMeters: Math.round(distance),
    durationMin: distance < 40 ? 0 : estimateTravelMinutes(distance, ctx.request.mobility),
  };
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
    usedReasons.push(picked.step.reasonKey ?? picked.step.reason);
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

/** Arten, bei denen ein kürzerer Besuch dasselbe Erlebnis ist. */
const KUERZBAR = new Set<Category>(['cafe', 'food', 'nature', 'culture', 'bar', 'shopping']);

/**
 * Bei knapper Zeit darf ein Besuch kürzer sein als üblich – ein Kaffee in 35
 * statt 50 Minuten ist immer noch ein Kaffee. Ein Kinofilm dagegen nicht.
 * Nie unter 30 Minuten und nie unter zwei Drittel der üblichen Dauer.
 */
function kuerzerWennKnapp(place: Place, freiMin: number): number {
  const ueblich = place.typicalDurationMin;
  if (freiMin >= ueblich || !KUERZBAR.has(place.category)) return ueblich;
  const kuerzer = Math.floor(freiMin / 5) * 5;
  return kuerzer >= Math.max(30, Math.ceil(ueblich * 0.66)) ? kuerzer : ueblich;
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
    // Mit Heimkehrzeit muss nach JEDEM Ort der Weg nach Hause noch passen –
    // jeder kann der letzte sein, wenn danach nichts mehr offen hat.
    const heim = homeLeg(ctx, place.location);
    const durationMin = kuerzerWennKnapp(
      place,
      (ctx.latestEnd.getTime() - startAt.getTime()) / 60_000 - (heim ? heim.durationMin : input.reserveMinutes),
    );
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
      reserveMinutes: heim ? heim.durationMin : input.reserveMinutes,
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
          ...begruendung(ctx, stepReason(place, ctx, weatherAtStart, distanceMeters, input.usedReasons)),
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
  // Maßgeblich ist das Wetter während des Plans, nicht das beim Erstellen.
  const nassZu = (s: PlanStep) => weatherModeOf(weatherAt(ctx.weather, s.startISO)) === 'wet';
  const mode = steps.length
    ? steps.some(nassZu)
      ? 'wet'
      : 'dry'
    : weatherModeOf(ctx.weather.now);

  if (mode === 'wet') {
    const outdoor = steps.filter((s) => s.place.indoorOutdoor === 'outdoor' && nassZu(s)).length;
    notes.push(
      note(
        ctx,
        'weather',
        outdoor === 0
          ? steps.every((s) => s.place.indoorOutdoor !== 'outdoor')
            ? 'weatherAllIndoor'
            : 'weatherIndoorWhenRain'
          : 'weatherPartOutdoor',
      ),
    );
  }

  if (ctx.request.mustBeHomeByISO && steps.length > 0) {
    notes.push(note(ctx, 'time', 'homeIncluded'));
  }

  const cost = aggregateCost(steps.map((s) => s.price));
  if (ctx.budgetCap !== undefined && cost.perPerson && cost.perPerson.max > ctx.budgetCap) {
    notes.push(note(ctx, 'budget', 'overBudget'));
  }

  const unknownHours = steps.filter((s) => !s.openingHoursKnown).length;
  if (unknownHours > 0) {
    notes.push(note(ctx, 'availability', 'unknownHours', { count: unknownHours }));
  }

  if (dropped > 0 && steps.length > 0) {
    notes.push(note(ctx, 'availability', 'droppedSlot'));
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
    plan.notes.unshift(
      note(ctx, 'time', 'lateStart', { time: formatClock(steps[0].startISO, 'de', ctx.tzOffsetMin) }),
    );
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

  // Abfahrt: die gewählte Startzeit. Hat die Engine den Beginn verschoben
  // (früh am Morgen hat nichts offen), ist es der tatsächliche Aufbruch.
  const aufbruch = new Date(startISO).getTime() - steps[0].travelFromPrevious.durationMin * 60_000;
  const departISO = (
    aufbruch - ctx.start.getTime() > 15 * 60_000
      ? new Date(Math.floor(aufbruch / 300_000) * 300_000)
      : ctx.start
  ).toISOString();

  const heim = homeLeg(ctx, steps[steps.length - 1].place.location);
  const returnHome = heim
    ? {
        ...heim,
        estimated: true,
        arriveISO: new Date(new Date(endISO).getTime() + heim.durationMin * 60_000).toISOString(),
      }
    : undefined;
  const fertig = returnHome?.arriveISO ?? endISO;
  const titel = isTour ? tourTitle(ctx) : planTitle(ctx);

  return {
    id: existing?.id ?? shortId(10),
    shareCode: existing?.shareCode ?? shortId(6),
    title: titel.text,
    titleKey: titel.key,
    titleParams: titel.params,
    summary: isTour ? tourSummary(steps, ctx) : planSummary(steps, ctx),
    variant,
    mode: isTour ? 'tour' : 'evening',
    steps,
    startISO,
    endISO,
    departISO,
    returnHome,
    // Von der Abfahrt bis zum Ende – mit Heimkehrzeit bis zur Ankunft zuhause.
    totalDurationMin: Math.round(
      (new Date(fertig).getTime() - new Date(departISO).getTime()) / 60000,
    ),
    cost,
    currency: ctx.request.currency,
    request: ctx.request,
    // Das Wetter zur Startzeit – bei einem Plan für heute Abend zählt nicht
    // der Regen von jetzt.
    weatherAtCreation: weatherAt(ctx.weather, departISO) ?? ctx.weather.now ?? null,
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
  // Mit Heimkehrzeit wird der Rückweg gleich mitgeroutet.
  const mitRueckweg = Boolean(ctx.request.mustBeHomeByISO);
  if (mitRueckweg) {
    queries.push({
      from,
      to: ctx.request.homeLocation ?? ctx.request.origin,
      mode: ctx.request.mobility,
    });
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
  const rueckweg = mitRueckweg ? legs[plan.steps.length] : undefined;
  const reserve = rueckweg ? rueckweg.durationMin : reserveMinutesFor(ctx, true, lastStep.place.location);
  const finish = new Date(new Date(lastStep.endISO).getTime() + reserve * 60_000);

  const zeitplanHaelt =
    finish <= ctx.latestEnd &&
    steps.every(
      (step) =>
        !step.place.openingHours ||
        isOpenDuring(step.place.openingHours, new Date(step.startISO), step.durationMin, ctx.tzOffsetMin),
    );
  if (!zeitplanHaelt) return echteWegeImAltenZeitplan(plan, legs, ctx);

  const refined = assemblePlan(ctx, steps, plan.variant, 0, {
    id: plan.id,
    shareCode: plan.shareCode,
    participants: plan.participants,
    meetingPoint: plan.meetingPoint,
    createdAtISO: plan.createdAtISO,
    siblings: plan.siblings,
  });
  // Hinweise, die nicht aus den Stationen folgen (Verschiebung, Heimkehr),
  // gehen beim Neuaufbau sonst verloren.
  refined.notes = mergeNotes(plan.notes, refined.notes);
  if (rueckweg && refined.returnHome) {
    refined.returnHome = {
      durationMin: rueckweg.durationMin,
      distanceMeters: rueckweg.distanceMeters,
      estimated: rueckweg.estimated,
      geometry: rueckweg.geometry,
      arriveISO: new Date(new Date(lastStep.endISO).getTime() + rueckweg.durationMin * 60_000).toISOString(),
    };
    refined.totalDurationMin = Math.round(
      (new Date(refined.returnHome.arriveISO).getTime() - new Date(refined.departISO ?? refined.startISO).getTime()) / 60000,
    );
  }
  return refined;
}

/**
 * Würde der echte Weg den Zeitplan sprengen, bleiben die Zeiten, wie sie sind.
 * Echte Wege (mit Geometrie für die Karte) werden trotzdem übernommen – aber
 * nur dort, wo sie in die vorhandene Lücke passen. Überall sonst bleibt die
 * Schätzung stehen und ist als solche gekennzeichnet.
 */
function echteWegeImAltenZeitplan(plan: Plan, legs: TravelLeg[], ctx: PlanContext): Plan {
  let vorher = new Date(ctx.start).getTime();
  const steps = plan.steps.map((step, i) => {
    const leg = legs[i];
    const passt =
      leg && !leg.estimated && vorher + leg.durationMin * 60_000 <= new Date(step.startISO).getTime();
    vorher = new Date(step.endISO).getTime();
    return passt ? { ...step, travelFromPrevious: leg } : step;
  });
  return { ...plan, steps };
}

/** Alte Hinweise behalten, die der Neuaufbau nicht selbst erzeugt – ohne Dopplungen. */
function mergeNotes(alt: PlanNote[], neu: PlanNote[]): PlanNote[] {
  const kennung = (n: PlanNote) => n.key ?? n.text;
  const vorhanden = new Set(neu.map(kennung));
  const behalten = alt.filter(
    (n) => (n.kind === 'time' || n.kind === 'info') && !vorhanden.has(kennung(n)),
  );
  return [...behalten, ...neu];
}

/**
 * Passt der gewünschte Umfang nicht bis zur Heimkehrzeit, sagt der Plan das
 * offen: "Dafür passen 3 Stationen – 5 würden zu spät enden." Dafür wird
 * probeweise ohne Heimkehrzeit geplant und verglichen.
 */
export function homeByNote(
  ctx: PlanContext,
  plan: Plan,
  bauen: (c: PlanContext) => Plan | null,
): PlanNote | null {
  const homeBy = ctx.request.mustBeHomeByISO;
  if (!homeBy) return null;
  const byBudget = new Date(ctx.start.getTime() + ctx.request.availableMinutes * 60_000);
  if (new Date(homeBy).getTime() >= byBudget.getTime()) return null;

  const ohne = bauen({
    ...ctx,
    latestEnd: byBudget,
    request: { ...ctx.request, mustBeHomeByISO: undefined },
  });
  if (!ohne) return null;

  const zaehlen = (p: Plan) =>
    p.mode === 'tour' ? p.steps.filter((s) => s.place.themes?.length).length : p.steps.length;
  const passen = zaehlen(plan);
  const gewuenscht = zaehlen(ohne);
  if (gewuenscht <= passen) return null;

  return note(ctx, 'time', 'homeByFit', {
    time: formatClock(homeBy, 'de', ctx.tzOffsetMin),
    fit: passen,
    wanted: gewuenscht,
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
    usedReasons: before.map((s) => s.reasonKey ?? s.reason),
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
