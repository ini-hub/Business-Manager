// One-currency-per-business guard. Until "All stores" totals are grouped per currency everywhere
// (see shared/currency-groups.ts), stores are kept in a single currency so no new mixed totals appear.

export interface StoreCurrencyRow {
  id: string;
  currency: string;
  isActive: boolean;
  isMain: boolean;
}

/**
 * The currency the business's active stores already use, or null when there are none.
 * The main store wins; otherwise the first active store.
 */
export function businessCurrency(stores: readonly StoreCurrencyRow[], excludeStoreId?: string): string | null {
  const active = stores.filter((s) => s.isActive && s.id !== excludeStoreId);
  if (active.length === 0) return null;
  return (active.find((s) => s.isMain) ?? active[0]).currency;
}

/**
 * Returns the business's existing currency when `candidate` differs from it, else null.
 * A business that is already mixed may still move a store onto a currency another active store uses.
 */
export function findCurrencyConflict(
  stores: readonly StoreCurrencyRow[],
  candidate: string,
  excludeStoreId?: string,
): string | null {
  const others = stores.filter((s) => s.isActive && s.id !== excludeStoreId);
  if (others.length === 0) return null;
  if (others.some((s) => s.currency === candidate)) return null;
  return businessCurrency(stores, excludeStoreId);
}

export function currencyConflictMessage(existing: string, candidate: string): string {
  return `All stores in a business must use the same currency for now. Your stores use ${existing}; this one was set to ${candidate}.`;
}
