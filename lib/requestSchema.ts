import {
  DEFAULT_PREFERENCES,
  type BudgetPreset,
  type Category,
  type Mobility,
  type Mood,
  type Party,
  type PlanRequest,
  type SightTheme,
  type TourTweak,
  type UserPreferences,
} from '@/types/domain';

const PARTIES: Party[] = ['solo', 'partner', 'friends', 'family'];
const BUDGETS: BudgetPreset[] = ['free', 'low', 'medium', 'high', 'any'];
const MOBILITIES: Mobility[] = ['walk', 'bike', 'transit', 'car'];
const MOODS: Mood[] = ['date', 'action', 'chill', 'party', 'food', 'nature', 'gaming', 'new'];
const SIGHT_THEMES: SightTheme[] = ['classic', 'photo', 'museum', 'park', 'history', 'hidden'];
const TOUR_TWEAKS: TourTweak[] = ['more', 'less-walk', 'museum', 'photo', 'free', 'faster', 'calm', 'surprise'];

const CATEGORIES: Category[] = [
  'food', 'cafe', 'bar', 'activity', 'cinema', 'culture',
  'nature', 'sport', 'gaming', 'wellness', 'shopping', 'event',
];

/** Ungültige Anfrage – mit Code, den die Oberfläche übersetzt. */
export class RequestError extends Error {
  constructor(
    readonly code: 'location-missing' | 'location-invalid',
    message: string,
  ) {
    super(message);
  }
}

function pick<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === 'string' && (allowed as string[]).includes(value)
    ? (value as T)
    : fallback;
}

function num(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

/** "14:30" – nur gültige Uhrzeiten, sonst nichts. */
function clockOrUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : undefined;
}

function isoOrUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * Nimmt rohe Eingaben (Client-Body oder Query) und baut daraus einen
 * vollständigen PlanRequest. Fehlende Angaben werden mit sinnvollen
 * Annahmen gefüllt – die App fragt lieber weniger und korrigiert später.
 */
export function normalizePlanRequest(raw: unknown): PlanRequest {
  const input = (raw ?? {}) as Record<string, unknown>;

  const lat = num(input.lat);
  const lon = num(input.lon);
  if (lat === undefined || lon === undefined) {
    throw new RequestError('location-missing', 'Standort fehlt.');
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new RequestError('location-invalid', 'Standort ist ungültig.');
  }

  const startISO = isoOrUndefined(input.startISO) ?? new Date().toISOString();
  const availableMinutes = clampMinutes(num(input.availableMinutes) ?? 240);
  const party = pick<Party>(input.party, PARTIES, 'friends');

  const rawMoods = Array.isArray(input.moods) ? input.moods : [];
  const moods = rawMoods
    .filter((m): m is Mood => typeof m === 'string' && (MOODS as string[]).includes(m))
    .slice(0, 4);

  const budget = pick<BudgetPreset>(input.budget, BUDGETS, 'any');
  const budgetPerPerson = num(input.budgetPerPerson);

  const homeLat = num(input.homeLat);
  const homeLon = num(input.homeLon);

  const focusCategory =
    typeof input.focusCategory === 'string' &&
    (CATEGORIES as string[]).includes(input.focusCategory)
      ? (input.focusCategory as Category)
      : undefined;

  const age = num(input.age);
  const isTour = input.mode === 'tour';
  const tz = num(input.tzOffsetMin);

  const interests = Array.isArray(input.interests)
    ? input.interests.filter(
        (t): t is SightTheme => typeof t === 'string' && (SIGHT_THEMES as string[]).includes(t),
      )
    : [];
  const excludePlaceIds = Array.isArray(input.excludePlaceIds)
    ? input.excludePlaceIds.filter((v): v is string => typeof v === 'string').slice(0, 200)
    : [];
  const tourTweak =
    typeof input.tourTweak === 'string' && (TOUR_TWEAKS as string[]).includes(input.tourTweak)
      ? (input.tourTweak as TourTweak)
      : undefined;

  return {
    origin: { lat, lon },
    originLabel:
      typeof input.originLabel === 'string' && input.originLabel.trim()
        ? input.originLabel.trim().slice(0, 80)
        : 'Dein Standort',
    startISO,
    availableMinutes,
    party,
    groupSize: Math.max(1, Math.min(20, Math.round(num(input.groupSize) ?? defaultGroupSize(party)))),
    budget,
    budgetPerPerson:
      budgetPerPerson !== undefined && budgetPerPerson >= 0
        ? Math.min(1000, budgetPerPerson)
        : undefined,
    moods,
    mobility: pick<Mobility>(input.mobility, MOBILITIES, isTour ? 'walk' : 'transit'),
    mustBeHomeByISO: isoOrUndefined(input.mustBeHomeByISO),
    startLocal: clockOrUndefined(input.startLocal),
    homeByLocal: clockOrUndefined(input.homeByLocal),
    homeLocation:
      homeLat !== undefined && homeLon !== undefined
        ? { lat: homeLat, lon: homeLon }
        : undefined,
    singleActivity: input.singleActivity === true,
    preferNovelty: input.preferNovelty === true,
    focusCategory,
    rawText: typeof input.rawText === 'string' ? input.rawText.slice(0, 500) : undefined,
    language: typeof input.language === 'string' ? input.language.slice(0, 5) : 'de',
    currency: typeof input.currency === 'string' ? input.currency.slice(0, 3) : 'EUR',
    age: age !== undefined && age >= 6 && age <= 120 ? Math.round(age) : undefined,
    touristMode: input.touristMode === true,
    tzOffsetMin: tz !== undefined && Math.abs(tz) <= 14 * 60 ? Math.round(tz) : undefined,
    mode: isTour ? 'tour' : 'evening',
    interests: isTour ? interests : undefined,
    excludePlaceIds: excludePlaceIds.length ? excludePlaceIds : undefined,
    tourTweak: isTour ? tourTweak : undefined,
  };
}

