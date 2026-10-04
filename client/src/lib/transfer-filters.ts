/**
 * Pure filter/sort logic for the Stock Transfers list's Filters + Sort bottom sheets.
 * Framework-free so it can be unit tested without mounting the page.
 */

export type TransferDirection = "outgoing" | "incoming";
export type TransferDateFilter = "7d" | "30d" | "90d";
export type TransferStage = "pending" | "in_transit" | "received" | "cancelled";

export interface TransferFilterState {
  stage: TransferStage | null;
  direction: TransferDirection | null;
  /** Origin / destination branch names. */
  from: string[];
  to: string[];
  date: TransferDateFilter | null;
}

export const EMPTY_TRANSFER_FILTERS: TransferFilterState = { stage: null, direction: null, from: [], to: [], date: null };

export type TransferSortKey = "newest" | "oldest" | "route";
export interface TransferSortState {
  key: TransferSortKey;
}

export interface FilterableTransfer {
  direction: string;
  status: string;
  createdAt: string | Date;
  notes?: string | null;
  fromStore?: { name?: string | null } | null;
  toStore?: { name?: string | null } | null;
}

export const STAGE_LABELS: Record<TransferStage, string> = {
  pending: "Pending",
  in_transit: "In transit",
  received: "Received",
  cancelled: "Cancelled",
};

/** Collapses the many server statuses into the four stages a manager thinks in. */
export function transferStageOf(status: string): TransferStage {
  const st = status.toLowerCase();
  if (st === "accepted" || st === "scheduled" || st === "delivered") return "in_transit";
  if (st === "completed" || st === "confirmed") return "received";
  if (st === "cancelled" || st === "rejected") return "cancelled";
  // "requested" (a branch asking a neighbour for stock) is still waiting on a decision.
  return "pending";
}

export const DIRECTION_LABELS: Record<TransferDirection, string> = { outgoing: "Outgoing", incoming: "Incoming" };
export const DATE_LABELS: Record<TransferDateFilter, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
};
const DATE_DAYS: Record<TransferDateFilter, number> = { "7d": 7, "30d": 30, "90d": 90 };

const fromName = (t: FilterableTransfer) => t.fromStore?.name || "Unknown Origin";
const toName = (t: FilterableTransfer) => t.toStore?.name || "Unknown Target";

export function transferMatchesFilters<T extends FilterableTransfer>(t: T, f: TransferFilterState, now = new Date()): boolean {
  if (f.stage && transferStageOf(t.status) !== f.stage) return false;
  if (f.direction && t.direction !== f.direction) return false;
  if (f.from.length > 0 && !f.from.includes(fromName(t))) return false;
  if (f.to.length > 0 && !f.to.includes(toName(t))) return false;
  if (f.date) {
    const ageDays = (now.getTime() - new Date(t.createdAt).getTime()) / 86_400_000;
    if (ageDays > DATE_DAYS[f.date]) return false;
  }
  return true;
}

export function transferMatchesSearch(t: FilterableTransfer, term: string): boolean {
  const q = term.trim().toLowerCase();
  if (!q) return true;
  return (
    fromName(t).toLowerCase().includes(q) ||
    toName(t).toLowerCase().includes(q) ||
    (t.notes ?? "").toLowerCase().includes(q)
  );
}

export function countActiveTransferFilters(f: TransferFilterState): number {
  return (f.stage ? 1 : 0) + (f.direction ? 1 : 0) + (f.from.length > 0 ? 1 : 0) + (f.to.length > 0 ? 1 : 0) + (f.date ? 1 : 0);
}

export interface TransferFilterChip {
  key: keyof TransferFilterState;
  label: string;
}

export function buildTransferFilterChips(f: TransferFilterState): TransferFilterChip[] {
  const chips: TransferFilterChip[] = [];
  if (f.stage) chips.push({ key: "stage", label: STAGE_LABELS[f.stage] });
  if (f.direction) chips.push({ key: "direction", label: DIRECTION_LABELS[f.direction] });
  if (f.from.length > 0) chips.push({ key: "from", label: `From ${f.from.join(", ")}` });
  if (f.to.length > 0) chips.push({ key: "to", label: `To ${f.to.join(", ")}` });
  if (f.date) chips.push({ key: "date", label: DATE_LABELS[f.date] });
  return chips;
}

export function clearTransferFilterChip(f: TransferFilterState, key: TransferFilterChip["key"]): TransferFilterState {
  return { ...f, [key]: EMPTY_TRANSFER_FILTERS[key] };
}

export function transferSortLabel(sort: TransferSortState | null): string {
  if (!sort) return "Sort";
  return { newest: "Sort: Newest", oldest: "Sort: Oldest", route: "Sort: Route" }[sort.key];
}

export function sortTransfers<T extends FilterableTransfer>(rows: T[], sort: TransferSortState | null): T[] {
  if (!sort) return rows;
  const time = (t: T) => new Date(t.createdAt).getTime();
  return [...rows].sort((a, b) => {
    switch (sort.key) {
      case "newest": return time(b) - time(a);
      case "oldest": return time(a) - time(b);
      case "route": return `${fromName(a)} ${toName(a)}`.localeCompare(`${fromName(b)} ${toName(b)}`);
    }
  });
}
