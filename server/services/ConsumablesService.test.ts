import { describe, it, expect } from "vitest";
import { expandConsumables, deriveCalibration, type RecipeLine } from "./ConsumablesService";

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

describe("deriveCalibration", () => {
  it("scales the rate up when more was really used than the recipe assumed", () => {
    // Assumed 2/service over 10 services = 20 theoretical; 40 actually went.
    const out = deriveCalibration({
      actualConsumed: 40,
      recipes: [{ id: "r1", itemName: "Wash", quantityPerUnit: 2, servicesSold: 10 }],
    });
    expect(out.theoretical).toBe(20);
    expect(out.factor).toBe(2);
    expect(out.updates[0]).toMatchObject({ from: 2, to: 4, clamped: false });
  });

  it("scales the rate down when the recipe over-stated usage", () => {
    const out = deriveCalibration({
      actualConsumed: 40,
      recipes: [{ id: "r1", itemName: "Wash", quantityPerUnit: 8, servicesSold: 10 }],
    });
    expect(out.factor).toBe(0.5);
    expect(out.updates[0].to).toBe(4);
  });

  it("keeps relative proportions across services sharing one supply", () => {
    // One count is one equation: it can recover the overall level, not which
    // service is the heavy user. So both rates move by the same factor.
    const out = deriveCalibration({
      actualConsumed: 300,
      recipes: [
        { id: "wash", itemName: "Wash", quantityPerUnit: 10, servicesSold: 10 },
        { id: "colour", itemName: "Colour", quantityPerUnit: 20, servicesSold: 5 },
      ],
    });
    expect(out.theoretical).toBe(200);
    expect(out.factor).toBe(1.5);
    expect(out.updates.map((u) => u.to)).toEqual([15, 30]);
    // Ratio preserved: colour still uses exactly twice what wash uses.
    expect(out.updates[1].to / out.updates[0].to).toBe(2);
  });

  it("refuses to derive a rate when nothing was sold, rather than dividing by zero", () => {
    const out = deriveCalibration({
      actualConsumed: 25,
      recipes: [{ id: "r1", itemName: "Wash", quantityPerUnit: 2, servicesSold: 0 }],
    });
    expect(out.factor).toBeNull();
    expect(out.updates).toEqual([]);
    expect(out.reason).toMatch(/nothing that uses this supply was sold/i);
  });

  it("refuses when there are no recipes at all", () => {
    const out = deriveCalibration({ actualConsumed: 10, recipes: [] });
    expect(out.factor).toBeNull();
    expect(out.reason).toMatch(/no active recipes/i);
  });

  it("refuses when the count shows no net usage", () => {
    const out = deriveCalibration({
      actualConsumed: 0,
      recipes: [{ id: "r1", itemName: "Wash", quantityPerUnit: 2, servicesSold: 10 }],
    });
    expect(out.factor).toBeNull();
    expect(out.reason).toMatch(/no net usage/i);
  });

  it("clamps a derived rate that would be too small to move stock", () => {
    // Stock is numeric(14,4), so anything under 0.0001 would accrue cost against
    // a quantity that never changes.
    const out = deriveCalibration({
      actualConsumed: 0.0001,
      recipes: [{ id: "r1", itemName: "Wash", quantityPerUnit: 1, servicesSold: 10000 }],
    });
    expect(out.updates[0].clamped).toBe(true);
    expect(out.updates[0].to).toBe(0.0001);
  });

  it("rounds the derived rate to the 4dp the column stores", () => {
    const out = deriveCalibration({
      actualConsumed: 1,
      recipes: [{ id: "r1", itemName: "Wash", quantityPerUnit: 1, servicesSold: 3 }],
    });
    expect(out.updates[0].to).toBe(0.3333);
  });
});
