import { estimateTravelMinutes, haversineMeters } from '@/lib/geo';
import { shortId } from '@/lib/id';
import { formatClock, isOpenDuring, localDayDiff, localHour } from '@/lib/time';
import type { Coordinates, Place, Plan, PlanStep, SightTheme } from '@/types/domain';
import { assemblePlan, homeLeg, roundToFive, weatherAt } from './planBuilder';
import { begruendung, note, type ReasonKey } from './texts';
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

  for (const sight of ctx.sights ?? []) {
    if (sight.source !== 'mock') byId.set(sight.id, sight);
  }

  for (const place of ctx.pool) {
    if (place.source === 'mock') continue;
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

  // Wahrzeichen: die bekanntesten Orte zuerst. Ein Kiezpark mit
  // Wikipedia-Artikel ist noch kein Wahrzeichen.
  const bekanntheit = place.prominence ?? 0;
  if (wantsClassic) {
    score += bekanntheit * 1.8;
    if (NEBENZIELE.has(place.kind) && bekanntheit < 0.4) score -= 0.7;
  }

  if (settings.surprise) score += place.scores.novelty * 0.5 + bekanntheit * 0.6;

  return score;
}

/** Schön, aber selten der Grund für eine Stadttour. */
const NEBENZIELE = new Set(['Park', 'Garten', 'Brücke', 'Brunnen', 'Kunstwerk']);

/** Zehnmal dieselbe Art hintereinander ist keine Tour, sondern eine Liste. */
function wiederholung(place: Place, kinds: Map<string, number>): number {
  const schon = kinds.get(place.kind) ?? 0;
  return schon * (place.kind === 'Museum' || place.kind === 'Galerie' ? 0.15 : 0.45);
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
  /** Wie oft jede Art schon vorkommt – für Abwechslung. */
  kinds?: Map<string, number>;
  /** Beim Ersetzen: Die nächste Station soll gut erreichbar bleiben. */
  towards?: Coordinates;
  /** Bereits vergebene Begründungen – derselbe Satz nicht zweimal. */
  usedReasons?: Set<string>;
  /** Schon eingeplante Orte – derselbe Ort zählt nicht zweimal. */
  besucht?: Place[];
};

/** Wörter, die allein nichts über die Identität eines Ortes sagen. */
const ALLGEMEIN = new Set([
  'der', 'die', 'das', 'the', 'st.', 'sankt', 'neue', 'neues', 'neuer', 'alte', 'altes', 'alter',
  'große', 'großer', 'großes', 'kleine', 'kleiner', 'denkmal', 'museum', 'kirche', 'park', 'garten',
  'brücke', 'haus', 'platz', 'statue', 'monument', 'gedenkstätte', 'gedenkort', 'berliner',
]);

/**
 * Zwei OSM-Einträge für denselben Ort – etwa „Reichstagsgebäude" und
 * „Reichstagskuppel". In OSM sind das getrennte Objekte, für eine Tour ist es
 * ein Halt.
 */
function gleicherOrt(a: Place, b: Place): boolean {
  const d = haversineMeters(a.location, b.location);
  if (d < 20) return true;
  if (d > 150) return false;
  const wa = a.name.toLowerCase().split(/\s+/)[0] ?? '';
  const wb = b.name.toLowerCase().split(/\s+/)[0] ?? '';
  if (ALLGEMEIN.has(wa) || ALLGEMEIN.has(wb)) return false;
  let gemeinsam = 0;
  while (gemeinsam < wa.length && wa[gemeinsam] === wb[gemeinsam]) gemeinsam += 1;
  return gemeinsam >= 6;
}

/** Sonnenuntergang am Tag des Zeitpunkts – ein Plan für morgen braucht den von morgen. */
function sunsetOn(ctx: PlanContext, date: Date): Date | null {
  const passend = (ctx.weather.sunsetsISO ?? []).find(
    (iso) => localDayDiff(new Date(iso), date, ctx.tzOffsetMin) === 0,
  );
  const iso = passend ?? ctx.weather.sunsetISO;
  return iso ? new Date(iso) : null;
}

