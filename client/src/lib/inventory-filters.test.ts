import { describe, it, expect } from "vitest";
import {
  EMPTY_INVENTORY_FILTERS,
  LOW_STOCK_FILTERS,
  buildInventoryFilterChips,
  clearInventoryFilterChip,
  countActiveInventoryFilters,
  filtersFromLegacyView,
  inventoryMatchesFilters,
  inventoryMatchesSearch,
  sortInventory,
  urgentFirst,
} from "./inventory-filters";

const it_ = (name: string, type: string, stockStatus: string, totalStock: number, price: number, margin: number, o: Record<string, unknown> = {}) =>
  ({ name, type, stockStatus, totalStock, price, margin, category: "Hair", createdAt: "2026-09-01", ...o });
const rows = [
  it_("Shampoo", "supply", "Low Stock", 2, 500, 40),
  it_("Wig", "product", "In Stock", 20, 90000, 55, { category: "Retail", createdAt: "2026-09-20" }),
  it_("Cut", "service", "In Stock", 0, 3000, 80),
  it_("Gel", "product", "Out of Stock", 0, 1500, 30),
];
const names = (f: Parameters<typeof inventoryMatchesFilters>[1]) => rows.filter((r) => inventoryMatchesFilters(r, f)).map((r) => r.name);

describe("inventory filters", () => {
  it("matches all when empty", () => expect(names(EMPTY_INVENTORY_FILTERS)).toHaveLength(4));
  it("filters by type (multi) and stock status", () => {
    expect(names({ ...EMPTY_INVENTORY_FILTERS, types: ["product", "supply"] })).toEqual(["Shampoo", "Wig", "Gel"]);
    expect(names({ ...EMPTY_INVENTORY_FILTERS, stock: ["out"] })).toEqual(["Gel"]);
  });
  it("low-stock preset = low or out, and never includes services", () => {
    expect(names(LOW_STOCK_FILTERS)).toEqual(["Shampoo", "Gel"]);
  });
  it("maps legacy ?view= values", () => {
    expect(filtersFromLegacyView("low-stock")).toEqual(LOW_STOCK_FILTERS);
    expect(filtersFromLegacyView("service").types).toEqual(["service"]);
    expect(filtersFromLegacyView("all")).toEqual(EMPTY_INVENTORY_FILTERS);
    expect(filtersFromLegacyView("audits")).toEqual(EMPTY_INVENTORY_FILTERS);
  });
  it("filters by category, price and margin", () => {
    expect(names({ ...EMPTY_INVENTORY_FILTERS, categories: ["Retail"] })).toEqual(["Wig"]);
    expect(names({ ...EMPTY_INVENTORY_FILTERS, priceMin: 1000, priceMax: 5000 })).toEqual(["Cut", "Gel"]);
    expect(names({ ...EMPTY_INVENTORY_FILTERS, marginMin: 50 })).toEqual(["Wig", "Cut"]);
  });
  it("searches name and category", () => {
    expect(rows.filter((r) => inventoryMatchesSearch(r, "retail")).length).toBe(1);
    expect(rows.filter((r) => inventoryMatchesSearch(r, "SHAM")).length).toBe(1);
  });
  it("counts, builds and clears chips", () => {
    const f = { ...EMPTY_INVENTORY_FILTERS, types: ["product" as const], marginMin: 10 };
    expect(countActiveInventoryFilters(f)).toBe(2);
    expect(buildInventoryFilterChips(f, "₦").map((c) => c.label)).toEqual(["Products", "Margin 10% or more"]);
    expect(clearInventoryFilterChip(f, "margin").marginMin).toBeNull();
  });
  it("sorts, urgent-first puts out of stock then lowest quantity first", () => {
    expect(sortInventory(rows, { key: "name" })[0].name).toBe("Cut");
    expect(sortInventory(rows, { key: "margin" })[0].name).toBe("Cut");
    expect(sortInventory(rows, { key: "newest" })[0].name).toBe("Wig");
    expect([...rows].sort(urgentFirst).map((r) => r.name)).toEqual(["Cut", "Gel", "Shampoo", "Wig"]);
  });
});
