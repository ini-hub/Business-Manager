import { describe, it, expect } from "vitest";
import { fullUnitCost, lineLossAmount } from "./lossSale";

describe("fullUnitCost", () => {
  it("is just the item cost without a recipe", () => {
    expect(fullUnitCost(500, undefined, new Map())).toBe(500);
  });

  it("adds what the consumables recipe burns per unit", () => {
    const supplies = new Map([["s1", 2000], ["s2", 100]]);
    const recipe = [
      { supplyInventoryId: "s1", quantityPerUnit: 0.01 }, // 20
      { supplyInventoryId: "s2", quantityPerUnit: 3 },    // 300
    ];
    expect(fullUnitCost(500, recipe, supplies)).toBe(820);
  });

  it("treats a supply with unknown cost as free rather than NaN", () => {
    expect(fullUnitCost(500, [{ supplyInventoryId: "gone", quantityPerUnit: 2 }], new Map())).toBe(500);
  });
});

describe("lineLossAmount", () => {
  it("is zero at or above cost", () => {
    expect(lineLossAmount(500, 3, 500)).toBe(0);
    expect(lineLossAmount(600, 3, 500)).toBe(0);
  });

  it("is the shortfall across the whole quantity", () => {
    expect(lineLossAmount(400, 3, 500)).toBe(300);
  });

  it("ignores sub-kobo float noise", () => {
    expect(lineLossAmount(0.1 + 0.2, 1, 0.3)).toBe(0);
  });
});
