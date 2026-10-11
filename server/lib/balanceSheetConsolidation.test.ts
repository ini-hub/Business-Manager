import { describe, it, expect } from "vitest";
import { consolidateBalanceSheets, type StoreBalanceSheet } from "./balanceSheetConsolidation";

const sheet = (over: Partial<StoreBalanceSheet>): StoreBalanceSheet => ({
  storeId: "s", storeName: "S", currency: "NGN",
  totalAssets: 0, totalLiabilities: 0, totalCapitalInvested: 0, totalWithdrawals: 0,
  cumulativeNetProfit: 0, retainedEarnings: 0, totalEquity: 0, netWorth: 0, roi: null, assetsByCategory: [],
  ...over,
});

describe("consolidateBalanceSheets", () => {
  it("sums stores that share a currency and recomputes ROI from the totals", () => {
    const out = consolidateBalanceSheets([
      sheet({ storeId: "a", totalAssets: 100, totalLiabilities: 20, totalCapitalInvested: 50, retainedEarnings: 10, netWorth: 80, assetsByCategory: [{ category: "equipment", total: 100 }] }),
      sheet({ storeId: "b", totalAssets: 60, totalLiabilities: 10, totalCapitalInvested: 50, retainedEarnings: 30, netWorth: 50, assetsByCategory: [{ category: "equipment", total: 40 }, { category: "vehicle", total: 20 }] }),
    ]);
    expect(out.currencies).toHaveLength(1);
    const ngn = out.currencies[0];
    expect(ngn).toMatchObject({ currency: "NGN", storeCount: 2, totalAssets: 160, totalLiabilities: 30, netWorth: 130 });
    expect(ngn.roi).toBeCloseTo(0.4);
    expect(ngn.assetsByCategory).toEqual([{ category: "equipment", total: 140 }, { category: "vehicle", total: 20 }]);
  });

  it("keeps different currencies apart", () => {
    const out = consolidateBalanceSheets([
      sheet({ storeId: "a", currency: "NGN", totalAssets: 1000 }),
      sheet({ storeId: "b", currency: "GHS", totalAssets: 7 }),
    ]);
    expect(out.currencies.map((c) => [c.currency, c.totalAssets])).toEqual([["NGN", 1000], ["GHS", 7]]);
  });

  it("returns null ROI when no capital was invested and handles no stores", () => {
    expect(consolidateBalanceSheets([sheet({ retainedEarnings: 5 })]).currencies[0].roi).toBeNull();
    expect(consolidateBalanceSheets([]).currencies).toEqual([]);
  });
});
