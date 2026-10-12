import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import { inventory, products, checkouts, orders, cashRegisterSessions, customers, staff, transactions } from "@shared/schema";
import { storage } from "../storage";
import { runWithRequestStats } from "../lib/queryCounter";
import { getStoreTimezone, toUtcStart, toUtcEnd } from "../lib/dateUtils";
import {
  assertTestDatabase, ensureSchema, createFixture, sweepResidue, closePool, type Fixture,
} from "../test-support/integration-db";

/**
 * The P&L core, the revenue mix and the dashboard counts used to be computed by loading rows into Node and
 * adding them up. They are now one SQL aggregate each. The old logic is kept here, verbatim in behaviour, as
 * the oracle: for the same sales (refunds, returns, a void, a pending payment, discounts, services, supplies,
 * a soft-deleted item, a per-item reorder point) the numbers must agree.
 */

let f: Fixture;
const ids: Record<string, string> = {};

async function clearSales(storeId: string) {
  const s = sql`${storeId}`;
  for (const t of ["gamification_points_ledger", "gamification_badge_awards", "gamification_streaks", "sale_payment_legs", "store_credit_transactions", "checkout_idempotency_keys", "stock_movements", "order_consumables", "service_consumables"]) {
    await db.execute(sql`DELETE FROM ${sql.raw(t)} WHERE store_id = ${s}`);
  }
  await db.execute(sql`DELETE FROM transactions WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM checkouts WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM orders WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM profit_loss WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM cash_drops WHERE session_id IN (SELECT id FROM cash_register_sessions WHERE store_id = ${s})`);
  await db.execute(sql`DELETE FROM cash_register_sessions WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM inventory_batches WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM store_counters WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM inventory WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM products WHERE store_id = ${s}`);
}
async function clearResidue() {
  const { rows } = await db.execute(sql`SELECT id FROM stores WHERE name LIKE 'Test Store itest-%'`);
  for (const r of rows) await clearSales(r.id as string);
  await sweepResidue();
}

async function item(key: string, o: { type?: "product" | "service" | "supply"; quantity: number; cost?: number; price?: number; reorderPoint?: number; deleted?: boolean }) {
  const [product] = await db.insert(products).values({ storeId: f.storeId, name: key, type: o.type === "service" ? "service" : "product" }).returning();
  const [row] = await db.insert(inventory).values({
    storeId: f.storeId, productId: product.id, name: key, type: o.type ?? "product", quantity: o.quantity,
    costPrice: o.cost ?? 300, sellingPrice: o.price ?? 1000, reorderPoint: o.reorderPoint ?? null,
    isDeleted: o.deleted ?? false,
  } as any).returning();
  ids[key] = row.id;
  return row;
}

const sell = (lines: Array<{ inventoryId: string; quantity: number }>, extra: Record<string, unknown> = {}) =>
  storage.processCheckout({ storeId: f.storeId, customerId: f.customerId, staffId: f.staffId, items: lines, paymentMethod: "cash", ...extra } as any);

// ── the old implementations, as the oracle ──────────────────────────────────────────────────────────────
async function legacyPnl(startDate?: string, endDate?: string) {
  const tz = await getStoreTimezone(f.storeId);
  const conds: any[] = [eq(checkouts.storeId, f.storeId), eq(checkouts.paymentStatus, "completed"), eq(checkouts.isVoided, false)];
  const { gte, lte } = await import("drizzle-orm");
  if (startDate) conds.push(gte(checkouts.createdAt, toUtcStart(startDate, tz)));
  if (endDate) conds.push(lte(checkouts.createdAt, toUtcEnd(endDate, tz)));
  const rows = await db.select({
    inventoryType: inventory.type, costPrice: inventory.costPrice, quantity: orders.quantity,
    returnedQuantity: orders.returnedQuantity, refundedAmount: orders.refundedAmount, totalPrice: orders.totalPrice,
  }).from(orders).innerJoin(checkouts, eq(checkouts.orderId, orders.id)).innerJoin(inventory, eq(inventory.id, orders.inventoryId)).where(and(...conds));
  let serviceRevenue = 0, productRevenue = 0, costOfProductsSold = 0, costOfServicesSold = 0, grossRevenue = 0, returnedRevenue = 0;
  for (const row of rows) {
    const netQuantity = Math.max(0, row.quantity - (row.returnedQuantity || 0));
    const netTotalPrice = Math.max(0, row.totalPrice - (row.refundedAmount || 0));
    const netLineCost = (row.costPrice ?? 0) * netQuantity;
    grossRevenue += row.totalPrice;
    returnedRevenue += row.refundedAmount || 0;
    if (row.inventoryType === "service") { serviceRevenue += netTotalPrice; costOfServicesSold += netLineCost; }
    else if (row.inventoryType === "product") { productRevenue += netTotalPrice; costOfProductsSold += netLineCost; }
  }
  const totalRevenue = serviceRevenue + productRevenue;
  const costOfGoodsSold = costOfProductsSold + costOfServicesSold;
  return { serviceRevenue, productRevenue, grossRevenue, returnedRevenue, totalRevenue, costOfGoodsSold, costOfProductsSold, costOfServicesSold, grossProfit: totalRevenue - costOfGoodsSold };
}

