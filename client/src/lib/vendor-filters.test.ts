import { describe, it, expect } from "vitest";
import {
  EMPTY_VENDOR_FILTERS,
  buildVendorFilterChips,
  clearVendorFilterChip,
  countActiveVendorFilters,
  sortVendors,
  vendorMatchesFilters,
} from "./vendor-filters";

const now = new Date("2026-10-01T00:00:00Z");
const vendors = [
  { name: "Acme", outstandingBalance: 500, openOrders: 2, lastOrderAt: "2026-09-20T00:00:00Z" },
  { name: "Bolt", outstandingBalance: 0, openOrders: 0, lastOrderAt: "2026-05-01T00:00:00Z" },
  { name: "Cask", outstandingBalance: 0, openOrders: 0, lastOrderAt: null },
];
const names = (f: Parameters<typeof vendorMatchesFilters>[1]) =>
  vendors.filter((v) => vendorMatchesFilters(v, f, now)).map((v) => v.name);

describe("vendor filters", () => {
  it("empty filters match all", () => {
    expect(names(EMPTY_VENDOR_FILTERS)).toEqual(["Acme", "Bolt", "Cask"]);
  });
  it("filters by balance and orders", () => {
    expect(names({ ...EMPTY_VENDOR_FILTERS, balance: "owing" })).toEqual(["Acme"]);
    expect(names({ ...EMPTY_VENDOR_FILTERS, balance: "settled" })).toEqual(["Bolt", "Cask"]);
    expect(names({ ...EMPTY_VENDOR_FILTERS, orders: "open" })).toEqual(["Acme"]);
  });
  it("filters by last order window", () => {
    expect(names({ ...EMPTY_VENDOR_FILTERS, lastOrder: "30d" })).toEqual(["Acme"]);
    expect(names({ ...EMPTY_VENDOR_FILTERS, lastOrder: "90d+" })).toEqual(["Bolt", "Cask"]);
    expect(names({ ...EMPTY_VENDOR_FILTERS, lastOrder: "never" })).toEqual(["Cask"]);
  });
  it("counts, builds and clears chips", () => {
    const f = { ...EMPTY_VENDOR_FILTERS, balance: "owing" as const, orders: "open" as const };
    expect(countActiveVendorFilters(f)).toBe(2);
    expect(buildVendorFilterChips(f).map((c) => c.key)).toEqual(["balance", "orders"]);
    expect(clearVendorFilterChip(f, "balance").balance).toBeNull();
  });
  it("sorts", () => {
    expect(sortVendors(vendors, { key: "name", direction: "asc" }).map((v) => v.name)).toEqual(["Acme", "Bolt", "Cask"]);
    expect(sortVendors(vendors, { key: "lastOrder", direction: "desc" }).map((v) => v.name)).toEqual(["Acme", "Bolt", "Cask"]);
    expect(sortVendors(vendors, { key: "outstanding", direction: "desc" })[0].name).toBe("Acme");
  });
});
