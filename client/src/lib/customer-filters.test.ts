import { describe, it, expect } from "vitest";
import {
  EMPTY_CUSTOMER_FILTERS,
  customerMatchesFilters,
  computeTopSpendThreshold,
  countActiveCustomerFilters,
  buildCustomerFilterChips,
  clearCustomerFilterChip,
  customerSortLabel,
  sortCustomers,
  type FilterableCustomer,
  type CustomerFilterState,
} from "./customer-filters";

const NOW = new Date("2026-09-16T00:00:00Z");

function makeCustomer(overrides: Partial<FilterableCustomer> = {}): FilterableCustomer {
  return {
    id: "1",
    name: "Laura",
    totalSpend: 0,
    lastVisited: null,
    createdAt: "2026-01-01T00:00:00Z",
    address: "1 Main St",
    mobileNumber: "08010000000",
    ...overrides,
  };
}

describe("customerMatchesFilters", () => {
  it("matches everything when no filters are set", () => {
    expect(customerMatchesFilters(makeCustomer(), EMPTY_CUSTOMER_FILTERS, Infinity, NOW)).toBe(true);
  });

  it("filters by last visited within 7 days", () => {
    const recent = makeCustomer({ lastVisited: "2026-09-14T00:00:00Z" });
    const old = makeCustomer({ lastVisited: "2026-08-01T00:00:00Z" });
    const filters: CustomerFilterState = { ...EMPTY_CUSTOMER_FILTERS, lastVisited: "7d" };
    expect(customerMatchesFilters(recent, filters, Infinity, NOW)).toBe(true);
    expect(customerMatchesFilters(old, filters, Infinity, NOW)).toBe(false);
  });

  it("filters by never visited", () => {
    const never = makeCustomer({ lastVisited: null });
    const visited = makeCustomer({ lastVisited: "2026-08-01T00:00:00Z" });
    const filters: CustomerFilterState = { ...EMPTY_CUSTOMER_FILTERS, lastVisited: "never" };
    expect(customerMatchesFilters(never, filters, Infinity, NOW)).toBe(true);
    expect(customerMatchesFilters(visited, filters, Infinity, NOW)).toBe(false);
  });

  it("filters 30+ days ago as strictly more than 30 days", () => {
    const filters: CustomerFilterState = { ...EMPTY_CUSTOMER_FILTERS, lastVisited: "30d+" };
    expect(customerMatchesFilters(makeCustomer({ lastVisited: "2026-08-01T00:00:00Z" }), filters, Infinity, NOW)).toBe(true);
    expect(customerMatchesFilters(makeCustomer({ lastVisited: "2026-09-10T00:00:00Z" }), filters, Infinity, NOW)).toBe(false);
  });

  it("filters by spend range", () => {
    const filters: CustomerFilterState = { ...EMPTY_CUSTOMER_FILTERS, spendMin: 1000, spendMax: 5000 };
    expect(customerMatchesFilters(makeCustomer({ totalSpend: 3000 }), filters, Infinity, NOW)).toBe(true);
    expect(customerMatchesFilters(makeCustomer({ totalSpend: 500 }), filters, Infinity, NOW)).toBe(false);
    expect(customerMatchesFilters(makeCustomer({ totalSpend: 9000 }), filters, Infinity, NOW)).toBe(false);
  });

  it("filters top10 spenders using the supplied threshold", () => {
    const filters: CustomerFilterState = { ...EMPTY_CUSTOMER_FILTERS, spendPreset: "top10" };
    expect(customerMatchesFilters(makeCustomer({ totalSpend: 10000 }), filters, 9000, NOW)).toBe(true);
    expect(customerMatchesFilters(makeCustomer({ totalSpend: 8000 }), filters, 9000, NOW)).toBe(false);
  });

  it("filters no-purchase customers", () => {
    const filters: CustomerFilterState = { ...EMPTY_CUSTOMER_FILTERS, spendPreset: "none" };
    expect(customerMatchesFilters(makeCustomer({ totalSpend: 0 }), filters, Infinity, NOW)).toBe(true);
    expect(customerMatchesFilters(makeCustomer({ totalSpend: 1 }), filters, Infinity, NOW)).toBe(false);
  });

  it("filters missing address (blank counts as missing)", () => {
    const filters: CustomerFilterState = { ...EMPTY_CUSTOMER_FILTERS, missingAddress: true };
    expect(customerMatchesFilters(makeCustomer({ address: "" }), filters, Infinity, NOW)).toBe(true);
    expect(customerMatchesFilters(makeCustomer({ address: "  " }), filters, Infinity, NOW)).toBe(true);
    expect(customerMatchesFilters(makeCustomer({ address: "1 Main St" }), filters, Infinity, NOW)).toBe(false);
  });

  it("filters missing phone", () => {
    const filters: CustomerFilterState = { ...EMPTY_CUSTOMER_FILTERS, missingPhone: true };
    expect(customerMatchesFilters(makeCustomer({ mobileNumber: null }), filters, Infinity, NOW)).toBe(true);
    expect(customerMatchesFilters(makeCustomer({ mobileNumber: "08010000000" }), filters, Infinity, NOW)).toBe(false);
  });
});

