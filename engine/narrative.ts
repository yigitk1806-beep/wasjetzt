import { formatDuration } from '@/lib/time';
import type { Place, PlanStep, WeatherSlice } from '@/types/domain';
import { dict, type ReasonKey } from './texts';
import type { PlanContext } from './types';
import { weatherModeOf } from './weatherRules';

/**
 * Titel als Schlüssel plus Text in der Sprache der Anfrage. Die Oberfläche
 * baut den Titel aus dem Schlüssel neu – in der Sprache des Betrachters.
 */
export function planTitle(ctx: PlanContext): {
  text: string;
  key: 'plan';
  params: { party: string; dayPart: string };
} {
  const params = { party: ctx.request.party, dayPart: ctx.dayPart };
  return { key: 'plan', params, text: dict(ctx).titles.plan(ctx.request.party, ctx.dayPart) };
}

/**
 * Tourtitel aus dem Ort, den der Nutzer gewählt hat – ohne ausgedachten
 * Stadtnamen, wenn nur ein GPS-Standort vorliegt.
 */
export function tourTitle(ctx: PlanContext): {
  text: string;
  key: 'tour';
  params: { place: string };
} {
  const label = ctx.request.originLabel?.trim();
  const ort = !label || label === 'Dein Standort' ? '' : label;
  return { key: 'tour', params: { place: ort }, text: dict(ctx).titles.tour(ort || null) };
}

/** "3 Stationen · 3 Std. 10 Min." – in der Sprache der Anfrage. */
export function planSummary(steps: PlanStep[], ctx: PlanContext): string {
  const t = dict(ctx);
  if (steps.length === 0) return t.errors['no-plan'];
  const minutes =
    (new Date(steps[steps.length - 1].endISO).getTime() - new Date(steps[0].startISO).getTime()) /
    60000;
  return `${t.plan.stops(steps.length)} · ${formatDuration(Math.round(minutes), ctx.request.language)}`;
}

/** Wie `planSummary`, nur zählen Pausen bei Touren nicht als Station. */
export function tourSummary(steps: PlanStep[], ctx: PlanContext): string {
  const t = dict(ctx);
  const stationen = steps.filter((s) => s.place.themes?.length).length;
  const minutes =
    steps.length === 0
      ? 0
      : (new Date(steps[steps.length - 1].endISO).getTime() - new Date(steps[0].startISO).getTime()) /
        60000;
  return `${t.plan.stops(stationen)} · ${formatDuration(Math.round(minutes), ctx.request.language)}`;
}

/**
 * Ein kurzer, ehrlicher Grund, warum dieser Ort gewählt wurde – als Schlüssel.
 * `avoid` verhindert, dass in einem Plan dreimal derselbe Satz steht.
 * Angebote stehen bewusst nicht hier – die zeigt die UI als eigenes Label.
 */
export function stepReason(
  place: Place,
  ctx: PlanContext,
  weatherAtStart: WeatherSlice | null,
  distanceMeters: number,
  avoid: string[] = [],
): ReasonKey {
  const mode = weatherModeOf(weatherAtStart);
  const candidates: ReasonKey[] = [];

  if (mode === 'wet' && place.indoorOutdoor === 'indoor') candidates.push('wetIndoor');
  if (mode === 'pleasant' && place.indoorOutdoor === 'outdoor') candidates.push('niceOutdoor');
  if (mode === 'hot' && place.heatSuitability >= 0.95) candidates.push('hot');
  if (mode === 'cold' && place.coldSuitability >= 0.9) candidates.push('cold');
  if (ctx.request.moods.includes('date') && place.scores.romantic >= 0.8) candidates.push('date');
  if (ctx.request.moods.includes('action') && place.scores.action >= 0.75) candidates.push('action');
  if (ctx.request.party === 'family' && place.scores.family >= 0.85) candidates.push('family');
  if ((ctx.request.budget === 'free' || ctx.request.budget === 'low') && place.price.level <= 1) {
    candidates.push(place.price.level === 0 ? 'free' : 'cheap');
  }
  if (ctx.request.preferNovelty && place.scores.novelty >= 0.7) candidates.push('novelty');
  if (distanceMeters < 900) candidates.push('near');
  candidates.push(CATEGORY_REASON[place.category]);
  candidates.push('fits');

  return candidates.find((key) => !avoid.includes(key)) ?? candidates[0];
}

/** Letzter Rückfall: ein Satz, der zur Art des Ortes passt. */
const CATEGORY_REASON: Record<Place['category'], ReasonKey> = {
  food: 'catFood',
  cafe: 'catCafe',
  bar: 'catBar',
  activity: 'catActivity',
  cinema: 'catCinema',
  culture: 'catCulture',
  nature: 'catNature',
  sport: 'catSport',
  gaming: 'catActivity',
  wellness: 'catWellness',
  shopping: 'catShopping',
  event: 'catEvent',
};
