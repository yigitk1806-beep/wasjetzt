import type { OpeningHours, Season, Weekday } from '@/types/domain';

export function minutesSinceMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

export function roundUpToQuarter(date: Date): Date {
  const d = new Date(date);
  d.setSeconds(0, 0);
  const rest = d.getMinutes() % 15;
  if (rest !== 0) d.setMinutes(d.getMinutes() + (15 - rest));
  return d;
}

export function formatClock(iso: string, locale = 'de'): string {
  return new Date(iso).toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
  });
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

export function weekdayOf(date: Date): Weekday {
  return date.getDay() as Weekday;
}

/**
 * Prüft, ob ein Ort im gesamten Fenster [start, start+duration) geöffnet ist.
 * Intervalle mit closeMin > 1440 laufen über Mitternacht hinaus.
 */
export function isOpenDuring(
  hours: OpeningHours,
  start: Date,
  durationMin: number,
): boolean {
  const startMin = minutesSinceMidnight(start);
  const endMin = startMin + durationMin;
  const today = weekdayOf(start);
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

export function dayPartOf(date: Date): DayPart {
  const h = date.getHours();
  if (h < 11) return 'morning';
  if (h < 14) return 'midday';
  if (h < 17) return 'afternoon';
  if (h < 23) return 'evening';
  return 'night';
}
