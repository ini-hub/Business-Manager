import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import { eq, and, count, inArray, sql } from "drizzle-orm";
import { organisations, organisationMembers, stores, staff, users, checkouts, inventory, products, cashRegisterSessions } from "@shared/schema";
import { storage } from "../storage";
import { getBusinessRosterStats } from "./adminBusinesses";
import { getOnboardingPipeline } from "./adminOnboarding";
import {
  assertTestDatabase, ensureSchema, createFixture, sweepResidue, closePool, type Fixture,
} from "../test-support/integration-db";

/**
 * The admin business list and onboarding funnel used to run several queries per business. They now read a page
 * (or the whole funnel) in a few statements. The per-business loops are reproduced here as the oracle, over
 * businesses at every funnel stage.
 */

const fixtures: Fixture[] = [];
const extraOrgs: string[] = [];
const names: Record<string, string> = {};

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

async function addInventory(storeId: string) {
  const [product] = await db.insert(products).values({ storeId, name: `Item ${Date.now()}`, type: "product" } as any).returning();
  return (await db.insert(inventory).values({ storeId, productId: product.id, name: product.name, type: "product", costPrice: 100, sellingPrice: 900, quantity: 50 } as any).returning())[0];
}

/** The previous per-business roster loop. */
async function legacyRoster(orgIds: string[]) {
  const out = new Map<string, { staffCount: number; txCount: number; gmv: number; latest: Date | null; owner: { name: string; email: string } }>();
  for (const id of orgIds) {
    const orgStores = await db.select().from(stores).where(eq(stores.businessId, id));
    let txCount = 0, gmv = 0, staffCount = 0, latest: Date | null = null;
    if (orgStores.length > 0) {
      const storeIds = orgStores.map((s) => s.id);
      const [sales] = await db.select({ value: count() }).from(checkouts).where(and(inArray(checkouts.storeId, storeIds), eq(checkouts.isVoided, false)));
      txCount = sales.value;
      const rows = await db.select({ p: checkouts.totalPrice, at: checkouts.createdAt }).from(checkouts).where(and(inArray(checkouts.storeId, storeIds), eq(checkouts.isVoided, false)));
      gmv = rows.reduce((s, r) => s + (r.p || 0), 0);
      if (rows.length) latest = [...rows].sort((a, b) => b.at.getTime() - a.at.getTime())[0].at;
      const [st] = await db.select({ value: count() }).from(staff).where(and(inArray(staff.storeId, storeIds), eq(staff.isArchived, false)));
      staffCount = st.value;
    }
    const [member] = await db.select().from(organisationMembers).where(and(eq(organisationMembers.organisationId, id), eq(organisationMembers.role, "owner"))).limit(1);
    let owner = { name: "Unconfigured", email: "Unconfigured" };
    if (member) {
      const [u] = await db.select({ name: users.name, email: users.email, phone: users.phone }).from(users).where(eq(users.id, member.userId)).limit(1);
      if (u) owner = { name: u.name || "Owner Account", email: u.email || u.phone || "No Email" };
    }
    out.set(id, { staffCount, txCount, gmv, latest, owner });
  }
  return out;
}

/** The previous onboarding loop. */
async function legacyPipeline(now: number) {
  const orgs = await db.select().from(organisations).where(sql`${organisations.deletedAt} is null`);
  const stage = new Map<string, string>();
  const stuck: string[] = [];
  for (const org of orgs) {
    const orgStores = await db.select().from(stores).where(eq(stores.businessId, org.id));
    const ids = orgStores.map((s) => s.id);
    let s: string;
    if (ids.length === 0) s = "registered";
    else if ((await db.select({ v: count() }).from(inventory).where(inArray(inventory.storeId, ids)))[0].v === 0) s = "configured";
    else if ((await db.select({ v: count() }).from(staff).where(and(inArray(staff.storeId, ids), eq(staff.isArchived, false))))[0].v === 0) s = "staffed";
    else if ((await db.select({ p: checkouts.totalPrice }).from(checkouts).where(and(inArray(checkouts.storeId, ids), eq(checkouts.isVoided, false)))).length === 0) s = "first_sale";
    else s = "active";
    stage.set(org.id, s);
    if (s !== "active" && now - org.createdAt.getTime() > 48 * 3600000) stuck.push(org.id);
  }
  return { stage, stuck };
}

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
  await clearResidue();
  const old = new Date(Date.now() - 5 * 86400000);

  // registered: a business with no store at all (and old enough to count as stuck)
  const [bare] = await db.insert(organisations).values({ name: `Funnel Bare ${Date.now()}`, createdAt: old } as any).returning();
  extraOrgs.push(bare.id); names.registered = bare.id;

  // configured: store and staff, no inventory
  const configured = await createFixture(); fixtures.push(configured); names.configured = configured.businessId;
  await db.update(organisations).set({ createdAt: old }).where(eq(organisations.id, configured.businessId));

  // staffed (no active staff): inventory, staff archived
  const noStaff = await createFixture(); fixtures.push(noStaff); names.staffed = noStaff.businessId;
  await addInventory(noStaff.storeId);
  await db.update(staff).set({ isArchived: true }).where(eq(staff.storeId, noStaff.storeId));

  // first_sale: inventory and staff, no sale yet (recent: not stuck)
  const noSale = await createFixture(); fixtures.push(noSale); names.first_sale = noSale.businessId;
  await addInventory(noSale.storeId);

  // active: inventory, staff and sales (one voided, one counted)
  const active = await createFixture(); fixtures.push(active); names.active = active.businessId;
  const item = await addInventory(active.storeId);
  await db.insert(cashRegisterSessions).values({ storeId: active.storeId, status: "open", openingFloat: 0, expectedCash: 0 });
  const sale = (qty: number) => storage.processCheckout({ storeId: active.storeId, customerId: active.customerId, staffId: active.staffId, items: [{ inventoryId: item.id, quantity: qty }], paymentMethod: "cash" } as any);
  await sale(2);
  const voided = await sale(1);
  await db.update(checkouts).set({ isVoided: true }).where(eq(checkouts.id, voided.checkoutIds![0]));
});

