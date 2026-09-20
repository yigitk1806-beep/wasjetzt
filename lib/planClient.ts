'use client';

import { loadPreferences } from '@/lib/clientStore';
import type { Category, Mobility, Mood, Party, Plan } from '@/types/domain';

export type PlanRequestInput = {
  lat: number;
  lon: number;
  originLabel?: string;
  startISO?: string;
  availableMinutes?: number;
  party?: Party;
  groupSize?: number;
  budget?: 'free' | 'low' | 'medium' | 'high' | 'any';
  budgetPerPerson?: number;
  moods?: Mood[];
  mobility?: Mobility;
  mustBeHomeByISO?: string;
  singleActivity?: boolean;
  preferNovelty?: boolean;
  focusCategory?: Category;
  rawText?: string;
  surprise?: boolean;
  variants?: boolean;
  touristMode?: boolean;
};

export type PlanResponse = {
  plan?: Plan;
  variants?: Plan[];
  understood?: string[];
  usesMockPlaces?: boolean;
  error?: string;
  message?: string;
};

/** Einziger Einstiegspunkt der UI in die Planung. */
export async function requestPlan(input: PlanRequestInput): Promise<PlanResponse> {
  const preferences = loadPreferences();

  try {
    const res = await fetch('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...input,
        language: preferences.language,
        age: preferences.age,
        homeLat: preferences.homeLocation?.lat,
        homeLon: preferences.homeLocation?.lon,
        party: input.party ?? preferences.defaultParty,
        mobility: input.mobility ?? preferences.defaultMobility,
        preferences,
      }),
    });

    const data = (await res.json()) as PlanResponse;
    if (!res.ok) {
      return { error: data.error ?? 'Die Planung ist fehlgeschlagen.' };
    }
    return data;
  } catch {
    return { error: 'Keine Verbindung. Versuch es gleich nochmal.' };
  }
}

export async function replacePlanStep(
  planId: string,
  stepId: string,
  hint: string,
): Promise<{ plan?: Plan; error?: string; message?: string }> {
  try {
    const res = await fetch(`/api/plan/${planId}/replace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepId, hint, preferences: loadPreferences() }),
    });
    return (await res.json()) as { plan?: Plan; error?: string; message?: string };
  } catch {
    return { error: 'Keine Verbindung.' };
  }
}

export async function groupAction(
  planId: string,
  body: Record<string, unknown>,
): Promise<Plan | null> {
  try {
    const res = await fetch(`/api/plan/${planId}/group`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { plan?: Plan };
    return data.plan ?? null;
  } catch {
    return null;
  }
}
