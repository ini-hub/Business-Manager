import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import { eq, sql } from "drizzle-orm";
import { inventory, products, checkouts, transactions, stores, cashRegisterSessions } from "@shared/schema";
import { storage } from "../storage";
import { parseDateWindow } from "../routes/transaction.routes";
import { invalidateStoreTimezone } from "../lib/dateUtils";
import {
  assertTestDatabase, ensureSchema, createFixture, sweepResidue, closePool, type Fixture,
} from "../test-support/integration-db";

/**
 * A "day" on the Transactions page is the store's day, the same as on the Profit & Loss, whatever timezone the
 * viewer's browser is in. Lagos is UTC+1, so a sale at 00:30 on the 12th there happened at 23:30Z on the 11th:
 * a UTC reading puts it on the wrong day.
 */

let f: Fixture;
const DAY = "2026-03-11";

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

async function sellAt(inventoryId: string, when: Date) {
  const res = await storage.processCheckout({
    storeId: f.storeId, customerId: f.customerId, staffId: f.staffId, items: [{ inventoryId, quantity: 1 }], paymentMethod: "cash",
  } as any);
  expect(res.success, res.message).toBe(true);
  for (const id of res.checkoutIds!) {
    await db.update(transactions).set({ transactionDate: when }).where(eq(transactions.checkoutId, id));
    await db.update(checkouts).set({ createdAt: when }).where(eq(checkouts.id, id));
  }
}

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
  await clearResidue();
  f = await createFixture();
  await db.update(stores).set({ timezone: "Africa/Lagos" }).where(eq(stores.id, f.storeId));
  invalidateStoreTimezone(f.storeId);
  await db.insert(cashRegisterSessions).values({ storeId: f.storeId, status: "open", openingFloat: 0, expectedCash: 0 });
  const [product] = await db.insert(products).values({ storeId: f.storeId, name: "Tz Item", type: "product" }).returning();
  const [row] = await db.insert(inventory).values({
    storeId: f.storeId, productId: product.id, name: "Tz Item", type: "product", costPrice: 100, sellingPrice: 1000, quantity: 1000,
  } as any).returning();

  await sellAt(row.id, new Date("2026-03-10T23:30:00.000Z")); // 00:30 on the 11th, Lagos  -> the 11th
  await sellAt(row.id, new Date("2026-03-11T12:00:00.000Z")); // 13:00 on the 11th, Lagos  -> the 11th
  await sellAt(row.id, new Date("2026-03-11T23:30:00.000Z")); // 00:30 on the 12th, Lagos  -> the 12th
}, 120_000);

afterAll(async () => {
  if (f) { await clearSales(f.storeId); await f.cleanup(); }
  await clearResidue();
  await closePool();
});

describe("transactions date window follows the store's timezone", () => {
  it("reads a bare day as that day in the store's zone, not UTC", async () => {
    const w = await parseDateWindow({ startDate: DAY, endDate: DAY }, [f.storeId]);
    expect(w?.startDate?.toISOString()).toBe("2026-03-10T23:00:00.000Z");
    expect(w?.endDate?.toISOString()).toBe("2026-03-11T22:59:59.999Z");
  });

  it("puts each sale on the store's day, in the tile totals and the list alike", async () => {
    const w = (await parseDateWindow({ startDate: DAY, endDate: DAY }, [f.storeId]))!;
    const totals = await storage.getReceiptTotals([f.storeId], { ...w, scope: null });
    expect(totals.receiptCount).toBe(2); // the 23:30Z sale is already the 12th in Lagos
    const page = await storage.getReceiptPage([f.storeId], { ...w, scope: null, offset: 0, limit: 10 });
    expect(page.total).toBe(2);
  });

  it("agrees with the Profit & Loss window for the same day", async () => {
    const totals = await storage.getReceiptTotals([f.storeId], { ...(await parseDateWindow({ startDate: DAY, endDate: DAY }, [f.storeId]))!, scope: null });
    const pnl = await storage.getProfitLossSummary(f.storeId, DAY, DAY);
    expect(totals.gross).toBeCloseTo(pnl.grossRevenue, 2);
    expect(totals.gross).toBe(2000);
  });

  it("still takes a full ISO instant as given, and rejects a bad date", async () => {
    const iso = await parseDateWindow({ startDate: "2026-03-11T00:00:00.000Z" }, [f.storeId]);
    expect(iso?.startDate?.toISOString()).toBe("2026-03-11T00:00:00.000Z");
    expect(await parseDateWindow({ startDate: "not-a-date" }, [f.storeId])).toBeNull();
  });
});
