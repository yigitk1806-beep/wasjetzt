import { isOpenDuring } from '@/lib/time';
import type { Place, WeatherSlice } from '@/types/domain';
import { BUDGET_MAX_LEVEL } from './budget';
import type { PlanContext } from './types';
import { isWeatherBlocked } from './weatherRules';

export type FilterInput = {
  place: Place;
  ctx: PlanContext;
  /** Geplanter Beginn des Besuchs. */
  start: Date;
  durationMin: number;
  /** Entfernung vom vorherigen Punkt. */
  distanceMeters: number;
  /** Bereits verplante Kosten pro Person, nur aus echten Beträgen. */
  spentMin: number;
  weatherAtStart: WeatherSlice | null;
  /** Minuten, die nach diesem Schritt noch für den Heimweg gebraucht werden. */
  reserveMinutes: number;
};

export type FilterResult = { ok: true } | { ok: false; reason: string };

/**
 * Wenn die Öffnungszeiten unbekannt sind, wird außerhalb dieses Fensters
 * nichts vorgeschlagen. Begründung: Wir wissen nicht, ob offen ist – aber
 * ein Vorschlag um 4 Uhr morgens wäre fast sicher falsch. Innerhalb des
 * Fensters bleibt der Ort zulässig und wird in der UI als „Öffnungszeiten
 * nicht verfügbar" gekennzeichnet.
 */
const UNKNOWN_HOURS_WINDOW = { fromHour: 9, toHour: 22 };

/**
 * Harte Ausschlusskriterien. Alles hier ist nicht verhandelbar:
 * geschlossen, unerreichbar, zu teuer, zu spät, rechtlich nicht möglich
 * oder bei diesem Wetter unzumutbar.
 */
export function passesHardFilters(input: FilterInput): FilterResult {
  const { place, ctx, start, durationMin, distanceMeters, spentMin, weatherAtStart } = input;

  // 1. Geöffnet? – oder zumindest plausibel, wenn wir es nicht wissen.
  if (place.openingHours) {
    if (!isOpenDuring(place.openingHours, start, durationMin)) {
      return { ok: false, reason: 'closed' };
    }
  } else {
    const startHour = start.getHours();
    const endHour = new Date(start.getTime() + durationMin * 60_000).getHours();
    const insideWindow =
      startHour >= UNKNOWN_HOURS_WINDOW.fromHour &&
      startHour < UNKNOWN_HOURS_WINDOW.toHour &&
      (endHour <= UNKNOWN_HOURS_WINDOW.toHour || endHour < startHour);
    if (!insideWindow) return { ok: false, reason: 'hours-unknown' };
  }

  // 2. In Reichweite?
  if (distanceMeters > ctx.radiusMeters) {
    return { ok: false, reason: 'too-far' };
  }

  // 3. Passt das ins Zeitfenster?
  const end = new Date(start.getTime() + durationMin * 60_000);
  const latestAllowed = new Date(ctx.latestEnd.getTime() - input.reserveMinutes * 60_000);
  if (end > latestAllowed) {
    return { ok: false, reason: 'no-time' };
  }

  // 4. Budget – echte Beträge hart, Niveaus nur beim Wunsch "kostenlos".
  if (place.price.perPerson && ctx.budgetCap !== undefined) {
    if (spentMin + place.price.perPerson.min > ctx.budgetCap) {
      return { ok: false, reason: 'too-expensive' };
    }
  }
  if (place.price.level > BUDGET_MAX_LEVEL[ctx.request.budget]) {
    // Bei "kostenlos" ist das eine klare Ansage, sonst nur ein Abzug im Ranking.
    if (ctx.request.budget === 'free') {
      return { ok: false, reason: 'too-expensive' };
    }
  }

  // 5. Altersgrenze
  if (place.minAge !== undefined) {
    if (ctx.request.party === 'family' && place.minAge >= 18) {
      return { ok: false, reason: 'age-family' };
    }
    if (ctx.request.age !== undefined && ctx.request.age < place.minAge) {
      return { ok: false, reason: 'age' };
    }
  }

  // 6. Wetter
  if (isWeatherBlocked(place, weatherAtStart)) {
    return { ok: false, reason: 'weather' };
  }

  // 7. Harte Abneigung des Nutzers
  const dislike = ctx.preferences.dislikes[place.category] ?? 0;
  if (dislike >= 0.9) {
    return { ok: false, reason: 'disliked' };
  }

  return { ok: true };
}
