/**
 * Pure filter/sort logic for the Staff Performance directory's Filters + Sort sheets.
 * Framework-free so it can be unit tested without mounting the page.
 */

/** Avg revenue per present day above which a staff member counts as "above average". */
export const ABOVE_AVG_DAILY_REVENUE = 5000;

export type PerformanceTier = "above" | "below";

export interface StaffPerformanceFilterState {
  roles: string[];
  performance: PerformanceTier | null;
  withAbsences: boolean;
  withLate: boolean;
  noSales: boolean;
  revenueMin: number | null;
  revenueMax: number | null;
  /** Inclusive local dates as yyyy-MM-dd; the server-side scope of the report (rows carry no dates). */
  dateFrom: string | null;
  dateTo: string | null;
}

export const EMPTY_STAFF_PERFORMANCE_FILTERS: StaffPerformanceFilterState = {
  roles: [], performance: null, withAbsences: false, withLate: false, noSales: false, revenueMin: null, revenueMax: null, dateFrom: null, dateTo: null,
};

export interface FilterableStaffPerformance {
  name: string;
  role: string;
  servicesCount: number;
  productsCount: number;
  totalRevenue: number;
  presentDays: number;
  absentDays: number;
  lateDays: number;
}

export const PERFORMANCE_LABELS: Record<PerformanceTier, string> = { above: "Above average", below: "Below average" };

export function avgDailyRevenue(r: Pick<FilterableStaffPerformance, "totalRevenue" | "presentDays">): number {
  return (r.totalRevenue || 0) / (r.presentDays || 1);
}

export function performanceTier(r: Pick<FilterableStaffPerformance, "totalRevenue" | "presentDays">): PerformanceTier {
  return avgDailyRevenue(r) > ABOVE_AVG_DAILY_REVENUE ? "above" : "below";
}

export function staffMatchesFilters(r: FilterableStaffPerformance, f: StaffPerformanceFilterState): boolean {
  if (f.roles.length > 0 && !f.roles.includes(r.role)) return false;
  if (f.performance && performanceTier(r) !== f.performance) return false;
  if (f.withAbsences && !(r.absentDays > 0)) return false;
  if (f.withLate && !(r.lateDays > 0)) return false;
  if (f.noSales && (r.servicesCount > 0 || r.productsCount > 0)) return false;
  if (f.revenueMin != null && r.totalRevenue < f.revenueMin) return false;
  if (f.revenueMax != null && r.totalRevenue > f.revenueMax) return false;
  return true;
}

export function staffMatchesSearch(r: FilterableStaffPerformance, term: string): boolean {
  const q = term.trim().toLowerCase();
  return !q || r.name.toLowerCase().includes(q) || r.role.toLowerCase().includes(q);
}

export function countActiveStaffPerformanceFilters(f: StaffPerformanceFilterState): number {
  return (
    (f.roles.length > 0 ? 1 : 0) +
    (f.performance ? 1 : 0) +
    (f.withAbsences ? 1 : 0) +
    (f.withLate ? 1 : 0) +
    (f.noSales ? 1 : 0) +
    (f.revenueMin != null || f.revenueMax != null ? 1 : 0) +
    (f.dateFrom || f.dateTo ? 1 : 0)
  );
}

export function revenueSummary(f: Pick<StaffPerformanceFilterState, "revenueMin" | "revenueMax">, symbol: string): string | null {
  const m = (n: number) => `${symbol}${n.toLocaleString()}`;
  if (f.revenueMin != null && f.revenueMax != null) return `${m(f.revenueMin)} to ${m(f.revenueMax)}`;
  if (f.revenueMin != null) return `${m(f.revenueMin)} or more`;
  if (f.revenueMax != null) return `Up to ${m(f.revenueMax)}`;
  return null;
}

const fmtDay = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function staffPerformanceDateRangeLabel(from: string | null, to: string | null): string {
  if (from && to) return from === to ? fmtDay(from) : `${fmtDay(from)} – ${fmtDay(to)}`;
  if (from) return `From ${fmtDay(from)}`;
  return to ? `Until ${fmtDay(to)}` : "";
}

