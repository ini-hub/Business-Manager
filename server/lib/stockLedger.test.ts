import { describe, it, expect } from "vitest";
import { buildStockMovements } from "./stockLedger";

const base = { storeId: "s1", inventoryId: "i1", reason: "sale" as const };

describe("buildStockMovements", () => {
  it("records the signed delta with before and after", () => {
    const [row] = buildStockMovements([{ ...base, before: 10, after: 7 }]);
    expect(row).toMatchObject({ quantityBefore: 10, quantityAfter: 7, delta: -3, reason: "sale" });
  });

  it("drops moves that change nothing", () => {
    expect(buildStockMovements([{ ...base, before: 5, after: 5 }])).toEqual([]);
  });

  it("removes float noise so fractional stock reconciles", () => {
    const [row] = buildStockMovements([{ ...base, before: 0.3, after: 0.1 + 0.2 - 0.25 }]);
    expect(row.delta).toBe(-0.25);
  });

  it("treats a sub-scale difference as no movement", () => {
    expect(buildStockMovements([{ ...base, before: 1, after: 1.00001 }])).toEqual([]);
  });

  it("keeps two moves of one item as two ordered rows", () => {
    const rows = buildStockMovements([
      { ...base, before: 10, after: 8 },
      { ...base, before: 8, after: 5, reason: "consumable_use" },
    ]);
    expect(rows.map((r) => r.delta)).toEqual([-2, -3]);
    expect(rows.reduce((s, r) => s + r.delta, 0)).toBe(-5);
  });

  it("carries the source document and actor", () => {
    const [row] = buildStockMovements([{ ...base, before: 1, after: 2, refType: "checkout", refId: "c1", actorStaffId: "st1", note: "n" }]);
    expect(row).toMatchObject({ refType: "checkout", refId: "c1", actorStaffId: "st1", actorUserId: null, note: "n" });
  });
});
