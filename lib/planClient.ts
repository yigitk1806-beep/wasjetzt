'use client';

import { loadPreferences } from '@/lib/clientStore';
import type { Category, Mobility, Mood, Party, Plan, SightTheme, TourTweak } from '@/types/domain';

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
  /** Startzeit als Ortszeit, z. B. "14:30". Fehlt = jetzt. */
  startLocal?: string;
  /** Heimkehrzeit als Ortszeit, z. B. "21:00". */
  homeByLocal?: string;
  singleActivity?: boolean;
  preferNovelty?: boolean;
  focusCategory?: Category;
  rawText?: string;
  surprise?: boolean;
  variants?: boolean;
  touristMode?: boolean;
  mode?: 'evening' | 'tour';
  interests?: SightTheme[];
  excludePlaceIds?: string[];
  tourTweak?: TourTweak;
};

export type PlanResponse = {
  plan?: Plan;
  variants?: Plan[];
  understood?: string[];
  usesMockPlaces?: boolean;
  error?: string;
  message?: string;
};

/** Abschnitte der Planung – die Ladeanzeige folgt diesen Meldungen. */
export type PlanPhase = 'orte' | 'wetter' | 'wege' | 'plan';

/**
 * Planung mit Fortschrittsmeldung.
 *
 * Liest den Ereignisstrom der Plan-Route und meldet jeden Abschnitt, sobald
 * der Server ihn tatsächlich erreicht – die Ladeanzeige zeigt damit echten
 * Fortschritt und keine erfundene Zeitleiste.
 *
 * Bricht der Strom ab (alte Zwischenspeicher, Proxys ohne Stream-Unterstützung),
 * wird stillschweigend auf die gewöhnliche Anfrage zurückgefallen.
 */
export async function requestPlanStreamed(
  input: PlanRequestInput,
  onPhase: (phase: PlanPhase) => void,
): Promise<PlanResponse> {
  const preferences = loadPreferences();

  try {
    const res = await fetch('/api/plan?stream=1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyFor(input, preferences)),
    });

    if (!res.ok || !res.body) return requestPlan(input);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let puffer = '';
    let ergebnis: PlanResponse | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      puffer += decoder.decode(value, { stream: true });

      // Ereignisse sind durch eine Leerzeile getrennt.
      const bloecke = puffer.split('\n\n');
      puffer = bloecke.pop() ?? '';

      for (const block of bloecke) {
        const typ = block.match(/^event: (.+)$/m)?.[1];
        const daten = block.match(/^data: (.+)$/m)?.[1];
        if (!typ || !daten) continue;

        if (typ === 'phase') {
          onPhase(JSON.parse(daten).phase as PlanPhase);
        } else if (typ === 'result') {
          const r = JSON.parse(daten);
          ergebnis = r.ok
            ? { plan: r.plan, variants: r.variants, understood: r.understood }
            : { error: r.error, message: r.message, understood: r.understood };
        }
      }
    }

    return ergebnis ?? { error: 'Die Planung wurde unterbrochen.' };
  } catch {
    return requestPlan(input);
  }
}

function bodyFor(
  input: PlanRequestInput,
  preferences: ReturnType<typeof loadPreferences>,
): Record<string, unknown> {
  return {
    ...input,
    // Der Server läuft auf UTC; ohne diese Angabe wüsste er nicht, welche
    // Uhrzeit „bis 22 Uhr" beim Nutzer meint.
    tzOffsetMin: -new Date().getTimezoneOffset(),
    language: preferences.language,
    age: preferences.age,
    homeLat: preferences.homeLocation?.lat,
    homeLon: preferences.homeLocation?.lon,
    party: input.party ?? preferences.defaultParty,
    mobility: input.mobility ?? preferences.defaultMobility,
    preferences,
  };
}

/** Einziger Einstiegspunkt der UI in die Planung. */
export async function requestPlan(input: PlanRequestInput): Promise<PlanResponse> {
  const preferences = loadPreferences();

  try {
    const res = await fetch('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyFor(input, preferences)),
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

/**
 * Legt einen bestehenden Plan auf eine neue Startzeit. `null` heißt jetzt.
 * `homeByLocal` weglassen = bisherige Heimkehrzeit behalten, `null` = keine.
 */
export async function retimePlan(
  planId: string,
  startLocal: string | null,
  homeByLocal: string | null | undefined,
): Promise<{ plan?: Plan; error?: string; message?: string }> {
  try {
    const res = await fetch(`/api/plan/${planId}/retime`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startLocal, homeByLocal, preferences: loadPreferences() }),
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
