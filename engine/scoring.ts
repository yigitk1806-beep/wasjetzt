import type { Category, Mood, Place, WeatherSlice } from '@/types/domain';
import { BUDGET_MAX_LEVEL } from './budget';
import type { PlanContext, ScoringWeights, Slot, VariantProfile } from './types';
import { seasonCategoryBoost, seasonFit, weatherFit, weatherModeOf } from './weatherRules';

export const BASE_WEIGHTS: ScoringWeights = {
  mood: 1.25,
  distance: 0.9,
  price: 0.7,
  weather: 1.1,
  season: 0.45,
  novelty: 0.55,
  preference: 0.9,
  role: 0.8,
  deal: 0.25,
  rating: 0.35,
};

export const VARIANTS: VariantProfile[] = [
  {
    key: 'balanced',
    title: 'Ausgewogen',
    emoji: '✨',
    weights: {},
    bias: {},
  },
  {
    key: 'romantic',
    title: 'Romantisch',
    emoji: '❤️',
    weights: { mood: 1.1, distance: 1.0, price: 0.4 },
    bias: { romantic: 1.3, chill: 0.4, action: -0.4, social: -0.2 },
  },
  {
    key: 'action',
    title: 'Action',
    emoji: '🔥',
    weights: { mood: 1.1, novelty: 0.8 },
    bias: { action: 1.3, social: 0.5, chill: -0.5, romantic: -0.2 },
  },
  {
    key: 'cheap',
    title: 'Günstig',
    emoji: '💸',
    weights: { price: 2.2, distance: 1.2 },
    bias: {},
    maxPriceLevel: 1,
  },
];

export function variantByKey(key: string): VariantProfile {
  return VARIANTS.find((v) => v.key === key) ?? VARIANTS[0];
}

function weightsFor(profile: VariantProfile): ScoringWeights {
  return { ...BASE_WEIGHTS, ...profile.weights };
}

