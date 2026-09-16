/**
 * Pure filter logic for the Sales ledger's single Filters bottom sheet plus its
 * quick-access chips (Returns, Credit, Staff purchases). Mirrors customer-filters.ts.
 */

export type SaleItemType = "service" | "product" | "mixed";

export interface SaleFilterState {
  paymentMethod: string | null;
  staffId: string | null;
  itemType: SaleItemType | null;
  amountMin: number | null;
  amountMax: number | null;
  returnsOnly: boolean;
  creditOnly: boolean;
  staffPurchasesOnly: boolean;
}

export const EMPTY_SALE_FILTERS: SaleFilterState = {
  paymentMethod: null,
  staffId: null,
  itemType: null,
  amountMin: null,
  amountMax: null,
  returnsOnly: false,
  creditOnly: false,
  staffPurchasesOnly: false,
};

export interface FilterableSale {
  id: string | number;
  amount: number;
  paymentMethod: string;
  paymentStatus?: string | null;
  staffId: string | null;
  inventoryType: string | null;
  isReturned: boolean;
  isStaffPurchase: boolean;
}

export function saleMatchesFilters<T extends FilterableSale>(
  sale: T,
  filters: SaleFilterState
): boolean {
  const { paymentMethod, staffId, itemType, amountMin, amountMax, returnsOnly, creditOnly, staffPurchasesOnly } = filters;

  if (paymentMethod && sale.paymentMethod !== paymentMethod) return false;
  if (staffId && sale.staffId !== staffId) return false;
  if (itemType && sale.inventoryType !== itemType) return false;
  if (amountMin != null && sale.amount < amountMin) return false;
  if (amountMax != null && sale.amount > amountMax) return false;
  if (returnsOnly && !sale.isReturned) return false;
  if (creditOnly && sale.paymentStatus !== "pending") return false;
  if (staffPurchasesOnly && !sale.isStaffPurchase) return false;

  return true;
}

export function countActiveSaleFilters(filters: SaleFilterState): number {
  let count = 0;
  if (filters.paymentMethod) count++;
  if (filters.staffId) count++;
  if (filters.itemType) count++;
  if (filters.amountMin != null || filters.amountMax != null) count++;
  return count;
}

export interface SaleFilterChip {
  key: keyof SaleFilterState | "amountRange";
  label: string;
}

const ITEM_TYPE_LABELS: Record<SaleItemType, string> = {
  service: "Service",
  product: "Product",
  mixed: "Mixed",
};

/** Builds the removable-chip list for filters set inside the sheet — the quick chips
 * (Returns/Credit/Staff purchases) render their own active state directly, not via this list. */
export function buildSaleFilterChips(
  filters: SaleFilterState,
  currencySymbol: string,
  staffNameFor: (staffId: string) => string
): SaleFilterChip[] {
  const chips: SaleFilterChip[] = [];

  if (filters.paymentMethod) {
    chips.push({ key: "paymentMethod", label: filters.paymentMethod.charAt(0).toUpperCase() + filters.paymentMethod.slice(1) });
  }
  if (filters.staffId) {
    chips.push({ key: "staffId", label: staffNameFor(filters.staffId) });
  }
  if (filters.itemType) {
    chips.push({ key: "itemType", label: ITEM_TYPE_LABELS[filters.itemType] });
  }
  if (filters.amountMin != null && filters.amountMax != null) {
    chips.push({ key: "amountRange", label: `${currencySymbol}${filters.amountMin.toLocaleString()}–${currencySymbol}${filters.amountMax.toLocaleString()}` });
  } else if (filters.amountMax != null) {
    chips.push({ key: "amountRange", label: `Up to ${currencySymbol}${filters.amountMax.toLocaleString()}` });
  } else if (filters.amountMin != null) {
    chips.push({ key: "amountRange", label: `From ${currencySymbol}${filters.amountMin.toLocaleString()}` });
  }

  return chips;
}

export function clearSaleFilterChip(filters: SaleFilterState, key: SaleFilterChip["key"]): SaleFilterState {
  switch (key) {
    case "paymentMethod": return { ...filters, paymentMethod: null };
    case "staffId": return { ...filters, staffId: null };
    case "itemType": return { ...filters, itemType: null };
    case "amountRange": return { ...filters, amountMin: null, amountMax: null };
    default: return filters;
  }
}

/**
 * Sort — consolidated into the same Filters sheet as a "Sort by" section rather than a
 * separate button (unlike the Customers list, which has independent Filters/Sort sheets),
 * since the sales toolbar only has room for one control alongside search. Mirrors
 * customer-filters.ts's sort shape/labels so the two lists stay consistent under the hood.
 */
export type SaleSortKey = "date" | "amount" | "customer";
export type SaleSortDirection = "asc" | "desc";
export interface SaleSortState {
  key: SaleSortKey;
  direction: SaleSortDirection;
}

const SALE_SORT_LABELS: Record<SaleSortKey, Record<SaleSortDirection, string>> = {
  date: { desc: "Newest", asc: "Oldest" },
  amount: { desc: "High", asc: "Low" },
  customer: { asc: "A to Z", desc: "Z to A" },
};

export function saleSortLabel(sort: SaleSortState | null): string {
  if (!sort) return "Sort: Newest";
  return `Sort: ${SALE_SORT_LABELS[sort.key][sort.direction]}`;
}

export interface SortableSale {
  transactionDate: string | Date;
  amount: number;
  customerName: string;
}

export function sortSales<T extends SortableSale>(sales: T[], sort: SaleSortState | null): T[] {
  if (!sort) return sales;
  const dir = sort.direction === "asc" ? 1 : -1;
  const sorted = [...sales];
  sorted.sort((a, b) => {
    switch (sort.key) {
      case "date":
        return (new Date(a.transactionDate).getTime() - new Date(b.transactionDate).getTime()) * dir;
      case "amount":
        return (a.amount - b.amount) * dir;
      case "customer":
        return a.customerName.localeCompare(b.customerName) * dir;
      default:
        return 0;
    }
  });
  return sorted;
}
