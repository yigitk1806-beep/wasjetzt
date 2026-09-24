import type { RecentPlan } from '@/lib/clientStore';
import type { Plan, PlanCost, PlanNote, PlanStep, PriceInfo, PriceLevel } from '@/types/domain';
import { de as deDict, type Dictionary } from './locales/de';

/**
 * Alles, was aus Zahlen und Schlüsseln Text macht – in der gewählten Sprache.
 * Komponenten rufen nur diese Helfer auf; Grammatik steckt im Wörterbuch.
 */

export function duration(t: Dictionary, minutes: number): string {
  const gerundet = Math.max(0, Math.round(minutes));
  return t.units.duration(Math.floor(gerundet / 60), gerundet % 60);
}

export function distance(t: Dictionary, meters: number): string {
  if (meters < 950) return `${Math.round(meters / 50) * 50} m`;
  return `${(meters / 1000).toLocaleString(t.units.decimal, { maximumFractionDigits: 1 })} km`;
}

const SYMBOLE: Record<PriceLevel, string> = { 0: '', 1: '€', 2: '€€', 3: '€€€' };

/**
 * Preis: Eurobeträge nur, wenn die Quelle sie wirklich liefert; sonst das
 * geschätzte Niveau als € / €€ / €€€.
 */
export function price(t: Dictionary, info: PriceInfo, currency: string): string {
  const symbol = currency === 'EUR' ? '€' : currency;
  if (info.perPerson) {
    const { min, max } = info.perPerson;
    if (max === 0) return t.price.free;
    return min === max ? `${min} ${symbol}` : `${min}–${max} ${symbol}`;
  }
  if (info.level === 0) return info.levelEstimated ? t.price.mostlyFree : t.price.free;
  return t.price.estimated(SYMBOLE[info.level]);
}

/**
 * Preis eines ganzen Plans. Gezeigt wird die Summe für die Gruppe – so, wie
 * das Budget auch gemeint war. Eine Zahl steht nur dort, wo jeder Einzelpreis
 * echt ist; sonst bleibt es beim Niveau mit sichtbarem „geschätzt“.
 */
export function planPrice(t: Dictionary, cost: PlanCost, currency: string): string {
  const symbol = currency === 'EUR' ? '€' : currency;
  const gruppe = cost.groupSize ?? 1;
  if (cost.total && gruppe > 1) {
    const { min, max } = cost.total;
    if (max === 0) return t.price.free;
    const betrag = min === max ? `${min} ${symbol}` : `${min}–${max} ${symbol}`;
    return `${betrag} ${t.build.budgetTotal}`;
  }
  return price(t, { level: cost.level, levelEstimated: cost.levelEstimated, perPerson: cost.perPerson }, currency);
}

/** "Heute", "Morgen" oder der Wochentag – in Ortszeit des Plans. */
export function dayLabel(t: Dictionary, iso: string, offsetMin: number, now = new Date()): string {
  const tag = (d: Date) => Math.floor((d.getTime() + offsetMin * 60_000) / 86_400_000);
  const date = new Date(iso);
  const diff = tag(date) - tag(now);
  if (diff === 0) return t.days.today;
  if (diff === 1) return t.days.tomorrow;
  if (diff === -1) return t.days.yesterday;
  const wochentag = new Date(date.getTime() + offsetMin * 60_000).getUTCDay();
  return t.days.weekdays[wochentag];
}

/** Art eines Ortes, z. B. "Denkmal" → "Monument". Unbekannte Arten bleiben, wie sie sind. */
export function kind(t: Dictionary, kindLabel: string): string {
  return t.kinds[kindLabel] ?? kindLabel;
}

/** Interne Bezeichnung für den Gerätestandort (so steht sie im Speicher). */
export const DEVICE_LOCATION_LABEL = 'Dein Standort';

export function locationLabel(t: Dictionary, label: string | null | undefined): string | null {
  if (!label) return null;
  return label === DEVICE_LOCATION_LABEL ? t.location.yours : label;
}

export function planTitle(t: Dictionary, plan: Pick<Plan, 'title' | 'titleKey' | 'titleParams'>): string {
  const alt = plan.titleKey ? null : legacyTitle(plan.title);
  const titleKey = plan.titleKey ?? alt?.key;
  const p = plan.titleParams ?? alt?.params;
  if (titleKey === 'tour') {
    const ort = typeof p?.place === 'string' && p.place ? p.place : null;
    return t.titles.tour(ort);
  }
  if (titleKey === 'plan' && p) {
    return t.titles.plan(p.party as Parameters<Dictionary['titles']['plan']>[0], p.dayPart as Parameters<Dictionary['titles']['plan']>[1]);
  }
  return plan.title;
}

export function stationCount(plan: Pick<Plan, 'mode' | 'steps'>): number {
  return plan.mode === 'tour'
    ? plan.steps.filter((s) => s.place.themes?.length).length
    : plan.steps.length;
}

/** "6 Stationen · 3 Std. 10 Min." – aus den Daten, nicht aus dem gespeicherten Satz. */
export function planSummary(t: Dictionary, plan: Plan): string {
  return `${t.plan.stops(stationCount(plan))} · ${duration(t, plan.totalDurationMin)}`;
}