/** 0..1 – wie gut passt der Ort zur gewünschten Stimmung. */
function moodScore(place: Place, moods: Mood[]): number {
  if (moods.length === 0) return 0.6;
  const s = place.scores;
  const parts = moods.map((mood) => {
    switch (mood) {
      case 'date':
        return s.romantic;
      case 'action':
        return s.action;
      case 'chill':
        return s.chill;
      case 'party':
        return Math.max(s.social, place.category === 'bar' ? 0.9 : 0);
      case 'food':
        return place.category === 'food' ? 1 : place.category === 'cafe' ? 0.6 : 0.25;
      case 'nature':
        return place.category === 'nature' ? 1 : place.indoorOutdoor === 'outdoor' ? 0.7 : 0.2;
      case 'gaming':
        return place.category === 'gaming' ? 1 : s.action * 0.6;
      case 'new':
        return s.novelty;
      default:
        return 0.5;
    }
  });
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

/** 0..1 – nah ist besser, aber nicht linear: die ersten Meter tun nicht weh. */
function distanceScore(distanceMeters: number, radiusMeters: number, sensitivity: number): number {
  const ratio = Math.min(1, distanceMeters / Math.max(300, radiusMeters));
  const curved = 1 - ratio ** 1.6;
  return curved * (0.55 + sensitivity * 0.45) + (1 - sensitivity) * 0.25 * (1 - ratio);
}

/** 0..1 – passt der Preis zum Budget. */
function priceScore(place: Place, ctx: PlanContext): number {
  const maxLevel = BUDGET_MAX_LEVEL[ctx.request.budget];
  const level = place.price.level;

  if (level > maxLevel) {
    // Nicht hart ausschließen (das macht der Filter bei echtem Cap), aber deutlich abwerten.
    return Math.max(0, 0.35 - (level - maxLevel) * 0.2);
  }
  const headroom = maxLevel - level;
  const base = 0.6 + Math.min(0.4, headroom * 0.2);
  return base * (0.6 + ctx.preferences.priceSensitivity * 0.4);
}

/** 0..1 – Abwechslung: Unbekanntes und selten Gemachtes wird belohnt. */
function noveltyScore(place: Place, ctx: PlanContext): number {
  const recentPlace = ctx.preferences.recentPlaceIds.includes(place.id);
  const recentCategoryCount = ctx.preferences.recentCategories.filter(
    (c) => c === place.category,
  ).length;
  let score = place.scores.novelty * 0.5 + 0.35;
  if (recentPlace) score -= 0.55;
  score -= Math.min(0.4, recentCategoryCount * 0.12);
  if (ctx.request.preferNovelty) score *= 1.35;
  return Math.max(0, Math.min(1, score));
}

/** -1..1 – gelernte Vorlieben und Abneigungen. */
function preferenceScore(place: Place, ctx: PlanContext): number {
  const like = ctx.preferences.likes[place.category] ?? 0;
  const dislike = ctx.preferences.dislikes[place.category] ?? 0;
  return Math.max(-1, Math.min(1, like - dislike));
}

/** 0..1 – wie gut passt der Ort zur Rolle dieses Slots. */
function roleScore(place: Place, slot: Slot): number {
  const index = slot.roles.indexOf(place.category);
  if (index < 0) return 0;
  return Math.max(0.35, 1 - index * 0.18);
}

function partyScore(place: Place, ctx: PlanContext): number {
  switch (ctx.request.party) {
    case 'family':
      return place.scores.family;
    case 'partner':
      return place.scores.romantic * 0.7 + place.scores.chill * 0.3;
    case 'friends':
      return place.scores.social;
    case 'solo':
      return place.scores.chill * 0.6 + place.scores.novelty * 0.4;
    default:
      return 0.6;
  }
}

export type ScoreInput = {
  place: Place;
  ctx: PlanContext;
  slot: Slot;
  distanceMeters: number;
  weatherAtStart: WeatherSlice | null;
  /** Kategorien, die im Plan schon vorkommen – für Abwechslung. */
  usedCategories: Category[];
  previousCategory?: Category;
  profile: VariantProfile;
};

export type ScoreResult = {
  total: number;
  breakdown: Partial<Record<keyof ScoringWeights, number>>;
};

export function scorePlace(input: ScoreInput): ScoreResult {
  const { place, ctx, slot, distanceMeters, weatherAtStart, profile } = input;
  const w = weightsFor(profile);

  const mood = moodScore(place, ctx.request.moods) * 0.65 + partyScore(place, ctx) * 0.35;
  const distance = distanceScore(distanceMeters, ctx.radiusMeters, ctx.preferences.distanceSensitivity);
  const price = priceScore(place, ctx);
  const weather = weatherFit(place, weatherAtStart);
  const season = seasonFit(place, ctx.season) + seasonCategoryBoost(place.category, ctx.season);
  const novelty = noveltyScore(place, ctx);
  const preference = preferenceScore(place, ctx);
  const role = roleScore(place, slot);
  const deal = place.deal ? 1 : 0;
  // Bewertungen fließen nur ein, wenn eine echte Quelle sie geliefert hat.
  const rating = place.rating !== undefined ? place.rating / 5 : 0;

  let total =
    mood * w.mood +
    distance * w.distance +
    price * w.price +
    weather * w.weather +
    season * w.season +
    novelty * w.novelty +
    preference * w.preference +
    role * w.role +
    deal * w.deal +
    rating * w.rating;

  // Varianten-Bias direkt auf Ortsprofil
  for (const [key, factor] of Object.entries(profile.bias) as Array<
    [keyof Place['scores'], number]
  >) {
    total += place.scores[key] * factor;
  }

  // Abwechslung: gleiche Kategorie direkt hintereinander ist meistens langweilig.
  if (input.previousCategory === place.category) total -= 1.4;
  const repeats = input.usedCategories.filter((c) => c === place.category).length;
  total -= repeats * 0.7;

  // Sparvariante: teure Orte fallen praktisch raus.
  if (profile.maxPriceLevel !== undefined && place.price.level > profile.maxPriceLevel) {
    total -= 2.5;
  }

  // Bestätigte Öffnungszeiten schlagen unbekannte. Der Ort bleibt zulässig,
  // aber wenn es eine Alternative mit gesicherten Zeiten gibt, gewinnt die.
  if (!place.openingHours) total -= 1.1;

  // Wer ausdrücklich "Kino" antippt, soll auch Kino bekommen. Der Wunsch
  // wirkt nur auf den Hauptteil des Plans – Essen und Ausklang bleiben frei.
  if (ctx.request.focusCategory && slot.label !== 'food' && slot.label !== 'winddown') {
    if (place.category === ctx.request.focusCategory) total += 1.6;
  }

  // Bei Regen indoor-lastige Kategorien zusätzlich anheben, bei Sonne outdoor.
  const mode = weatherModeOf(weatherAtStart);
  if (mode === 'wet' && place.indoorOutdoor === 'indoor') total += 0.5;
  if (mode === 'pleasant' && place.indoorOutdoor === 'outdoor') total += 0.45;
  if (mode === 'hot' && place.indoorOutdoor === 'outdoor' && place.heatSuitability > 0.85) {
    total += 0.3;
  }

  return {
    total,
    breakdown: { mood, distance, price, weather, season, novelty, preference, role, deal, rating },
  };
}