async function legacyMix(startDate?: string, endDate?: string) {
  const tz = await getStoreTimezone(f.storeId);
  const conds: any[] = [eq(checkouts.storeId, f.storeId), eq(checkouts.paymentStatus, "completed"), eq(checkouts.isVoided, false)];
  const { gte, lte } = await import("drizzle-orm");
  if (startDate) conds.push(gte(checkouts.createdAt, toUtcStart(startDate, tz)));
  if (endDate) conds.push(lte(checkouts.createdAt, toUtcEnd(endDate, tz)));
  const rows = await db.select({ inventoryType: inventory.type, revenue: orders.totalPrice, refundedAmount: orders.refundedAmount, taxRefunded: orders.taxRefunded })
    .from(orders).innerJoin(checkouts, eq(orders.id, checkouts.orderId)).innerJoin(inventory, eq(orders.inventoryId, inventory.id)).where(and(...conds));
  let services = 0, productsSum = 0;
  for (const row of rows) {
    const net = Math.max(0, row.revenue - ((row.refundedAmount || 0) - (row.taxRefunded || 0)));
    if (row.inventoryType === "service") services += net; else productsSum += net;
  }
  return { services, products: productsSum };
}

async function legacyStock() {
  // Soft-deleted items are not stock: the dashboard leaves them out, like the inventory list does.
  const all = (await db.select().from(inventory).where(eq(inventory.storeId, f.storeId))).filter((i) => !i.isDeleted);
  const threshold = 5; // the fixture store has no custom threshold
  const prods = all.filter((i) => i.type === "product"), svcs = all.filter((i) => i.type === "service"), sups = all.filter((i) => i.type === "supply");
  const alerts = [...prods, ...sups].filter((p) => p.quantity <= (p.reorderPoint != null ? p.reorderPoint : threshold));
  const out = alerts.filter((p) => p.quantity === 0).length;
  return { totalInventory: all.length, totalProducts: prods.length, totalServices: svcs.length, totalSupplies: sups.length, outOfStockCount: out, lowStockCount: alerts.length - out, alertIds: alerts.map((a) => a.id) };
}

const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(0.01);

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
  await clearResidue();
  f = await createFixture();
  await db.insert(cashRegisterSessions).values({ storeId: f.storeId, status: "open", openingFloat: 0, expectedCash: 0 });

  await item("prod-low", { quantity: 8, cost: 300, price: 1000 });            // sold down to 3 -> low
  await item("prod-out", { quantity: 2, cost: 200, price: 800 });             // sold out -> 0
  await item("prod-fine", { quantity: 200, cost: 400, price: 1500 });
  await item("prod-reorder", { quantity: 50, cost: 100, price: 500, reorderPoint: 100 }); // alert via its own reorder point
  await item("prod-deleted", { quantity: 0, deleted: true });                  // soft-deleted: must not count or alert
  await item("svc", { type: "service", quantity: 0, cost: 150, price: 2500 });
  await item("supply", { type: "supply", quantity: 2, cost: 50, price: 0 });   // low supply

  const a = await sell([{ inventoryId: ids["prod-low"], quantity: 5 }, { inventoryId: ids["svc"], quantity: 1 }], { discountAmount: 300 });
  const b = await sell([{ inventoryId: ids["prod-out"], quantity: 2 }]);
  const c = await sell([{ inventoryId: ids["prod-fine"], quantity: 2 }, { inventoryId: ids["svc"], quantity: 2 }]);
  const d = await sell([{ inventoryId: ids["prod-reorder"], quantity: 1 }]);   // will be voided
  const e = await sell([{ inventoryId: ids["prod-fine"], quantity: 1 }]);      // will be left pending
  for (const r of [a, b, c, d, e]) expect(r.success).toBe(true);

  // A return with a refund (and refunded tax) on one line of sale C.
  const [cLine] = await db.select().from(orders).where(eq(orders.id, (await db.select().from(checkouts).where(eq(checkouts.id, c.checkoutIds![0])))[0].orderId));
  await db.update(orders).set({ returnedQuantity: 1, refundedAmount: 700, taxRefunded: 50 }).where(eq(orders.id, cLine.id));
  // Void sale D, leave sale E's payment pending.
  await db.update(checkouts).set({ isVoided: true }).where(eq(checkouts.id, d.checkoutIds![0]));
  await db.update(checkouts).set({ paymentStatus: "pending" }).where(eq(checkouts.id, e.checkoutIds![0]));
});

