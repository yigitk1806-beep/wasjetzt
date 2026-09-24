import type { BudgetPreset, PlanCost, PriceInfo, PriceLevel } from '@/types/domain';

/** Welches Preisniveau ein Budgetwunsch höchstens zulässt. */
export const BUDGET_MAX_LEVEL: Record<BudgetPreset, PriceLevel> = {
  free: 0,
  low: 1,
  medium: 2,
  high: 3,
  any: 3,
};

/**
 * Fasst die Preise eines Plans zusammen.
 *
 * Ein Eurobetrag wird nur ausgewiesen, wenn **jeder** Schritt einen echten
 * Preis mitbringt. Sobald auch nur einer geschätzt ist, gibt es ausschließlich
 * das Niveau – sonst entstünde aus Schätzungen eine Scheingenauigkeit.
 */
export function aggregateCost(prices: PriceInfo[], groupSize = 1): PlanCost {
  if (prices.length === 0) {
    return { level: 0, levelEstimated: false, groupSize };
  }

  const level = Math.max(...prices.map((p) => p.level)) as PriceLevel;
  const levelEstimated = prices.some((p) => p.levelEstimated);

  const allHaveAmounts = prices.every((p) => p.perPerson !== undefined);
  if (!allHaveAmounts) return { level, levelEstimated, groupSize };

  const perPerson = prices.reduce(
    (acc, p) => ({
      min: acc.min + (p.perPerson?.min ?? 0),
      max: acc.max + (p.perPerson?.max ?? 0),
    }),
    { min: 0, max: 0 },
  );

  // Gesamtsumme nur dort, wo jeder Einzelpreis echt ist – aus Schätzungen
  // entstünde sonst eine Zahl, die nach Gewissheit aussieht.
  const total = { min: perPerson.min * groupSize, max: perPerson.max * groupSize };

  return { level, levelEstimated, perPerson, total, groupSize };
}
