import { estimateTravelMinutes, haversineMeters } from '@/lib/geo';
import { shortId } from '@/lib/id';
import { isOpenDuring, localHour } from '@/lib/time';
import type { Coordinates, Place, Plan, PlanStep, SightTheme } from '@/types/domain';
import { assemblePlan, roundToFive, weatherAt } from './planBuilder';
import type { PlanContext } from './types';
import { fitsTimeOfDay } from './timeOfDay';
import { isWeatherBlocked, weatherFit, weatherModeOf } from './weatherRules';

/**
 * Besichtigungstouren.
 *
 * Anders als beim Abendprogramm (wenige Stationen, bewusst verschieden) geht
 * es hier um viele Stationen ähnlicher Art in sinnvoller Reihenfolge. Die
 * Route entsteht Schritt für Schritt: Von der aktuellen Position aus wird die
 * Station gewählt, die am meisten bringt und am wenigsten Umweg kostet – und
 * die zum geplanten Zeitpunkt tatsächlich offen ist.
 *
 * Nichts hier kennt eine bestimmte Stadt. Welche Orte Klassiker sind, sagt
 * OpenStreetMap über verknüpfte Wikipedia-Artikel.
 */

/** Arten aus der normalen Ortsabfrage, die als Geheimtipp taugen. */
const GEHEIMTIPP_ARTEN: Record<string, SightTheme[]> = {
  Museum: ['museum', 'history'],
  Galerie: ['museum'],
  Aussichtspunkt: ['photo', 'park'],
  Sehenswürdigkeit: ['photo'],
  Park: ['park'],
  Garten: ['park', 'photo'],
};

type TourSettings = {
  interests: Set<SightTheme>;
  dwellFactor: number;
  distanceWeight: number;
  freeOnly: boolean;
  budgetFactor: number;
  boost: Partial<Record<SightTheme, number>>;
  surprise: boolean;
  maxStops: number;
};

function settingsFor(ctx: PlanContext): TourSettings {
  const interests = new Set<SightTheme>(ctx.request.interests ?? []);
  const settings: TourSettings = {
    interests,
    dwellFactor: 1,
    distanceWeight: 1,
    freeOnly: ctx.request.budget === 'free',
    budgetFactor: 1,
    boost: {},
    surprise: interests.size === 0,
    maxStops: 8,
  };

  switch (ctx.request.tourTweak) {
    case 'more':
      settings.dwellFactor = 0.7;
      settings.maxStops = 11;
      break;
    case 'less-walk':
      settings.distanceWeight = 2.6;
      break;
    case 'museum':
      interests.add('museum');
      settings.boost.museum = 1.3;
      settings.surprise = false;
      break;
    case 'photo':
      interests.add('photo');
      settings.boost.photo = 1.3;
      settings.surprise = false;
      break;
    case 'free':
      settings.freeOnly = true;
      break;
    case 'faster':
      settings.budgetFactor = 0.65;
      break;
    case 'calm':
      settings.boost.park = 1.1;
      settings.dwellFactor = 1.25;
      settings.maxStops = 5;
      break;
    case 'surprise':
      settings.surprise = true;
      break;
    default:
      break;
  }
  return settings;
}

/**
 * Alle möglichen Stationen: bekannte Orte aus der Sehenswürdigkeiten-Abfrage
 * plus Geheimtipps aus der normalen Ortsabfrage (ohne Wikipedia-Artikel).
 */
function candidatePool(ctx: PlanContext, settings: TourSettings): Place[] {
  const ausgeschlossen = new Set(ctx.request.excludePlaceIds ?? []);
  const byId = new Map<string, Place>();

  for (const sight of ctx.sights ?? []) byId.set(sight.id, sight);

  for (const place of ctx.pool) {
    if (place.notable !== false) continue;
    const themes = GEHEIMTIPP_ARTEN[place.kind];
    if (!themes || byId.has(place.id)) continue;
    byId.set(place.id, { ...place, themes: [...themes, 'hidden'] });
  }

  return [...byId.values()].filter((place) => {
    if (ausgeschlossen.has(place.id)) return false;
    if (settings.freeOnly && place.price.level > 0) return false;
    return true;
  });
}

