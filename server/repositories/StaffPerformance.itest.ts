import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import { eq, and, gte, lte } from "drizzle-orm";
import { staff, checkouts, orders, inventory, products, attendanceRecords, cashRegisterSessions } from "@shared/schema";
import { storage } from "../storage";
import { getStoreTimezone, toUtcStart, toUtcEnd } from "../lib/dateUtils";
import {
  assertTestDatabase, ensureSchema, createFixture, sweepResidue, type Fixture,
} from "../test-support/integration-db";
import { sql } from "drizzle-orm";

/**
 * getStaffPerformance now counts attendance in SQL and indexes the sales rows by staff in one pass. The previous
 * implementation (whole attendance list + per-staff filters) is reproduced as the oracle and run over the same
 * data, including a discounted multi-line receipt with a lead and two assistants.
 */

let f: Fixture;
let second: string;
let third: string;

async function clearSales(storeId: string) {
  const s = sql`${storeId}`;
  for (const t of ["gamification_points_ledger", "gamification_badge_awards", "gamification_streaks", "sale_payment_legs", "store_credit_transactions", "checkout_idempotency_keys", "stock_movements"]) {
    await db.execute(sql`DELETE FROM ${sql.raw(t)} WHERE store_id = ${s}`);
  }
  await db.execute(sql`DELETE FROM transactions WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM checkouts WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM orders WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM profit_loss WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM attendance_records WHERE store_id = ${s}`);
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

/** The previous implementation, verbatim apart from reading the repository's private helpers. */
async function legacy(storeId: string, startDate?: string, endDate?: string) {
  const repo = (storage as any).staffRepo;
  const activeStaff = await db.select().from(staff).where(and(eq(staff.storeId, storeId), eq(staff.isArchived, false)));
  const conds: any[] = [eq(checkouts.storeId, storeId), eq(checkouts.paymentStatus, "completed"), eq(checkouts.isVoided, false)];
  const tz = await getStoreTimezone(storeId);
  if (startDate) conds.push(gte(checkouts.createdAt, toUtcStart(startDate, tz)));
  if (endDate) conds.push(lte(checkouts.createdAt, toUtcEnd(endDate, tz)));
  const rows = await db.select({ checkout: checkouts, order: orders, inventoryItem: inventory })
    .from(orders).innerJoin(checkouts, eq(orders.id, checkouts.orderId)).innerJoin(inventory, eq(orders.inventoryId, inventory.id))
    .where(and(...conds));
  const aConds: any[] = [eq(attendanceRecords.storeId, storeId)];
  if (startDate) aConds.push(gte(attendanceRecords.date, startDate));
  if (endDate) aConds.push(lte(attendanceRecords.date, endDate));
  const attendanceList = await db.select().from(attendanceRecords).where(and(...aConds));
  const eff = repo.allocateEffectivePrices(rows);
  return activeStaff.map((s) => {
    const sc = rows.filter((r) =>
      r.checkout.leadStaffId === s.id || (r.checkout.staffId === s.id && !r.checkout.leadStaffId) ||
      r.checkout.assistingStaff1Id === s.id || r.checkout.assistingStaff2Id === s.id);
    const a = attendanceList.filter((x) => x.staffId === s.id);
    return {
      id: s.id,
      totalRevenue: sc.reduce((sum, r) => sum + repo.revenueShare(s.id, r.checkout, eff.get(r.checkout.id) ?? r.order.totalPrice), 0),
      servicesCount: sc.filter((r) => r.inventoryItem.type === "service").length,
      productsCount: sc.filter((r) => r.inventoryItem.type === "product").length,
      presentDays: a.filter((x) => x.status === "present").length,
      absentDays: a.filter((x) => x.status === "absent").length,
      lateDays: a.filter((x) => x.isLate).length,
    };
  });
}

const pick = (list: any[]) => list.map((x) => ({
  id: x.id, totalRevenue: Math.round(x.totalRevenue * 100) / 100, servicesCount: x.servicesCount,
  productsCount: x.productsCount, presentDays: x.presentDays, absentDays: x.absentDays, lateDays: x.lateDays,
})).sort((a, b) => a.id.localeCompare(b.id));

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
  await clearResidue();
  f = await createFixture();
  await db.insert(cashRegisterSessions).values({ storeId: f.storeId, status: "open", openingFloat: 0, expectedCash: 0 });
  const mkStaff = async (n: string) => (await db.insert(staff).values({
    storeId: f.storeId, name: n, email: `${n}-${Date.now()}@example.test`, staffNumber: `S-${n}-${Date.now()}`,
    mobileNumber: `0801${String(Math.random()).slice(2, 9)}`, payPerMonth: 1, paymentMethod: "fixed", overridePaymentMethod: true,
  } as any).returning())[0].id;
  second = await mkStaff("bola");
  third = await mkStaff("chi");

  const mk = async (name: string, type: string, price: number) => {
    const [p] = await db.insert(products).values({ storeId: f.storeId, name, type } as any).returning();
    return (await db.insert(inventory).values({ storeId: f.storeId, productId: p.id, name, type, costPrice: 1, sellingPrice: price, quantity: 100 } as any).returning())[0];
  };
  const svc = await mk("Cut", "service", 3333);
  const prod = await mk("Gel", "product", 1111);
  const sell = (items: any[], extra: any = {}) => storage.processCheckout({ storeId: f.storeId, customerId: f.customerId, staffId: f.staffId, items, paymentMethod: "cash", ...extra } as any);

  // A discounted two-line receipt whose lines are led/assisted differently.
  const r1 = await sell([{ inventoryId: svc.id, quantity: 1 }, { inventoryId: prod.id, quantity: 2 }], { discountAmount: 100 });
  const ids = r1.checkoutIds!;
  await db.update(checkouts).set({ leadStaffId: second, assistingStaff1Id: third }).where(eq(checkouts.id, ids[0]));
  await db.update(checkouts).set({ assistingStaff1Id: second, assistingStaff2Id: third }).where(eq(checkouts.id, ids[1]));
  const r2 = await sell([{ inventoryId: svc.id, quantity: 1 }]);
  await db.update(checkouts).set({ leadStaffId: third }).where(eq(checkouts.id, r2.checkoutIds![0]));
  await sell([{ inventoryId: prod.id, quantity: 1 }]); // plain, cashier only

  const day = new Date().toISOString().slice(0, 10);
  const days = [0, 1, 2, 3].map((n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10));
  await db.insert(attendanceRecords).values([
    { storeId: f.storeId, staffId: f.staffId, date: days[0], status: "present", isLate: true },
    { storeId: f.storeId, staffId: f.staffId, date: days[1], status: "present", isLate: false },
    { storeId: f.storeId, staffId: f.staffId, date: days[2], status: "absent" },
    { storeId: f.storeId, staffId: second, date: days[0], status: "present", isLate: true },
    { storeId: f.storeId, staffId: second, date: days[3], status: "off_day" },
  ] as any);
  void day;
});

