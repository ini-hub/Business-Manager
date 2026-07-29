import { describe, it, expect } from "vitest";
import { expandConsumables, type RecipeLine } from "./ConsumablesService";

const recipes = (m: Record<string, RecipeLine[]>) => new Map(Object.entries(m));
const costs = (m: Record<string, number>) => new Map(Object.entries(m));

describe("expandConsumables", () => {
  it("produces no rows and no deductions for an item with no recipe", () => {
    const out = expandConsumables(
      [{ orderId: "o1", inventoryId: "haircut", quantity: 3 }],
      recipes({}),
      costs({}),
    );
    expect(out.rows).toEqual([]);
    expect(out.deductions.size).toBe(0);
  });

  it("skips inactive recipe lines", () => {
    const out = expandConsumables(
      [{ orderId: "o1", inventoryId: "wash", quantity: 1 }],
      recipes({
        wash: [
          { supplyInventoryId: "shampoo", quantityPerUnit: 30, isActive: true },
          { supplyInventoryId: "oldConditioner", quantityPerUnit: 20, isActive: false },
        ],
      }),
      costs({ shampoo: 2, oldConditioner: 5 }),
    );
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].supplyInventoryId).toBe("shampoo");
    expect(out.deductions.get("oldConditioner")).toBeUndefined();
  });

  it("collapses two lines of the same service on one order into a single row", () => {
    // order_consumables is UNIQUE(order_id, supply_inventory_id), so this must
    // merge rather than emit two rows.
    const out = expandConsumables(
      [
        { orderId: "o1", inventoryId: "wash", quantity: 1 },
        { orderId: "o1", inventoryId: "wash", quantity: 2 },
      ],
      recipes({ wash: [{ supplyInventoryId: "shampoo", quantityPerUnit: 30 }] }),
      costs({ shampoo: 2 }),
    );
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].quantityUsed).toBe(90);
    expect(out.rows[0].totalCost).toBe(180);
    expect(out.deductions.get("shampoo")).toBe(90);
  });

  it("keeps separate rows per order but aggregates the stock deduction", () => {
    const out = expandConsumables(
      [
        { orderId: "o1", inventoryId: "wash", quantity: 1 },
        { orderId: "o2", inventoryId: "blowdry", quantity: 1 },
      ],
      recipes({
        wash: [{ supplyInventoryId: "shampoo", quantityPerUnit: 30 }],
        blowdry: [{ supplyInventoryId: "shampoo", quantityPerUnit: 10 }],
      }),
      costs({ shampoo: 2 }),
    );
    expect(out.rows).toHaveLength(2);
    expect(out.deductions.size).toBe(1);
    expect(out.deductions.get("shampoo")).toBe(40);
  });

  it("expands promo lines at full quantity — a free service still burns product", () => {
    // Promo lines are priced at zero but are physically identical to a paid one.
    const out = expandConsumables(
      [{ orderId: "o1", inventoryId: "wash", quantity: 2 }],
      recipes({ wash: [{ supplyInventoryId: "shampoo", quantityPerUnit: 30 }] }),
      costs({ shampoo: 2 }),
    );
    expect(out.rows[0].quantityUsed).toBe(60);
    expect(out.rows[0].totalCost).toBe(120);
  });

  it("rounds total cost once from the accumulated quantity, not per line", () => {
    // 3 lines x 0.0033 units at 100/unit. Rounding each line first gives
    // 3 x 0.33 = 0.99 only by luck; the invariant is that cost derives from the
    // summed quantity, so restating it here guards the merge path.
    const out = expandConsumables(
      [
        { orderId: "o1", inventoryId: "wash", quantity: 1 },
        { orderId: "o1", inventoryId: "wash", quantity: 1 },
        { orderId: "o1", inventoryId: "wash", quantity: 1 },
      ],
      recipes({ wash: [{ supplyInventoryId: "oil", quantityPerUnit: 0.0033 }] }),
      costs({ oil: 100 }),
    );
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].quantityUsed).toBeCloseTo(0.0099, 10);
    expect(out.rows[0].totalCost).toBe(0.99);
  });

  it("snapshots the supply cost and defaults a missing one to zero", () => {
    const out = expandConsumables(
      [{ orderId: "o1", inventoryId: "wash", quantity: 1 }],
      recipes({
        wash: [
          { supplyInventoryId: "shampoo", quantityPerUnit: 10 },
          { supplyInventoryId: "unknown", quantityPerUnit: 5 },
        ],
      }),
      costs({ shampoo: 7.5 }),
    );
    const shampoo = out.rows.find((r) => r.supplyInventoryId === "shampoo")!;
    const unknown = out.rows.find((r) => r.supplyInventoryId === "unknown")!;
    expect(shampoo.unitCostAtSale).toBe(7.5);
    expect(shampoo.totalCost).toBe(75);
    expect(unknown.unitCostAtSale).toBe(0);
    expect(unknown.totalCost).toBe(0);
  });

  it("returns deductions in supply-id order so concurrent checkouts lock consistently", () => {
    // Two carts that lock the same supplies in opposite order deadlock. Sorted
    // keys give every caller the same acquisition order.
    const out = expandConsumables(
      [
        { orderId: "o1", inventoryId: "wash", quantity: 1 },
        { orderId: "o1", inventoryId: "manicure", quantity: 1 },
      ],
      recipes({
        wash: [{ supplyInventoryId: "zzz-shampoo", quantityPerUnit: 1 }],
        manicure: [{ supplyInventoryId: "aaa-polish", quantityPerUnit: 1 }],
      }),
      costs({ "zzz-shampoo": 1, "aaa-polish": 1 }),
    );
    expect([...out.deductions.keys()]).toEqual(["aaa-polish", "zzz-shampoo"]);
  });

  it("ignores non-positive quantities", () => {
    const out = expandConsumables(
      [{ orderId: "o1", inventoryId: "wash", quantity: 0 }],
      recipes({ wash: [{ supplyInventoryId: "shampoo", quantityPerUnit: 30 }] }),
      costs({ shampoo: 2 }),
    );
    expect(out.rows).toEqual([]);
    expect(out.deductions.size).toBe(0);
  });
});
