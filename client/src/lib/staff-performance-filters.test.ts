import { describe, it, expect } from "vitest";
import {
  EMPTY_STAFF_PERFORMANCE_FILTERS as EMPTY,
  staffMatchesFilters,
  staffMatchesSearch,
  countActiveStaffPerformanceFilters,
  buildStaffPerformanceFilterChips,
  clearStaffPerformanceFilterChip,
  sortStaffPerformance,
  performanceTier,
} from "./staff-performance-filters";

const s = (name: string, o: Record<string, unknown> = {}) => ({
  name, role: "staff", servicesCount: 0, productsCount: 0, totalRevenue: 0, presentDays: 10, absentDays: 0, lateDays: 0, ...o,
});
const rows = [
  s("Ada", { totalRevenue: 100000, servicesCount: 20, role: "manager" }),
  s("Bayo", { totalRevenue: 20000, productsCount: 4, absentDays: 2 }),
  s("Chi", { lateDays: 3 }),
];
const names = (f: typeof EMPTY) => rows.filter((r) => staffMatchesFilters(r, f)).map((r) => r.name);

describe("staff performance filters", () => {
  it("tiers by average daily revenue", () => {
    expect(performanceTier(rows[0])).toBe("above");
    expect(performanceTier(rows[1])).toBe("below");
    expect(performanceTier(s("Zero", { presentDays: 0, totalRevenue: 9000 }))).toBe("above");
  });
  it("filters", () => {
    expect(names({ ...EMPTY, roles: ["manager"] })).toEqual(["Ada"]);
    expect(names({ ...EMPTY, performance: "above" })).toEqual(["Ada"]);
    expect(names({ ...EMPTY, withAbsences: true })).toEqual(["Bayo"]);
    expect(names({ ...EMPTY, withLate: true })).toEqual(["Chi"]);
    expect(names({ ...EMPTY, noSales: true })).toEqual(["Chi"]);
    expect(names({ ...EMPTY, revenueMin: 10000, revenueMax: 50000 })).toEqual(["Bayo"]);
  });
  it("searches name and role", () => {
    expect(rows.filter((r) => staffMatchesSearch(r, "MANAG")).length).toBe(1);
    expect(rows.filter((r) => staffMatchesSearch(r, "ba")).length).toBe(1);
  });
  it("counts, builds and clears chips", () => {
    const f = { ...EMPTY, performance: "below" as const, revenueMin: 1000 };
    expect(countActiveStaffPerformanceFilters(f)).toBe(2);
    expect(buildStaffPerformanceFilterChips(f, "₦").map((c) => c.label)).toEqual(["Below average", "₦1,000 or more"]);
    expect(clearStaffPerformanceFilterChip(f, "revenue").revenueMin).toBeNull();
  });
  it("counts and chips the date range", () => {
    const f = { ...EMPTY, dateFrom: "2026-10-01", dateTo: "2026-10-31" };
    expect(countActiveStaffPerformanceFilters(f)).toBe(1);
    expect(buildStaffPerformanceFilterChips(f, "₦").map((c) => c.key)).toEqual(["dateRange"]);
    expect(clearStaffPerformanceFilterChip(f, "dateRange").dateFrom).toBeNull();
    expect(names(f)).toEqual(["Ada", "Bayo", "Chi"]);
  });
  it("sorts", () => {
    expect(sortStaffPerformance(rows, { key: "revenue", direction: "desc" })[0].name).toBe("Ada");
    expect(sortStaffPerformance(rows, { key: "name", direction: "asc" })[2].name).toBe("Chi");
    expect(sortStaffPerformance(rows, null)).toBe(rows);
  });
});
