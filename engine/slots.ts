import type { Category, Mood } from '@/types/domain';
import { localHour, type DayPart } from '@/lib/time';
import type { PlanContext, Slot } from './types';

/** Welche Kategorien eine Stimmung als Hauptaktivität bedient. */
const MOOD_ROLES: Record<Mood, Category[]> = {
  date: ['culture', 'nature', 'cinema', 'activity', 'wellness'],
  action: ['activity', 'sport', 'gaming'],
  chill: ['cafe', 'nature', 'wellness', 'culture'],
  party: ['bar', 'activity', 'event'],
  food: ['food', 'cafe'],
  nature: ['nature', 'sport'],
  gaming: ['gaming', 'activity'],
  new: ['event', 'gaming', 'culture', 'activity'],
};

/** Fallback-Hauptaktivität je Tageszeit. */
const DAYPART_ROLES: Record<DayPart, Category[]> = {
  morning: ['cafe', 'nature', 'culture', 'sport'],
  midday: ['food', 'culture', 'nature', 'activity'],
  afternoon: ['activity', 'nature', 'culture', 'sport'],
  evening: ['activity', 'cinema', 'gaming', 'culture'],
  night: ['bar', 'gaming', 'activity'],
};

const WINDDOWN_BY_DAYPART: Record<DayPart, Category[]> = {
  morning: ['cafe', 'shopping'],
  midday: ['cafe', 'shopping'],
  afternoon: ['cafe', 'bar'],
  evening: ['bar', 'cafe'],
  night: ['bar', 'cafe'],
};

const EAT_ROLES: Category[] = ['food'];

function mainRoles(ctx: PlanContext): Category[] {
  const { request } = ctx;
  if (request.focusCategory) {
    return dedupe([request.focusCategory, ...DAYPART_ROLES[ctx.dayPart]]);
  }
  const fromMoods = request.moods
    .filter((m) => m !== 'food')
    .flatMap((m) => MOOD_ROLES[m] ?? []);
  if (fromMoods.length > 0) return dedupe([...fromMoods, ...DAYPART_ROLES[ctx.dayPart]]);
  return DAYPART_ROLES[ctx.dayPart];
}

function winddownRoles(ctx: PlanContext): Category[] {
  const base = WINDDOWN_BY_DAYPART[ctx.dayPart];
  // Bars fallen weg, wenn Kinder dabei sind oder der Nutzer zu jung ist.
  if (ctx.request.party === 'family') return dedupe(['cafe', ...base.filter((c) => c !== 'bar')]);
  if (ctx.request.age !== undefined && ctx.request.age < 18) {
    return dedupe(['cafe', ...base.filter((c) => c !== 'bar')]);
  }
  return base;
}

function dedupe<T>(list: T[]): T[] {
  return Array.from(new Set(list));
}

/** Wird zu dieser Tageszeit typischerweise gegessen? */
function wantsMeal(ctx: PlanContext): boolean {
  if (ctx.request.moods.includes('food')) return true;
  if (ctx.request.focusCategory === 'food') return true;
  const hour = Math.floor(localHour(ctx.start, ctx.tzOffsetMin));
  const meal = (hour >= 11 && hour <= 14) || (hour >= 17 && hour <= 21);
  return meal && ctx.request.availableMinutes >= 120;
}

/**
 * Baut die Slot-Struktur des Plans. Die Anzahl der Slots ergibt sich aus
 * dem Zeitbudget, die Reihenfolge aus der Tageszeit.
 */
export function buildSlots(ctx: PlanContext): Slot[] {
  const minutes = ctx.request.availableMinutes;
  const main = mainRoles(ctx);
  const wind = winddownRoles(ctx);
  const meal = wantsMeal(ctx);

  if (ctx.request.singleActivity || minutes <= 100) {
    return [
      {
        roles: ctx.request.focusCategory ? [ctx.request.focusCategory, ...main] : main,
        targetMinutes: Math.min(minutes - 15, 90),
        optional: false,
        label: 'main',
      },
    ];
  }

  const slotCount = minutes <= 170 ? 2 : minutes <= 330 ? 3 : 4;
  const slots: Slot[] = [];
  const budgetPerSlot = Math.floor((minutes - slotCount * 15) / slotCount);

  const mealSlot: Slot = {
    roles: EAT_ROLES,
    targetMinutes: Math.min(budgetPerSlot, 90),
    optional: false,
    label: 'food',
  };
  const mainSlot: Slot = {
    roles: main,
    targetMinutes: budgetPerSlot,
    optional: false,
    label: 'main',
  };
  const windSlot: Slot = {
    roles: wind,
    targetMinutes: Math.min(budgetPerSlot, 60),
    optional: true,
    label: 'winddown',
  };
  const secondSlot: Slot = {
    roles: dedupe([...main.slice(1), ...DAYPART_ROLES[ctx.dayPart]]),
    targetMinutes: budgetPerSlot,
    optional: true,
    label: 'secondary',
  };

  if (slotCount === 2) {
    if (meal) slots.push(mealSlot, mainSlot);
    else slots.push(mainSlot, windSlot);
  } else if (slotCount === 3) {
    if (ctx.dayPart === 'morning') slots.push(windSlot, mainSlot, mealSlot);
    else if (meal) slots.push(mealSlot, mainSlot, windSlot);
    else slots.push(mainSlot, secondSlot, windSlot);
  } else {
    if (meal) slots.push(mealSlot, mainSlot, secondSlot, windSlot);
    else slots.push(mainSlot, secondSlot, mealSlot, windSlot);
  }

  // Der letzte Slot darf entfallen, wenn die Zeit nicht reicht.
  slots[slots.length - 1].optional = true;
  return slots;
}
