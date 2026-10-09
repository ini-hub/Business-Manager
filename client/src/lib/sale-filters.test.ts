import { describe, it, expect } from "vitest";
import {
  EMPTY_SALE_FILTERS,
  buildSaleFilterChips,
  clearSaleFilterChip,
  countActiveSaleFilters,
  saleMatchesFilters,
} from "./sale-filters";

const sale = (o: Record<string, unknown>) =>
  ({ id: "1", amount: 100, paymentMethod: "cash", staffId: "s1", inventoryType: "product", paymentStatus: "paid", isReturned: false, isStaffPurchase: false, ...o }) as any;

describe("sale type filters (returns, credit, staff purchases)", () => {
  it("match only their own sales", () => {
    expect(saleMatchesFilters(sale({ isReturned: true }), { ...EMPTY_SALE_FILTERS, returnsOnly: true })).toBe(true);
    expect(saleMatchesFilters(sale({}), { ...EMPTY_SALE_FILTERS, returnsOnly: true })).toBe(false);
    expect(saleMatchesFilters(sale({ paymentStatus: "pending" }), { ...EMPTY_SALE_FILTERS, creditOnly: true })).toBe(true);
    expect(saleMatchesFilters(sale({}), { ...EMPTY_SALE_FILTERS, creditOnly: true })).toBe(false);
    expect(saleMatchesFilters(sale({ isStaffPurchase: true }), { ...EMPTY_SALE_FILTERS, staffPurchasesOnly: true })).toBe(true);
    expect(saleMatchesFilters(sale({}), { ...EMPTY_SALE_FILTERS, staffPurchasesOnly: true })).toBe(false);
  });
  it("count as active filters and show removable chips", () => {
    const f = { ...EMPTY_SALE_FILTERS, returnsOnly: true, creditOnly: true, staffPurchasesOnly: true };
    expect(countActiveSaleFilters(f)).toBe(3);
    const chips = buildSaleFilterChips(f, "₦", () => "x");
    expect(chips.map((c) => c.label)).toEqual(["Returns", "Credit", "Staff purchases"]);
    expect(clearSaleFilterChip(f, "creditOnly").creditOnly).toBe(false);
    expect(clearSaleFilterChip(f, "returnsOnly").returnsOnly).toBe(false);
    expect(clearSaleFilterChip(f, "staffPurchasesOnly").staffPurchasesOnly).toBe(false);
  });
});

describe("paid-into-account filter", () => {
  const paid = sale({ paymentAccountIds: ["a1", "a2"] });
  it("matches a sale with any leg on the account", () => {
    expect(saleMatchesFilters(paid, { ...EMPTY_SALE_FILTERS, paymentAccountId: "a2" })).toBe(true);
    expect(saleMatchesFilters(paid, { ...EMPTY_SALE_FILTERS, paymentAccountId: "a3" })).toBe(false);
    expect(saleMatchesFilters(sale({}), { ...EMPTY_SALE_FILTERS, paymentAccountId: "a1" })).toBe(false);
  });
  it("counts, chips and clears like the other filters", () => {
    const f = { ...EMPTY_SALE_FILTERS, paymentAccountId: "a1" };
    expect(countActiveSaleFilters(f)).toBe(1);
    expect(buildSaleFilterChips(f, "₦", () => "", () => "GTBank")).toEqual([{ key: "paymentAccountId", label: "GTBank" }]);
    expect(clearSaleFilterChip(f, "paymentAccountId").paymentAccountId).toBeNull();
  });
});
