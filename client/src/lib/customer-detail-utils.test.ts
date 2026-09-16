import { describe, it, expect } from "vitest";
import { getCustomerInitials, formatRelativeDate, dayGroupLabel, groupByDay, deriveTransactionStatus } from "./customer-detail-utils";

describe("getCustomerInitials", () => {
  it("takes the first letter of the first two words", () => {
    expect(getCustomerInitials("Excellent Bolujo")).toBe("EB");
  });
  it("handles a single word", () => {
    expect(getCustomerInitials("Laura")).toBe("L");
  });
  it("handles empty/whitespace input", () => {
    expect(getCustomerInitials("   ")).toBe("?");
  });
});

describe("formatRelativeDate", () => {
  it("returns null for no date", () => {
    expect(formatRelativeDate(null)).toBeNull();
  });
  it("returns Today for a date in the last 24h", () => {
    expect(formatRelativeDate(new Date())).toBe("Today");
  });
});

describe("dayGroupLabel", () => {
  // Local-time constructors (not UTC ISO strings) so the test isn't sensitive
  // to the runner's timezone relative to a UTC day boundary.
  const NOW = new Date(2026, 8, 16, 12, 0, 0);
  it("labels the same calendar day as Today", () => {
    expect(dayGroupLabel(new Date(2026, 8, 16, 2, 0, 0), NOW)).toBe("Today");
  });
  it("labels the previous calendar day as Yesterday", () => {
    expect(dayGroupLabel(new Date(2026, 8, 15, 23, 0, 0), NOW)).toBe("Yesterday");
  });
  it("labels older dates with month/day", () => {
    expect(dayGroupLabel(new Date(2026, 8, 1, 0, 0, 0), NOW)).toBe("Sep 1");
  });
});

describe("groupByDay", () => {
  it("buckets items by day, most recent first, preserving item order within a day", () => {
    const now = new Date(2026, 8, 16, 12, 0, 0);
    const items = [
      { id: 1, date: new Date(2026, 8, 14, 0, 0, 0) },
      { id: 2, date: new Date(2026, 8, 16, 8, 0, 0) },
      { id: 3, date: new Date(2026, 8, 16, 9, 0, 0) },
    ];
    const groups = groupByDay(items, (i) => i.date, now);
    expect(groups.map((g) => g.label)).toEqual(["Today", "Sep 14"]);
    expect(groups[0].items.map((i) => i.id)).toEqual([3, 2]);
    expect(groups[1].items.map((i) => i.id)).toEqual([1]);
  });
});

describe("deriveTransactionStatus", () => {
  it("prefers the linked credit entry's status over checkout status", () => {
    const entries = [{ transactionId: "tx1", status: "partial" }];
    expect(deriveTransactionStatus("tx1", "completed", entries)).toEqual({ label: "Part paid", tone: "warning" });
  });
  it("falls back to checkout payment status when no credit entry is linked", () => {
    expect(deriveTransactionStatus("tx2", "completed", [])).toEqual({ label: "Paid", tone: "success" });
    expect(deriveTransactionStatus("tx2", "pending", [])).toEqual({ label: "Pending", tone: "warning" });
  });
});
