import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import { eq, and, lte, gte, count, desc, inArray, sql } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";
import { organisations, stores, users, checkouts, inventory, products, cashRegisterSessions, supportThreads, superAdminAuditLogs } from "@shared/schema";
import { storage } from "../storage";
import { getAdminDashboardMetrics } from "./adminDashboard";
import {
  assertTestDatabase, ensureSchema, createFixture, sweepResidue, closePool, type Fixture,
} from "../test-support/integration-db";

/**
 * The admin dashboard used to be about 70 sequential queries. It is now four statements. The old logic is kept
 * here, figure by figure, as the oracle: both run over the same database state (this is platform-wide, so it
 * includes whatever else is in the test database) and must agree.
 */

let f: Fixture;
let stuck: { id: string };

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

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);

/** The previous implementation, one figure at a time. */
async function legacy(now: Date) {
  const startOfToday = startOfDay(now);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 86400000);
  const fortyEightHoursAgo = new Date(now.getTime() - 48 * 3600000);

  const [{ value: totalOrgs }] = await db.select({ value: count() }).from(organisations);
  const [{ value: priorOrgs }] = await db.select({ value: count() }).from(organisations).where(lte(organisations.createdAt, thirtyDaysAgo));
  const activeToday = await db.selectDistinct({ storeId: checkouts.storeId }).from(checkouts).where(and(gte(checkouts.createdAt, startOfToday), eq(checkouts.isVoided, false)));
  let activeOrgs = 0;
  if (activeToday.length) {
    const rows = await db.select({ businessId: stores.businessId }).from(stores).where(inArray(stores.id, activeToday.map((r) => r.storeId)));
    activeOrgs = new Set(rows.map((r) => r.businessId)).size;
  }
  const [{ value: newOrgs }] = await db.select({ value: count() }).from(organisations).where(gte(organisations.createdAt, thirtyDaysAgo));
  const [{ value: priorNewOrgs }] = await db.select({ value: count() }).from(organisations).where(and(gte(organisations.createdAt, sixtyDaysAgo), lte(organisations.createdAt, thirtyDaysAgo)));
  const [{ value: suspended }] = await db.select({ value: count() }).from(organisations).where(eq(organisations.status, "suspended"));
  const [{ value: totalUsers }] = await db.select({ value: count() }).from(users);
  const [{ value: txToday }] = await db.select({ value: count() }).from(checkouts).where(and(gte(checkouts.createdAt, startOfToday), eq(checkouts.isVoided, false)));
  const [{ value: txMonth }] = await db.select({ value: count() }).from(checkouts).where(and(gte(checkouts.createdAt, thirtyDaysAgo), eq(checkouts.isVoided, false)));
  const month = await db.select({ p: checkouts.totalPrice }).from(checkouts).where(and(gte(checkouts.createdAt, thirtyDaysAgo), eq(checkouts.isVoided, false)));
  const gmv = month.reduce((s, r) => s + (r.p || 0), 0);
  const prior = await db.select({ p: checkouts.totalPrice }).from(checkouts).where(and(gte(checkouts.createdAt, sixtyDaysAgo), lte(checkouts.createdAt, thirtyDaysAgo), eq(checkouts.isVoided, false)));
  const priorGmv = prior.reduce((s, r) => s + (r.p || 0), 0);

  const growth: { date: string; businesses: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const date = new Date(now.getTime() - i * 86400000);
    const [{ value }] = await db.select({ value: count() }).from(organisations).where(lte(organisations.createdAt, endOfDay(date)));
    growth.push({ date: startOfDay(date).toLocaleDateString("en-US", { month: "short", day: "numeric" }), businesses: value });
  }
  const bars: { day: string; count: number; gmv: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date(now.getTime() - i * 86400000);
    const rows = await db.select({ p: checkouts.totalPrice }).from(checkouts).where(and(gte(checkouts.createdAt, startOfDay(date)), lte(checkouts.createdAt, endOfDay(date)), eq(checkouts.isVoided, false)));
    bars.push({ day: startOfDay(date).toLocaleDateString("en-US", { weekday: "short" }), count: rows.length, gmv: rows.reduce((s, r) => s + (r.p || 0), 0) });
  }

  const allStores = await db.select({ storeId: stores.id }).from(stores);
  const latest = await db.select({ storeId: checkouts.storeId, latest: sql<Date>`max(${checkouts.createdAt})` }).from(checkouts).groupBy(checkouts.storeId);
  const inactive = allStores.filter((so) => { const tx = latest.find((l) => l.storeId === so.storeId); return !tx || new Date(tx.latest).getTime() < thirtyDaysAgo.getTime(); }).length;
  const [{ value: locked }] = await db.select({ value: count() }).from(users).where(eq(users.status, "locked"));
  const [{ value: large }] = await db.select({ value: count() }).from(checkouts).where(and(gte(checkouts.totalPrice, 500000), eq(checkouts.isVoided, false), gte(checkouts.createdAt, startOfToday)));
  const [{ value: openSupport }] = await db.select({ value: count() }).from(supportThreads).where(eq(supportThreads.status, "open"));
  const oldOrgs = await db.select({ id: organisations.id }).from(organisations).where(lte(organisations.createdAt, fortyEightHoursAgo));
  let stuckCount = 0;
  for (const org of oldOrgs) {
    const orgStores = await db.select({ id: stores.id }).from(stores).where(eq(stores.businessId, org.id));
    if (orgStores.length === 0) { stuckCount++; continue; }
    const [{ value }] = await db.select({ value: count() }).from(checkouts).where(inArray(checkouts.storeId, orgStores.map((s) => s.id)));
    if (value === 0) stuckCount++;
  }
  return { totalOrgs, priorOrgs, activeOrgs, newOrgs, priorNewOrgs, suspended, totalUsers, txToday, txMonth, gmv, priorGmv, growth, bars, inactive, locked, large, openSupport, stuckCount };
}