/**
 * Kann dieser Ort zu dieser Zeit Teil der Tour sein? Eine Stelle für alle
 * Regeln – beim Planen, beim Ersetzen und beim Verschieben auf eine andere
 * Startzeit gilt dasselbe:
 *  - Sehenswürdigkeit: bekannte Öffnungszeiten hart, sonst nur tagsüber;
 *    draußen nur bei Tageslicht und ohne Unwetter,
 *  - Pause (Café, Essen): nur mit bekannten Öffnungszeiten und zur Tageszeit,
 *  - mit Heimkehrzeit: danach muss der Weg nach Hause noch passen.
 */
export function tourStopFits(
  ctx: PlanContext,
  place: Place,
  arrive: Date,
  dwell: number,
  tourEnd: Date = ctx.latestEnd,
): boolean {
  const leave = new Date(arrive.getTime() + dwell * 60_000);
  if (leave > tourEnd) return false;

  const heim = homeLeg(ctx, place.location);
  if (heim && ctx.request.mustBeHomeByISO) {
    const zuhause = leave.getTime() + heim.durationMin * 60_000;
    if (zuhause > new Date(ctx.request.mustBeHomeByISO).getTime()) return false;
  }

  if (!place.themes?.length) {
    if (!fitsTimeOfDay(place, arrive, ctx.tzOffsetMin)) return false;
    return Boolean(place.openingHours) && isOpenDuring(place.openingHours!, arrive, dwell, ctx.tzOffsetMin);
  }

  if (place.openingHours) {
    if (!isOpenDuring(place.openingHours, arrive, dwell, ctx.tzOffsetMin)) return false;
  } else if (place.category === 'nature') {
    // Öffentlich zugänglich – nur Tageslicht und Tageszeit zählen.
    if (!fitsTimeOfDay(place, arrive, ctx.tzOffsetMin)) return false;
  } else if (localHour(arrive, ctx.tzOffsetMin) < 9 || localHour(leave, ctx.tzOffsetMin) >= 20) {
    return false;
  }

  if (isWeatherBlocked(place, weatherAt(ctx.weather, arrive.toISOString()))) return false;

  // Draußen braucht es Tageslicht, um etwas zu sehen.
  const sunset = sunsetOn(ctx, arrive);
  if (place.indoorOutdoor === 'outdoor' && sunset && leave > sunset) return false;

  return true;
}

/** Wählt die nächste Station: viel Wert, wenig Umweg, zur Zeit offen. */
function pickNextSight(options: PickOptions): Pick | null {
  const { ctx, settings, candidates, used, cursor, from, tourEnd } = options;
  let best: Pick | null = null;

  for (const place of candidates) {
    if (used.has(place.id)) continue;
    if (options.onlyIndoor && place.indoorOutdoor === 'outdoor') continue;
    if (options.besucht?.some((b) => gleicherOrt(b, place))) continue;

    const base = interestScore(place, settings);
    if (!Number.isFinite(base)) continue;

    const distanceMeters = haversineMeters(from, place.location);
    const travelMin =
      distanceMeters < 40 ? 0 : estimateTravelMinutes(distanceMeters, ctx.request.mobility);
    const arrive = roundToFive(new Date(cursor.getTime() + travelMin * 60_000));
    const dwell = Math.max(10, Math.round(place.typicalDurationMin * settings.dwellFactor));
    const leave = new Date(arrive.getTime() + dwell * 60_000);
    if (!tourStopFits(ctx, place, arrive, dwell, tourEnd)) continue;
    const weather = weatherAt(ctx.weather, arrive.toISOString());

    const weiterweg = options.towards
      ? estimateTravelMinutes(haversineMeters(place.location, options.towards), ctx.request.mobility)
      : 0;
    const umweg = ((travelMin + weiterweg) / 10) * 0.5 * settings.distanceWeight;
    const unbekannt = place.openingHours || place.category === 'nature' ? 0 : 0.4;
    const score =
      base +
      weatherFit(place, weather) * 0.6 +
      wetterAusgleich(place, weather) -
      umweg -
      unbekannt -
      wiederholung(place, options.kinds ?? new Map()) +
      (options.jitter.get(place.id) ?? 0);

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
          reason: '',
        },
      };
    }
  }

  if (best) {
    Object.assign(
      best.step,
      begruendung(
        ctx,
        tourReason(
          best.step.place,
          weatherAt(ctx.weather, best.step.startISO),
          best.step.travelFromPrevious.durationMin,
          options.usedReasons ?? new Set(),
        ),
      ),
    );
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
    // Auch eine Kaffeepause kommt nie aus den Demo-Daten.
    if (place.source === 'mock') continue;
    if (!wanted.includes(place.category)) continue;

    const distanceMeters = haversineMeters(from, place.location);
    if (distanceMeters > 700) continue;

    const travelMin =
      distanceMeters < 40 ? 0 : estimateTravelMinutes(distanceMeters, ctx.request.mobility);
    const arrive = roundToFive(new Date(cursor.getTime() + travelMin * 60_000));
    const dwell = place.category === 'food' ? 60 : 40;
    const leave = new Date(arrive.getTime() + dwell * 60_000);
    // Pausen nur dort, wo sicher offen ist.
    if (!tourStopFits(ctx, place, arrive, dwell, tourEnd)) continue;

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
          ...begruendung(ctx, mittag ? 'lunch' : 'break'),
        },
      };
    }
  }
  return best;
}

