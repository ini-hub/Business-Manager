// Money from stores in different currencies must never be added together. These helpers
// group per-store figures by currency so "All stores" views show one subtotal per currency.

export type CurrencyTotals<K extends string> = { currency: string } & Record<K, number>;

/** Sums the named numeric fields of `rows` per currency. Order follows first appearance. */
export function sumByCurrency<T extends { currency: string }, K extends keyof T & string>(
  rows: readonly T[],
  fields: readonly K[],
): CurrencyTotals<K>[] {
  const groups = new Map<string, CurrencyTotals<K>>();
  for (const row of rows) {
    let group = groups.get(row.currency);
    if (!group) {
      group = { currency: row.currency } as CurrencyTotals<K>;
      for (const f of fields) (group as Record<string, unknown>)[f] = 0;
      groups.set(row.currency, group);
    }
    for (const f of fields) {
      (group as Record<string, number>)[f] += Number(row[f] ?? 0);
    }
  }
  return Array.from(groups.values());
}

export function distinctCurrencies(stores: readonly { currency: string }[]): string[] {
  return Array.from(new Set(stores.map((s) => s.currency)));
}

export function isMixedCurrency(stores: readonly { currency: string }[]): boolean {
  return distinctCurrencies(stores).length > 1;
}
