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
  const h = Math.floor(gerundet / 60);
  const m = gerundet % 60;
  const deutsch = locale.startsWith('de');

  if (h === 0) return deutsch ? `${m} Min.` : `${m} min`;
  if (m === 0) return deutsch ? `${h} Std.` : `${h} h`;
  return deutsch ? `${h} Std. ${m} Min.` : `${h} h ${m} min`;
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