/**
 * Bei Regen keine Tour aus lauter Denkmälern unter freiem Himmel, wenn es
 * Museen und Kirchen in der Nähe gibt – bei Sonne umgekehrt. Stark genug,
 * um die Reihenfolge zu drehen, aber kein Verbot: Gibt es nichts Überdachtes,
 * bleibt der Ort im Rennen.
 */
function wetterAusgleich(place: Place, weather: ReturnType<typeof weatherAt>): number {
  const mode = weatherModeOf(weather);
  const draussen = place.indoorOutdoor === 'outdoor';
  const drinnen = place.indoorOutdoor === 'indoor';
  if (mode === 'wet') return draussen ? -1.1 : drinnen ? 0.5 : 0;
  if (mode === 'cold') return draussen ? -0.4 : 0.2;
  if (mode === 'pleasant') return draussen ? 0.45 : 0;
  return 0;
}

/**
 * Ein Satz, warum die Station dabei ist. Der erste passende, der in dieser
 * Tour noch nicht vorkam – achtmal „Ein Klassiker der Stadt." sagt nichts.
 */
function tourReason(
  place: Place,
  weather: ReturnType<typeof weatherAt>,
  travelMin: number,
  usedReasons: Set<string>,
): ReasonKey {
  const themes = place.themes ?? [];
  const mode = weatherModeOf(weather);
  const bekanntheit = place.prominence ?? 0;
  const kandidaten: Array<ReasonKey | false | undefined> = [
    mode === 'wet' && place.indoorOutdoor === 'indoor' && 'wetIndoor',
    bekanntheit >= 0.6 && 'famous',
    place.notable && bekanntheit >= 0.25 && 'classic',
    themes.includes('hidden') && 'hidden',
    place.kind === 'Gedenkort' && 'memorial',
    (place.kind === 'Museum' || place.kind === 'Galerie') && 'museum',
    themes.includes('photo') && mode === 'pleasant' && 'photo',
    themes.includes('park') && 'park',
    travelMin <= 5 && 'fewSteps',
    place.notable && 'known',
  ];
  for (const key of kandidaten) {
    if (key && !usedReasons.has(key)) {
      usedReasons.add(key);
      return key;
    }
  }
  return 'onTheWay';
}

/**
 * Baut eine Tour. `null`, wenn es nicht für mindestens zwei Stationen reicht –
 * dann ist es keine Tour, und die App sagt das ehrlich.
 */
