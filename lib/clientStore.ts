'use client';

import {
  DEFAULT_PREFERENCES,
  type Category,
  type Coordinates,
  type Mood,
  type Party,
  type Plan,
  type UserPreferences,
} from '@/types/domain';

const KEYS = {
  prefs: 'wasjetzt.prefs.v1',
  location: 'wasjetzt.location.v1',
  history: 'wasjetzt.history.v1',
  recentPlans: 'wasjetzt.recentPlans.v1',
} as const;

export type StoredLocation = {
  label: string;
  location: Coordinates;
  /** true, wenn per GPS ermittelt. */
  fromDevice: boolean;
  savedAtISO: string;
};

export type HistoryEntry = {
  weekday: number;
  party: Party;
  moods: Mood[];
  categories: Category[];
  atISO: string;
};

export type RecentPlan = {
  id: string;
  title: string;
  summary: string;
  startISO: string;
  emojis: string[];
};

function read<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as T) };
  } catch {
    return fallback;
  }
}

function readRaw<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Privater Modus oder voller Speicher – die App funktioniert auch ohne.
  }
}

// ---------------------------------------------------------------- Preferences

export function loadPreferences(): UserPreferences {
  return read<UserPreferences>(KEYS.prefs, DEFAULT_PREFERENCES);
}

export function savePreferences(prefs: UserPreferences): UserPreferences {
  write(KEYS.prefs, prefs);
  return prefs;
}

export function updatePreferences(
  mutate: (prefs: UserPreferences) => UserPreferences,
): UserPreferences {
  return savePreferences(mutate(loadPreferences()));
}

// ------------------------------------------------------------------ Location

export function loadLocation(): StoredLocation | null {
  return readRaw<StoredLocation | null>(KEYS.location, null);
}

export function saveLocation(location: StoredLocation) {
  write(KEYS.location, location);
}

export function clearLocation() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(KEYS.location);
  } catch {
    /* ignorieren */
  }
}

// -------------------------------------------------------------------- Lernen

const MAX_RECENT_PLACES = 40;
const MAX_HISTORY = 40;

/** Nach dem Start eines Plans: merken, was tatsächlich gemacht wurde. */
export function recordPlanStarted(plan: Plan) {
  updatePreferences((prefs) => {
    const placeIds = plan.steps.map((s) => s.place.id);
    const categories = plan.steps.map((s) => s.place.category);
    return {
      ...prefs,
      recentPlaceIds: [...placeIds, ...prefs.recentPlaceIds].slice(0, MAX_RECENT_PLACES),
      recentCategories: [...categories, ...prefs.recentCategories].slice(0, MAX_RECENT_PLACES),
    };
  });

  const history = readRaw<HistoryEntry[]>(KEYS.history, []);
  const entry: HistoryEntry = {
    weekday: new Date(plan.startISO).getDay(),
    party: plan.request.party,
    moods: plan.request.moods,
    categories: plan.steps.map((s) => s.place.category),
    atISO: plan.startISO,
  };
  write(KEYS.history, [entry, ...history].slice(0, MAX_HISTORY));

  const recents = readRaw<RecentPlan[]>(KEYS.recentPlans, []);
  const recent: RecentPlan = {
    id: plan.id,
    title: plan.title,
    summary: plan.summary,
    startISO: plan.startISO,
    emojis: plan.steps.map((s) => s.place.emoji),
  };
  write(KEYS.recentPlans, [recent, ...recents.filter((r) => r.id !== plan.id)].slice(0, 8));
}

export function loadRecentPlans(): RecentPlan[] {
  return readRaw<RecentPlan[]>(KEYS.recentPlans, []);
}

export type FeedbackReason = 'price' | 'distance' | 'atmosphere' | 'quality';

/** Daumen hoch/runter zu einer Kategorie – verschiebt die Gewichte sanft. */
export function recordFeedback(
  category: Category,
  verdict: 'up' | 'down',
  reason?: FeedbackReason,
) {
  updatePreferences((prefs) => {
    const likes = { ...prefs.likes };
    const dislikes = { ...prefs.dislikes };
    const step = 0.2;

    if (verdict === 'up') {
      likes[category] = clamp01((likes[category] ?? 0) + step);
      dislikes[category] = clamp01((dislikes[category] ?? 0) - step);
    } else {
      dislikes[category] = clamp01((dislikes[category] ?? 0) + step);
      likes[category] = clamp01((likes[category] ?? 0) - step);
    }

    let { distanceSensitivity, priceSensitivity } = prefs;
    if (reason === 'distance') distanceSensitivity = clamp01(distanceSensitivity + 0.15);
    if (reason === 'price') priceSensitivity = clamp01(priceSensitivity + 0.15);

    return { ...prefs, likes, dislikes, distanceSensitivity, priceSensitivity };
  });
}

/** Wenn ein Vorschlag ersetzt wird, ist das ein schwaches Nein. */
export function recordRejection(category: Category, hint?: string) {
  updatePreferences((prefs) => {
    const dislikes = { ...prefs.dislikes };
    dislikes[category] = clamp01((dislikes[category] ?? 0) + 0.08);
    let { distanceSensitivity, priceSensitivity } = prefs;
    if (hint === 'cheaper') priceSensitivity = clamp01(priceSensitivity + 0.1);
    if (hint === 'faster') distanceSensitivity = clamp01(distanceSensitivity + 0.1);
    return { ...prefs, dislikes, distanceSensitivity, priceSensitivity };
  });
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Sehr zurückhaltende Routine-Erkennung: nur wenn sich ein Muster
 * an diesem Wochentag mindestens zweimal gezeigt hat.
 */
export function suggestRoutine(weekday: number): { party: Party; moods: Mood[] } | null {
  const history = readRaw<HistoryEntry[]>(KEYS.history, []).filter(
    (h) => h.weekday === weekday,
  );
  if (history.length < 2) return null;

  const partyCount = new Map<Party, number>();
  const moodCount = new Map<Mood, number>();
  for (const entry of history) {
    partyCount.set(entry.party, (partyCount.get(entry.party) ?? 0) + 1);
    for (const mood of entry.moods) moodCount.set(mood, (moodCount.get(mood) ?? 0) + 1);
  }

  const topParty = [...partyCount.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!topParty || topParty[1] < 2) return null;
  const moods = [...moodCount.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([mood]) => mood);

  return { party: topParty[0], moods };
}

export function clearEverything() {
  if (typeof window === 'undefined') return;
  for (const key of Object.values(KEYS)) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignorieren */
    }
  }
}
