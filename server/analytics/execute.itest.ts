import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, pool } from "../db";
import { eq, sql } from "drizzle-orm";
import { inventory, products, checkouts, orders, cashRegisterSessions } from "@shared/schema";
import { storage } from "../storage";
import { analyticsQuerySchema } from "@shared/analytics/query";
import { runAnalyticsQuery, runReadOnly } from "./execute";
import {
  assertTestDatabase, ensureSchema, createFixture, sweepResidue, closePool, type Fixture,
} from "../test-support/integration-db";

/**
 * The Explorer's executor was reworked for fewer round trips, a parallel comparison window and a cap on the
 * connections it may hold. The numbers must not move: they are checked against the P&L the Explorer was built to
 * match (the same check scripts/analytics-parity.ts makes on a live database), and the new connection handling is
 * checked directly: timeouts, read-only, the cap, and a clean connection afterwards.
 */

let f: Fixture;
const dayString = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
const today = dayString(0);
// All the seeded sales fall inside this window, and it is short enough for daily buckets (the schema caps buckets).
const windowStart = dayString(120);

async function clearSales(storeId: string) {
  const s = sql`${storeId}`;
  for (const t of ["gamification_points_ledger", "gamification_badge_awards", "gamification_streaks", "sale_payment_legs", "store_credit_transactions", "checkout_idempotency_keys", "stock_movements"]) {
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

const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(0.01);

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
  await clearResidue();
  f = await createFixture();
  await db.insert(cashRegisterSessions).values({ storeId: f.storeId, status: "open", openingFloat: 0, expectedCash: 0 });

  const mk = async (name: string, type: "product" | "service", price: number, cost: number) => {
    const [product] = await db.insert(products).values({ storeId: f.storeId, name, type } as any).returning();
    return (await db.insert(inventory).values({ storeId: f.storeId, productId: product.id, name, type, costPrice: cost, sellingPrice: price, quantity: 500 } as any).returning())[0];
  };
  const gel = await mk("Gel", "product", 1500, 600);
  const cut = await mk("Cut", "service", 4000, 500);
  const sell = (lines: Array<{ inventoryId: string; quantity: number }>, extra: Record<string, unknown> = {}) =>
    storage.processCheckout({ storeId: f.storeId, customerId: f.customerId, staffId: f.staffId, items: lines, paymentMethod: "cash", ...extra } as any);

  const a = await sell([{ inventoryId: gel.id, quantity: 2 }, { inventoryId: cut.id, quantity: 1 }], { discountAmount: 500 });
  await sell([{ inventoryId: cut.id, quantity: 2 }]);
  const returned = await sell([{ inventoryId: gel.id, quantity: 3 }]);
  const [line] = await db.select().from(checkouts).where(eq(checkouts.id, returned.checkoutIds![0]));
  await db.update(orders).set({ returnedQuantity: 1, refundedAmount: 1500 }).where(eq(orders.id, line.orderId));
  // Last month's sales, for the comparison window.
  // 40 days ago: inside the 30 days before the last 30, which is the window "previous period" looks at.
  const old = await sell([{ inventoryId: gel.id, quantity: 4 }]);
  await db.update(checkouts).set({ createdAt: new Date(Date.now() - 40 * 86400000) }).where(eq(checkouts.id, old.checkoutIds![0]));
  expect(a.success).toBe(true);
});

afterAll(async () => {
  if (f) { await clearSales(f.storeId); await f.cleanup(); }
  await clearResidue();
  await closePool();
});