afterAll(async () => {
  if (f) { await clearSales(f.storeId); await f.cleanup(); }
  await clearResidue();
  await closePool();
});

describe("P&L core", () => {
  for (const [label, range] of [["all time", [undefined, undefined]], ["today", [new Date().toISOString().slice(0, 10), new Date().toISOString().slice(0, 10)]], ["a past window", ["2020-01-01", "2020-01-31"]]] as const) {
    it(`matches the row-by-row calculation: ${label}`, async () => {
      const want = await legacyPnl(range[0], range[1]);
      const got = await storage.getProfitLossSummary(f.storeId, range[0], range[1]);
      for (const k of Object.keys(want) as (keyof typeof want)[]) close(got[k] as number, want[k]);
    });
  }

  it("has non-trivial numbers to compare (the test is not vacuous)", async () => {
    const got = await storage.getProfitLossSummary(f.storeId);
    expect(got.serviceRevenue).toBeGreaterThan(0);
    expect(got.productRevenue).toBeGreaterThan(0);
    expect(got.returnedRevenue).toBe(700);
    expect(got.discountsCount).toBe(1);
  });

  it("reports exact discount totals alongside a (possibly capped) list", async () => {
    const got = await storage.getProfitLossSummary(f.storeId);
    expect(got.discountsList).toHaveLength(got.discountsCount);
    close(got.discountsGiven, got.discountsList.reduce((sum, d) => sum + d.discountAmount, 0));
    close(got.discountsGiven, 300);
  });
});

describe("revenue mix", () => {
  it("matches the row-by-row calculation, with and without a range", async () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const [from, to] of [[undefined, undefined], [today, today], ["2020-01-01", "2020-01-31"]] as const) {
      const want = await legacyMix(from, to);
      const got = await (storage as any).analyticsRepo.getRevenueMixByType(f.storeId, from, to);
      close(got.services, want.services);
      close(got.products, want.products);
    }
  });
});

describe("dashboard stock figures", () => {
  it("counts and alerts exactly as the old filter did, and only lists the most urgent", async () => {
    const want = await legacyStock();
    const got = await storage.getDashboardStats(f.storeId);
    expect({
      totalInventory: got.totalInventory, totalProducts: got.totalProducts, totalServices: got.totalServices,
      totalSupplies: (got as any).totalSupplies, outOfStockCount: got.outOfStockCount, lowStockCount: got.lowStockCount,
    }).toEqual({
      totalInventory: want.totalInventory, totalProducts: want.totalProducts, totalServices: want.totalServices,
      totalSupplies: want.totalSupplies, outOfStockCount: want.outOfStockCount, lowStockCount: want.lowStockCount,
    });
    expect(want.outOfStockCount + want.lowStockCount).toBeGreaterThanOrEqual(3);
    // The deleted item (zero stock, which would otherwise be an out-of-stock alert) is in neither the counts nor the list.
    expect(got.lowStockItems.some((i) => i.id === ids["prod-deleted"])).toBe(false);
    expect(want.totalInventory).toBe(6); // seven items seeded, one of them deleted
    // Every listed item is a real alert, out-of-stock items come first, and the list is bounded.
    expect(got.lowStockItems.every((i) => want.alertIds.includes(i.id))).toBe(true);
    expect(got.lowStockItems.length).toBeLessThanOrEqual(20);
    const firstNonZero = got.lowStockItems.findIndex((i) => i.quantity !== 0);
    if (firstNonZero >= 0) expect(got.lowStockItems.slice(firstNonZero).every((i) => i.quantity !== 0)).toBe(true);
  });

  it("agrees with the P&L on revenue and profit", async () => {
    const pl = await storage.getProfitLossSummary(f.storeId);
    const got = await storage.getDashboardStats(f.storeId);
    close(got.totalRevenue, pl.totalRevenue);
    close(got.totalProfit, pl.grossProfit);
  });
});