const pct = (n: number, before: number) => (before > 0 ? Math.round(((n - before) / before) * 100) : 0);

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
  await clearResidue();
  f = await createFixture();
  await db.insert(cashRegisterSessions).values({ storeId: f.storeId, status: "open", openingFloat: 0, expectedCash: 0 });
  const [product] = await db.insert(products).values({ storeId: f.storeId, name: "Big", type: "product" } as any).returning();
  const [item] = await db.insert(inventory).values({ storeId: f.storeId, productId: product.id, name: "Big", type: "product", costPrice: 100, sellingPrice: 600000, quantity: 100 } as any).returning();
  const sale = (qty: number) => storage.processCheckout({ storeId: f.storeId, customerId: f.customerId, staffId: f.staffId, items: [{ inventoryId: item.id, quantity: qty }], paymentMethod: "cash" } as any);
  await sale(1);                                   // a large transaction today
  const voided = await sale(1);
  await db.update(checkouts).set({ isVoided: true }).where(eq(checkouts.id, voided.checkoutIds![0]));
  const older = await sale(2);                     // three days ago
  await db.update(checkouts).set({ createdAt: new Date(Date.now() - 3 * 86400000) }).where(eq(checkouts.id, older.checkoutIds![0]));
  const old = await sale(1);                       // 40 days ago (prior month)
  await db.update(checkouts).set({ createdAt: new Date(Date.now() - 40 * 86400000) }).where(eq(checkouts.id, old.checkoutIds![0]));

  // A business created long ago with no stores (stuck), and a suspended one.
  [stuck] = await db.insert(organisations).values({ name: `Stuck ${Date.now()}`, createdAt: new Date(Date.now() - 5 * 86400000) } as any).returning();
  await db.insert(organisations).values({ name: `Suspended ${Date.now()}`, status: "suspended" } as any);
  await db.insert(superAdminAuditLogs).values({ adminId: (await db.execute(sql`SELECT id FROM super_admins LIMIT 1`)).rows[0]?.id as string ?? "x", adminEmail: "a@test.local", adminRole: "super_admin", action: "suspend_business", target: "Suspended Co", ipAddress: "127.0.0.1" } as any).catch(() => undefined);
});

afterAll(async () => {
  await db.execute(sql`DELETE FROM super_admin_audit_logs WHERE admin_email = 'a@test.local'`);
  if (stuck) await db.execute(sql`DELETE FROM organisations WHERE name LIKE 'Stuck %' OR name LIKE 'Suspended %'`);
  if (f) { await clearSales(f.storeId); await f.cleanup(); }
  await clearResidue();
  await closePool();
});