/** Wie gut passt ein Ort zu den Wünschen – unabhängig von Zeit und Weg. */
function interestScore(place: Place, settings: TourSettings): number {
  const themes = place.themes ?? [];
  const wantsHidden = settings.interests.has('hidden');
  const wantsClassic = settings.interests.has('classic');

  let score = 0;

  if (settings.interests.size > 0) {
    const treffer = themes.filter((t) => settings.interests.has(t)).length;
    if (treffer === 0) return Number.NEGATIVE_INFINITY;
    score += Math.min(2, treffer) * 0.9;
  }

  // Bekanntheit zählt – außer wer ausdrücklich Geheimtipps will.
  if (place.notable) {
    score += wantsHidden && !wantsClassic ? -0.6 : 0.9;
  } else if (wantsHidden) {
    score += 0.9;
  }

  for (const theme of themes) score += settings.boost[theme] ?? 0;

  if (settings.surprise) score += place.scores.novelty * 0.7;

  return score;
}

type Pick = { step: PlanStep; score: number; location: Coordinates };

type PickOptions = {
  ctx: PlanContext;
  settings: TourSettings;
  candidates: Place[];
  used: Set<string>;
  cursor: Date;
  from: Coordinates;
  tourEnd: Date;
  /** Nur für "Überrasch mich": leichtes Zufallsrauschen pro Tour. */
  jitter: Map<string, number>;
  onlyIndoor?: boolean;
};

/** Wählt die nächste Station: viel Wert, wenig Umweg, zur Zeit offen. */
function pickNextSight(options: PickOptions): Pick | null {
  const { ctx, settings, candidates, used, cursor, from, tourEnd } = options;
  const sunset = ctx.weather.sunsetISO ? new Date(ctx.weather.sunsetISO) : null;
  let best: Pick | null = null;

  for (const place of candidates) {
    if (used.has(place.id)) continue;
    if (options.onlyIndoor && place.indoorOutdoor === 'outdoor') continue;

    const base = interestScore(place, settings);
    if (!Number.isFinite(base)) continue;

    const distanceMeters = haversineMeters(from, place.location);
    const travelMin =
      distanceMeters < 40 ? 0 : estimateTravelMinutes(distanceMeters, ctx.request.mobility);
    const arrive = roundToFive(new Date(cursor.getTime() + travelMin * 60_000));
    const dwell = Math.max(10, Math.round(place.typicalDurationMin * settings.dwellFactor));
    const leave = new Date(arrive.getTime() + dwell * 60_000);

    if (leave > tourEnd) continue;

    // Öffnungszeiten: bekannt → hart prüfen; unbekannt → nur tagsüber.
    if (place.openingHours) {
      if (!isOpenDuring(place.openingHours, arrive, dwell, ctx.tzOffsetMin)) continue;
    } else if (place.category === 'nature') {
      // Öffentlich zugänglich – nur Tageslicht und Tageszeit zählen.
      if (!fitsTimeOfDay(place, arrive, ctx.tzOffsetMin)) continue;
    } else if (localHour(arrive, ctx.tzOffsetMin) < 9 || localHour(leave, ctx.tzOffsetMin) >= 20) {
      continue;
    }

    const weather = weatherAt(ctx.weather, arrive.toISOString());
    if (isWeatherBlocked(place, weather)) continue;

    // Draußen braucht es Tageslicht, um etwas zu sehen.
    if (place.indoorOutdoor === 'outdoor' && sunset && leave > sunset) continue;

    const umweg = (travelMin / 10) * 0.5 * settings.distanceWeight;
    const unbekannt = place.openingHours ? 0 : 0.4;
    const score =
      base + weatherFit(place, weather) * 0.6 - umweg - unbekannt + (options.jitter.get(place.id) ?? 0);

    if (!best || score > best.score) {
      best = {
        score,
        location: place.location,
        step: {
          id: shortId(6),
          place,
          startISO: arrive.toISOString(),
          endISO: leave.toISOString(),
          durationMin: dwell,
          travelFromPrevious: {
            mode: ctx.request.mobility,
            distanceMeters: Math.round(distanceMeters),
            durationMin: travelMin,
            estimated: true,
          },
          price: { ...place.price },
          openingHoursKnown: place.openingHours !== null,
          reason: tourReason(place, weather),
        },
      };
    }
  }

  return best;
}

