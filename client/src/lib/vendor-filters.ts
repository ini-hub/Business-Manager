/**
 * Pure filter/sort logic for the Vendors list's Filters + Sort bottom sheets.
 * Framework-free so it can be unit tested without mounting the page.
 */

export type VendorBalanceFilter = "owing" | "settled";
export type VendorOrdersFilter = "open" | "none";
export type VendorLastOrderFilter = "30d" | "90d" | "90d+" | "never";

export interface VendorFilterState {
  balance: VendorBalanceFilter | null;
  orders: VendorOrdersFilter | null;
  lastOrder: VendorLastOrderFilter | null;
}

export const EMPTY_VENDOR_FILTERS: VendorFilterState = { balance: null, orders: null, lastOrder: null };

export type VendorSortKey = "name" | "lastOrder" | "openOrders" | "outstanding";
export interface VendorSortState {
  key: VendorSortKey;
  direction: "asc" | "desc";
}

export interface FilterableVendor {
  name: string;
  outstandingBalance?: number;
  openOrders?: number;
  lastOrderAt?: string | null;
}

export const BALANCE_LABELS: Record<VendorBalanceFilter, string> = { owing: "We owe them", settled: "Settled" };
export const ORDERS_LABELS: Record<VendorOrdersFilter, string> = { open: "Has open orders", none: "No open orders" };
export const LAST_ORDER_LABELS: Record<VendorLastOrderFilter, string> = {
  "30d": "Ordered in the last 30 days",
  "90d": "Ordered in the last 90 days",
  "90d+": "Not ordered in 90+ days",
  never: "Never ordered",
};

const daysSince = (iso: string, now: Date) => (now.getTime() - new Date(iso).getTime()) / 86_400_000;

export function vendorMatchesFilters<T extends FilterableVendor>(v: T, f: VendorFilterState, now = new Date()): boolean {
  const owed = v.outstandingBalance ?? 0;
  if (f.balance === "owing" && owed <= 0) return false;
  if (f.balance === "settled" && owed > 0) return false;
  const open = v.openOrders ?? 0;
  if (f.orders === "open" && open <= 0) return false;
  if (f.orders === "none" && open > 0) return false;
  if (f.lastOrder) {
    if (f.lastOrder === "never") return !v.lastOrderAt;
    if (!v.lastOrderAt) return f.lastOrder === "90d+";
    const d = daysSince(v.lastOrderAt, now);
    if (f.lastOrder === "30d" && d > 30) return false;
    if (f.lastOrder === "90d" && d > 90) return false;
    if (f.lastOrder === "90d+" && d <= 90) return false;
  }
  return true;
}

export function countActiveVendorFilters(f: VendorFilterState): number {
  return (f.balance ? 1 : 0) + (f.orders ? 1 : 0) + (f.lastOrder ? 1 : 0);
}

export interface VendorFilterChip {
  key: keyof VendorFilterState;
  label: string;
}

export function buildVendorFilterChips(f: VendorFilterState): VendorFilterChip[] {
  const chips: VendorFilterChip[] = [];
  if (f.balance) chips.push({ key: "balance", label: BALANCE_LABELS[f.balance] });
  if (f.orders) chips.push({ key: "orders", label: ORDERS_LABELS[f.orders] });
  if (f.lastOrder) chips.push({ key: "lastOrder", label: LAST_ORDER_LABELS[f.lastOrder] });
  return chips;
}

export function clearVendorFilterChip(f: VendorFilterState, key: VendorFilterChip["key"]): VendorFilterState {
  return { ...f, [key]: null };
}

export function vendorSortLabel(sort: VendorSortState | null): string {
  if (!sort) return "Sort";
  switch (sort.key) {
    case "name": return "Sort: Name";
    case "lastOrder": return "Sort: Latest order";
    case "openOrders": return "Sort: Most open orders";
    case "outstanding": return "Sort: Highest balance";
  }
}

export function sortVendors<T extends FilterableVendor>(rows: T[], sort: VendorSortState | null): T[] {
  if (!sort) return rows;
  const dir = sort.direction === "asc" ? 1 : -1;
  const time = (v: T) => (v.lastOrderAt ? new Date(v.lastOrderAt).getTime() : 0);
  return [...rows].sort((a, b) => {
    switch (sort.key) {
      case "name": return a.name.localeCompare(b.name) * dir;
      case "lastOrder": return (time(a) - time(b)) * dir;
      case "openOrders": return ((a.openOrders ?? 0) - (b.openOrders ?? 0)) * dir;
      case "outstanding": return ((a.outstandingBalance ?? 0) - (b.outstandingBalance ?? 0)) * dir;
    }
  });
}
