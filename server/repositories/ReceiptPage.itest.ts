import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import { eq, sql } from "drizzle-orm";
import { inventory, products, checkouts, transactions, staff, cashRegisterSessions } from "@shared/schema";
import { storage } from "../storage";
import { groupTransactions } from "../routes/transaction.routes";
import { filterToScope } from "../lib/transactionAccess";
import {
  assertTestDatabase, ensureSchema, createFixture, sweepResidue, closePool, type Fixture,
} from "../test-support/integration-db";

/**
 * getReceiptPage moves "which receipts are on this page" from Node into SQL. The list has always been built by
 * grouping lines into receipts in JavaScript, so the old pipeline is kept here as the oracle and the SQL must
 * agree with it for every scope, search, date window and page.
 */

let fixture: Fixture;
let staffB: string;

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

async function item(name: string) {
  const [product] = await db.insert(products).values({ storeId: fixture.storeId, name, type: "product" }).returning();
  const [row] = await db.insert(inventory).values({
    storeId: fixture.storeId, productId: product.id, name, type: "product", costPrice: 100, sellingPrice: 500, quantity: 1000,
  }).returning();
  return row;
}

const sale = (lines: Array<{ inventoryId: string; quantity: number; leadStaffId?: string }>, staffId = fixture.staffId) =>
  storage.processCheckout({
    storeId: fixture.storeId, customerId: fixture.customerId, staffId, items: lines, paymentMethod: "cash",
  } as any);

/** Old pipeline, verbatim in behaviour: index rows -> group -> scope -> search -> sort -> slice. */
async function oracle(opts: { startDate?: Date; endDate?: Date; scope: Set<string> | null; search?: string; page: number; limit: number }) {
  const index = await storage.getTransactionIndex([fixture.storeId], { startDate: opts.startDate, endDate: opts.endDate });
  let groups = filterToScope(groupTransactions(index), opts.scope);
  if (opts.search) {
    const q = opts.search.toLowerCase();
    groups = groups.filter((tx: any) =>
      String(tx.checkout?.receiptNumber || "").toLowerCase().includes(q) ||
      String(tx.id || "").toLowerCase().includes(q) ||
      String(tx.inventory?.name || "").toLowerCase().includes(q) ||
      String(tx.customer?.name || "").toLowerCase().includes(q));
  }
  groups.sort((a: any, b: any) => new Date(b.transactionDate).getTime() - new Date(a.transactionDate).getTime());
  const offset = (opts.page - 1) * opts.limit;
  return {
    total: groups.length,
    keys: groups.slice(offset, offset + opts.limit).map((g: any) => g.checkout?.receiptNumber || g.checkoutId || g.id),
  };
}

const sqlPage = (opts: { startDate?: Date; endDate?: Date; scope: Set<string> | null; search?: string; page: number; limit: number }) =>
  storage.getReceiptPage([fixture.storeId], { ...opts, offset: (opts.page - 1) * opts.limit, limit: opts.limit });

let rcpt: Record<string, string> = {};
let middleDate: Date;

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
  await clearResidue();

  fixture = await createFixture();
  const [b] = await db.insert(staff).values({
    storeId: fixture.storeId, name: "Second Cashier", email: `second-${Date.now()}@test.local`,
    staffNumber: "S2", mobileNumber: "08000000002", payPerMonth: 50000,
  } as any).returning();
  staffB = b.id;
  await db.insert(cashRegisterSessions).values({ storeId: fixture.storeId, status: "open", openingFloat: 0, expectedCash: 0 });

  const a = await item("Alpha Soap");
  const bb = await item("Bravo Lotion");
  const c = await item("Charlie Candle");

  const r1 = await sale([{ inventoryId: a.id, quantity: 1 }]);                                           // single line, cashier A
  const r2 = await sale([{ inventoryId: a.id, quantity: 1 }, { inventoryId: bb.id, quantity: 1, leadStaffId: staffB }, { inventoryId: c.id, quantity: 2 }]); // three lines, B leads one
  const r3 = await sale([{ inventoryId: bb.id, quantity: 1 }, { inventoryId: c.id, quantity: 1 }]);      // two lines, one becomes an addendum
  const r4 = await sale([{ inventoryId: c.id, quantity: 1 }], staffB);                                   // single line, cashier B
  const r5 = await sale([{ inventoryId: bb.id, quantity: 3 }]);                                          // single line, cashier A
  for (const r of [r1, r2, r3, r4, r5]) expect(r.success).toBe(true);

  // Spread the receipts over distinct days so ordering is unambiguous (lines of one receipt share a date).
  const ids = [r1, r2, r3, r4, r5].map((r) => r.checkoutIds!);
  const day = 86400000;
  for (let i = 0; i < ids.length; i++) {
    const when = new Date(Date.now() - (ids.length - i) * day);
    for (const checkoutId of ids[i]) {
      await db.update(transactions).set({ transactionDate: when }).where(eq(transactions.checkoutId, checkoutId));
      await db.update(checkouts).set({ createdAt: when }).where(eq(checkouts.id, checkoutId));
    }
  }
  middleDate = new Date(Date.now() - 3 * day - 3600000);
  // Receipt 3: its second line is an addendum, so the first line must represent it.
  await db.update(checkouts).set({ isAddendum: true }).where(eq(checkouts.id, ids[2][1]));

  const rows = await db.select({ id: checkouts.id, receipt: checkouts.receiptNumber }).from(checkouts).where(eq(checkouts.storeId, fixture.storeId));
  rcpt = Object.fromEntries(rows.map((r) => [r.id, r.receipt as string]));
});