afterAll(async () => {
  for (const f of fixtures) { await clearSales(f.storeId); await f.cleanup(); }
  if (extraOrgs.length) await db.execute(sql`DELETE FROM organisations WHERE id IN (${sql.join(extraOrgs.map((i) => sql`${i}`), sql`, `)})`);
  await clearResidue();
  await closePool();
});

describe("business roster stats", () => {
  it("match the per-business loop for every stage", async () => {
    const ids = Object.values(names);
    const want = await legacyRoster(ids);
    const got = await getBusinessRosterStats(ids);
    for (const id of ids) {
      const w = want.get(id)!;
      expect(got.staff.get(id) ?? 0).toBe(w.staffCount);
      expect(got.sales.get(id)?.txCount ?? 0).toBe(w.txCount);
      expect(Math.abs((got.sales.get(id)?.gmv ?? 0) - w.gmv)).toBeLessThan(0.01);
      expect(got.sales.get(id)?.latest?.getTime() ?? null).toBe(w.latest ? w.latest.getTime() : null);
      const o = got.owners.get(id);
      const owner = o ? { name: o.name || "Owner Account", email: o.email || o.phone || "No Email" } : { name: "Unconfigured", email: "Unconfigured" };
      expect(owner).toEqual(w.owner);
    }
    expect(want.get(names.active)!.txCount).toBe(1); // the voided sale is not counted
    expect(want.get(names.active)!.gmv).toBeGreaterThan(0);
  });

  it("handles an empty page", async () => {
    const got = await getBusinessRosterStats([]);
    expect(got.sales.size + got.staff.size + got.owners.size).toBe(0);
  });
});

describe("onboarding pipeline", () => {
  it("puts every business at the same stage as the per-business loop, with exact totals", async () => {
    const now = Date.now();
    const want = await legacyPipeline(now);
    const got = await getOnboardingPipeline({ perStage: 10_000, stuckLimit: 10_000, now });

    const gotStage = new Map<string, string>();
    for (const [stage, data] of Object.entries(got.funnel)) for (const item of data.items) gotStage.set(item.id, stage);
    expect(gotStage.size).toBe(want.stage.size);
    for (const [id, stage] of Array.from(want.stage.entries())) expect(gotStage.get(id)).toBe(stage);

    for (const stage of ["registered", "configured", "staffed", "first_sale", "active"] as const) {
      const expected = Array.from(want.stage.values()).filter((s) => s === stage).length;
      expect(got.funnel[stage].count).toBe(expected);
      expect(got.funnel[stage].hasMore).toBe(false);
    }
    expect(got.stuckBusinesses.map((b) => b.id).sort()).toEqual([...want.stuck].sort());
    expect(got.stuckTotal).toBe(want.stuck.length);
    // The seeded businesses really cover each stage.
    for (const stage of ["registered", "configured", "staffed", "first_sale", "active"] as const) expect(want.stage.get(names[stage])).toBe(stage);
    expect(got.funnel.active.items.find((i) => i.id === names.active)?.salesCount).toBe(1);
  });

  it("caps each stage's list but keeps its exact count", async () => {
    const got = await getOnboardingPipeline({ perStage: 1, stuckLimit: 1 });
    for (const stage of Object.values(got.funnel)) {
      expect(stage.items.length).toBeLessThanOrEqual(1);
      expect(stage.hasMore).toBe(stage.count > stage.items.length);
    }
    expect(got.stuckBusinesses.length).toBeLessThanOrEqual(1);
    expect(got.stuckTotal).toBeGreaterThanOrEqual(got.stuckBusinesses.length);
  });
});
