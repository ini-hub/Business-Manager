/**
 * Pure filter/sort logic for the Customers list's Filters + Sort bottom sheets.
 * Framework-free so it can be unit tested without mounting the page.
 */

export type LastVisitedPreset = "7d" | "30d" | "30d+" | "never";
export type SpendPreset = "top10" | "none";
export type DateAddedPreset = "month" | "3months";

export interface DateRange {
  from?: string;
  to?: string;
}

export interface CustomerFilterState {
  lastVisited: LastVisitedPreset | null;
  lastVisitedCustom: DateRange | null;
  spendMin: number | null;
  spendMax: number | null;
  spendPreset: SpendPreset | null;
  dateAdded: DateAddedPreset | null;
  dateAddedCustom: DateRange | null;
  missingAddress: boolean;
  missingPhone: boolean;
}

export const EMPTY_CUSTOMER_FILTERS: CustomerFilterState = {
  lastVisited: null,
  lastVisitedCustom: null,
  spendMin: null,
  spendMax: null,
  spendPreset: null,
  dateAdded: null,
  dateAddedCustom: null,
  missingAddress: false,
  missingPhone: false,
};

export type CustomerSortKey = "lastVisited" | "totalSpend" | "dateAdded" | "name";
export type CustomerSortDirection = "asc" | "desc";
export interface CustomerSortState {
  key: CustomerSortKey;
  direction: CustomerSortDirection;
}

export interface FilterableCustomer {
  id: string | number;
  totalSpend: number;
  lastVisited: string | Date | null;
  createdAt: string | Date;
  address: string | null;
  mobileNumber: string | null;
  name: string;
}

function daysSince(date: string | Date, now: Date): number {
  const ms = now.getTime() - new Date(date).getTime();
  return ms / (1000 * 60 * 60 * 24);
}

function isWithinMonths(date: string | Date, months: number, now: Date): boolean {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - months);
  return new Date(date) >= cutoff;
}