function defaultGroupSize(party: Party): number {
  switch (party) {
    case 'solo':
      return 1;
    case 'partner':
      return 2;
    case 'family':
      return 4;
    default:
      return 3;
  }
}

function clampMinutes(value: number): number {
  return Math.max(45, Math.min(720, Math.round(value)));
}

/** Präferenzen kommen vom Client und müssen validiert werden. */
export function normalizePreferences(raw: unknown): UserPreferences {
  const input = (raw ?? {}) as Record<string, unknown>;
  const weightMap = (value: unknown): Partial<Record<Category, number>> => {
    const out: Partial<Record<Category, number>> = {};
    if (value && typeof value === 'object') {
      for (const [key, weight] of Object.entries(value as Record<string, unknown>)) {
        if (!(CATEGORIES as string[]).includes(key)) continue;
        const n = num(weight);
        if (n === undefined) continue;
        out[key as Category] = Math.max(0, Math.min(1, n));
      }
    }
    return out;
  };

  const ids = Array.isArray(input.recentPlaceIds)
    ? input.recentPlaceIds.filter((v): v is string => typeof v === 'string').slice(0, 60)
    : [];
  const cats = Array.isArray(input.recentCategories)
    ? input.recentCategories
        .filter((v): v is Category => typeof v === 'string' && (CATEGORIES as string[]).includes(v))
        .slice(0, 60)
    : [];

  return {
    ...DEFAULT_PREFERENCES,
    likes: weightMap(input.likes),
    dislikes: weightMap(input.dislikes),
    distanceSensitivity: clamp01(num(input.distanceSensitivity) ?? 0.5),
    priceSensitivity: clamp01(num(input.priceSensitivity) ?? 0.5),
    defaultMobility: pick<Mobility>(input.defaultMobility, MOBILITIES, 'transit'),
    defaultParty: pick<Party>(input.defaultParty, PARTIES, 'friends'),
    recentPlaceIds: ids,
    recentCategories: cats,
    language: typeof input.language === 'string' ? input.language.slice(0, 5) : 'de',
    shareLocationLive: input.shareLocationLive === true,
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
