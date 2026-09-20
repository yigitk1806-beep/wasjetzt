import type { OpeningInterval, OpeningHours, Weekday } from '@/types/domain';

/**
 * Parser für das OSM-Feld `opening_hours`.
 *
 * Bewusst konservativ: Es wird nur die verbreitete Teilmenge verstanden
 * (Wochentage, Zeitspannen, `off`, `24/7`). Alles, was darüber hinausgeht –
 * Monatsbereiche, Sonnenauf-/-untergang, "erster Sonntag im Monat",
 * offene Enden wie `09:00+` – führt zu `null`.
 *
 * `null` heißt: **wir wissen es nicht**. Die App behauptet dann nirgends,
 * der Ort sei geöffnet, sondern zeigt "Öffnungszeiten nicht verfügbar".
 * Lieber keine Angabe als eine geratene.
 */

const DAY_ORDER = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'] as const;

const DAY_TO_WEEKDAY: Record<string, Weekday> = {
  su: 0, mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6,
};

/** Selektoren, die dieser Parser nicht sicher abbilden kann. */
const UNSUPPORTED = /sunrise|sunset|dusk|dawn|week\s|\[|easter|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|"|unknown/;

const DAY_TOKEN = '(?:mo|tu|we|th|fr|sa|su|ph|sh)';
const DAY_SELECTOR = new RegExp(
  `^(${DAY_TOKEN}(?:\\s*-\\s*${DAY_TOKEN})?(?:\\s*,\\s*${DAY_TOKEN}(?:\\s*-\\s*${DAY_TOKEN})?)*)\\s+(.*)$`,
);
const ONLY_DAYS = new RegExp(
  `^(${DAY_TOKEN}(?:\\s*-\\s*${DAY_TOKEN})?(?:\\s*,\\s*${DAY_TOKEN}(?:\\s*-\\s*${DAY_TOKEN})?)*)$`,
);

const TIME_RANGE = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/;

function allDays(intervals: OpeningInterval[]): OpeningHours {
  const hours: OpeningHours = {};
  for (const day of [0, 1, 2, 3, 4, 5, 6] as Weekday[]) hours[day] = intervals;
  return hours;
}

export function parseOpeningHours(raw: string | undefined | null): OpeningHours | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!value) return null;

  if (value === '24/7' || value === 'mo-su 00:00-24:00') {
    return allDays([{ openMin: 0, closeMin: 1440 }]);
  }
  if (UNSUPPORTED.test(value)) return null;

  const result: OpeningHours = {};
  const rules = value.split(';').map((r) => r.trim()).filter(Boolean);
  if (rules.length === 0) return null;

  let touchedAnyDay = false;

  for (const rule of rules) {
    const parsed = parseRule(rule);
    if (parsed === null) return null;
    if (parsed === 'skip') continue;

    const { days, intervals } = parsed;
    for (const day of days) {
      // Spätere Regeln überschreiben frühere für dieselben Tage (OSM-Semantik).
      if (intervals.length === 0) delete result[day];
      else result[day] = intervals;
      touchedAnyDay = true;
    }
  }

  return touchedAnyDay ? result : null;
}

type ParsedRule = { days: Weekday[]; intervals: OpeningInterval[] } | 'skip' | null;

function parseRule(rule: string): ParsedRule {
  let dayPart: string | null = null;
  let timePart = rule;

  const withDays = rule.match(DAY_SELECTOR);
  if (withDays) {
    dayPart = withDays[1];
    timePart = withDays[2].trim();
  } else if (ONLY_DAYS.test(rule)) {
    // Nur Tage, keine Zeit – etwa "su" allein. Nicht interpretierbar.
    return null;
  }

  const days = dayPart ? expandDays(dayPart) : [...Object.values(DAY_TO_WEEKDAY)];
  if (days === null) return null;
  // Regeln, die ausschließlich Feiertage betreffen, ignorieren wir.
  if (days.length === 0) return 'skip';

  if (timePart === 'off' || timePart === 'closed') {
    return { days, intervals: [] };
  }

  const intervals: OpeningInterval[] = [];
  for (const chunk of timePart.split(',').map((c) => c.trim())) {
    const interval = parseTimeRange(chunk);
    if (!interval) return null;
    intervals.push(interval);
  }
  if (intervals.length === 0) return null;

  return { days, intervals };
}

/** Gibt die Wochentage einer Selektion zurück; null bei unverständlicher Angabe. */
function expandDays(selector: string): Weekday[] | null {
  const out = new Set<Weekday>();

  for (const part of selector.split(',').map((p) => p.trim())) {
    if (part === 'ph' || part === 'sh') continue; // Feiertage ignorieren

    const range = part.split('-').map((p) => p.trim());
    if (range.length === 1) {
      const day = DAY_TO_WEEKDAY[range[0]];
      if (day === undefined) return null;
      out.add(day);
      continue;
    }
    if (range.length !== 2) return null;

    const from = DAY_ORDER.indexOf(range[0] as (typeof DAY_ORDER)[number]);
    const to = DAY_ORDER.indexOf(range[1] as (typeof DAY_ORDER)[number]);
    if (from < 0 || to < 0) return null;

    // Bereiche dürfen über das Wochenende hinauslaufen (z. B. Fr-Mo).
    for (let i = 0; i < 7; i += 1) {
      const index = (from + i) % 7;
      out.add(DAY_TO_WEEKDAY[DAY_ORDER[index]]);
      if (index === to) break;
    }
  }

  return [...out];
}

function parseTimeRange(chunk: string): OpeningInterval | null {
  const match = chunk.match(TIME_RANGE);
  if (!match) return null;

  const openMin = Number(match[1]) * 60 + Number(match[2]);
  let closeMin = Number(match[3]) * 60 + Number(match[4]);

  if (!Number.isFinite(openMin) || !Number.isFinite(closeMin)) return null;
  if (openMin < 0 || openMin > 1440) return null;

  // Über Mitternacht: 20:00-02:00 wird zu 1200-1560.
  if (closeMin <= openMin) closeMin += 1440;
  if (closeMin - openMin > 1440) return null;

  return { openMin, closeMin };
}
