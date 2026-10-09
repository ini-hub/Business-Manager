import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import { eq, and, gte, count, inArray, desc, sql } from "drizzle-orm";
import { organisations, organisationMembers, stores, users, checkouts, inventory, products, cashRegisterSessions } from "@shared/schema";
import { storage } from "../storage";
import { getFlaggedTransactions, getFlaggedUsers } from "./adminFlagged";
import {
  assertTestDatabase, ensureSchema, createFixture, sweepResidue, closePool, type Fixture,
} from "../test-support/integration-db";

/**
 * The platform anomaly lists used to read every checkout and every user into Node and apply four (and three)
 * rules in a loop, then append a made-up example row. The loops are reproduced here as the oracle; both run over
 * the same database, and the SQL must flag the same records for the same first-matching rule.
 */

let f: Fixture;
const createdUsers: string[] = [];
const createdOrgs: string[] = [];

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

type Flag = { id: string; flag: string };

/** The previous transaction loop. */
async function legacyTransactions(): Promise<Flag[]> {
  const list = await db.select({ checkout: checkouts, store: stores }).from(checkouts).innerJoin(stores, eq(checkouts.storeId, stores.id)).orderBy(desc(checkouts.createdAt));
  const out: Flag[] = [];
  for (const { checkout: tx } of list) {
    if (tx.totalPrice > 500000) { out.push({ id: tx.id, flag: "Unusually large" }); continue; }
    if (tx.discountPercent && tx.discountPercent > 40) { out.push({ id: tx.id, flag: "High discount" }); continue; }
    if (tx.isVoided && tx.voidedAt) {
      const minutes = (tx.voidedAt.getTime() - tx.createdAt.getTime()) / 1000 / 60;
      if (minutes < 5) { out.push({ id: tx.id, flag: "Rapid void" }); continue; }
    }
    if (tx.totalPrice >= 100000 && tx.totalPrice % 10000 === 0) { out.push({ id: tx.id, flag: "Round number" }); continue; }
  }
  return out;
}

/** The previous user loop. */
async function legacyUsers(): Promise<Flag[]> {
  const all = await db.select({ id: users.id, loginAttempts: users.loginAttempts, lastLoginAt: users.lastLoginAt }).from(users);
  const sixty = new Date(Date.now() - 60 * 86400000);
  const out: Flag[] = [];
  for (const user of all) {
    if (user.loginAttempts && user.loginAttempts >= 10) { out.push({ id: user.id, flag: "Excessive failed logins" }); continue; }
    const owned = await db.select().from(organisationMembers).where(and(eq(organisationMembers.userId, user.id), eq(organisationMembers.role, "owner")));
    if (owned.length >= 5) { out.push({ id: user.id, flag: "Multiple org ownership" }); continue; }
    if (owned.length > 0 && (!user.lastLoginAt || user.lastLoginAt < sixty)) {
      const orgStores = await db.select({ id: stores.id }).from(stores).where(inArray(stores.businessId, owned.map((o) => o.organisationId)));
      if (orgStores.length > 0) {
        const [{ value }] = await db.select({ value: count() }).from(checkouts).where(and(inArray(checkouts.storeId, orgStores.map((s) => s.id)), gte(checkouts.createdAt, sixty)));
        if (value > 0) out.push({ id: user.id, flag: "Dormant owner" });
      }
    }
  }
  return out;
}

