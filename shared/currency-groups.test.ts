import { describe, it, expect } from "vitest";
import { sumByCurrency, distinctCurrencies, isMixedCurrency } from "./currency-groups";

describe("sumByCurrency", () => {
  it("never adds across currencies", () => {
    const out = sumByCurrency(
      [
        { currency: "NGN", revenue: 100, profit: 40 },
        { currency: "GHS", revenue: 5, profit: 2 },
        { currency: "NGN", revenue: 50, profit: 10 },
      ],
      ["revenue", "profit"],
    );
    expect(out).toEqual([
      { currency: "NGN", revenue: 150, profit: 50 },
      { currency: "GHS", revenue: 5, profit: 2 },
    ]);
  });
  it("returns an empty list for no rows", () => {
    expect(sumByCurrency([], ["revenue"] as never)).toEqual([]);
  });
});

describe("mixed currency detection", () => {
  it("detects one versus several currencies", () => {
    expect(distinctCurrencies([{ currency: "NGN" }, { currency: "NGN" }])).toEqual(["NGN"]);
    expect(isMixedCurrency([{ currency: "NGN" }, { currency: "GHS" }])).toBe(true);
    expect(isMixedCurrency([{ currency: "NGN" }])).toBe(false);
    expect(isMixedCurrency([])).toBe(false);
  });
});