export function buildTour(ctx: PlanContext): Plan | null {
  const settings = settingsFor(ctx);
  let result = routeTour(ctx, settings);
  let erweitert = false;

  // Früh am Morgen hat fast nichts offen. Statt einer leeren Tour beginnt
  // sie später – stundenweise, solange das Zeitbudget es hergibt.
  let tourCtx = ctx;
  let verschobenUm = 0;
  while (sightCount(result) < 2 && verschobenUm < 4) {
    verschobenUm += 1;
    const start = new Date(ctx.start.getTime() + verschobenUm * 60 * 60_000);
    if (start >= ctx.latestEnd) break;
    tourCtx = { ...ctx, start };
    result = routeTour(tourCtx, settings);
  }

  // Regen am Anfang und fast alles draußen? Wenn später Museen, Kirchen und
  // Ähnliches offen haben, beginnt die Tour lieber dann – in voller Länge.
  let wegenRegen = false;
  if (nassDraussen(tourCtx, result)) {
    for (let stunden = 1; stunden <= 3; stunden += 1) {
      const versatz = stunden * 60 * 60_000;
      const start = new Date(tourCtx.start.getTime() + versatz);
      const latestEnd = ctx.request.mustBeHomeByISO
        ? ctx.latestEnd
        : new Date(tourCtx.latestEnd.getTime() + versatz);
      if (latestEnd.getTime() - start.getTime() < 90 * 60_000) break;
      const spaeterCtx = { ...ctx, start, latestEnd };
      const spaeter = routeTour(spaeterCtx, settings);
      if (sightCount(spaeter) >= 3 && !nassDraussen(spaeterCtx, spaeter)) {
        result = spaeter;
        tourCtx = spaeterCtx;
        wegenRegen = true;
        break;
      }
    }
  }

  // Zur Auswahl gab es zu wenig? Dann um weitere Sehenswürdigkeiten ergänzen,
  // statt eine Zwei-Stationen-Tour auszugeben – und das offen sagen.
  if (sightCount(result) < 3 && settings.interests.size > 0) {
    const weiter = routeTour(tourCtx, { ...settings, interests: new Set(), surprise: false });
    if (sightCount(weiter) > sightCount(result)) {
      result = weiter;
      erweitert = true;
    }
  }

  if (sightCount(result) < 2) return null;

  const plan = assemblePlan(ctx, result, 'balanced', 0);
  if (wegenRegen) {
    plan.notes.unshift(
      note(ctx, 'weather', 'tourRainStart', {
        time: formatClock(tourCtx.start.toISOString(), 'de', ctx.tzOffsetMin),
      }),
    );
  } else if (verschobenUm > 0) {
    plan.notes.unshift(note(ctx, 'time', 'tourLateStart'));
  }
  if (erweitert) {
    plan.notes.unshift(note(ctx, 'info', 'tourExtended'));
  }
  return plan;
}

function sightCount(steps: PlanStep[]): number {
  return steps.filter((s) => s.place.themes?.length).length;
}

/** Findet die Tour überwiegend draußen im Regen statt? */
function nassDraussen(ctx: PlanContext, steps: PlanStep[]): boolean {
  const stationen = steps.filter((s) => s.place.themes?.length);
  if (stationen.length === 0) return false;
  const nass = stationen.filter(
    (s) =>
      s.place.indoorOutdoor === 'outdoor' &&
      weatherModeOf(weatherAt(ctx.weather, s.startISO)) === 'wet',
  ).length;
  return nass / stationen.length >= 0.5;
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
  const kinds = new Map<string, number>();
  const usedReasons = new Set<string>();
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

    const next = pickNextSight({
      ctx,
      settings,
      candidates,
      used,
      cursor,
      from,
      tourEnd,
      jitter,
      kinds,
      usedReasons,
      besucht: steps.map((s) => s.place),
    });
    if (!next) break;

    steps.push(next.step);
    used.add(next.step.place.id);
    kinds.set(next.step.place.kind, (kinds.get(next.step.place.kind) ?? 0) + 1);
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
  const danach = plan.steps[index + 1]?.place.location;
  const kinds = new Map<string, number>();
  for (const s of plan.steps) {
    if (s.id !== stepId) kinds.set(s.place.kind, (kinds.get(s.place.kind) ?? 0) + 1);
  }
  const usedReasons = new Set(
    plan.steps.filter((s) => s.id !== stepId).map((s) => s.reasonKey ?? s.reason),
  );

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
        kinds,
        towards: danach,
        usedReasons,
        besucht: plan.steps.filter((s) => s.id !== stepId).map((s) => s.place),
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
