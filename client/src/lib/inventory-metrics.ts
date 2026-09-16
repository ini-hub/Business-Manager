/**
 * Projected gross margin = (retail value - cost value) / retail value, as a
 * percentage. Returns null (render as "n/a") when there's no retail value to
 * divide by, rather than a misleading "0.0%" — a zero-revenue store hasn't
 * measured a 0% margin, it has no margin to report yet.
 */
export function calculateProjectedGrossMargin(totalCostValue: number, totalRetailValue: number): number | null {
  if (totalRetailValue <= 0) return null;
  return ((totalRetailValue - totalCostValue) / totalRetailValue) * 100;
}

export function formatProjectedGrossMargin(totalCostValue: number, totalRetailValue: number): string {
  const margin = calculateProjectedGrossMargin(totalCostValue, totalRetailValue);
  return margin === null ? "n/a" : `${margin.toFixed(1)}%`;
}

/**
 * A variant's own reorderPoint overrides the store-wide lowStockThreshold when
 * set (null/undefined falls back) — same rule as AnalyticsRepository's
 * dashboard stock-alert bucketing, kept consistent across the app.
 */
export function effectiveReorderPoint(
  variant: { reorderPoint?: number | null },
  storeThreshold: number,
): number {
  return variant.reorderPoint != null ? variant.reorderPoint : storeThreshold;
}

export function isOutOfStock(variant: { quantity: number }): boolean {
  return variant.quantity === 0;
}

export function isAtOrBelowReorderPoint(
  variant: { quantity: number; reorderPoint?: number | null },
  storeThreshold: number,
): boolean {
  return variant.quantity <= effectiveReorderPoint(variant, storeThreshold);
}

/** Correct singular/plural for "{n} item(s) at or below their reorder level". */
export function formatStockAlertCopy(outOfStockCount: number, lowStockCount: number): string {
  const total = outOfStockCount + lowStockCount;
  const noun = total === 1 ? "item" : "items";
  const verb = total === 1 ? "is" : "are";
  return `${total} ${noun} ${verb} at or below their reorder level`;
}