function isThisCalendarMonth(date: string | Date, now: Date): boolean {
  const d = new Date(date);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

/** The spend value at the 90th percentile of `spends` — the "Top 10%" threshold. */
export function computeTopSpendThreshold(spends: number[]): number {
  if (spends.length === 0) return Infinity;
  const sorted = [...spends].sort((a, b) => a - b);
  const index = Math.floor(sorted.length * 0.9);
  return sorted[Math.min(index, sorted.length - 1)];
}

export function customerMatchesFilters<T extends FilterableCustomer>(
  customer: T,
  filters: CustomerFilterState,
  topSpendThreshold: number,
  now: Date = new Date()
): boolean {
  const { lastVisited, lastVisitedCustom, spendMin, spendMax, spendPreset, dateAdded, dateAddedCustom, missingAddress, missingPhone } = filters;

  if (lastVisited) {
    const visited = customer.lastVisited;
    const days = visited ? daysSince(visited, now) : null;
    if (lastVisited === "7d" && !(days !== null && days <= 7)) return false;
    if (lastVisited === "30d" && !(days !== null && days <= 30)) return false;
    if (lastVisited === "30d+" && !(days !== null && days > 30)) return false;
    if (lastVisited === "never" && days !== null) return false;
  }
  if (lastVisitedCustom?.from || lastVisitedCustom?.to) {
    if (!customer.lastVisited) return false;
    const visited = new Date(customer.lastVisited);
    if (lastVisitedCustom.from && visited < new Date(lastVisitedCustom.from)) return false;
    if (lastVisitedCustom.to && visited > new Date(lastVisitedCustom.to)) return false;
  }

  if (spendMin != null && customer.totalSpend < spendMin) return false;
  if (spendMax != null && customer.totalSpend > spendMax) return false;
  if (spendPreset === "top10" && customer.totalSpend < topSpendThreshold) return false;
  if (spendPreset === "none" && customer.totalSpend > 0) return false;

  if (dateAdded === "month" && !isThisCalendarMonth(customer.createdAt, now)) return false;
  if (dateAdded === "3months" && !isWithinMonths(customer.createdAt, 3, now)) return false;
  if (dateAddedCustom?.from || dateAddedCustom?.to) {
    const added = new Date(customer.createdAt);
    if (dateAddedCustom.from && added < new Date(dateAddedCustom.from)) return false;
    if (dateAddedCustom.to && added > new Date(dateAddedCustom.to)) return false;
  }

  if (missingAddress && customer.address && customer.address.trim() !== "") return false;
  if (missingPhone && customer.mobileNumber && customer.mobileNumber.trim() !== "") return false;

  return true;
}

export function countActiveCustomerFilters(filters: CustomerFilterState): number {
  let count = 0;
  if (filters.lastVisited) count++;
  if (filters.lastVisitedCustom?.from || filters.lastVisitedCustom?.to) count++;
  if (filters.spendMin != null || filters.spendMax != null) count++;
  if (filters.spendPreset) count++;
  if (filters.dateAdded) count++;
  if (filters.dateAddedCustom?.from || filters.dateAddedCustom?.to) count++;
  if (filters.missingAddress) count++;
  if (filters.missingPhone) count++;
  return count;
}

export interface FilterChip {
  key: keyof CustomerFilterState | "spendRange" | "dateAddedCustom" | "lastVisitedCustom";
  label: string;
}

const LAST_VISITED_LABELS: Record<LastVisitedPreset, string> = {
  "7d": "Visited last 7 days",
  "30d": "Visited last 30 days",
  "30d+": "Visited 30+ days ago",
  never: "Never visited",
};

const DATE_ADDED_LABELS: Record<DateAddedPreset, string> = {
  month: "Added this month",
  "3months": "Added last 3 months",
};

/** Builds the removable-chip list shown under the Filters/Sort pills once filters are applied. */
export function buildCustomerFilterChips(filters: CustomerFilterState, currencySymbol: string): FilterChip[] {
  const chips: FilterChip[] = [];

  if (filters.lastVisited) chips.push({ key: "lastVisited", label: LAST_VISITED_LABELS[filters.lastVisited] });
  if (filters.lastVisitedCustom?.from || filters.lastVisitedCustom?.to) {
    chips.push({ key: "lastVisitedCustom", label: `Visited ${filters.lastVisitedCustom.from ?? "…"} – ${filters.lastVisitedCustom.to ?? "…"}` });
  }

  if (filters.spendPreset === "top10") chips.push({ key: "spendPreset", label: "Top 10% spenders" });
  if (filters.spendPreset === "none") chips.push({ key: "spendPreset", label: "No purchases" });
  if (filters.spendMin != null && filters.spendMax != null) {
    chips.push({ key: "spendRange", label: `Spend ${currencySymbol}${filters.spendMin.toLocaleString()}–${currencySymbol}${filters.spendMax.toLocaleString()}` });
  } else if (filters.spendMax != null) {
    chips.push({ key: "spendRange", label: `Spend up to ${currencySymbol}${filters.spendMax.toLocaleString()}` });
  } else if (filters.spendMin != null) {
    chips.push({ key: "spendRange", label: `Spend from ${currencySymbol}${filters.spendMin.toLocaleString()}` });
  }

  if (filters.dateAdded) chips.push({ key: "dateAdded", label: DATE_ADDED_LABELS[filters.dateAdded] });
  if (filters.dateAddedCustom?.from || filters.dateAddedCustom?.to) {
    chips.push({ key: "dateAddedCustom", label: `Added ${filters.dateAddedCustom.from ?? "…"} – ${filters.dateAddedCustom.to ?? "…"}` });
  }

  if (filters.missingAddress) chips.push({ key: "missingAddress", label: "Missing address" });
  if (filters.missingPhone) chips.push({ key: "missingPhone", label: "Missing phone" });

  return chips;
}

export function clearCustomerFilterChip(filters: CustomerFilterState, key: FilterChip["key"]): CustomerFilterState {
  switch (key) {
    case "lastVisited": return { ...filters, lastVisited: null };
    case "lastVisitedCustom": return { ...filters, lastVisitedCustom: null };
    case "spendRange": return { ...filters, spendMin: null, spendMax: null };
    case "spendPreset": return { ...filters, spendPreset: null };
    case "dateAdded": return { ...filters, dateAdded: null };
    case "dateAddedCustom": return { ...filters, dateAddedCustom: null };
    case "missingAddress": return { ...filters, missingAddress: false };
    case "missingPhone": return { ...filters, missingPhone: false };
    default: return filters;
  }
}

const SORT_LABELS: Record<CustomerSortKey, Record<CustomerSortDirection, string>> = {
  lastVisited: { desc: "Recent", asc: "Oldest" },
  totalSpend: { desc: "High", asc: "Low" },
  dateAdded: { desc: "Newest", asc: "Oldest" },
  name: { asc: "A to Z", desc: "Z to A" },
};

export function customerSortLabel(sort: CustomerSortState | null): string {
  if (!sort) return "Sort";
  return SORT_LABELS[sort.key][sort.direction];
}

export function sortCustomers<T extends FilterableCustomer>(customers: T[], sort: CustomerSortState | null): T[] {
  if (!sort) return customers;
  const dir = sort.direction === "asc" ? 1 : -1;
  const sorted = [...customers];
  sorted.sort((a, b) => {
    switch (sort.key) {
      case "lastVisited": {
        const av = a.lastVisited ? new Date(a.lastVisited).getTime() : -Infinity;
        const bv = b.lastVisited ? new Date(b.lastVisited).getTime() : -Infinity;
        return (av - bv) * dir;
      }
      case "totalSpend":
        return (a.totalSpend - b.totalSpend) * dir;
      case "dateAdded":
        return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir;
      case "name":
        return a.name.localeCompare(b.name) * dir;
      default:
        return 0;
    }
  });
  return sorted;
}