/** Eine kurze Pause in der Nähe – Café oder, um die Mittagszeit, etwas zu essen. */
function pickBreak(
  ctx: PlanContext,
  from: Coordinates,
  cursor: Date,
  used: Set<string>,
  tourEnd: Date,
): Pick | null {
  const hour = Math.floor(localHour(cursor, ctx.tzOffsetMin));
  const mittag = hour >= 11 && hour < 14;
  const wanted = mittag ? ['food', 'cafe'] : ['cafe', 'food'];
  let best: Pick | null = null;

  for (const place of ctx.pool) {
    if (used.has(place.id)) continue;
    if (!wanted.includes(place.category)) continue;

    const distanceMeters = haversineMeters(from, place.location);
    if (distanceMeters > 700) continue;

    const travelMin =
      distanceMeters < 40 ? 0 : estimateTravelMinutes(distanceMeters, ctx.request.mobility);
    const arrive = roundToFive(new Date(cursor.getTime() + travelMin * 60_000));
    const dwell = place.category === 'food' ? 60 : 40;
    const leave = new Date(arrive.getTime() + dwell * 60_000);
    if (leave > tourEnd) continue;
    if (!fitsTimeOfDay(place, arrive, ctx.tzOffsetMin)) continue;
    // Pausen nur dort, wo sicher offen ist.
    if (!place.openingHours || !isOpenDuring(place.openingHours, arrive, dwell, ctx.tzOffsetMin)) {
      continue;
    }

    const bevorzugt = place.category === wanted[0] ? 0.6 : 0;
    const score = bevorzugt - distanceMeters / 700;

    if (!best || score > best.score) {
      best = {
        score,
        location: place.location,
        step: {
          id: shortId(6),
          place,
          startISO: arrive.toISOString(),
          endISO: leave.toISOString(),
          durationMin: dwell,
          travelFromPrevious: {
            mode: ctx.request.mobility,
            distanceMeters: Math.round(distanceMeters),
            durationMin: travelMin,
            estimated: true,
          },
          price: { ...place.price },
          openingHoursKnown: true,
          reason: mittag ? 'Mittagspause in der Nähe.' : 'Kurze Pause zum Auftanken.',
        },
      };
    }
  }
  return best;
}

function tourReason(place: Place, weather: ReturnType<typeof weatherAt>): string {
  const themes = place.themes ?? [];
  const mode = weatherModeOf(weather);
  if (mode === 'wet' && place.indoorOutdoor === 'indoor') return 'Drinnen – passt zum Regen.';
  if (place.notable) return 'Ein Klassiker der Stadt.';
  if (themes.includes('hidden')) return 'Ein Geheimtipp abseits der großen Ziele.';
  if (themes.includes('photo') && mode === 'pleasant') return 'Gutes Licht für Fotos.';
  if (themes.includes('park')) return 'Zum Durchatmen zwischendurch.';
  return 'Liegt gut auf dem Weg.';
}

/**
 * Baut eine Tour. `null`, wenn es nicht für mindestens zwei Stationen reicht –
 * dann ist es keine Tour, und die App sagt das ehrlich.
 */
export function buildTour(ctx: PlanContext): Plan | null {
  const settings = settingsFor(ctx);
  let result = routeTour(ctx, settings);
  let erweitert = false;

  // Zur Auswahl gab es zu wenig? Dann um weitere Sehenswürdigkeiten ergänzen,
  // statt eine Zwei-Stationen-Tour auszugeben – und das offen sagen.
  if (sightCount(result) < 3 && settings.interests.size > 0) {
    const weiter = routeTour(ctx, { ...settings, interests: new Set(), surprise: false });
    if (sightCount(weiter) > sightCount(result)) {
      result = weiter;
      erweitert = true;
    }
  }

  if (sightCount(result) < 2) return null;

  const plan = assemblePlan(ctx, result, 'balanced', 0);
  if (erweitert) {
    plan.notes.unshift({
      kind: 'info',
      text: 'Zu deiner Auswahl gab es hier wenig – ergänzt um weitere Sehenswürdigkeiten.',
    });
  }
  return plan;
}