export function reason(t: Dictionary, step: PlanStep): string {
  const key = step.reasonKey ?? legacyReasonKey(step.reason);
  if (key && key in t.reasons) return t.reasons[key as keyof Dictionary['reasons']];
  return step.reason;
}

export function noteText(t: Dictionary, note: PlanNote): string {
  const alt = note.key ? null : legacyNote(note.text);
  const key = note.key ?? alt?.key;
  const fn = key ? (t.notes as Record<string, (p: never) => string>)[key] : undefined;
  return fn ? fn((note.params ?? alt?.params ?? {}) as never) : note.text;
}

type ApiFehler = { error?: string; message?: string; params?: Record<string, string | number> };

/**
 * Fehler der Schnittstelle in der gewählten Sprache. Der Server liefert einen
 * Code; nur wenn er keinen kennt, bleibt dessen eigene Meldung stehen.
 */
export function errorText(t: Dictionary, antwort: ApiFehler | null | undefined, fallback?: string): string {
  const code = antwort?.error;
  const eintrag = code ? (t.errors as Record<string, string | ((...a: string[]) => string)>)[code] : undefined;
  if (typeof eintrag === 'string') return eintrag;
  if (typeof eintrag === 'function') {
    const p = antwort?.params ?? {};
    return eintrag(p.minutes !== undefined ? duration(t, Number(p.minutes)) : String(p.time ?? ''));
  }
  return fallback ?? antwort?.message ?? t.errors.failed;
}

/** Zuletzt geplant: Titel in der aktuellen Sprache, sonst der gemerkte Text. */
export function recentTitle(t: Dictionary, plan: RecentPlan): string {
  return planTitle(t, plan);
}

export function recentSummary(t: Dictionary, plan: RecentPlan): string {
  // Ältere Einträge: Die Zahl der Stationen steckt im gemerkten Satz.
  if (plan.stops === undefined || plan.durationMin === undefined) {
    const n = /^(\d+) Station/.exec(plan.summary);
    return n ? t.plan.stops(Number(n[1])) : plan.emojis.length ? t.plan.stops(plan.emojis.length) : plan.summary;
  }
  return `${t.plan.stops(plan.stops)} · ${duration(t, plan.durationMin)}`;
}

/* ------------------------------------------------------------------------ *
 * Altbestand: Pläne und Einträge von vor der Mehrsprachigkeit tragen nur
 * deutschen Text. Die Standardsätze lassen sich eindeutig ihren Schlüsseln
 * zuordnen – so erscheinen auch alte geteilte Links in der Sprache des
 * Betrachters. Was sich nicht zuordnen lässt, bleibt als Text stehen.
 * ------------------------------------------------------------------------ */

const DE_REASON_KEYS = new Map<string, keyof Dictionary['reasons']>(
  (Object.entries(deDict.reasons) as Array<[keyof Dictionary['reasons'], string]>).map(([k, v]) => [v, k]),
);

export function legacyReasonKey(text: string): keyof Dictionary['reasons'] | undefined {
  return DE_REASON_KEYS.get(text);
}

const DE_DAYPARTS: Record<string, string> = {
  Vormittag: 'morning',
  Mittag: 'midday',
  Nachmittag: 'afternoon',
  Abend: 'evening',
  Nacht: 'night',
};

/** "Berlin entdecken", "Euer Abend" → Schlüssel und Parameter. */
export function legacyTitle(title: string): { key: 'plan' | 'tour'; params: Record<string, string> } | null {
  if (title === 'Deine Umgebung entdecken') return { key: 'tour', params: { place: '' } };
  const tour = /^(.+) entdecken$/.exec(title);
  if (tour) return { key: 'tour', params: { place: tour[1] } };
  const plan = /^(Dein|Euer) (Vormittag|Mittag|Nachmittag|Abend|Nacht)$/.exec(title);
  if (plan) return { key: 'plan', params: { party: plan[1] === 'Dein' ? 'solo' : 'friends', dayPart: DE_DAYPARTS[plan[2]] } };
  return null;
}

export function legacyNote(text: string): { key: string; params: Record<string, string | number> } | null {
  for (const [key, fn] of Object.entries(deDict.notes) as Array<[string, (p: never) => string]>) {
    if (fn.length === 0 && fn({} as never) === text) return { key, params: {} };
  }
  const stunden = /^Für (einen|\d+) Punkte? sind keine Öffnungszeiten hinterlegt/.exec(text);
  if (stunden) return { key: 'unknownHours', params: { count: stunden[1] === 'einen' ? 1 : Number(stunden[1]) } };
  const spaet = /^Um diese Uhrzeit hat noch kaum etwas geöffnet – der Plan beginnt deshalb um (\d\d:\d\d) Uhr\.$/.exec(text);
  if (spaet) return { key: 'lateStart', params: { time: spaet[1] } };
  const regen = /^Anfangs regnet es – die Tour beginnt deshalb um (\d\d:\d\d)/.exec(text);
  if (regen) return { key: 'tourRainStart', params: { time: regen[1] } };
  return null;
}
