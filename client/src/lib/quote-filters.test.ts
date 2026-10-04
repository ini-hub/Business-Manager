import { describe, it, expect } from "vitest";
import {
  EMPTY_QUOTE_FILTERS,
  buildQuoteFilterChips,
  clearQuoteFilterChip,
  countActiveQuoteFilters,
  quoteMatchesFilters,
  quoteMatchesSearch,
  sortQuotes,
} from "./quote-filters";

const now = new Date("2026-10-01T00:00:00Z");
const q = (quoteRef: string, status: string, totalPrice: number, createdAt: string, validUntil: string | null, o: Record<string, unknown> = {}) =>
  ({ quoteRef, status, totalPrice, createdAt, validUntil, ...o });
const rows = [
  q("QT-1", "draft", 1000, "2026-09-28T00:00:00Z", "2026-10-05T00:00:00Z"),
  q("QT-2", "SENT", 50000, "2026-08-20T00:00:00Z", "2026-09-10T00:00:00Z", { customer: { name: "Ada" } }),
  q("QT-3", "accepted", 9000, "2026-05-01T00:00:00Z", null),
];
const refs = (f: Parameters<typeof quoteMatchesFilters>[1]) => rows.filter((r) => quoteMatchesFilters(r, f, now)).map((r) => r.quoteRef);

describe("quote filters", () => {
  it("matches all when empty", () => expect(refs(EMPTY_QUOTE_FILTERS)).toHaveLength(3));
  it("filters by status case-insensitively", () => {
    expect(refs({ ...EMPTY_QUOTE_FILTERS, status: "sent" })).toEqual(["QT-2"]);
    expect(refs({ ...EMPTY_QUOTE_FILTERS, status: "draft" })).toEqual(["QT-1"]);
  });
  it("filters by created window and expiry", () => {
    expect(refs({ ...EMPTY_QUOTE_FILTERS, created: "7d" })).toEqual(["QT-1"]);
    expect(refs({ ...EMPTY_QUOTE_FILTERS, created: "90d" })).toEqual(["QT-1", "QT-2"]);
    expect(refs({ ...EMPTY_QUOTE_FILTERS, expiry: "expired" })).toEqual(["QT-2"]);
    expect(refs({ ...EMPTY_QUOTE_FILTERS, expiry: "week" })).toEqual(["QT-1"]);
    expect(refs({ ...EMPTY_QUOTE_FILTERS, expiry: "none" })).toEqual(["QT-3"]);
  });
  it("filters by value range", () => {
    expect(refs({ ...EMPTY_QUOTE_FILTERS, valueMin: 5000, valueMax: 20000 })).toEqual(["QT-3"]);
  });
  it("searches ref and customer", () => {
    expect(rows.filter((r) => quoteMatchesSearch(r, "ada")).length).toBe(1);
    expect(rows.filter((r) => quoteMatchesSearch(r, "qt-")).length).toBe(3);
  });
  it("counts, builds and clears chips", () => {
    const f = { ...EMPTY_QUOTE_FILTERS, status: "sent" as const, valueMin: 100 };
    expect(countActiveQuoteFilters(f)).toBe(2);
    expect(buildQuoteFilterChips(f, "₦").map((c) => c.label)).toEqual(["Sent", "₦100 or more"]);
    expect(clearQuoteFilterChip(f, "value").valueMin).toBeNull();
  });
  it("sorts, no-expiry last", () => {
    expect(sortQuotes(rows, { key: "newest" })[0].quoteRef).toBe("QT-1");
    expect(sortQuotes(rows, { key: "valueHigh" })[0].quoteRef).toBe("QT-2");
    expect(sortQuotes(rows, { key: "expiring" }).map((r) => r.quoteRef)).toEqual(["QT-2", "QT-1", "QT-3"]);
  });
});
