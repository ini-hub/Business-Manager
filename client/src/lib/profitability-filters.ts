/**
 * Pure filter/sort logic for the Service & Product Profitability list's Filters + Sort
 * bottom sheets. Framework-free so it can be unit tested without mounting the page.
 */

export type ProfitabilityTypeFilter = "service" | "product";
export type ProfitabilityStatusFilter = "profit" | "breakeven" | "loss";

export interface ProfitabilityFilterState {
  type: ProfitabilityTypeFilter | null;
  status: ProfitabilityStatusFilter | null;
  /** Inclusive local dates as yyyy-MM-dd; the server-side scope of the report (rows carry no dates). */
  dateFrom: string | null;
  dateTo: string | null;
}

export const EMPTY_PROFITABILITY_FILTERS: ProfitabilityFilterState = { type: null, status: null, dateFrom: null, dateTo: null };

export type ProfitabilitySortKey = "name" | "revenue" | "netProfit" | "margin";
export interface ProfitabilitySortState {
  key: ProfitabilitySortKey;
  direction: "asc" | "desc";
}

export interface FilterableProfitabilityItem {
  name: string;
  type: ProfitabilityTypeFilter;
  status: ProfitabilityStatusFilter;
  totalRevenue: number;
  netProfit: number;
  netProfitMargin: number;
}

export const TYPE_LABELS: Record<ProfitabilityTypeFilter, string> = { service: "Services", product: "Products" };
export const STATUS_LABELS: Record<ProfitabilityStatusFilter, string> = {
  profit: "In profit",
  breakeven: "Break even",
  loss: "In loss",
};

export function profitabilityMatchesFilters(i: FilterableProfitabilityItem, f: ProfitabilityFilterState): boolean {
  if (f.type && i.type !== f.type) return false;
  if (f.status && i.status !== f.status) return false;
  return true;
}

export function countActiveProfitabilityFilters(f: ProfitabilityFilterState): number {
  return (f.type ? 1 : 0) + (f.status ? 1 : 0) + (f.dateFrom || f.dateTo ? 1 : 0);
}

const fmtDay = (ymd: string) =>
  new Date(`${ymd}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function profitabilityDateRangeLabel(from: string | null, to: string | null): string {
  if (from && to) return from === to ? fmtDay(from) : `${fmtDay(from)} – ${fmtDay(to)}`;
  if (from) return `From ${fmtDay(from)}`;
  return to ? `Until ${fmtDay(to)}` : "";
}

export interface ProfitabilityFilterChip {
  key: "type" | "status" | "dateRange";
  label: string;
}

export function buildProfitabilityFilterChips(f: ProfitabilityFilterState): ProfitabilityFilterChip[] {
  const chips: ProfitabilityFilterChip[] = [];
  if (f.type) chips.push({ key: "type", label: TYPE_LABELS[f.type] });
  if (f.status) chips.push({ key: "status", label: STATUS_LABELS[f.status] });
  const range = profitabilityDateRangeLabel(f.dateFrom, f.dateTo);
  if (range) chips.push({ key: "dateRange", label: range });
  return chips;
}

export function clearProfitabilityFilterChip(
  f: ProfitabilityFilterState,
  key: ProfitabilityFilterChip["key"],
): ProfitabilityFilterState {
  if (key === "dateRange") return { ...f, dateFrom: null, dateTo: null };
  return { ...f, [key]: null };
}

export function profitabilitySortLabel(sort: ProfitabilitySortState | null): string {
  if (!sort) return "Sort";
  switch (sort.key) {
    case "name": return "Sort: Name";
    case "revenue": return "Sort: Highest revenue";
    case "netProfit": return sort.direction === "desc" ? "Sort: Highest profit" : "Sort: Biggest loss";
    case "margin": return "Sort: Best margin";
  }
}

export function sortProfitability<T extends FilterableProfitabilityItem>(rows: T[], sort: ProfitabilitySortState | null): T[] {
  if (!sort) return rows;
  const dir = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    switch (sort.key) {
      case "name": return a.name.localeCompare(b.name) * dir;
      case "revenue": return (a.totalRevenue - b.totalRevenue) * dir;
      case "netProfit": return (a.netProfit - b.netProfit) * dir;
      case "margin": return (a.netProfitMargin - b.netProfitMargin) * dir;
    }
  });
}
