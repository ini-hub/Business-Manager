import { describe, it, expect } from "vitest";
import {
  EMPTY_PO_FILTERS, buildPoFilterChips, clearPoFilterChip, countActivePoFilters, daysLate,
  poMatchesFilters, poMatchesSearch, sortPos, type PoLike,
} from "./po-filters";

const TODAY = "2026-10-03";
const po = (over: Partial<PoLike>): PoLike => ({
  id: "1", poNumber: "PO-A-1", status: "ordered", vendorId: "v1", totalAmount: 100,
  expectedDelivery: "2026-10-03T00:00:00.000Z", createdAt: "2026-10-01T00:00:00.000Z", supplierRef: null,
  vendor: { name: "Acme" }, ...over,
});

describe("daysLate", () => {
  it("is 0 on the due day, positive when late, negative when ahead", () => {
    expect(daysLate(po({}), TODAY)).toBe(0);
    expect(daysLate(po({ expectedDelivery: "2026-10-01T00:00:00.000Z" }), TODAY)).toBe(2);
    expect(daysLate(po({ expectedDelivery: "2026-10-05T00:00:00.000Z" }), TODAY)).toBe(-2);
  });
  it("ignores received, draft and undated orders", () => {
    expect(daysLate(po({ status: "received" }), TODAY)).toBeNull();
    expect(daysLate(po({ status: "draft" }), TODAY)).toBeNull();
    expect(daysLate(po({ expectedDelivery: null }), TODAY)).toBeNull();
  });
});

describe("poMatchesSearch", () => {
  it("matches PO number, supplier ref and vendor name, case-insensitively", () => {
    expect(poMatchesSearch(po({}), "po-a")).toBe(true);
    expect(poMatchesSearch(po({ supplierRef: "INV-77" }), "inv-77")).toBe(true);
    expect(poMatchesSearch(po({}), "acme")).toBe(true);
    expect(poMatchesSearch(po({}), "zzz")).toBe(false);
    expect(poMatchesSearch(po({}), "  ")).toBe(true);
  });
});

describe("poMatchesFilters", () => {
  it("filters by vendor and total range", () => {
    expect(poMatchesFilters(po({}), { ...EMPTY_PO_FILTERS, vendorIds: ["v2"] }, TODAY)).toBe(false);
    expect(poMatchesFilters(po({}), { ...EMPTY_PO_FILTERS, totalMin: 50, totalMax: 150 }, TODAY)).toBe(true);
    expect(poMatchesFilters(po({}), { ...EMPTY_PO_FILTERS, totalMin: 101 }, TODAY)).toBe(false);
  });
  it("handles the expected-date presets", () => {
    const late = po({ expectedDelivery: "2026-10-01T00:00:00.000Z" });
    const soon = po({ expectedDelivery: "2026-10-08T00:00:00.000Z" });
    const far = po({ expectedDelivery: "2026-10-20T00:00:00.000Z" });
    const none = po({ expectedDelivery: null });
    const f = (expected: any) => ({ ...EMPTY_PO_FILTERS, expected });
    expect(poMatchesFilters(late, f("overdue"), TODAY)).toBe(true);
    expect(poMatchesFilters(po({}), f("overdue"), TODAY)).toBe(false);
    expect(poMatchesFilters(po({}), f("today"), TODAY)).toBe(true);
    expect(poMatchesFilters(soon, f("week"), TODAY)).toBe(true);
    expect(poMatchesFilters(far, f("week"), TODAY)).toBe(false);
    expect(poMatchesFilters(none, f("none"), TODAY)).toBe(true);
    expect(poMatchesFilters(late, f("none"), TODAY)).toBe(false);
  });
  it("does not call a received order overdue", () => {
    expect(poMatchesFilters(po({ status: "received", expectedDelivery: "2026-10-01T00:00:00.000Z" }), { ...EMPTY_PO_FILTERS, expected: "overdue" }, TODAY)).toBe(false);
  });
});

