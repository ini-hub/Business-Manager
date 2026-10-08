import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import {
  inventory, products, checkouts, orders, profitLoss, promotions, cashRegisterSessions,
  bundleComponents, serviceConsumables, orderConsumables, inventoryBatches, customers,
} from "@shared/schema";
import { storage } from "../storage";
import { runWithRequestStats, type RequestStats } from "../lib/queryCounter";
import {
  assertTestDatabase, ensureSchema, createFixture, sweepResidue, closePool, type Fixture,
} from "../test-support/integration-db";

/**
 * Properties of processCheckout that only show up under concurrency or with awkward carts: receipt numbers
 * never repeat, a burst of sales cannot exhaust the connection pool, stock never oversells, and the stock /
 * profit_loss arithmetic stays right when one item appears on several lines (a repeat line, a promo line).
 * These pin behaviour so the checkout can be restructured for fewer round trips without changing outcomes.
 */

let fixtures: Fixture[] = [];
let seq = 0;

async function clearSales(storeId: string) {
  const s = sql`${storeId}`;
  await db.execute(sql`DELETE FROM gamification_points_ledger WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM gamification_badge_awards WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM gamification_streaks WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM sale_payment_legs WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM store_credit_transactions WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM checkout_idempotency_keys WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM transactions WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM checkouts WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM order_consumables WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM orders WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM profit_loss WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM promotions WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM notifications WHERE store_id = ${s}`).catch(() => undefined);
  await db.execute(sql`DELETE FROM cash_drops WHERE session_id IN (SELECT id FROM cash_register_sessions WHERE store_id = ${s})`);
  await db.execute(sql`DELETE FROM cash_register_sessions WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM inventory_batches WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM store_counters WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM service_consumables WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM bundle_components WHERE parent_inventory_id IN (SELECT id FROM inventory WHERE store_id = ${s})`);
  await db.execute(sql`DELETE FROM inventory WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM products WHERE store_id = ${s}`);
}

async function clearResidue() {
  const { rows } = await db.execute(sql`SELECT id FROM stores WHERE name LIKE 'Test Store itest-%'`);
  for (const r of rows) await clearSales(r.id as string);
  await sweepResidue();
}

async function newItem(
  storeId: string,
  opts: { quantity?: number; cost?: number; price?: number; type?: "product" | "service" | "supply"; isBundle?: boolean } = {},
) {
  const [product] = await db.insert(products).values({ storeId, name: `Item ${++seq}`, type: opts.type === "service" ? "service" : "product" }).returning();
  const [item] = await db.insert(inventory).values({
    storeId, productId: product.id, name: `Item ${seq}`, type: opts.type ?? "product", isBundle: opts.isBundle ?? false,
    costPrice: opts.cost ?? 400, sellingPrice: opts.price ?? 500, quantity: opts.quantity ?? 100,
  }).returning();
  return item;
}

async function shop(itemCount = 1, itemOpts: { quantity?: number } = {}) {
  const f = await createFixture();
  fixtures.push(f);
  const items = [];
  for (let i = 0; i < itemCount; i++) items.push(await newItem(f.storeId, itemOpts));
  await db.insert(cashRegisterSessions).values({ storeId: f.storeId, status: "open", openingFloat: 0, expectedCash: 0 });
  return { f, items };
}

const sellLines = (f: Fixture, lines: Array<{ inventoryId: string; quantity: number }>, extra: Record<string, unknown> = {}) =>
  storage.processCheckout({
    storeId: f.storeId, customerId: f.customerId, staffId: f.staffId,
    items: lines, paymentMethod: "cash", ...extra,
  } as any);

const qtyOf = async (id: string) => Number((await db.select().from(inventory).where(eq(inventory.id, id)))[0].quantity);
const plOf = async (storeId: string, inventoryId: string) =>
  (await db.select().from(profitLoss).where(and(eq(profitLoss.storeId, storeId), eq(profitLoss.inventoryId, inventoryId))))[0];

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
  await clearResidue();
});

afterEach(async () => {
  for (const f of fixtures) {
    await clearSales(f.storeId);
    await f.cleanup();
  }
  fixtures = [];
});

