import type { Category, Mobility, Mood, Place, PriceLevel, WeatherSlice } from '@/types/domain';
import { BUDGET_MAX_LEVEL } from './budget';
import type { PlanContext, ScoringWeights, Slot, VariantProfile } from './types';

/** Arten, an denen man nichts *tut* – als "Action" ungeeignet. */
const PASSIV = new Set<Category>(['nature', 'shopping', 'cafe', 'wellness']);
import { seasonCategoryBoost, seasonFit, weatherFit, weatherModeOf } from './weatherRules';

/**
 * Gewichte des Rankings. Nähe zählt bewusst schwer: WasJetzt verspricht, was
 * *hier* gerade sinnvoll ist – nicht den theoretisch besten Ort der Stadt.
 */
export const BASE_WEIGHTS: ScoringWeights = {
  mood: 1.25,
  distance: 1.8,
  price: 0.7,
  weather: 1.1,
  season: 0.45,
  novelty: 0.55,
  preference: 0.9,
  // Die Rolle wiegt schwer: Wer Action will, soll Action bekommen.
  role: 1.5,
  deal: 0.25,
  rating: 0.35,
  group: 0.7,
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
    weights: { mood: 1.1, distance: 1.9, price: 0.4 },
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
    weights: { price: 2.2, distance: 2.1 },
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

/**
 * Entfernung, die sich mit dem jeweiligen Verkehrsmittel noch „gleich um die
 * Ecke" anfühlt. Bis hierhin kostet ein Ort kaum Punkte, danach fällt er
 * deutlich ab.
 *
 * Gemessen wird bewusst hieran und nicht am Suchradius: Sonst wäre für einen
 * Bus-und-Bahn-Nutzer (Radius 9 km) ein Lokal in 3 km Entfernung „nah" – und
 * das Café zwei Straßen weiter hätte keinen Vorteil mehr.
 */
const WOHLFUEHL_METER: Record<Mobility, number> = {
  walk: 700,
  bike: 2000,
  transit: 2500,
  car: 4000,
};

/**
 * 0..1 – nah ist deutlich besser. Innerhalb der Wohlfühlentfernung bleibt der
 * Wert hoch, danach fällt er steil: Ein Ort in dreifacher Entfernung muss
 * schon inhaltlich klar besser sein, um zu gewinnen.
 */
function distanceScore(distanceMeters: number, ctx: PlanContext, sensitivity: number): number {
  const wohl = WOHLFUEHL_METER[ctx.request.mobility];
  const ratio = distanceMeters / wohl;
  // Glockenähnlicher Abfall: 1 bei 0 m, ~0,74 bei Wohlfühlentfernung,
  // ~0,3 beim Doppelten, nahe 0 beim Vierfachen.
  const basis = 1 / (1 + ratio ** 2 * 0.55);
  // Wer empfindlich auf Wege reagiert, bekommt den Abfall noch stärker.
  return basis ** (0.75 + sensitivity * 0.75);
}

/**
 * Was ein Preisniveau ungefähr pro Person kostet.
 *
 * Diese Zahlen werden **nie angezeigt**. Sie dienen allein dem Vergleich
 * innerhalb des Rankings: Ohne sie wäre "50 € für zwei" nicht von "200 €
 * für vier" zu unterscheiden, weil beide dieselbe Budgetstufe treffen.
 * Angezeigt wird weiterhin nur € / €€ / €€€ mit dem Zusatz "geschätzt".
 */
const NIVEAU_EURO: Record<PriceLevel, number> = { 0: 0, 1: 12, 2: 28, 3: 60 };

/** 0..1 – passt der Preis zum Budget. */
function priceScore(place: Place, ctx: PlanContext): number {
  const level = place.price.level;

  // Echter Betrag vom Betrieb? Dann zählt der, nicht die Stufe.
  const proKopf = place.price.perPerson
    ? (place.price.perPerson.min + place.price.perPerson.max) / 2
    : NIVEAU_EURO[level];

  // Kennt die Anfrage ein Budget pro Kopf, wird daran gemessen. Das macht
  // 30 € für eine Person und 25 € für zwei unterscheidbar – vorher fielen
  // beide in dieselbe grobe Stufe und ergaben dasselbe Ergebnis.
  if (ctx.budgetCap !== undefined && ctx.budgetCap > 0) {
    const anteil = proKopf / ctx.budgetCap;
    // Bis zur Hälfte des Budgets voll gut, danach fallend, über dem Budget
    // deutlich abgewertet.
    const passung = anteil <= 0.5 ? 1 : anteil <= 1 ? 1 - (anteil - 0.5) * 0.8 : Math.max(0, 0.6 - (anteil - 1) * 0.6);
    return passung * (0.6 + ctx.preferences.priceSensitivity * 0.4);
  }

  const maxLevel = BUDGET_MAX_LEVEL[ctx.request.budget];
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

/**
 * 0..1 – wie gut passt der Ort zur Rolle dieses Slots.
 *
 * Die Reihenfolge der Rollen ist Bedeutung, nicht Aufzählung: Steht
 * „activity" vorn und „nature" hinten, muss ein Park inhaltlich deutlich
 * besser sein, um eine Bowlingbahn zu verdrängen.
 */
function roleScore(place: Place, slot: Slot): number {
  const index = slot.roles.indexOf(place.category);
  if (index < 0) return 0;
  return Math.max(0.15, 1 - index * 0.3);
}

/**
 * Passt der Ort zur Gruppengröße?
 *
 * Wir kennen keine Sitzplatzzahlen – deshalb wird nichts behauptet, sondern
 * nur gewichtet: Große Gruppen bekommen eher Orte, die für Gruppen gemacht
 * sind (Bowling, Minigolf, Restaurant), kleine eher Orte, die zu zweit
 * funktionieren. Ein Eiscafé für acht Leute ist keine Zusage wert.
 */
function groupScore(place: Place, groupSize: number): number {
  const s = place.scores;

  if (groupSize === 1) {
    // Allein: Man braucht niemanden, mit dem man redet. Ein Kino, ein
    // Museum, eine Stunde Arcade funktionieren bestens; ein Ort, der ganz
    // vom Miteinander lebt (Karaoke, Bowlingbahn für acht), weniger.
    const geselligkeitsLastig = s.social > 0.88 ? 0.2 : 0;
    return Math.max(0, 0.45 + s.chill * 0.35 + s.novelty * 0.2 - geselligkeitsLastig);
  }

  if (groupSize === 2) {
    // Zu zweit: Intimität schlägt Gruppentauglichkeit, aber nur leicht.
    return 0.5 + s.romantic * 0.35 + s.chill * 0.15;
  }

  if (groupSize >= 5) {
    // Ab fünf Leuten zählt Gruppentauglichkeit stark; sehr kleine Formate
    // (Eisdiele, Wellness) verlieren spürbar.
    const klein = KLEINE_FORMATE.has(place.category) ? 0.25 : 0;
    return Math.max(0, s.social - klein);
  }

  return 0.4 + s.social * 0.6;
}

/** Arten, die in großer Gruppe selten funktionieren. */
const KLEINE_FORMATE = new Set<Category>(['cafe', 'wellness']);

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
  const distance = distanceScore(distanceMeters, ctx, ctx.preferences.distanceSensitivity);
  const price = priceScore(place, ctx);
  const weather = weatherFit(place, weatherAtStart);
  const season = seasonFit(place, ctx.season) + seasonCategoryBoost(place.category, ctx.season);
  const novelty = noveltyScore(place, ctx);
  const preference = preferenceScore(place, ctx);
  const role = roleScore(place, slot);
  const group = groupScore(place, ctx.request.groupSize);
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
    group * w.group +
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

  // Wer Action will, meint etwas zu erleben: Bowling, Kart, Escape Room.
  // Orte, an denen man nichts tut, sind dafür kein Ersatz.
  if (slot.need === 'experience') {
    total += place.scores.action * 1.4;
    if (PASSIV.has(place.category)) total -= 1.5;
  }

  // Ein Park ist kein Allzweck-Füller. Er gewinnt, wenn jemand rausgehen,
  // spazieren oder es ruhig angehen will – sonst nur, wenn sonst nichts da
  // ist. Kostenlos und immer offen allein ist kein Grund.
  if (place.category === 'nature' && !ctx.intent.outdoor && !ctx.intent.calm) {
    total -= ctx.intent.experience ? 2.2 : 1.1;
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
    breakdown: {
      mood, distance, price, weather, season, novelty, preference, role, group, deal, rating,
    },
  };
}
