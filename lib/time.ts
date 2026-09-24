import { dictionaryFor } from '@/lib/i18n';
import type { OpeningHours, Season, Weekday } from '@/types/domain';

/**
 * Ortszeit statt Serverzeit.
 *
 * Der Server läuft bei Vercel auf UTC. Alles, was nach „wie spät ist es dort?"
 * fragt – Öffnungszeiten, Tageszeit, Wochentag – muss deshalb mit dem Versatz
 * des *Ortes* rechnen, nicht mit dem des Servers. Sonst hält die App um 9:30
 * ein Museum für geschlossen, das um 9 Uhr öffnet, weil sie 7:30 annimmt.
 *
 * Technik: Zeitpunkt um den Versatz verschieben und die UTC-Felder lesen.
 * Das ist unabhängig davon, in welcher Zeitzone der Rechner selbst läuft.
 */
function ortszeit(date: Date, offsetMin: number): Date {
  return new Date(date.getTime() + offsetMin * 60_000);
}

/** Versatz der Zeitzone, in der dieser Prozess läuft – nur als Rückfall. */
export function processOffsetMin(at: Date = new Date()): number {
  return -at.getTimezoneOffset();
}

export function minutesSinceMidnight(date: Date, offsetMin: number): number {
  const d = ortszeit(date, offsetMin);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** Stunde am Ort als Kommazahl, z. B. 9.5 für 9:30 Uhr. */
export function localHour(date: Date, offsetMin: number): number {
  return minutesSinceMidnight(date, offsetMin) / 60;
}

export function roundUpToQuarter(date: Date): Date {
  const d = new Date(date);
  d.setSeconds(0, 0);
  const rest = d.getMinutes() % 15;
  if (rest !== 0) d.setMinutes(d.getMinutes() + (15 - rest));
  return d;
}

/**
 * Uhrzeit für die Oberfläche. Mit `offsetMin` in der Ortszeit des Plans –
 * wichtig, wenn jemand von Berlin aus einen Tag in New York plant. Ohne
 * Angabe in der Zeit des Geräts.
 */
export function formatClock(iso: string, locale = 'de', offsetMin?: number): string {
  if (offsetMin === undefined) {
    return new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  }
  const d = ortszeit(new Date(iso), offsetMin);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * Zeitdauer für die Oberfläche.
 *
 * Auf Deutsch immer "Std." und "Min." – nie "h" oder "min". Minutenzahlen über
 * einer Stunde werden umgerechnet: 120 wird zu "2 Std.", nicht zu "120 Min.".
 * Das ist reine Darstellung; gerechnet wird überall weiter in Minuten.
 */
export function formatDuration(minutes: number, locale = 'de'): string {
  const gerundet = Math.max(0, Math.round(minutes));
  return dictionaryFor(locale).units.duration(Math.floor(gerundet / 60), gerundet % 60);
}

export function weekdayOf(date: Date, offsetMin: number): Weekday {
  return ortszeit(date, offsetMin).getUTCDay() as Weekday;
}

/**
 * Prüft, ob ein Ort im gesamten Fenster [start, start+duration) geöffnet ist.
 * Intervalle mit closeMin > 1440 laufen über Mitternacht hinaus.
 */
export function isOpenDuring(
  hours: OpeningHours,
  start: Date,
  durationMin: number,
  /** Versatz der Ortszeit – OSM-Öffnungszeiten gelten in Ortszeit. */
  offsetMin: number,
): boolean {
  const startMin = minutesSinceMidnight(start, offsetMin);
  const endMin = startMin + durationMin;
  const today = weekdayOf(start, offsetMin);
  const yesterday = ((today + 6) % 7) as Weekday;

  const todayIntervals = hours[today] ?? [];
  for (const iv of todayIntervals) {
    if (startMin >= iv.openMin && endMin <= iv.closeMin) return true;
  }

  // Intervalle von gestern, die über Mitternacht reichen.
  const yesterdayIntervals = hours[yesterday] ?? [];
  for (const iv of yesterdayIntervals) {
    if (iv.closeMin <= 1440) continue;
    const shiftedOpen = iv.openMin - 1440;
    const shiftedClose = iv.closeMin - 1440;
    if (startMin >= shiftedOpen && endMin <= shiftedClose) return true;
  }

  return false;
}

export function seasonOf(date: Date, lat: number): Season {
  const month = date.getMonth(); // 0-basiert
  const northern: Season[] = [
    'winter', 'winter', 'spring', 'spring', 'spring', 'summer',
    'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter',
  ];
  const season = northern[month];
  if (lat >= 0) return season;
  const opposite: Record<Season, Season> = {
    winter: 'summer',
    summer: 'winter',
    spring: 'autumn',
    autumn: 'spring',
  };
  return opposite[season];
}

export type DayPart = 'morning' | 'midday' | 'afternoon' | 'evening' | 'night';

export function dayPartOf(date: Date, offsetMin: number): DayPart {
  const h = Math.floor(localHour(date, offsetMin));
  if (h < 11) return 'morning';
  if (h < 14) return 'midday';
  if (h < 17) return 'afternoon';
  if (h < 23) return 'evening';
  return 'night';
}

/**
 * Bis wann ein Ort offen hat – für das Intervall, in dem `at` liegt.
 * Minuten seit Mitternacht in Ortszeit; `null`, wenn er dann zu hat.
 * 1440 oder mehr heißt: bis Mitternacht oder darüber hinaus.
 */
export function openUntil(hours: OpeningHours, at: Date, offsetMin: number): number | null {
  const min = minutesSinceMidnight(at, offsetMin);
  const today = weekdayOf(at, offsetMin);
  for (const iv of hours[today] ?? []) {
    if (min >= iv.openMin && min < iv.closeMin) return iv.closeMin;
  }
  const yesterday = ((today + 6) % 7) as Weekday;
  for (const iv of hours[yesterday] ?? []) {
    if (iv.closeMin > 1440 && min < iv.closeMin - 1440) return iv.closeMin - 1440;
  }
  return null;
}

/** 1080 → "18:00". Werte über Mitternacht werden zurückgerechnet. */
/**
 * Wann schließt der Ort an dem Tag, um den es geht?
 *
 * Gedacht für den Fall, dass ein Ort zur gewünschten Zeit gerade nicht mehr
 * passt: Dann soll der Nutzer die echte Schließzeit erfahren statt nur
 * „nichts offen“. Geantwortet wird ausschließlich aus den hinterlegten
 * Öffnungszeiten – nie geraten.
 *
 * `null` heißt: darüber lässt sich nichts Verlässliches sagen. Das gilt auch,
 * wenn der Ort an dem Tag erst später öffnet – „schließt um“ wäre dann
 * irreführend.
 */
export function closingTimeFor(
  hours: OpeningHours,
  at: Date,
  offsetMin: number,
): number | null {
  const min = minutesSinceMidnight(at, offsetMin);
  const today = weekdayOf(at, offsetMin);
  const intervalle = hours[today] ?? [];
  if (intervalle.length === 0) return null;

  // Liegt die geplante Zeit in einem Intervall, zählt dessen Ende.
  for (const iv of intervalle) {
    if (min >= iv.openMin && min < iv.closeMin) return iv.closeMin;
  }
  // Sonst das letzte Intervall, das vor der geplanten Zeit geendet hat.
  const vorbei = intervalle.filter((iv) => iv.closeMin <= min).map((iv) => iv.closeMin);
  return vorbei.length > 0 ? Math.max(...vorbei) : null;
}

export function clockFromMinutes(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** "14:30" → 870 Minuten seit Mitternacht; `null`, wenn es keine Uhrzeit ist. */
export function parseClock(text: unknown): number | null {
  if (typeof text !== 'string') return null;
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(text.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * Der nächste Zeitpunkt, an dem es am Ort `minutes` nach Mitternacht ist –
 * frühestens `after` (abzüglich `toleranceMin`). Liegt die Uhrzeit heute schon
 * zurück, ist morgen gemeint.
 */
export function nextLocalTime(
  minutes: number,
  after: Date,
  offsetMin: number,
  toleranceMin = 0,
): Date {
  const lokal = new Date(after.getTime() + offsetMin * 60_000);
  const mitternacht = Date.UTC(lokal.getUTCFullYear(), lokal.getUTCMonth(), lokal.getUTCDate());
  let ziel = mitternacht + minutes * 60_000 - offsetMin * 60_000;
  if (ziel < after.getTime() - toleranceMin * 60_000) ziel += 24 * 60 * 60_000;
  return new Date(ziel);
}

/** Ortszeit als "HH:MM" – Gegenstück zu `parseClock`. */
export function localClock(date: Date, offsetMin: number): string {
  return clockFromMinutes(minutesSinceMidnight(date, offsetMin));
}

/** Kalendertage zwischen zwei Zeitpunkten in Ortszeit: 0 = heute, 1 = morgen. */
export function localDayDiff(date: Date, reference: Date, offsetMin: number): number {
  const tag = (d: Date) => Math.floor((d.getTime() + offsetMin * 60_000) / 86_400_000);
  return tag(date) - tag(reference);
}

/** Auf fünf Minuten aufrunden – „jetzt" wird nicht auf die Viertelstunde verschoben. */
export function roundUpToFive(date: Date): Date {
  const d = new Date(date);
  d.setSeconds(0, 0);
  const rest = d.getMinutes() % 5;
  if (rest !== 0) d.setMinutes(d.getMinutes() + (5 - rest));
  return d;
}