function sightCount(steps: PlanStep[]): number {
  return steps.filter((s) => s.place.themes?.length).length;
}

function routeTour(ctx: PlanContext, settings: TourSettings): PlanStep[] {
  const candidates = candidatePool(ctx, settings);
  const budgetMin = ctx.request.availableMinutes * settings.budgetFactor;
  const byBudget = new Date(ctx.start.getTime() + budgetMin * 60_000);
  const tourEnd = byBudget < ctx.latestEnd ? byBudget : ctx.latestEnd;

  const jitter = new Map<string, number>();
  if (settings.surprise) {
    for (const place of candidates) jitter.set(place.id, Math.random() * 0.8);
  }

  const steps: PlanStep[] = [];
  const used = new Set<string>();
  let cursor = new Date(ctx.start);
  let from: Coordinates = ctx.request.origin;
  let lastBreak = new Date(ctx.start);
  let pausen = 0;
  const maxPausen = budgetMin >= 360 ? 2 : budgetMin >= 180 ? 1 : 0;

  while (sightCount(steps) < settings.maxStops) {
    const seitPause = (cursor.getTime() - lastBreak.getTime()) / 60_000;
    if (pausen < maxPausen && seitPause >= 150 && sightCount(steps) >= 2) {
      const pause = pickBreak(ctx, from, cursor, used, tourEnd);
      if (pause) {
        steps.push(pause.step);
        used.add(pause.step.place.id);
        cursor = new Date(pause.step.endISO);
        from = pause.location;
        lastBreak = cursor;
        pausen += 1;
        continue;
      }
    }

    const next = pickNextSight({ ctx, settings, candidates, used, cursor, from, tourEnd, jitter });
    if (!next) break;

    steps.push(next.step);
    used.add(next.step.place.id);
    cursor = new Date(next.step.endISO);
    from = next.location;
  }

  return steps;
}

/**
 * Tauscht eine einzelne Station aus. Der Rest der Tour bleibt; die Zeiten
 * danach werden neu gerechnet.
 */
export function replaceTourStop(
  ctx: PlanContext,
  plan: Plan,
  stepId: string,
  hint: string,
): Plan | null {
  const index = plan.steps.findIndex((s) => s.id === stepId);
  if (index < 0) return null;

  const settings = settingsFor(ctx);
  if (hint === 'cheaper') settings.freeOnly = true;
  if (hint === 'new') settings.boost.hidden = 1.2;

  const before = plan.steps.slice(0, index);
  const cursor = before.length ? new Date(before[before.length - 1].endISO) : new Date(ctx.start);
  const from = before.length ? before[before.length - 1].place.location : ctx.request.origin;
  const used = new Set(plan.steps.map((s) => s.place.id));
  const tourEnd = new Date(plan.endISO).getTime() > ctx.latestEnd.getTime()
    ? new Date(plan.endISO)
    : ctx.latestEnd;

  const alt = plan.steps[index];
  const istPause = !alt.place.themes?.length;

  const picked = istPause
    ? pickBreak(ctx, from, cursor, used, tourEnd)
    : pickNextSight({
        ctx,
        settings,
        candidates: candidatePool(ctx, settings),
        used,
        cursor,
        from,
        tourEnd,
        jitter: new Map(),
        onlyIndoor: hint === 'indoor',
      });
  if (!picked) return null;

  const steps: PlanStep[] = [...before, picked.step];
  let running = new Date(picked.step.endISO);
  let location = picked.location;

  for (const old of plan.steps.slice(index + 1)) {
    const distanceMeters = haversineMeters(location, old.place.location);
    const travelMin =
      distanceMeters < 40 ? 0 : estimateTravelMinutes(distanceMeters, ctx.request.mobility);
    const startAt = roundToFive(new Date(running.getTime() + travelMin * 60_000));
    const endAt = new Date(startAt.getTime() + old.durationMin * 60_000);
    steps.push({
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
    running = endAt;
    location = old.place.location;
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