// The merged counts statement against the straightforward per-table queries it replaced.
async function legacyCounts(startDate?: string, endDate?: string) {
  const tz = await getStoreTimezone(f.storeId);
  const { gte, lte } = await import("drizzle-orm");
  const conds: any[] = [eq(checkouts.storeId, f.storeId), eq(checkouts.isVoided, false), eq(checkouts.paymentStatus, "completed")];
  if (startDate) conds.push(gte(checkouts.createdAt, toUtcStart(startDate, tz)));
  if (endDate) conds.push(lte(checkouts.createdAt, toUtcEnd(endDate, tz)));
  const cks = await db.select().from(checkouts).where(and(...conds));
  const txs = await db.select({ customerId: transactions.customerId }).from(transactions)
    .innerJoin(checkouts, eq(checkouts.id, transactions.checkoutId)).where(and(...conds));
  const lossy = cks.filter((c: any) => Number(c.lossAmount) > 0);
  return {
    totalCustomers: (await db.select().from(customers).where(eq(customers.storeId, f.storeId))).length,
    totalStaff: (await db.select().from(staff).where(eq(staff.storeId, f.storeId))).length,
    totalTransactions: cks.length,
    uniqueCustomersInPeriod: new Set(txs.map((t) => t.customerId)).size,
    lossCount: new Set(lossy.map((c: any) => c.receiptNumber)).size,
    lossAmount: lossy.reduce((n: number, c: any) => n + Number(c.lossAmount), 0),
  };
}

describe("dashboard counts", () => {
  for (const [label, range] of [["all time", [undefined, undefined]], ["today", [new Date().toISOString().slice(0, 10), new Date().toISOString().slice(0, 10)]], ["a past window", ["2020-01-01", "2020-01-31"]]] as const) {
    it(`matches the per-table counts: ${label}`, async () => {
      const got = await storage.getDashboardStats(f.storeId, range[0], range[1]);
      const want = await legacyCounts(range[0], range[1]);
      expect(got.totalCustomers).toBe(want.totalCustomers);
      expect(got.totalStaff).toBe(want.totalStaff);
      expect(got.totalTransactions).toBe(want.totalTransactions);
      expect(got.uniqueCustomersInPeriod).toBe(want.uniqueCustomersInPeriod);
      expect(got.lossSales.count).toBe(want.lossCount);
      close(got.lossSales.amount, want.lossAmount);
    });
  }

  it("is not vacuous: the fixture has customers, sales and a customer who bought", async () => {
    const got = await storage.getDashboardStats(f.storeId);
    expect(got.totalCustomers).toBeGreaterThan(0);
    expect(got.totalTransactions).toBeGreaterThan(0);
    expect(got.uniqueCustomersInPeriod).toBeGreaterThan(0);
  });
});

describe("dashboard and P&L statement budget", () => {
  // Each statement is a round trip that also holds one of the 10 pool connections, so these are the
  // numbers that decide whether one page load starves every other request. Raise only with a reason.
  it("loads dashboard stats in few statements", async () => {
    const stats = { queries: 0 };
    const got = await runWithRequestStats(stats, () => storage.getDashboardStats(f.storeId));
    // counts (1) + stock alerts (1) + P&L summary (<=5) + revenue mix (1) + timezone/settings, was 27.
    expect(stats.queries).toBeLessThanOrEqual(12);
    // The merged counts statement must still report real figures, not zeros.
    expect(got.totalCustomers).toBeGreaterThanOrEqual(0);
    expect(got.totalTransactions).toBeGreaterThan(0);
    expect(got.totalStaff).toBeGreaterThanOrEqual(0);
    expect(got.totalInventory).toBeGreaterThan(0);
  }, 120_000);

  it("loads the P&L list in a constant number of statements and with its inventory rows", async () => {
    const stats = { queries: 0 };
    const rows = await runWithRequestStats(stats, () => storage.getProfitLoss(f.storeId));
    expect(stats.queries).toBeLessThanOrEqual(2);
    for (const r of rows) expect(r.inventory?.id).toBe(r.inventoryId);
  }, 120_000);
});
