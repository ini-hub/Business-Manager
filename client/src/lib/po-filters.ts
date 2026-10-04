// Filter / sort state for the purchase order list. Pure functions so the page,
// the Filters sheet's live count and the tests all agree on the result.

export type PoStatusFilter = "draft" | "awaiting" | "received" | "cancelled";
export type PoExpectedFilter = "overdue" | "today" | "week" | "none";

export interface PoFilterState {
  /** Awaiting delivery covers ordered and partially received. */
  status: PoStatusFilter | null;
  vendorIds: string[];
  expected: PoExpectedFilter | null;
  /** Custom expected-arrival window, YYYY-MM-DD bounds (either may be absent). */
  expectedRange: { from?: string; to?: string } | null;
  totalMin: number | null;
  totalMax: number | null;
}

export const EMPTY_PO_FILTERS: PoFilterState = { status: null, vendorIds: [], expected: null, expectedRange: null, totalMin: null, totalMax: null };

export type PoSort = "newest" | "expected" | "totalDesc" | "totalAsc" | "number";

export const PO_SORT_LABELS: Record<PoSort, string> = {
  newest: "Newest first",
  expected: "Expected soonest",
  totalDesc: "Total: high to low",
  totalAsc: "Total: low to high",
  number: "PO number",
};

export interface PoLike {
  id: string;
  poNumber: string;
  status: string;
  vendorId: string;
  totalAmount: number;
  expectedDelivery?: Date | string | null;
  createdAt: Date | string;
  supplierRef?: string | null;
  vendor?: { name?: string } | null;
}

export const isAwaiting = (po: { status: string }) => po.status === "ordered" || po.status === "partially_received";

/** Expected date as YYYY-MM-DD (stored at UTC midnight), so it never shifts a day. */
export const dueDay = (po: { expectedDelivery?: Date | string | null }): string | null =>
  po.expectedDelivery ? new Date(po.expectedDelivery).toISOString().slice(0, 10) : null;

const dayNumber = (ymd: string) => Math.round(new Date(`${ymd}T00:00:00Z`).getTime() / 86_400_000);

/** Whole days past the expected date (0 = due today, negative = still ahead). null if not awaiting or undated. */
export function daysLate(po: PoLike, today: string): number | null {
  const due = dueDay(po);
  if (!due || !isAwaiting(po)) return null;
  return dayNumber(today) - dayNumber(due);
}

export function poMatchesSearch(po: PoLike, term: string): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return true;
  return (
    po.poNumber.toLowerCase().includes(t) ||
    (po.supplierRef ?? "").toLowerCase().includes(t) ||
    (po.vendor?.name ?? "").toLowerCase().includes(t)
  );
}

export const PO_STATUS_LABELS: Record<PoStatusFilter, string> = {
  draft: "Draft",
  awaiting: "Awaiting delivery",
  received: "Received",
  cancelled: "Cancelled",
};

const poMatchesStatus = (po: PoLike, status: PoStatusFilter) =>
  status === "awaiting" ? isAwaiting(po) : po.status === status;

export function poMatchesFilters(po: PoLike, f: PoFilterState, today: string): boolean {
  if (f.status && !poMatchesStatus(po, f.status)) return false;
  if (f.vendorIds.length > 0 && !f.vendorIds.includes(po.vendorId)) return false;
  if (f.totalMin !== null && po.totalAmount < f.totalMin) return false;
  if (f.totalMax !== null && po.totalAmount > f.totalMax) return false;
  if (f.expectedRange && (f.expectedRange.from || f.expectedRange.to)) {
    const due = dueDay(po);
    if (!due) return false;
    if (f.expectedRange.from && due < f.expectedRange.from) return false;
    if (f.expectedRange.to && due > f.expectedRange.to) return false;
  }
  if (f.expected) {
    const due = dueDay(po);
    if (f.expected === "none") return due === null;
    if (!due) return false;
    const diff = dayNumber(due) - dayNumber(today);
    if (f.expected === "overdue") return isAwaiting(po) && diff < 0;
    if (f.expected === "today") return diff === 0;
    if (f.expected === "week") return diff >= 0 && diff <= 7;
  }
  return true;
}

export function sortPos<T extends PoLike>(list: T[], sort: PoSort | null): T[] {
  const copy = [...list];
  const created = (p: PoLike) => new Date(p.createdAt).getTime();
  switch (sort ?? "newest") {
    case "expected":
      // Undated orders last.
      return copy.sort((a, b) => (dueDay(a) ?? "9999-12-31").localeCompare(dueDay(b) ?? "9999-12-31"));
    case "totalDesc": return copy.sort((a, b) => b.totalAmount - a.totalAmount);
    case "totalAsc": return copy.sort((a, b) => a.totalAmount - b.totalAmount);
    case "number": return copy.sort((a, b) => a.poNumber.localeCompare(b.poNumber, undefined, { numeric: true }));
    default: return copy.sort((a, b) => created(b) - created(a));
  }
}

export const countActivePoFilters = (f: PoFilterState): number =>
  (f.status ? 1 : 0) + (f.vendorIds.length > 0 ? 1 : 0) + (f.expected || f.expectedRange?.from || f.expectedRange?.to ? 1 : 0) + (f.totalMin !== null || f.totalMax !== null ? 1 : 0);

const EXPECTED_LABEL: Record<PoExpectedFilter, string> = {
  overdue: "Overdue",
  today: "Due today",
  week: "Due in the next 7 days",
  none: "No date set",
};
export const expectedLabel = (e: PoExpectedFilter) => EXPECTED_LABEL[e];

export interface PoFilterChip { key: "status" | "vendor" | "expected" | "total"; label: string }

export function buildPoFilterChips(f: PoFilterState, vendorName: (id: string) => string, symbol: string): PoFilterChip[] {
  const chips: PoFilterChip[] = [];
  if (f.status) chips.push({ key: "status", label: PO_STATUS_LABELS[f.status] });
  const m = (n: number) => `${symbol}${n.toLocaleString()}`;
  if (f.vendorIds.length === 1) chips.push({ key: "vendor", label: `Vendor: ${vendorName(f.vendorIds[0])}` });
  else if (f.vendorIds.length > 1) chips.push({ key: "vendor", label: `Vendor: ${f.vendorIds.length} selected` });
  if (f.expectedRange?.from || f.expectedRange?.to) {
    chips.push({ key: "expected", label: `Expected arrival: ${f.expectedRange.from ?? "…"} to ${f.expectedRange.to ?? "…"}` });
  } else if (f.expected) {
    chips.push({ key: "expected", label: `Expected arrival: ${EXPECTED_LABEL[f.expected]}` });
  }
  if (f.totalMin !== null || f.totalMax !== null) {
    const label = f.totalMin !== null && f.totalMax !== null ? `${m(f.totalMin)} to ${m(f.totalMax)}`
      : f.totalMin !== null ? `${m(f.totalMin)} or more` : `Up to ${m(f.totalMax as number)}`;
    chips.push({ key: "total", label: `Order total: ${label}` });
  }
  return chips;
}

export function clearPoFilterChip(f: PoFilterState, key: PoFilterChip["key"]): PoFilterState {
  if (key === "status") return { ...f, status: null };
  if (key === "vendor") return { ...f, vendorIds: [] };
  if (key === "expected") return { ...f, expected: null, expectedRange: null };
  return { ...f, totalMin: null, totalMax: null };
}
