import { describe, it, expect } from "vitest";
import { archiveStockWarning, stockSummary } from "./archive-stock-warning";

const money = (v: number) => `$${v}`;

describe("stockSummary", () => {
  it("sums units and cost across rows, skipping services and empty rows", () => {
    expect(stockSummary([
      { type: "product", quantity: 4, costPrice: 25 },
      { type: "supply", quantity: "2.5", costPrice: "10" },
      { type: "service", quantity: 99, costPrice: 99 },
      { type: "product", quantity: 0, costPrice: 500 },
      { type: "product", quantity: null, costPrice: 500 },
    ])).toEqual({ units: 6.5, cost: 125 });
  });
});

describe("archiveStockWarning", () => {
  it("is null when there is nothing in stock", () => {
    expect(archiveStockWarning([{ type: "product", quantity: 0, costPrice: 10 }], money)).toBeNull();
    expect(archiveStockWarning([], money)).toBeNull();
  });

  it("names the units and the cost value", () => {
    const text = archiveStockWarning([{ type: "product", quantity: 12, costPrice: 5 }], money)!;
    expect(text).toContain("12 units ($60 at cost)");
    expect(text).toContain("the stock stays recorded");
  });

  it("uses the singular and omits the value when cost is zero", () => {
    const text = archiveStockWarning([{ type: "product", quantity: 1, costPrice: 0 }], money)!;
    expect(text).toContain("1 unit in stock");
    expect(text).not.toContain("at cost");
  });
});
