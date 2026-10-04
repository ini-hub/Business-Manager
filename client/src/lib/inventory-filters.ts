/**
 * Pure filter/sort logic for the Inventory items list's Filters + Sort bottom sheets.
 * Framework-free so it can be unit tested without mounting the page.
 */

export type InventoryItemType = "product" | "service" | "supply";
export type InventoryStockStatus = "in" | "low" | "out";

export interface InventoryFilterState {
  types: InventoryItemType[];
  stock: InventoryStockStatus[];
  categories: string[];
  priceMin: number | null;
  priceMax: number | null;
  marginMin: number | null;
  marginMax: number | null;
}

export const EMPTY_INVENTORY_FILTERS: InventoryFilterState = {
  types: [], stock: [], categories: [], priceMin: null, priceMax: null, marginMin: null, marginMax: null,
};

/** What the old "Low Stock" tab (and the dashboard's ?view=low-stock link) means now. */
export const LOW_STOCK_FILTERS: InventoryFilterState = { ...EMPTY_INVENTORY_FILTERS, stock: ["low", "out"] };

/** Maps the legacy ?view= values (type tabs and low-stock) onto filters. */
export function filtersFromLegacyView(view: string): InventoryFilterState {
  if (view === "low-stock") return LOW_STOCK_FILTERS;
  if (view === "product" || view === "service" || view === "supply") return { ...EMPTY_INVENTORY_FILTERS, types: [view] };
  return EMPTY_INVENTORY_FILTERS;
}

export type InventorySortKey = "lowestStock" | "margin" | "newest" | "name";
export interface InventorySortState {
  key: InventorySortKey;
}

export interface FilterableInventory {
  name: string;
  type: string;
  category?: string | null;
  /** "In Stock" | "Low Stock" | "Out of Stock" */
  stockStatus: string;
  totalStock: number;
  price: number;
  margin: number;
  createdAt?: string | Date | null;
}

export const TYPE_LABELS: Record<InventoryItemType, string> = { product: "Products", service: "Services", supply: "Supplies" };
export const STOCK_LABELS: Record<InventoryStockStatus, string> = { in: "In stock", low: "Low stock", out: "Out of stock" };

const stockKey = (status: string): InventoryStockStatus =>
  status === "Out of Stock" ? "out" : status === "Low Stock" ? "low" : "in";

export function inventoryMatchesFilters<T extends FilterableInventory>(i: T, f: InventoryFilterState): boolean {
  if (f.types.length > 0 && !f.types.includes(i.type as InventoryItemType)) return false;
  if (f.stock.length > 0 && !f.stock.includes(stockKey(i.stockStatus))) return false;
  if (f.categories.length > 0 && !f.categories.includes(i.category || "Uncategorized")) return false;
  if (f.priceMin != null && i.price < f.priceMin) return false;
  if (f.priceMax != null && i.price > f.priceMax) return false;
  if (f.marginMin != null && i.margin < f.marginMin) return false;
  if (f.marginMax != null && i.margin > f.marginMax) return false;
  return true;
}

export function inventoryMatchesSearch(i: FilterableInventory, term: string): boolean {
  const q = term.trim().toLowerCase();
  if (!q) return true;
  return i.name.toLowerCase().includes(q) || (i.category ?? "").toLowerCase().includes(q);
}

const hasRange = (min: number | null, max: number | null) => min != null || max != null;

export function countActiveInventoryFilters(f: InventoryFilterState): number {
  return (
    (f.types.length > 0 ? 1 : 0) +
    (f.stock.length > 0 ? 1 : 0) +
    (f.categories.length > 0 ? 1 : 0) +
    (hasRange(f.priceMin, f.priceMax) ? 1 : 0) +
    (hasRange(f.marginMin, f.marginMax) ? 1 : 0)
  );
}

export function rangeSummary(min: number | null, max: number | null, fmt: (n: number) => string): string | null {
  if (min != null && max != null) return `${fmt(min)} to ${fmt(max)}`;
  if (min != null) return `${fmt(min)} or more`;
  if (max != null) return `Up to ${fmt(max)}`;
  return null;
}

export interface InventoryFilterChip {
  key: "types" | "stock" | "categories" | "price" | "margin";
  label: string;
}

export function buildInventoryFilterChips(f: InventoryFilterState, symbol: string): InventoryFilterChip[] {
  const chips: InventoryFilterChip[] = [];
  if (f.types.length > 0) chips.push({ key: "types", label: f.types.map((t) => TYPE_LABELS[t]).join(", ") });
  if (f.stock.length > 0) chips.push({ key: "stock", label: f.stock.map((s) => STOCK_LABELS[s]).join(", ") });
  if (f.categories.length > 0) chips.push({ key: "categories", label: f.categories.join(", ") });
  const price = rangeSummary(f.priceMin, f.priceMax, (n) => `${symbol}${n.toLocaleString()}`);
  if (price) chips.push({ key: "price", label: `Price ${price}` });
  const margin = rangeSummary(f.marginMin, f.marginMax, (n) => `${n}%`);
  if (margin) chips.push({ key: "margin", label: `Margin ${margin}` });
  return chips;
}

export function clearInventoryFilterChip(f: InventoryFilterState, key: InventoryFilterChip["key"]): InventoryFilterState {
  switch (key) {
    case "types": return { ...f, types: [] };
    case "stock": return { ...f, stock: [] };
    case "categories": return { ...f, categories: [] };
    case "price": return { ...f, priceMin: null, priceMax: null };
    case "margin": return { ...f, marginMin: null, marginMax: null };
  }
}

export function inventorySortLabel(sort: InventorySortState | null): string {
  if (!sort) return "Sort";
  return { lowestStock: "Sort: Lowest stock", margin: "Sort: Highest margin", newest: "Sort: Newest", name: "Sort: Name" }[sort.key];
}

/** Out of stock first, then ascending quantity: the items needing the most urgent attention lead. */
export const urgentFirst = <T extends FilterableInventory>(a: T, b: T) => {
  const aOut = a.totalStock === 0 ? 0 : 1;
  const bOut = b.totalStock === 0 ? 0 : 1;
  return aOut !== bOut ? aOut - bOut : a.totalStock - b.totalStock;
};

export function sortInventory<T extends FilterableInventory>(rows: T[], sort: InventorySortState | null): T[] {
  if (!sort) return rows;
  const time = (i: T) => (i.createdAt ? new Date(i.createdAt).getTime() : 0);
  return [...rows].sort((a, b) => {
    switch (sort.key) {
      case "lowestStock": return a.totalStock - b.totalStock;
      case "margin": return b.margin - a.margin;
      case "newest": return time(b) - time(a);
      case "name": return a.name.localeCompare(b.name);
    }
  });
}