afterAll(async () => {
  await clearResidue();
  await closePool();
});

describe("receipt numbers", () => {
  it("gives every concurrent sale in a store its own receipt number, including the very first ones", async () => {
    // Distinct items, so the sales do not queue behind one item's row lock and genuinely overlap.
    const { f, items } = await shop(8);
    const results = await Promise.all(items.map((item) => sellLines(f, [{ inventoryId: item.id, quantity: 1 }])));
    expect(results.map((r) => r.message)).toEqual(results.map(() => "Sale completed successfully"));

    const rows = await db.select({ receipt: checkouts.receiptNumber }).from(checkouts).where(eq(checkouts.storeId, f.storeId));
    const receipts = rows.map((r) => r.receipt);
    expect(receipts).toHaveLength(8);
    expect(new Set(receipts).size).toBe(8);

    // Consecutive, starting at 1: nothing skipped, nothing reused.
    const numbers = receipts.map((r) => Number(String(r).split("-TN-")[1])).sort((a, b) => a - b);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("keeps numbering on after a burst", async () => {
    const { f, items } = await shop(3);
    await Promise.all(items.map((item) => sellLines(f, [{ inventoryId: item.id, quantity: 1 }])));
    const next = await sellLines(f, [{ inventoryId: items[0].id, quantity: 1 }]);
    expect(next.success).toBe(true);
    const [row] = await db.select({ receipt: checkouts.receiptNumber }).from(checkouts).where(eq(checkouts.id, next.checkoutIds![0]));
    expect(String(row.receipt).endsWith("-TN-4")).toBe(true);
  });
});

describe("connection pool", () => {
  it("completes a burst larger than the pool without any sale starving for a connection", async () => {
    // More simultaneous sales than pool connections (default 10). A sale that needs a second connection while
    // its transaction holds the first would deadlock the pool until the connect timeout fires.
    const burst = 14;
    const { f, items } = await shop(burst);
    const results = await Promise.all(items.map((item) => sellLines(f, [{ inventoryId: item.id, quantity: 1 }])));
    const failed = results.filter((r) => !r.success).map((r) => r.message);
    expect(failed).toEqual([]);
  }, 120_000);
});

describe("stock", () => {
  it("never oversells when sales of one item race", async () => {
    const { f, items } = await shop(1, { quantity: 5 });
    const results = await Promise.all(
      [1, 2, 3, 4].map(() => sellLines(f, [{ inventoryId: items[0].id, quantity: 2 }])),
    );
    expect(results.filter((r) => r.success)).toHaveLength(2);
    expect(results.filter((r) => !r.success).every((r) => /only have/.test(r.message))).toBe(true);
    expect(await qtyOf(items[0].id)).toBe(1);
  });

  it("reports an out-of-stock cart without writing anything", async () => {
    const { f, items } = await shop(1, { quantity: 3 });
    const r = await sellLines(f, [{ inventoryId: items[0].id, quantity: 4 }]);
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/only have 3/);
    expect(await qtyOf(items[0].id)).toBe(3);
    expect(await db.select().from(orders).where(eq(orders.storeId, f.storeId))).toHaveLength(0);
  });

  it("deducts correctly when the same item is on several lines, and checks the later line against what is left", async () => {
    const { f, items } = await shop(1, { quantity: 10 });
    const ok = await sellLines(f, [
      { inventoryId: items[0].id, quantity: 3 },
      { inventoryId: items[0].id, quantity: 4 },
    ]);
    expect(ok.success).toBe(true);
    expect(ok.checkoutIds).toHaveLength(2);
    expect(await qtyOf(items[0].id)).toBe(3);

    const pl = await plOf(f.storeId, items[0].id);
    expect(pl.totalQuantitySold).toBe(7);
    expect(pl.totalRevenue).toBe(3500);
    expect(pl.totalGrossProfit).toBe(700); // (500 - 400) x 7
    expect(pl.quantityRemaining).toBe(3);

    // 3 left: lines of 2 + 2 each fit the original stock but not the stock the first line leaves.
    const over = await sellLines(f, [
      { inventoryId: items[0].id, quantity: 2 },
      { inventoryId: items[0].id, quantity: 2 },
    ]);
    expect(over.success).toBe(false);
    expect(over.message).toMatch(/only have 1/);
    expect(await qtyOf(items[0].id)).toBe(3);
    expect((await plOf(f.storeId, items[0].id)).totalQuantitySold).toBe(7);
  });

  it("splits a buy-2-get-1 promotion into a paid and a free line and moves stock for both", async () => {
    const { f, items } = await shop(1, { quantity: 20 });
    await db.insert(promotions).values({
      storeId: f.storeId, name: "2 for 3", type: "buy_x_get_y",
      buyItemId: items[0].id, buyQuantity: 2, getItemId: items[0].id, getQuantity: 1,
    });
    const r = await sellLines(f, [{ inventoryId: items[0].id, quantity: 3 }]);
    expect(r.success).toBe(true);
    expect(r.checkoutIds).toHaveLength(2);

    const rows = await db.select().from(checkouts).where(eq(checkouts.storeId, f.storeId));
    expect(rows.map((c) => c.totalCharged).sort((a, b) => a - b)).toEqual([0, 1000]);
    expect(new Set(rows.map((c) => c.receiptNumber)).size).toBe(1);
    expect(await qtyOf(items[0].id)).toBe(17);

    const pl = await plOf(f.storeId, items[0].id);
    expect(pl.totalQuantitySold).toBe(3);
    expect(pl.totalRevenue).toBe(1000);
  });
});

describe("replay", () => {
  it("returns the original sale for a repeated client id and deducts stock once", async () => {
    const { f, items } = await shop(1, { quantity: 10 });
    const clientCheckoutId = `replay-${Date.now()}`;
    const first = await sellLines(f, [{ inventoryId: items[0].id, quantity: 2 }], { clientCheckoutId });
    const again = await sellLines(f, [{ inventoryId: items[0].id, quantity: 2 }], { clientCheckoutId });
    expect(first.success && again.success).toBe(true);
    expect(again.checkoutIds).toEqual(first.checkoutIds);
    expect(await qtyOf(items[0].id)).toBe(8);
  });
});

describe("line arithmetic", () => {
  it("sells a bundle by drawing down its components, not the bundle row", async () => {
    const { f } = await shop(0);
    const bundle = await newItem(f.storeId, { quantity: 50, cost: 700, price: 1500, isBundle: true });
    const c1 = await newItem(f.storeId, { quantity: 10 });
    const c2 = await newItem(f.storeId, { quantity: 5 });
    await db.insert(bundleComponents).values([
      { parentInventoryId: bundle.id, componentInventoryId: c1.id, quantity: 2 },
      { parentInventoryId: bundle.id, componentInventoryId: c2.id, quantity: 1 },
    ]);

    const ok = await sellLines(f, [{ inventoryId: bundle.id, quantity: 3 }]);
    expect(ok.success).toBe(true);
    expect(await qtyOf(c1.id)).toBe(4);
    expect(await qtyOf(c2.id)).toBe(2);
    expect(await qtyOf(bundle.id)).toBe(50);

    const pl = await plOf(f.storeId, bundle.id);
    expect(pl.totalQuantitySold).toBe(3);
    expect(pl.totalRevenue).toBe(4500);
    expect(pl.totalGrossProfit).toBe(2400); // (1500 - 700) x 3
    expect(pl.quantityRemaining).toBe(47); // the bundle row's own count less the line

    const short = await sellLines(f, [{ inventoryId: bundle.id, quantity: 3 }]);
    expect(short.success).toBe(false);
    expect(short.message).toMatch(/not have enough stock for the component/);
    expect(await qtyOf(c1.id)).toBe(4);
    expect(await qtyOf(c2.id)).toBe(2);
  });

  it("deducts expiry batches oldest first and leaves the rest", async () => {
    const { f, items } = await shop(1, { quantity: 8 });
    const day = 86400000;
    await db.insert(inventoryBatches).values([
      { storeId: f.storeId, inventoryId: items[0].id, batchNumber: "B-late", expiryDate: new Date(Date.now() + 20 * day), quantity: 5 },
      { storeId: f.storeId, inventoryId: items[0].id, batchNumber: "B-soon", expiryDate: new Date(Date.now() + 10 * day), quantity: 3 },
    ]);
    const qtyByBatch = async () =>
      Object.fromEntries((await db.select().from(inventoryBatches).where(eq(inventoryBatches.inventoryId, items[0].id))).map((b) => [b.batchNumber, b.quantity]));

    expect((await sellLines(f, [{ inventoryId: items[0].id, quantity: 4 }])).success).toBe(true);
    expect(await qtyByBatch()).toEqual({ "B-soon": 0, "B-late": 4 });
    expect((await sellLines(f, [{ inventoryId: items[0].id, quantity: 2 }])).success).toBe(true);
    expect(await qtyByBatch()).toEqual({ "B-soon": 0, "B-late": 2 });
    expect(await qtyOf(items[0].id)).toBe(2);
  });

  it("charges a service's supplies to the ledger and stock without touching profit_loss for the supply", async () => {
    const { f } = await shop(0);
    const service = await newItem(f.storeId, { type: "service", quantity: 0, cost: 100, price: 1000 });
    const supply = await newItem(f.storeId, { type: "supply", quantity: 10, cost: 100, price: 0 });
    await db.insert(serviceConsumables).values({ storeId: f.storeId, inventoryId: service.id, supplyInventoryId: supply.id, quantityPerUnit: 1.5 });

    const r = await sellLines(f, [{ inventoryId: service.id, quantity: 2 }]);
    expect(r.success).toBe(true);
    expect(await qtyOf(supply.id)).toBe(7);

    const ledger = await db.select().from(orderConsumables).where(eq(orderConsumables.storeId, f.storeId));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ supplyInventoryId: supply.id, quantityUsed: 3, unitCostAtSale: 100, totalCost: 300 });

    expect(await plOf(f.storeId, supply.id)).toBeUndefined();
    const pl = await plOf(f.storeId, service.id);
    expect(pl.totalQuantitySold).toBe(2);
    expect(pl.totalRevenue).toBe(2000);
  });

  it("adds a free gift line when the cart passes a spend threshold", async () => {
    const { f, items } = await shop(2);
    const [main, gift] = items;
    await db.insert(promotions).values({ storeId: f.storeId, name: "Spend 1000", type: "spend_x_get_y", spendAmount: 1000, getItemId: gift.id, getQuantity: 1 });
    const r = await sellLines(f, [{ inventoryId: main.id, quantity: 3 }]);
    expect(r.success).toBe(true);
    expect(r.checkoutIds).toHaveLength(2);
    expect(await qtyOf(main.id)).toBe(97);
    expect(await qtyOf(gift.id)).toBe(99);
    const rows = await db.select().from(checkouts).where(eq(checkouts.storeId, f.storeId));
    expect(rows.map((c) => c.totalCharged).sort((a, b) => a - b)).toEqual([0, 1500]);
    const giftPl = await plOf(f.storeId, gift.id);
    expect(giftPl.totalQuantitySold).toBe(1);
    expect(giftPl.totalRevenue).toBe(0);
    expect(giftPl.totalGrossProfit).toBe(-400);
  });

  it("gives the free item of a buy-X-get-Y promotion on a different product", async () => {
    const { f, items } = await shop(2);
    const [main, gift] = items;
    await db.insert(promotions).values({ storeId: f.storeId, name: "Buy 2 get 1", type: "buy_x_get_y", buyItemId: main.id, buyQuantity: 2, getItemId: gift.id, getQuantity: 1 });
    const r = await sellLines(f, [{ inventoryId: main.id, quantity: 4 }]);
    expect(r.success).toBe(true);
    expect(await qtyOf(main.id)).toBe(96);
    expect(await qtyOf(gift.id)).toBe(98); // two cycles of 2 -> 2 free
  });

  it("spreads a cart discount across its lines", async () => {
    const { f, items } = await shop(2);
    const r = await sellLines(
      f,
      [{ inventoryId: items[0].id, quantity: 1 }, { inventoryId: items[1].id, quantity: 1 }],
      { discountAmount: 100, discountReason: "loyal" },
    );
    expect(r.success).toBe(true);
    const rows = await db.select().from(checkouts).where(eq(checkouts.storeId, f.storeId));
    expect(rows.map((c) => c.totalCharged)).toEqual([450, 450]);
    expect(new Set(rows.map((c) => c.receiptNumber)).size).toBe(1);
  });

  it("rolls the whole cart back when a later line fails", async () => {
    const { f, items } = await shop(2, { quantity: 10 });
    const r = await sellLines(f, [{ inventoryId: items[0].id, quantity: 2 }, { inventoryId: items[1].id, quantity: 11 }]);
    expect(r.success).toBe(false);
    expect(await qtyOf(items[0].id)).toBe(10);
    expect(await qtyOf(items[1].id)).toBe(10);
    expect(await db.select().from(orders).where(eq(orders.storeId, f.storeId))).toHaveLength(0);
    expect(await db.select().from(checkouts).where(eq(checkouts.storeId, f.storeId))).toHaveLength(0);
    expect(await plOf(f.storeId, items[0].id)).toBeUndefined();
  });
});