describe("explorer numbers", () => {
  it("still agree with the P&L over the same sales", async () => {
    const query = analyticsQuerySchema.parse({
      storeIds: [f.storeId],
      measures: ["sales.service_revenue", "sales.product_revenue", "sales.gross_revenue", "sales.returned_revenue", "sales.net_revenue", "sales.cogs", "sales.gross_profit", "sales.discounts"],
      dimensions: [],
      time: { from: windowStart, to: today, grain: "day" },
    });
    const got = (await runAnalyticsQuery(query)).totals;
    const want = await storage.getProfitLossSummary(f.storeId, windowStart, today);
    close(got["sales.service_revenue"] ?? 0, want.serviceRevenue);
    close(got["sales.product_revenue"] ?? 0, want.productRevenue);
    close(got["sales.gross_revenue"] ?? 0, want.grossRevenue);
    close(got["sales.returned_revenue"] ?? 0, want.returnedRevenue);
    close(got["sales.net_revenue"] ?? 0, want.totalRevenue);
    close(got["sales.cogs"] ?? 0, want.costOfGoodsSold);
    close(got["sales.gross_profit"] ?? 0, want.grossProfit);
    close(got["sales.discounts"] ?? 0, want.discountsGiven);
    expect(want.returnedRevenue).toBe(1500); // the seeded return really is in the numbers
  });

  it("daily buckets add up to the ungrouped total", async () => {
    const base = { storeIds: [f.storeId], measures: ["sales.net_revenue", "sales.line_items"], time: { from: windowStart, to: today, grain: "day" as const }, limit: 5000 };
    const total = await runAnalyticsQuery(analyticsQuerySchema.parse({ ...base, dimensions: [] }));
    const byDay = await runAnalyticsQuery(analyticsQuerySchema.parse({ ...base, dimensions: ["date"] }));
    const summed = byDay.rows.reduce((n, r) => n + (typeof r["sales.net_revenue"] === "number" ? (r["sales.net_revenue"] as number) : 0), 0);
    close(summed, total.totals["sales.net_revenue"] ?? 0);
  });

  it("returns the comparison window alongside the current one", async () => {
    const result = await runAnalyticsQuery(analyticsQuerySchema.parse({
      storeIds: [f.storeId], measures: ["sales.net_revenue"], dimensions: [],
      time: { from: dayString(29), to: today, grain: "day", compare: "previous_period" },
    }));
    expect(result.comparison).toBeDefined();
    expect(result.comparison!.label).toBe("previous period");
    expect(result.totals["sales.net_revenue"] ?? 0).toBeGreaterThan(0);
    // The sale from 40 days ago (4 x 1500 of gel) is inside the earlier window, and only there.
    close(result.comparison!.totals["sales.net_revenue"] ?? 0, 6000);
  });
});

describe("read-only execution", () => {
  it("returns rows and leaves the connection usable", async () => {
    const rows = await runReadOnly(sql`select 1 as one, ${"x"}::text as two`);
    expect(rows).toEqual([{ one: 1, two: "x" }]);
    expect(await runReadOnly(sql`select 2 as n`)).toEqual([{ n: 2 }]);
  });

  it("stops a statement that runs past the timeout, then keeps working", async () => {
    await expect(runReadOnly(sql`select pg_sleep(3)`, 300)).rejects.toThrow(/statement timeout|canceling statement/i);
    // The aborted transaction was rolled back: the same pool serves the next query normally.
    expect(await runReadOnly(sql`select 3 as n`)).toEqual([{ n: 3 }]);
  });

  it("cannot write, whatever the statement says", async () => {
    await expect(runReadOnly(sql`update stores set name = name where false`)).rejects.toThrow(/read-only/i);
    expect(await runReadOnly(sql`select 4 as n`)).toEqual([{ n: 4 }]);
  });

  it("applies the timeout to its own transaction only, not to the pooled connection", async () => {
    await runReadOnly(sql`select 1`, 250);
    const client = await pool.connect();
    try {
      const { rows } = await client.query("show statement_timeout");
      expect(rows[0].statement_timeout).not.toBe("250ms");
    } finally {
      client.release();
    }
  });

  it("never holds more connections than its cap, however many queries arrive together", async () => {
    // Every statement reports how many Explorer statements are executing alongside it.
    const marker = `cap_probe_${Date.now()}`;
    // The marker sits in the statement's text (a comment), because that is what pg_stat_activity shows: bound
    // parameters appear there as $1, never as their value.
    const probe = () => runReadOnly(sql`
      /* ${sql.raw(marker)} */
      select pg_sleep(0.6), (select count(*)::int from pg_stat_activity
                             where state = 'active' and query like ${`%${marker}%`} and pid <> pg_backend_pid()) + 1 as running`);
    const results = await Promise.all(Array.from({ length: 12 }, probe));
    const peak = Math.max(...results.map((r) => Number(r[0].running)));
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
    expect(results).toHaveLength(12);
  }, 60_000);
});