describe("sortPos", () => {
  const a = po({ id: "a", poNumber: "PO-A-2", totalAmount: 5, createdAt: "2026-10-01T00:00:00Z", expectedDelivery: null });
  const b = po({ id: "b", poNumber: "PO-A-10", totalAmount: 50, createdAt: "2026-10-02T00:00:00Z", expectedDelivery: "2026-10-09T00:00:00Z" });
  const c = po({ id: "c", poNumber: "PO-A-1", totalAmount: 20, createdAt: "2026-09-30T00:00:00Z", expectedDelivery: "2026-10-04T00:00:00Z" });
  const ids = (l: PoLike[]) => l.map((x) => x.id).join("");
  it("sorts newest first by default", () => expect(ids(sortPos([a, b, c], null))).toBe("bac"));
  it("puts undated orders last when sorting by expected date", () => expect(ids(sortPos([a, b, c], "expected"))).toBe("cba"));
  it("sorts by total", () => {
    expect(ids(sortPos([a, b, c], "totalDesc"))).toBe("bca");
    expect(ids(sortPos([a, b, c], "totalAsc"))).toBe("acb");
  });
  it("sorts PO numbers numerically", () => expect(ids(sortPos([a, b, c], "number"))).toBe("cab"));
  it("does not mutate its input", () => {
    const list = [a, b, c];
    sortPos(list, "totalDesc");
    expect(ids(list)).toBe("abc");
  });
});

describe("custom expected range", () => {
  it("matches only dated orders inside the window", () => {
    const f = { ...EMPTY_PO_FILTERS, expectedRange: { from: "2026-10-02", to: "2026-10-05" } };
    expect(poMatchesFilters(po({ expectedDelivery: "2026-10-03T00:00:00.000Z" }), f, TODAY)).toBe(true);
    expect(poMatchesFilters(po({ expectedDelivery: "2026-10-06T00:00:00.000Z" }), f, TODAY)).toBe(false);
    expect(poMatchesFilters(po({ expectedDelivery: null }), f, TODAY)).toBe(false);
  });
});

describe("status filter", () => {
  it("awaiting covers ordered and partially received", () => {
    const f = { ...EMPTY_PO_FILTERS, status: "awaiting" as const };
    expect(poMatchesFilters(po({ status: "ordered" }), f, TODAY)).toBe(true);
    expect(poMatchesFilters(po({ status: "partially_received" }), f, TODAY)).toBe(true);
    expect(poMatchesFilters(po({ status: "received" }), f, TODAY)).toBe(false);
  });
  it("matches other statuses exactly and counts as a filter", () => {
    const f = { ...EMPTY_PO_FILTERS, status: "draft" as const };
    expect(poMatchesFilters(po({ status: "draft" }), f, TODAY)).toBe(true);
    expect(poMatchesFilters(po({ status: "ordered" }), f, TODAY)).toBe(false);
    expect(countActivePoFilters(f)).toBe(1);
    expect(buildPoFilterChips(f, (id) => id, "₦").map((c) => c.label)).toEqual(["Draft"]);
    expect(clearPoFilterChip(f, "status").status).toBeNull();
  });
});

describe("filter chips", () => {
  it("counts a group as one active filter and clears it", () => {
    const f = { vendorIds: ["v1", "v2"], expected: "today" as const, expectedRange: null, totalMin: 10, totalMax: null };
    expect(countActivePoFilters(f)).toBe(3);
    const chips = buildPoFilterChips(f, (id) => id, "₦");
    expect(chips.map((c) => c.label)).toEqual(["Vendor: 2 selected", "Expected arrival: Due today", "Order total: ₦10 or more"]);
    expect(clearPoFilterChip(f, "vendor").vendorIds).toEqual([]);
    expect(clearPoFilterChip(f, "total").totalMin).toBeNull();
  });
});