const ids = (flags: Flag[]) => flags.map((x) => `${x.id}:${x.flag}`).sort();

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
  await clearResidue();
  f = await createFixture();
  await db.insert(cashRegisterSessions).values({ storeId: f.storeId, status: "open", openingFloat: 0, expectedCash: 0 });
  const mk = async (name: string, price: number) => {
    const [product] = await db.insert(products).values({ storeId: f.storeId, name, type: "product" } as any).returning();
    return (await db.insert(inventory).values({ storeId: f.storeId, productId: product.id, name, type: "product", costPrice: 1, sellingPrice: price, quantity: 100 } as any).returning())[0];
  };
  const sell = (itemId: string) => storage.processCheckout({ storeId: f.storeId, customerId: f.customerId, staffId: f.staffId, items: [{ inventoryId: itemId, quantity: 1 }], paymentMethod: "cash" } as any);

  const large = await mk("Large", 600000);
  const round = await mk("Round", 150000);
  const normal = await mk("Normal", 1234);
  await sell(large.id);                                                 // large
  await sell(round.id);                                                 // round number
  const discounted = await sell(normal.id);                             // high discount
  await db.update(checkouts).set({ discountPercent: 45 }).where(eq(checkouts.id, discounted.checkoutIds![0]));
  const both = await sell(large.id);                                    // large AND discounted: large wins
  await db.update(checkouts).set({ discountPercent: 60 }).where(eq(checkouts.id, both.checkoutIds![0]));
  const quickVoid = await sell(normal.id);                              // voided after 2 minutes
  const [row] = await db.select().from(checkouts).where(eq(checkouts.id, quickVoid.checkoutIds![0]));
  await db.update(checkouts).set({ isVoided: true, voidedAt: new Date(row.createdAt.getTime() + 2 * 60000) }).where(eq(checkouts.id, row.id));
  const slowVoid = await sell(normal.id);                               // voided after an hour: not flagged
  const [row2] = await db.select().from(checkouts).where(eq(checkouts.id, slowVoid.checkoutIds![0]));
  await db.update(checkouts).set({ isVoided: true, voidedAt: new Date(row2.createdAt.getTime() + 60 * 60000) }).where(eq(checkouts.id, row2.id));
  await sell(normal.id);                                                // plain

  // Users: failed logins; owner of five businesses; dormant owner of the fixture business (which has recent sales);
  // an active owner of the same business; an ordinary user.
  const mkUser = async (o: Record<string, unknown>) => {
    const [u] = await db.insert(users).values({ email: `flag-${Date.now()}-${createdUsers.length}@test.local`, name: "Flag Test", ...o } as any).returning();
    createdUsers.push(u.id);
    return u;
  };
  await mkUser({ loginAttempts: 12 });
  const multi = await mkUser({ loginAttempts: 1 });
  for (let i = 0; i < 5; i++) {
    const [org] = await db.insert(organisations).values({ name: `Flag Org ${Date.now()}-${i}` } as any).returning();
    createdOrgs.push(org.id);
    await db.insert(organisationMembers).values({ userId: multi.id, organisationId: org.id, role: "owner" } as any);
  }
  const dormant = await mkUser({ lastLoginAt: new Date(Date.now() - 70 * 86400000) });
  await db.insert(organisationMembers).values({ userId: dormant.id, organisationId: f.businessId, role: "owner" } as any);
  const active = await mkUser({ lastLoginAt: new Date() });
  await db.insert(organisationMembers).values({ userId: active.id, organisationId: f.businessId, role: "owner" } as any);
  await mkUser({});
});

afterAll(async () => {
  if (createdUsers.length) {
    const list = sql.join(createdUsers.map((i) => sql`${i}`), sql`, `);
    await db.execute(sql`DELETE FROM organisation_members WHERE user_id IN (${list})`);
    await db.execute(sql`DELETE FROM users WHERE id IN (${list})`);
  }
  if (createdOrgs.length) await db.execute(sql`DELETE FROM organisations WHERE id IN (${sql.join(createdOrgs.map((i) => sql`${i}`), sql`, `)})`);
  if (f) { await clearSales(f.storeId); await f.cleanup(); }
  await clearResidue();
  await closePool();
});

describe("flagged transactions", () => {
  it("flags the same checkouts, under the same first-matching rule, as the loop it replaces", async () => {
    const want = await legacyTransactions();
    const { rows, total } = await getFlaggedTransactions({ limit: 10_000, offset: 0 });
    expect(ids(rows.map((r) => ({ id: r.id, flag: r.flag })))).toEqual(ids(want));
    expect(total).toBe(want.length);
    const flags = new Set(want.map((w) => w.flag));
    for (const flag of ["Unusually large", "High discount", "Rapid void", "Round number"]) expect(flags.has(flag)).toBe(true);
  });

  it("returns no invented rows", async () => {
    const { rows } = await getFlaggedTransactions({ limit: 10_000, offset: 0 });
    expect(rows.some((r) => String(r.id).startsWith("mock-") || r.business === "Glam House Studio")).toBe(false);
  });

  it("pages newest first without repeating or dropping a record", async () => {
    const all = await getFlaggedTransactions({ limit: 10_000, offset: 0 });
    const seen: string[] = [];
    for (let offset = 0; offset < all.total; offset += 3) {
      const page = await getFlaggedTransactions({ limit: 3, offset });
      expect(page.total).toBe(all.total);
      seen.push(...page.rows.map((r) => r.id));
    }
    expect(seen).toEqual(all.rows.map((r) => r.id));
    const dates = all.rows.map((r) => r.date.getTime());
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);
  });
});

describe("flagged users", () => {
  it("flags the same users, under the same first-matching rule, as the loop it replaces", async () => {
    const want = await legacyUsers();
    const { rows, total } = await getFlaggedUsers({ limit: 10_000, offset: 0 });
    expect(ids(rows.map((r) => ({ id: r.id, flag: r.flag })))).toEqual(ids(want));
    expect(total).toBe(want.length);
    const flags = new Set(want.map((w) => w.flag));
    for (const flag of ["Excessive failed logins", "Multiple org ownership", "Dormant owner"]) expect(flags.has(flag)).toBe(true);
  });

  it("returns no invented rows and pages without losing any", async () => {
    const all = await getFlaggedUsers({ limit: 10_000, offset: 0 });
    expect(all.rows.some((r) => String(r.id).startsWith("mock-"))).toBe(false);
    const seen: string[] = [];
    for (let offset = 0; offset < all.total; offset += 2) seen.push(...(await getFlaggedUsers({ limit: 2, offset })).rows.map((r) => r.id));
    expect(seen).toEqual(all.rows.map((r) => r.id));
  });
});
