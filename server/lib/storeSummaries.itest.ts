import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import { eq, sql } from "drizzle-orm";
import { staff, checkouts, inventory, products, cashRegisterSessions } from "@shared/schema";
import { storage } from "../storage";
import { getVatByMonth, getServiceStaffDays } from "./storeSummaries";
import { assertTestDatabase, ensureSchema, createFixture, sweepResidue, type Fixture } from "../test-support/integration-db";

/**
 * VAT per month and the staff-days that did service work are now grouped by the database instead of walking
 * every receipt in the browser. Figures are checked against hand-computed values on seeded receipts.
 */

let f: Fixture;
let second: string;

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

let receiptA: string[]; // two lines, taxed, partly refunded
let orderIdsA: string[];

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
  await clearResidue();
  f = await createFixture();
  await db.insert(cashRegisterSessions).values({ storeId: f.storeId, status: "open", openingFloat: 0, expectedCash: 0 });
  second = (await db.insert(staff).values({
    storeId: f.storeId, name: "bola", email: `bola-${Date.now()}@example.test`, staffNumber: `S-b-${Date.now()}`,
    mobileNumber: `0801${String(Math.random()).slice(2, 9)}`, payPerMonth: 1, paymentMethod: "fixed", overridePaymentMethod: true,
  } as any).returning())[0].id;
  const mk = async (name: string, type: string, price: number) => {
    const [p] = await db.insert(products).values({ storeId: f.storeId, name, type } as any).returning();
    return (await db.insert(inventory).values({ storeId: f.storeId, productId: p.id, name, type, costPrice: 1, sellingPrice: price, quantity: 100 } as any).returning())[0];
  };
  const svc = await mk("Cut", "service", 1000);
  const prod = await mk("Gel", "product", 500);
  // Ids of the checkout rows a sale just created (the store's newest rows not seen before).
  const known = new Set<string>();
  const sell = async (items: any[]) => {
    await storage.processCheckout({ storeId: f.storeId, customerId: f.customerId, staffId: f.staffId, items, paymentMethod: "cash" } as any);
    const all = await db.select({ id: checkouts.id }).from(checkouts).where(eq(checkouts.storeId, f.storeId));
    const fresh = all.map((r) => r.id).filter((id) => !known.has(id));
    fresh.forEach((id) => known.add(id));
    return { checkoutIds: fresh };
  };

  const a = await sell([{ inventoryId: svc.id, quantity: 1 }, { inventoryId: prod.id, quantity: 1 }]);
  receiptA = a.checkoutIds!;
  await db.update(checkouts).set({ taxTotal: 10, subtotal: 1000, leadStaffId: second }).where(eq(checkouts.id, receiptA[0]));
  await db.update(checkouts).set({ taxTotal: 5, subtotal: 500, assistingStaff1Id: f.staffId }).where(eq(checkouts.id, receiptA[1]));
  const rows = await db.select({ orderId: checkouts.orderId }).from(checkouts).where(eq(checkouts.id, receiptA[0]));
  orderIdsA = [rows[0].orderId];
  await db.execute(sql`UPDATE orders SET tax_refunded = 3 WHERE id = ${orderIdsA[0]}`);

  const b = await sell([{ inventoryId: prod.id, quantity: 1 }]); // untaxed product-only receipt
  await db.update(checkouts).set({ taxTotal: 0, leadStaffId: f.staffId }).where(eq(checkouts.id, b.checkoutIds![0]));

  const c = await sell([{ inventoryId: svc.id, quantity: 1 }]); // voided taxed sale
  await db.update(checkouts).set({ taxTotal: 99, isVoided: true }).where(eq(checkouts.id, c.checkoutIds![0]));
});

afterAll(async () => {
  if (f) { await clearSales(f.storeId); if (second) await db.execute(sql`DELETE FROM staff WHERE id = ${second}`); await f.cleanup(); }
});

describe("store summaries", () => {
  it("sums VAT by month across a receipt's lines, net of refunds, ignoring voided sales", async () => {
    const months = await getVatByMonth(f.storeId);
    expect(months).toHaveLength(1);
    // Receipt A: tax 10 + 5 - refunded 3 = 12 on a 1500 subtotal. Receipt B carries no tax. Void C is ignored.
    expect(months[0].vatCollected).toBe(12);
    expect(months[0].taxableSales).toBe(1500);
    expect(months[0].count).toBe(2);
    expect(months[0].month).toMatch(/^\d{4}-\d{2}$/);
  });

  it("lists staff-and-day pairs for receipts with a service line, covering staff named on any line", async () => {
    const days = await getServiceStaffDays(f.storeId);
    const today = days.find((d) => d.startsWith(`${second}:`))!.split(":")[1];
    // A (has a service) names `second` (lead) and the cashier-as-assistant; the void C is a service receipt with
    // no staff named; B is product-only so its lead does not count on its own.
    expect(days.sort()).toEqual([`${f.staffId}:${today}`, `${second}:${today}`].sort());
  });

  it("honours the date range", async () => {
    expect(await getServiceStaffDays(f.storeId, "2000-01-01", "2000-01-02")).toEqual([]);
    const today = new Date().toISOString().slice(0, 10);
    const wide = await getServiceStaffDays(f.storeId, "2000-01-01", today);
    expect(wide.length).toBeGreaterThan(0);
  });
});
