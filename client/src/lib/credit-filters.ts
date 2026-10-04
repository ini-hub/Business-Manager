/**
 * Pure filter/sort logic for the Credit Sales ledger's Filters + Sort bottom sheets.
 * Framework-free so it can be unit tested without mounting the page.
 */

export type CreditStage = "open" | "settled" | "written_off";
export type CreditDueFilter = "overdue" | "week" | "later" | "none";

export interface CreditFilterState {
  stage: CreditStage | null;
  due: CreditDueFilter | null;
  balanceMin: number | null;
  balanceMax: number | null;
  customers: string[];
}

export const EMPTY_CREDIT_FILTERS: CreditFilterState = { stage: null, due: null, balanceMin: null, balanceMax: null, customers: [] };

export type CreditSortKey = "dueSoonest" | "balanceHigh" | "balanceLow";
export interface CreditSortState {
  key: CreditSortKey;
}

export interface FilterableCredit {
  customerName: string;
  customerMobile?: string;
  receiptNumber?: string | null;
  description?: string | null;
  outstandingBalance: number;
  dueDate?: string | Date | null;
  status: string;
}

export const STAGE_LABELS: Record<CreditStage, string> = {
  open: "Open",
  settled: "Settled",
  written_off: "Written off",
};

/** Open covers owing, partial and overdue. */
function creditStageOf(status: string): CreditStage {
  return status === "settled" ? "settled" : status === "written_off" ? "written_off" : "open";
}

export const DUE_LABELS: Record<CreditDueFilter, string> = {
  overdue: "Overdue",
  week: "Due in the next 7 days",
  later: "Due later",
  none: "No due date",
};

const DAY = 86_400_000;

export function creditMatchesFilters<T extends FilterableCredit>(e: T, f: CreditFilterState, now = new Date()): boolean {
  if (f.stage && creditStageOf(e.status) !== f.stage) return false;
  if (f.due) {
    if (f.due === "none") {
      if (e.dueDate) return false;
    } else {
      if (!e.dueDate) return false;
      const ms = new Date(e.dueDate).getTime() - now.getTime();
      const overdue = e.status === "overdue" || ms < 0;
      if (f.due === "overdue" && !overdue) return false;
      if (f.due === "week" && (overdue || ms > 7 * DAY)) return false;
      if (f.due === "later" && (overdue || ms <= 7 * DAY)) return false;
    }
  }
  if (f.balanceMin != null && e.outstandingBalance < f.balanceMin) return false;
  if (f.balanceMax != null && e.outstandingBalance > f.balanceMax) return false;
  if (f.customers.length > 0 && !f.customers.includes(e.customerName)) return false;
  return true;
}

export function creditMatchesSearch(e: FilterableCredit, term: string): boolean {
  const q = term.trim().toLowerCase();
  if (!q) return true;
  return (
    e.customerName.toLowerCase().includes(q) ||
    (e.customerMobile ?? "").toLowerCase().includes(q) ||
    (e.receiptNumber ?? "").toLowerCase().includes(q) ||
    (e.description ?? "").toLowerCase().includes(q)
  );
}

export function countActiveCreditFilters(f: CreditFilterState): number {
  return (f.stage ? 1 : 0) + (f.due ? 1 : 0) + (f.balanceMin != null || f.balanceMax != null ? 1 : 0) + (f.customers.length > 0 ? 1 : 0);
}

export function balanceSummary(f: Pick<CreditFilterState, "balanceMin" | "balanceMax">, symbol: string): string | null {
  const m = (n: number) => `${symbol}${n.toLocaleString()}`;
  if (f.balanceMin != null && f.balanceMax != null) return `${m(f.balanceMin)} to ${m(f.balanceMax)}`;
  if (f.balanceMin != null) return `${m(f.balanceMin)} or more`;
  if (f.balanceMax != null) return `Up to ${m(f.balanceMax)}`;
  return null;
}

export interface CreditFilterChip {
  key: "stage" | "due" | "balance" | "customers";
  label: string;
}

export function buildCreditFilterChips(f: CreditFilterState, symbol: string): CreditFilterChip[] {
  const chips: CreditFilterChip[] = [];
  if (f.stage) chips.push({ key: "stage", label: STAGE_LABELS[f.stage] });
  if (f.due) chips.push({ key: "due", label: DUE_LABELS[f.due] });
  const balance = balanceSummary(f, symbol);
  if (balance) chips.push({ key: "balance", label: `Balance ${balance}` });
  if (f.customers.length > 0) chips.push({ key: "customers", label: f.customers.join(", ") });
  return chips;
}

export function clearCreditFilterChip(f: CreditFilterState, key: CreditFilterChip["key"]): CreditFilterState {
  switch (key) {
    case "stage": return { ...f, stage: null };
    case "due": return { ...f, due: null };
    case "balance": return { ...f, balanceMin: null, balanceMax: null };
    case "customers": return { ...f, customers: [] };
  }
}

export function creditSortLabel(sort: CreditSortState | null): string {
  if (!sort) return "Sort";
  return { dueSoonest: "Sort: Due soonest", balanceHigh: "Sort: Balance, high to low", balanceLow: "Sort: Balance, low to high" }[sort.key];
}

export function sortCredits<T extends FilterableCredit>(rows: T[], sort: CreditSortState | null): T[] {
  if (!sort) return rows;
  // Entries without a due date sort last when ordering by due date.
  const due = (e: T) => (e.dueDate ? new Date(e.dueDate).getTime() : Number.POSITIVE_INFINITY);
  return [...rows].sort((a, b) => {
    switch (sort.key) {
      case "dueSoonest": return due(a) === due(b) ? 0 : due(a) < due(b) ? -1 : 1;
      case "balanceHigh": return b.outstandingBalance - a.outstandingBalance;
      case "balanceLow": return a.outstandingBalance - b.outstandingBalance;
    }
  });
}
