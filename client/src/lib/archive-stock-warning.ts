interface StockedRow {
  type?: string | null;
  quantity?: number | string | null;
  costPrice?: number | string | null;
}

/**
 * Sentence for the archive confirmation when the item still has stock on hand, or null when there is nothing
 * to warn about. Archiving does not touch the stock; it only hides the item, so the wording says that.
 * Services are stockless and never warn.
 */
export function stockSummary(rows: StockedRow[]): { units: number; cost: number } {
  let units = 0;
  let cost = 0;
  for (const r of rows) {
    if (r.type === "service") continue;
    const qty = Number(r.quantity ?? 0);
    if (!(qty > 0)) continue;
    units += qty;
    cost += qty * Number(r.costPrice ?? 0);
  }
  return { units, cost };
}

export function archiveStockWarning(rows: StockedRow[], formatCurrency: (value: number) => string): string | null {
  const { units, cost } = stockSummary(rows);
  if (units <= 0) return null;
  const unitText = `${Number.isInteger(units) ? units : units.toFixed(2)} unit${units === 1 ? "" : "s"}`;
  const value = cost > 0 ? ` (${formatCurrency(cost)} at cost)` : "";
  return `It still has ${unitText}${value} in stock. Archived items are hidden from sales and stock lists, and the stock stays recorded until you restore or write it off.`;
}
