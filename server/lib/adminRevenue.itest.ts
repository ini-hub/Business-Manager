import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import { eq, sql } from "drizzle-orm";
import { organisations, subscriptions, plans, inventory, products, cashRegisterSessions } from "@shared/schema";
import { storage } from "../storage";
import { getRevenueAnalytics } from "./adminRevenue";
import {
  assertTestDatabase, ensureSchema, createFixture, sweepResidue, closePool, type Fixture,
} from "../test-support/integration-db";

/**
 * Revenue analytics: the subscription maths is checked against the previous in-memory calculation over the same
 * rows, and "top businesses" must be the biggest by gross sales (it used to be the first five created, re-sorted).
 */

const fixtures: Fixture[] = [];
const planIds: string[] = [];

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

async function businessWithSales(price: number) {
  const f = await createFixture();
  fixtures.push(f);
  await db.insert(cashRegisterSessions).values({ storeId: f.storeId, status: "open", openingFloat: 0, expectedCash: 0 });
  const [product] = await db.insert(products).values({ storeId: f.storeId, name: "P", type: "product" } as any).returning();
  const [item] = await db.insert(inventory).values({ storeId: f.storeId, productId: product.id, name: "P", type: "product", costPrice: 1, sellingPrice: price, quantity: 10 } as any).returning();
  await storage.processCheckout({ storeId: f.storeId, customerId: f.customerId, staffId: f.staffId, items: [{ inventoryId: item.id, quantity: 1 }], paymentMethod: "cash" } as any);
  return f;
}

/** The previous in-memory subscription calculation. */
async function legacySummary(now: Date) {
  const orgs = await db.select().from(organisations);
  const subs = await db.select().from(subscriptions);
  const allPlans = await db.select().from(plans);
  const planById = new Map(allPlans.map((p) => [p.id, p]));
  const active = subs.filter((s) => s.status === "active");
  const mrr = active.reduce((sum, sub) => {
    const plan = planById.get(sub.planId);
    if (!plan) return sum;
    return sum + (sub.billingCycle === "annual" ? Number(plan.priceAnnual) / 12 : Number(plan.priceMonthly));
  }, 0);
  const churned = subs.filter((s) => s.status === "cancelled" && s.updatedAt.getFullYear() === now.getFullYear() && s.updatedAt.getMonth() === now.getMonth()).length;
  return { freeTrial: orgs.filter((o) => o.status === "trialing").length, activePaying: active.length, mrr, churned };
}

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
  await clearResidue();
  const small = await businessWithSales(1000);
  const big = await businessWithSales(9_000_000_000);       // far bigger than anything else in the database
  const mid = await businessWithSales(8_000_000_000);
  // Make the biggest one the most recently created, so "first five created" cannot find it.
  await db.update(organisations).set({ createdAt: new Date() }).where(eq(organisations.id, big.businessId));
  await db.update(organisations).set({ status: "trialing" }).where(eq(organisations.id, small.businessId));

  const [monthly] = await db.insert(plans).values({ name: `M ${Date.now()}`, priceMonthly: 5000, priceAnnual: 48000 } as any).returning();
  const [annual] = await db.insert(plans).values({ name: `A ${Date.now()}`, priceMonthly: 7000, priceAnnual: 60000 } as any).returning();
  planIds.push(monthly.id, annual.id);
  const end = new Date(Date.now() + 30 * 86400000);
  const sub = (orgId: string, planId: string, o: Record<string, unknown>) =>
    db.insert(subscriptions).values({ organisationId: orgId, planId, currentPeriodEnd: end, ...o } as any);
  await sub(small.businessId, monthly.id, { status: "active", billingCycle: "monthly" });
  await sub(big.businessId, annual.id, { status: "active", billingCycle: "annual" });
  await sub(mid.businessId, monthly.id, { status: "cancelled", updatedAt: new Date() });        // churned this month
});

afterAll(async () => {
  for (const f of fixtures) { await db.execute(sql`DELETE FROM subscriptions WHERE organisation_id = ${f.businessId}`); }
  if (planIds.length) await db.execute(sql`DELETE FROM plans WHERE id IN (${sql.join(planIds.map((i) => sql`${i}`), sql`, `)})`);
  for (const f of fixtures) { await clearSales(f.storeId); await f.cleanup(); }
  await clearResidue();
  await closePool();
});

describe("revenue analytics", () => {
  it("matches the in-memory subscription calculation", async () => {
    const now = new Date();
    const want = await legacySummary(now);
    const got = await getRevenueAnalytics(now);
    expect(got.revenueSummary.freeTrial).toBe(want.freeTrial);
    expect(got.revenueSummary.activePaying).toBe(want.activePaying);
    expect(Math.abs(got.revenueSummary.mrr - want.mrr)).toBeLessThan(0.01);
    expect(Math.abs(got.revenueSummary.arr - want.mrr * 12)).toBeLessThan(0.1);
    expect(got.revenueSummary.arpu).toBeCloseTo(want.activePaying > 0 ? want.mrr / want.activePaying : 0, 4);
    expect(got.revenueSummary.churnedThisMonth).toBe(want.churned);
    expect(want.activePaying).toBeGreaterThanOrEqual(2);
    expect(want.churned).toBeGreaterThanOrEqual(1);
    expect(want.mrr).toBeGreaterThanOrEqual(5000 + 60000 / 12);
  });

  it("lists the biggest businesses by gross sales, largest first, not the first five created", async () => {
    const got = await getRevenueAnalytics();
    expect(got.topBusinesses.length).toBeLessThanOrEqual(5);
    const gmvs = got.topBusinesses.map((b) => b.gmv);
    expect([...gmvs].sort((a, b) => b - a)).toEqual(gmvs);
    expect(got.topBusinesses[0].gmv).toBeGreaterThanOrEqual(9_000_000_000);
    expect(got.topBusinesses[1].gmv).toBeGreaterThanOrEqual(8_000_000_000);
  });
});