export interface StaffPerformanceFilterChip {
  key: "roles" | "performance" | "withAbsences" | "withLate" | "noSales" | "revenue" | "dateRange";
  label: string;
}

export function buildStaffPerformanceFilterChips(f: StaffPerformanceFilterState, symbol: string): StaffPerformanceFilterChip[] {
  const chips: StaffPerformanceFilterChip[] = [];
  if (f.roles.length > 0) chips.push({ key: "roles", label: f.roles.map((r) => r.charAt(0).toUpperCase() + r.slice(1)).join(", ") });
  if (f.performance) chips.push({ key: "performance", label: PERFORMANCE_LABELS[f.performance] });
  if (f.withAbsences) chips.push({ key: "withAbsences", label: "Has absences" });
  if (f.withLate) chips.push({ key: "withLate", label: "Has late days" });
  if (f.noSales) chips.push({ key: "noSales", label: "No sales" });
  const revenue = revenueSummary(f, symbol);
  if (revenue) chips.push({ key: "revenue", label: revenue });
  const range = staffPerformanceDateRangeLabel(f.dateFrom, f.dateTo);
  if (range) chips.push({ key: "dateRange", label: range });
  return chips;
}

export function clearStaffPerformanceFilterChip(f: StaffPerformanceFilterState, key: StaffPerformanceFilterChip["key"]): StaffPerformanceFilterState {
  switch (key) {
    case "roles": return { ...f, roles: [] };
    case "performance": return { ...f, performance: null };
    case "withAbsences": return { ...f, withAbsences: false };
    case "withLate": return { ...f, withLate: false };
    case "noSales": return { ...f, noSales: false };
    case "revenue": return { ...f, revenueMin: null, revenueMax: null };
    case "dateRange": return { ...f, dateFrom: null, dateTo: null };
  }
}

export type StaffPerformanceSortKey = "revenue" | "avgDaily" | "services" | "products" | "present" | "name";
export type StaffPerformanceSortDirection = "asc" | "desc";
export interface StaffPerformanceSortState {
  key: StaffPerformanceSortKey;
  direction: StaffPerformanceSortDirection;
}

export const STAFF_PERFORMANCE_SORT_OPTIONS: { value: string; label: string; key: StaffPerformanceSortKey; direction: StaffPerformanceSortDirection }[] = [
  { value: "revenue:desc", label: "Highest revenue", key: "revenue", direction: "desc" },
  { value: "avgDaily:desc", label: "Highest daily average", key: "avgDaily", direction: "desc" },
  { value: "services:desc", label: "Most services", key: "services", direction: "desc" },
  { value: "products:desc", label: "Most products sold", key: "products", direction: "desc" },
  { value: "present:desc", label: "Most days present", key: "present", direction: "desc" },
  { value: "name:asc", label: "Name", key: "name", direction: "asc" },
];

export function staffPerformanceSortLabel(sort: StaffPerformanceSortState | null): string {
  if (!sort) return "Sort";
  const o = STAFF_PERFORMANCE_SORT_OPTIONS.find((s) => s.key === sort.key && s.direction === sort.direction);
  return `Sort: ${o?.label ?? "Custom"}`;
}

export function sortStaffPerformance<T extends FilterableStaffPerformance>(rows: T[], sort: StaffPerformanceSortState | null): T[] {
  if (!sort) return rows;
  const dir = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    switch (sort.key) {
      case "revenue": return (a.totalRevenue - b.totalRevenue) * dir;
      case "avgDaily": return (avgDailyRevenue(a) - avgDailyRevenue(b)) * dir;
      case "services": return (a.servicesCount - b.servicesCount) * dir;
      case "products": return (a.productsCount - b.productsCount) * dir;
      case "present": return (a.presentDays - b.presentDays) * dir;
      case "name": return a.name.localeCompare(b.name) * dir;
    }
  });
}
