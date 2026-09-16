import { describe, it, expect } from "vitest";
import {
  calculateProjectedGrossMargin,
  formatProjectedGrossMargin,
  effectiveReorderPoint,
  isOutOfStock,
  isAtOrBelowReorderPoint,
  formatStockAlertCopy,
} from "./inventory-metrics";

describe("calculateProjectedGrossMargin", () => {
  it("370,280 cost / 463,450 retail -> 20.1%", () => {
    expect(formatProjectedGrossMargin(370280, 463450)).toBe("20.1%");
  });

  it("7 cost / 10 retail -> 30.0%", () => {
    expect(formatProjectedGrossMargin(7, 10)).toBe("30.0%");
  });

  it("0 cost / 0 retail -> n/a", () => {
    expect(formatProjectedGrossMargin(0, 0)).toBe("n/a");
  });

  it("returns null (not 0) for zero retail value", () => {
    expect(calculateProjectedGrossMargin(0, 0)).toBeNull();
  });

  it("handles cost exceeding retail (negative margin)", () => {
    expect(formatProjectedGrossMargin(120, 100)).toBe("-20.0%");
  });
});

describe("effectiveReorderPoint", () => {
  it("uses the store threshold when the variant has no reorderPoint", () => {
    expect(effectiveReorderPoint({ reorderPoint: null }, 5)).toBe(5);
    expect(effectiveReorderPoint({}, 5)).toBe(5);
  });

  it("overrides with the variant's own reorderPoint when set, including 0", () => {
    expect(effectiveReorderPoint({ reorderPoint: 10 }, 5)).toBe(10);
    expect(effectiveReorderPoint({ reorderPoint: 0 }, 5)).toBe(0);
  });
});

describe("isOutOfStock / isAtOrBelowReorderPoint", () => {
  it("distinguishes out-of-stock from merely low", () => {
    expect(isOutOfStock({ quantity: 0 })).toBe(true);
    expect(isOutOfStock({ quantity: 1 })).toBe(false);
  });

  it("respects a per-item reorderPoint override", () => {
    expect(isAtOrBelowReorderPoint({ quantity: 8, reorderPoint: 10 }, 5)).toBe(true);
    expect(isAtOrBelowReorderPoint({ quantity: 8, reorderPoint: null }, 5)).toBe(false);
  });
});

describe("formatStockAlertCopy", () => {
  it("singular for exactly one item", () => {
    expect(formatStockAlertCopy(1, 0)).toBe("1 item is at or below their reorder level");
  });

  it("plural for more than one, combining out-of-stock and low counts", () => {
    expect(formatStockAlertCopy(2, 3)).toBe("5 items are at or below their reorder level");
  });
});
