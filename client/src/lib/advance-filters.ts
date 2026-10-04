/**
 * Pure filter/sort logic for the Salary Advances list's Filters + Sort bottom sheets.
 * Framework-free so it can be unit tested without mounting the page.
 */

export type AdvanceStatusFilter = "pending" | "approved" | "partial" | "recovered" | "rejected";

export interface AdvanceFilterState {
  statuses: AdvanceStatusFilter[];
  staff: string[];
  amountMin: number | null;
  amountMax: number | null;
  /** Inclusive local dates as yyyy-MM-dd. */
  dateFrom: string | null;
  dateTo: string | null;
}

export const EMPTY_ADVANCE_FILTERS: AdvanceFilterState = {
  statuses: [], staff: [], amountMin: null, amountMax: null, dateFrom: null, dateTo: null,
};

export type AdvanceSortKey = "newest" | "oldest" | "amountHigh" | "amountLow" | "staff";
export interface AdvanceSortState {
  key: AdvanceSortKey;
}

export interface FilterableAdvance {
  staffName: string;
  staffNumber?: string | null;
  staffMobile?: string | null;
  notes?: string | null;
  date: string;
  amount: number | string;
  status?: string | null;
  isRecovered?: boolean | null;
  recoveryStatus?: string | null;
}

export const STATUS_LABELS: Record<AdvanceStatusFilter, string> = {
  pending: "Pending approval",
  approved: "Approved",
  partial: "Partially recovered",
  recovered: "Recovered",
  rejected: "Rejected",
};

/** Mirrors the status badge in the table: recovered/partial win over the approval status. */
export function advanceStatusKey(a: Pick<FilterableAdvance, "status" | "isRecovered" | "recoveryStatus">): AdvanceStatusFilter {
  if (a.isRecovered) return "recovered";
  if (a.recoveryStatus === "partial") return "partial";
  if (a.status === "rejected") return "rejected";
  if (a.status === "approved") return "approved";
  return "pending";
}

export function advanceMatchesFilters<T extends FilterableAdvance>(a: T, f: AdvanceFilterState): boolean {
  if (f.statuses.length > 0 && !f.statuses.includes(advanceStatusKey(a))) return false;
  if (f.staff.length > 0 && !f.staff.includes(a.staffName)) return false;
  const amount = Number(a.amount);
  if (f.amountMin != null && amount < f.amountMin) return false;
  if (f.amountMax != null && amount > f.amountMax) return false;
  const day = String(a.date).slice(0, 10);
  if (f.dateFrom && day < f.dateFrom) return false;
  if (f.dateTo && day > f.dateTo) return false;
  return true;
}

export function advanceMatchesSearch(a: FilterableAdvance, term: string): boolean {
  const q = term.trim().toLowerCase();
  if (!q) return true;
  return [a.staffName, a.staffNumber, a.staffMobile, a.notes].some((v) => (v ?? "").toLowerCase().includes(q));
}

export function countActiveAdvanceFilters(f: AdvanceFilterState): number {
  return (
    (f.statuses.length > 0 ? 1 : 0) +
    (f.staff.length > 0 ? 1 : 0) +
    (f.amountMin != null || f.amountMax != null ? 1 : 0) +
    (f.dateFrom || f.dateTo ? 1 : 0)
  );
}

export function advanceAmountSummary(f: Pick<AdvanceFilterState, "amountMin" | "amountMax">, symbol: string): string | null {
  const m = (n: number) => `${symbol}${n.toLocaleString()}`;
  if (f.amountMin != null && f.amountMax != null) return `${m(f.amountMin)} to ${m(f.amountMax)}`;
  if (f.amountMin != null) return `${m(f.amountMin)} or more`;
  if (f.amountMax != null) return `Up to ${m(f.amountMax)}`;
  return null;
}

const fmtDay = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function advanceDateRangeLabel(from: string | null, to: string | null): string {
  if (from && to) return from === to ? fmtDay(from) : `${fmtDay(from)} – ${fmtDay(to)}`;
  if (from) return `From ${fmtDay(from)}`;
  return to ? `Until ${fmtDay(to)}` : "";
}

export interface AdvanceFilterChip {
  key: "statuses" | "staff" | "amount" | "dateRange";
  label: string;
}

export function buildAdvanceFilterChips(f: AdvanceFilterState, symbol: string): AdvanceFilterChip[] {
  const chips: AdvanceFilterChip[] = [];
  if (f.statuses.length > 0) chips.push({ key: "statuses", label: f.statuses.map((s) => STATUS_LABELS[s]).join(", ") });
  if (f.staff.length > 0) chips.push({ key: "staff", label: f.staff.join(", ") });
  const amount = advanceAmountSummary(f, symbol);
  if (amount) chips.push({ key: "amount", label: amount });
  const range = advanceDateRangeLabel(f.dateFrom, f.dateTo);
  if (range) chips.push({ key: "dateRange", label: range });
  return chips;
}

export function clearAdvanceFilterChip(f: AdvanceFilterState, key: AdvanceFilterChip["key"]): AdvanceFilterState {
  switch (key) {
    case "statuses": return { ...f, statuses: [] };
    case "staff": return { ...f, staff: [] };
    case "amount": return { ...f, amountMin: null, amountMax: null };
    case "dateRange": return { ...f, dateFrom: null, dateTo: null };
  }
}

export function advanceSortLabel(sort: AdvanceSortState | null): string {
  if (!sort) return "Sort";
  return {
    newest: "Sort: Newest", oldest: "Sort: Oldest", amountHigh: "Sort: Highest amount", amountLow: "Sort: Lowest amount", staff: "Sort: Staff A–Z",
  }[sort.key];
}

export function sortAdvances<T extends FilterableAdvance>(rows: T[], sort: AdvanceSortState | null): T[] {
  if (!sort) return rows;
  const time = (a: T) => new Date(a.date).getTime();
  return [...rows].sort((a, b) => {
    switch (sort.key) {
      case "newest": return time(b) - time(a);
      case "oldest": return time(a) - time(b);
      case "amountHigh": return Number(b.amount) - Number(a.amount);
      case "amountLow": return Number(a.amount) - Number(b.amount);
      case "staff": return a.staffName.localeCompare(b.staffName);
    }
  });
}
