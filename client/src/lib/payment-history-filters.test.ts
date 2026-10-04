import { describe, it, expect } from "vitest";
import {
  EMPTY_PAYMENT_FILTERS,
  buildPaymentFilterChips,
  clearPaymentFilterChip,
  countActivePaymentFilters,
  paymentMatchesFilters,
  sortPayments,
  type FilterablePayment,
} from "./payment-history-filters";

const pay = (over: Partial<FilterablePayment> = {}): FilterablePayment => ({
  status: "success", kind: "renewal", billingCycle: "monthly", amount: 20000, reference: "REF1",
  createdAt: new Date(2026, 5, 15, 12, 0), ...over,
});

describe("payment history filters", () => {
  it("matches everything when empty", () => {
    expect(paymentMatchesFilters(pay(), EMPTY_PAYMENT_FILTERS)).toBe(true);
  });

  it("narrows by status, type and amount band", () => {
    expect(paymentMatchesFilters(pay(), { ...EMPTY_PAYMENT_FILTERS, status: "failed" })).toBe(false);
    expect(paymentMatchesFilters(pay(), { ...EMPTY_PAYMENT_FILTERS, kind: "initial" })).toBe(false);
  });

  it("applies custom amount bounds inclusively, with either end open", () => {
    const between = { ...EMPTY_PAYMENT_FILTERS, amountMin: 15_000, amountMax: 25_000 };
    expect(paymentMatchesFilters(pay({ amount: "20000" }), between)).toBe(true);
    expect(paymentMatchesFilters(pay({ amount: 15_000 }), between)).toBe(true);
    expect(paymentMatchesFilters(pay({ amount: 25_001 }), between)).toBe(false);
    expect(paymentMatchesFilters(pay({ amount: 60_000 }), { ...EMPTY_PAYMENT_FILTERS, amountMin: 50_000 })).toBe(true);
    expect(paymentMatchesFilters(pay({ amount: 5 }), { ...EMPTY_PAYMENT_FILTERS, amountMax: 4 })).toBe(false);
  });

  it("labels presets and custom ranges, and clears them as one chip", () => {
    const preset = { ...EMPTY_PAYMENT_FILTERS, amountMin: 10_000, amountMax: 50_000 };
    expect(buildPaymentFilterChips(preset)[0]).toEqual({ key: "amountRange", label: "₦10,000 to ₦50,000" });
    expect(buildPaymentFilterChips({ ...EMPTY_PAYMENT_FILTERS, amountMin: 123 })[0].label).toBe("₦123 and above");
    expect(countActivePaymentFilters(preset)).toBe(1);
    expect(clearPaymentFilterChip(preset, "amountRange")).toMatchObject({ amountMin: null, amountMax: null });
  });

  it("treats a custom date range as inclusive of both end days", () => {
    const f = { ...EMPTY_PAYMENT_FILTERS, dateFrom: "2026-06-15", dateTo: "2026-06-15" };
    expect(paymentMatchesFilters(pay(), f)).toBe(true);
    expect(paymentMatchesFilters(pay({ createdAt: new Date(2026, 5, 16, 0, 1) }), f)).toBe(false);
    expect(paymentMatchesFilters(pay({ createdAt: new Date(2026, 5, 14, 23, 59) }), f)).toBe(false);
  });

  it("counts a date range as one filter and clears it as one chip", () => {
    const f = { ...EMPTY_PAYMENT_FILTERS, status: "pending" as const, dateFrom: "2026-06-01", dateTo: "2026-06-30" };
    expect(countActivePaymentFilters(f)).toBe(2);
    expect(buildPaymentFilterChips(f).map((c) => c.key)).toEqual(["status", "dateRange"]);
    expect(clearPaymentFilterChip(f, "dateRange")).toMatchObject({ dateFrom: null, dateTo: null, status: "pending" });
  });

  it("sorts by amount without mutating the input", () => {
    const rows = [pay({ amount: 5 }), pay({ amount: 50 }), pay({ amount: 20 })];
    expect(sortPayments(rows, { key: "high" }).map((r) => r.amount)).toEqual([50, 20, 5]);
    expect(rows.map((r) => r.amount)).toEqual([5, 50, 20]);
  });
});