describe("round trips", () => {
  // Each statement is a ~0.3s trip to Neon, so the cost of a sale is its statement count. It must not grow
  // with the number of lines in the cart.
  const statementsFor = async (f: Fixture, lines: Array<{ inventoryId: string; quantity: number }>) => {
    const stats: RequestStats = { queries: 0 };
    const result = await runWithRequestStats(stats, () => sellLines(f, lines));
    expect(result.success).toBe(true);
    return stats.queries;
  };

  it("does not add statements per cart line", async () => {
    const { f, items } = await shop(6);
    // Warm the per-store rows (settings, counters) so both measurements see the steady state.
    await sellLines(f, [{ inventoryId: items[0].id, quantity: 1 }]);

    const one = await statementsFor(f, [{ inventoryId: items[0].id, quantity: 1 }]);
    const six = await statementsFor(f, items.map((i) => ({ inventoryId: i.id, quantity: 1 })));
    console.log(`[statements] 1 line: ${one}, 6 lines: ${six}`);
    expect(six - one).toBeLessThanOrEqual(6);
    expect(six).toBeLessThanOrEqual(40);
  });
});

describe("one customer, several registers", () => {
  const customerRow = async (id: string) => (await db.select().from(customers).where(eq(customers.id, id)))[0];

  it("keeps every point when sales to the same customer overlap", async () => {
    const { f, items } = await shop(5);
    // One sale on its own shows what a single sale earns.
    expect((await sellLines(f, [{ inventoryId: items[0].id, quantity: 1 }])).success).toBe(true);
    const perSale = (await customerRow(f.customerId)).loyaltyPoints;
    expect(perSale).toBeGreaterThan(0);

    await db.update(customers).set({ loyaltyPoints: 0 }).where(eq(customers.id, f.customerId));
    const results = await Promise.all(items.slice(1).map((item) => sellLines(f, [{ inventoryId: item.id, quantity: 1 }])));
    expect(results.every((r) => r.success)).toBe(true);
    expect((await customerRow(f.customerId)).loyaltyPoints).toBe(perSale * 4);
  });

  it("lets only one of two simultaneous sales spend the same store credit", async () => {
    const { f, items } = await shop(2);
    await db.update(customers).set({ storeCreditBalance: 500 }).where(eq(customers.id, f.customerId));
    const results = await Promise.all(
      items.map((item) => sellLines(f, [{ inventoryId: item.id, quantity: 1 }], { paymentMethod: "store_credit" })),
    );
    expect(results.filter((r) => r.success)).toHaveLength(1);
    expect(results.find((r) => !r.success)?.message).toMatch(/Insufficient store credit/);
    expect(Number((await customerRow(f.customerId)).storeCreditBalance)).toBe(0);
  });
});