describe("admin dashboard metrics", () => {
  it("matches the figure-by-figure calculation it replaces", async () => {
    const now = new Date();
    const want = await legacy(now);
    const got = await getAdminDashboardMetrics(now);
    const c = got.summaryCards;

    expect(c.totalBusinesses).toEqual({ count: want.totalOrgs, deltaPercent: pct(want.totalOrgs, want.priorOrgs) });
    expect(c.activeToday.count).toBe(want.activeOrgs);
    expect(c.activeToday.percent).toBe(want.totalOrgs > 0 ? Math.round((want.activeOrgs / want.totalOrgs) * 100) : 0);
    expect(c.newThisMonth).toEqual({ count: want.newOrgs, deltaPercent: pct(want.newOrgs, want.priorNewOrgs) });
    expect(c.suspended.count).toBe(want.suspended);
    expect(c.totalUsers.count).toBe(want.totalUsers);
    expect(c.transactionsToday.count).toBe(want.txToday);
    expect(c.transactionsMonth.count).toBe(want.txMonth);
    expect(Math.abs(c.gmvMonth.count - want.gmv)).toBeLessThan(0.01);
    expect(c.gmvMonth.deltaPercent).toBe(pct(want.gmv, want.priorGmv));
    expect(c.avgRevenuePerBusiness.count).toBe(want.activeOrgs > 0 ? Math.round(want.gmv / want.activeOrgs) : 0);

    expect(got.charts.growthTrend).toEqual(want.growth);
    expect(got.charts.transactionTrend.map((b) => ({ ...b, gmv: Math.round(b.gmv * 100) / 100 }))).toEqual(want.bars.map((b) => ({ ...b, gmv: Math.round(b.gmv * 100) / 100 })));

    const alertText = got.alerts.map((a) => a.message).join("\n");
    const has = (n: number, phrase: string) => (n > 0 ? expect(alertText).toContain(`${n} ${phrase}`) : expect(alertText).not.toContain(phrase));
    has(want.inactive, "Businesses inactive for 30+ days");
    has(want.locked, "Accounts locked with excessive failed logins");
    has(want.large, "Unusually large transaction flagged today");
    has(want.stuckCount, "New businesses stuck in onboarding funnel");
    expect(want.large).toBeGreaterThan(0);     // the seeded 600,000 sale
    expect(want.stuckCount).toBeGreaterThan(0); // the seeded store-less business
  });

  it("reports a real heatmap: sales per weekday and two-hour block, never random", async () => {
    const now = new Date();
    const first = await getAdminDashboardMetrics(now);
    const second = await getAdminDashboardMetrics(now);
    expect(first.charts.activityHeatmap).toEqual(second.charts.activityHeatmap); // deterministic
    expect(first.charts.activityHeatmap).toHaveLength(7 * 7);

    const thirty = new Date(now.getTime() - 30 * 86400000);
    const rows = await db.select({ at: checkouts.createdAt }).from(checkouts).where(and(gte(checkouts.createdAt, thirty), eq(checkouts.isVoided, false)));
    const expected = new Map<string, number>();
    for (const r of rows) {
      const local = formatInTimeZone(r.at, "Africa/Lagos", "i-HH"); // i: ISO weekday, 1 = Monday ... 7 = Sunday
      const [isoDow, hh] = local.split("-").map(Number);
      const dow = isoDow % 7; // Sunday = 0
      const block = Math.floor(hh / 2) * 2;
      if (block >= 8 && block <= 20) expected.set(`${dow}:${block}`, (expected.get(`${dow}:${block}`) ?? 0) + 1);
    }
    const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    for (const cell of first.charts.activityHeatmap) {
      const dow = names.indexOf(cell.day);
      const block = parseInt(cell.hour, 10);
      expect(cell.value).toBe(expected.get(`${dow}:${block}`) ?? 0);
    }
  });

  it("lists the newest businesses and sales in the live feed, newest first", async () => {
    const got = await getAdminDashboardMetrics(new Date());
    const stamps = got.liveActivity.map((e) => e.timestamp);
    expect([...stamps].sort((a, b) => b - a)).toEqual(stamps);
    const newestOrg = (await db.select({ name: organisations.name }).from(organisations).orderBy(desc(organisations.createdAt)).limit(1))[0];
    expect(got.liveActivity.some((e) => e.type === "business_registration" && e.message.includes(newestOrg.name))).toBe(true);
    expect(got.liveActivity.some((e) => e.type === "transaction_completed")).toBe(true);
  });
});