describe("computeTopSpendThreshold", () => {
  it("returns Infinity for an empty list (nothing qualifies)", () => {
    expect(computeTopSpendThreshold([])).toBe(Infinity);
  });

  it("returns the value at the 90th percentile", () => {
    const spends = Array.from({ length: 10 }, (_, i) => (i + 1) * 100);
    expect(computeTopSpendThreshold(spends)).toBe(1000);
  });
});

describe("countActiveCustomerFilters", () => {
  it("counts zero for the empty state", () => {
    expect(countActiveCustomerFilters(EMPTY_CUSTOMER_FILTERS)).toBe(0);
  });

  it("counts each independently-set group once", () => {
    const filters: CustomerFilterState = {
      ...EMPTY_CUSTOMER_FILTERS,
      lastVisited: "30d+",
      spendMax: 10000,
    };
    expect(countActiveCustomerFilters(filters)).toBe(2);
  });
});

describe("buildCustomerFilterChips / clearCustomerFilterChip", () => {
  it("builds one chip per active filter and clears just that one", () => {
    const filters: CustomerFilterState = { ...EMPTY_CUSTOMER_FILTERS, lastVisited: "30d+", spendMax: 10000 };
    const chips = buildCustomerFilterChips(filters, "₦");
    expect(chips).toEqual([
      { key: "lastVisited", label: "Visited 30+ days ago" },
      { key: "spendRange", label: "Spend up to ₦10,000" },
    ]);
    const cleared = clearCustomerFilterChip(filters, "lastVisited");
    expect(cleared.lastVisited).toBeNull();
    expect(cleared.spendMax).toBe(10000);
  });
});

describe("customerSortLabel / sortCustomers", () => {
  it("labels the default (no sort) state as 'Sort'", () => {
    expect(customerSortLabel(null)).toBe("Sort");
  });

  it("labels each sort key/direction combination", () => {
    expect(customerSortLabel({ key: "lastVisited", direction: "desc" })).toBe("Recent");
    expect(customerSortLabel({ key: "totalSpend", direction: "asc" })).toBe("Low");
    expect(customerSortLabel({ key: "name", direction: "asc" })).toBe("A to Z");
  });

  it("sorts by total spend descending", () => {
    const customers = [makeCustomer({ id: "a", totalSpend: 100 }), makeCustomer({ id: "b", totalSpend: 300 })];
    const sorted = sortCustomers(customers, { key: "totalSpend", direction: "desc" });
    expect(sorted.map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("returns the original order unsorted when sort is null", () => {
    const customers = [makeCustomer({ id: "a" }), makeCustomer({ id: "b" })];
    expect(sortCustomers(customers, null)).toEqual(customers);
  });
});
