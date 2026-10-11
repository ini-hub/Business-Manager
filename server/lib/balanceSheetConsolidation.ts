import { sumByCurrency } from "@shared/currency-groups";
import type { BalanceSheet } from "../services/AccountingService";

export interface StoreBalanceSheet extends BalanceSheet {
  storeId: string;
  storeName: string;
  currency: string;
}

export interface CurrencyBalanceSheet extends Omit<BalanceSheet, "assetsByCategory"> {
  currency: string;
  storeCount: number;
  assetsByCategory: { category: string; total: number }[];
}

export interface ConsolidatedBalanceSheet {
  consolidated: true;
  currencies: CurrencyBalanceSheet[];
  stores: StoreBalanceSheet[];
}

const MONEY_FIELDS = [
  "totalAssets",
  "totalLiabilities",
  "totalCapitalInvested",
  "totalWithdrawals",
  "cumulativeNetProfit",
  "retainedEarnings",
  "totalEquity",
  "netWorth",
] as const;

/**
 * Combines per-store balance sheets. Stores are only ever added together within one
 * currency, so a business with stores in two currencies gets two totals, never a mixed one.
 */
export function consolidateBalanceSheets(stores: readonly StoreBalanceSheet[]): ConsolidatedBalanceSheet {
  const totals = sumByCurrency(stores, MONEY_FIELDS);
  const currencies = totals.map((t): CurrencyBalanceSheet => {
    const inGroup = stores.filter((s) => s.currency === t.currency);
    const categories = new Map<string, number>();
    for (const s of inGroup) {
      for (const c of s.assetsByCategory) {
        categories.set(c.category, (categories.get(c.category) ?? 0) + c.total);
      }
    }
    return {
      ...t,
      storeCount: inGroup.length,
      roi: t.totalCapitalInvested > 0 ? t.retainedEarnings / t.totalCapitalInvested : null,
      assetsByCategory: Array.from(categories, ([category, total]) => ({ category, total })),
    };
  });
  return { consolidated: true, currencies, stores: [...stores] };
}