afterAll(async () => {
  if (f) { await clearSales(f.storeId); for (const id of [second, third]) if (id) await db.execute(sql`DELETE FROM staff WHERE id = ${id}`); await f.cleanup(); }
});

describe("getStaffPerformance", () => {
  it("matches the previous implementation for every staff member", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const week = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    for (const [a, b] of [[undefined, undefined], [week, today], [today, today]] as const) {
      const got = pick(await storage.getStaffPerformance(f.storeId, a, b));
      const want = pick(await legacy(f.storeId, a, b));
      expect(got).toEqual(want);
    }
    const all = pick(await storage.getStaffPerformance(f.storeId));
    expect(all.find((x) => x.id === second)!.totalRevenue).toBeGreaterThan(0);
    expect(all.find((x) => x.id === f.staffId)!.presentDays).toBe(2);
    expect(all.find((x) => x.id === f.staffId)!.lateDays).toBe(1);
  });

  it("returns the same figures for one staff member when asked for only them", async () => {
    const full = pick(await storage.getStaffPerformance(f.storeId));
    for (const id of [f.staffId, second, third]) {
      const one = pick(await storage.getStaffPerformance(f.storeId, undefined, undefined, id));
      expect(one).toEqual(full.filter((x) => x.id === id));
    }
  });
});
