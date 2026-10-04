import { describe, it, expect } from "vitest";
import {
  EMPTY_ADVANCE_FILTERS, advanceMatchesFilters, advanceMatchesSearch, advanceStatusKey, sortAdvances,
  countActiveAdvanceFilters, type FilterableAdvance,
} from "./advance-filters";

const row = (o: Partial<FilterableAdvance> = {}): FilterableAdvance => ({
  staffName: "Ada", staffNumber: "S1", staffMobile: "0801", notes: "rent", date: "2026-09-10", amount: 5000, status: "pending", ...o,
});

describe("advance filters", () => {
  it("derives status like the badge", () => {
    expect(advanceStatusKey(row({ isRecovered: true, status: "approved" }))).toBe("recovered");
    expect(advanceStatusKey(row({ status: "approved", recoveryStatus: "partial" }))).toBe("partial");
    expect(advanceStatusKey(row({ status: "rejected" }))).toBe("rejected");
    expect(advanceStatusKey(row())).toBe("pending");
  });
  it("filters by status, amount and date", () => {
    expect(advanceMatchesFilters(row(), { ...EMPTY_ADVANCE_FILTERS, statuses: ["approved"] })).toBe(false);
    expect(advanceMatchesFilters(row(), { ...EMPTY_ADVANCE_FILTERS, amountMin: 6000 })).toBe(false);
    expect(advanceMatchesFilters(row(), { ...EMPTY_ADVANCE_FILTERS, dateFrom: "2026-09-01", dateTo: "2026-09-30" })).toBe(true);
    expect(countActiveAdvanceFilters({ ...EMPTY_ADVANCE_FILTERS, statuses: ["pending"], amountMax: 1 })).toBe(2);
  });
  it("searches and sorts", () => {
    expect(advanceMatchesSearch(row(), "080")).toBe(true);
    expect(advanceMatchesSearch(row(), "zzz")).toBe(false);
    const sorted = sortAdvances([row({ amount: 1 }), row({ amount: 9 })], { key: "amountHigh" });
    expect(Number(sorted[0].amount)).toBe(9);
  });
});