afterAll(async () => {
  if (fixture) {
    await clearSales(fixture.storeId);
    await fixture.cleanup();
  }
  await clearResidue();
  await closePool();
});

describe("getReceiptPage agrees with the JavaScript pipeline it replaces", () => {
  const A = () => new Set([fixture.staffId]);
  const B = () => new Set([staffB]);

  it("matches on every page of an unrestricted list", async () => {
    for (const limit of [2, 3, 10]) {
      for (let page = 1; page <= 4; page++) {
        const want = await oracle({ scope: null, page, limit });
        const got = await sqlPage({ scope: null, page, limit });
        expect({ page, limit, ...got, lineIds: undefined }).toEqual({ page, limit, ...want, lineIds: undefined });
      }
    }
  });

  it("returns the right line ids for each receipt, whole receipts only", async () => {
    const got = await sqlPage({ scope: null, page: 1, limit: 10 });
    expect(got.total).toBe(5);
    expect(got.lineIds).toHaveLength(8); // 1 + 3 + 2 + 1 + 1 lines
    expect(new Set(got.lineIds).size).toBe(8);
  });

  it("applies the staff scope across all lines of a receipt", async () => {
    for (const scope of [A, B]) {
      const want = await oracle({ scope: scope(), page: 1, limit: 10 });
      const got = await sqlPage({ scope: scope(), page: 1, limit: 10 });
      expect(got.keys).toEqual(want.keys);
      expect(got.total).toBe(want.total);
    }
    // Staff B only leads one line of the three-line receipt, yet that whole receipt is visible to B.
    const forB = await sqlPage({ scope: B(), page: 1, limit: 10 });
    expect(forB.total).toBeGreaterThanOrEqual(2);
  });

  it("shows nothing to a viewer with no staff record", async () => {
    const got = await sqlPage({ scope: new Set(), page: 1, limit: 10 });
    expect(got).toEqual({ keys: [], lineIds: [], total: 0 });
  });

  it("matches on search by receipt, item, customer and id fragments, treating wildcards literally", async () => {
    const firstReceipt = Object.values(rcpt)[0];
    const terms = [firstReceipt.slice(-3), "alpha", "ALPHA", "charlie", "test", "%", "_", "no-such-thing", "TN-"];
    for (const search of terms) {
      const want = await oracle({ scope: null, search, page: 1, limit: 10 });
      const got = await sqlPage({ scope: null, search, page: 1, limit: 10 });
      expect({ search, keys: got.keys, total: got.total }).toEqual({ search, keys: want.keys, total: want.total });
    }
  });

  it("matches with a date window", async () => {
    for (const opts of [{ startDate: middleDate }, { endDate: middleDate }, { startDate: middleDate, endDate: new Date() }]) {
      const want = await oracle({ ...opts, scope: null, page: 1, limit: 10 });
      const got = await sqlPage({ ...opts, scope: null, page: 1, limit: 10 });
      expect(got.keys).toEqual(want.keys);
      expect(got.total).toBe(want.total);
    }
  });

  it("still reports the total when the page is past the end", async () => {
    const got = await sqlPage({ scope: null, page: 9, limit: 10 });
    expect(got.keys).toEqual([]);
    expect(got.total).toBe(5);
  });
});
