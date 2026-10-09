import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { db } from "../db";
import { eq, sql } from "drizzle-orm";
import { inventory, products, salePaymentLegs, cashRegisterSessions } from "@shared/schema";
import { storage } from "../storage";
import {
  assertTestDatabase, ensureSchema, createFixture, sweepResidue, closePool, type Fixture,
} from "../test-support/integration-db";

/**
 * The Mono bank feed against the database: credits confirm the one pending transfer they fit, re-syncing
 * is idempotent, ambiguous credits are left for a person, and the tax-returns bank block reflects it.
 */

let fixtures: Fixture[] = [];
let seq = 0;

async function clearStore(storeId: string) {
  const s = sql`${storeId}`;
  await db.execute(sql`DELETE FROM bank_transactions WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM bank_connections WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM gamification_points_ledger WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM gamification_badge_awards WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM gamification_streaks WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM sale_payment_legs WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM checkout_idempotency_keys WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM transactions WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM checkouts WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM orders WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM profit_loss WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM cash_drops WHERE session_id IN (SELECT id FROM cash_register_sessions WHERE store_id = ${s})`);
  await db.execute(sql`DELETE FROM cash_register_sessions WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM store_payment_accounts WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM store_counters WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM inventory WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM products WHERE store_id = ${s}`);
}

async function clearResidue() {
  const { rows } = await db.execute(sql`SELECT id FROM stores WHERE name LIKE 'Test Store itest-%'`);
  for (const r of rows) await clearStore(r.id as string);
  await sweepResidue();
}

async function shop() {
  const f = await createFixture();
  fixtures.push(f);
  const [product] = await db.insert(products).values({ storeId: f.storeId, name: `Soap ${++seq}`, type: "product" }).returning();
  const [item] = await db.insert(inventory).values({
    storeId: f.storeId, productId: product.id, name: `Soap ${seq}`, type: "product",
    costPrice: 400, sellingPrice: 500, quantity: 100,
  }).returning();
  await db.insert(cashRegisterSessions).values({ storeId: f.storeId, status: "open", openingFloat: 0, expectedCash: 0 });
  const acct = await storage.paymentAccountRepo.create({ storeId: f.storeId, label: "GTB main", kind: "bank", bankName: "GTBank", accountNumber: "0123456789" });
  const conn = await storage.bankFeedRepo.create({ storeId: f.storeId, paymentAccountId: acct.id, providerAccountId: `mono-${f.storeId}` });
  return { f, item, acct, conn };
}

/** An unconfirmed transfer sale, as a cashier records it before the money shows in the bank. */
const transferSale = (f: Fixture, itemId: string, acctId: string, qty = 1, extra: Record<string, unknown> = {}) =>
  storage.processCheckout({
    storeId: f.storeId, customerId: f.customerId, staffId: f.staffId,
    items: [{ inventoryId: itemId, quantity: qty }],
    paymentMethod: "transfer", paymentDetail: { accountId: acctId, ...extra },
  } as any);

const credit = (externalId: string, amount: number, narration: string | null = null, postedAt = new Date()) =>
  ({ externalId, direction: "credit" as const, amount, narration, postedAt });
const debit = (externalId: string, amount: number, postedAt = new Date()) =>
  ({ externalId, direction: "debit" as const, amount, narration: null, postedAt });

const legsFor = (storeId: string) => db.select().from(salePaymentLegs).where(eq(salePaymentLegs.storeId, storeId));

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
  await clearResidue();
});

afterEach(async () => {
  for (const f of fixtures) {
    await clearStore(f.storeId);
    await f.cleanup();
  }
  fixtures = [];
});

afterAll(async () => {
  await clearResidue();
  await closePool();
});

describe("bank feed ingest", () => {
  it("confirms the one pending transfer a credit fits, and re-syncing changes nothing", async () => {
    const { f, item, acct, conn } = await shop();
    expect((await transferSale(f, item.id, acct.id)).success).toBe(true);
    expect((await legsFor(f.storeId))[0].confirmationStatus).toBe("pending");

    const feed = [credit("c1", 500, "TRF FROM ADA"), credit("c2", 1234.56, "unrelated")];
    expect(await storage.bankFeedRepo.ingest(conn, feed)).toEqual({ stored: 2, confirmed: 1, unmatchedCredits: 1 });
    expect((await legsFor(f.storeId))[0]).toMatchObject({ confirmationStatus: "confirmed", confirmationSource: "bank_feed" });

    // The same feed again: nothing new is stored, so nothing is matched or counted twice.
    expect(await storage.bankFeedRepo.ingest(conn, feed)).toEqual({ stored: 0, confirmed: 0, unmatchedCredits: 0 });
    const unmatched = await storage.bankFeedRepo.unmatchedCredits(f.storeId);
    expect(unmatched.map((u) => Number(u.amount))).toEqual([1234.56]);
  });

  it("leaves an ambiguous credit for a person, unless the narration names one sender", async () => {
    const { f, item, acct, conn } = await shop();
    await transferSale(f, item.id, acct.id, 1, { senderName: "Ada Obi", reference: "TRX-ADA1" });
    await transferSale(f, item.id, acct.id, 1, { senderName: "Chidi Eze", reference: "TRX-CHI2" });

    // Two pending 500s and a credit that says nothing: no guessing.
    expect(await storage.bankFeedRepo.ingest(conn, [credit("a1", 500, "transfer")])).toMatchObject({ confirmed: 0, unmatchedCredits: 1 });
    expect((await legsFor(f.storeId)).every((l) => l.confirmationStatus === "pending")).toBe(true);

    // A later credit that names one of them confirms that one only.
    expect(await storage.bankFeedRepo.ingest(conn, [credit("a2", 500, "TRF FROM CHIDI EZE")])).toMatchObject({ confirmed: 1 });
    const legs = await legsFor(f.storeId);
    expect(legs.filter((l) => l.confirmationStatus === "confirmed").map((l) => l.senderName)).toEqual(["Chidi Eze"]);
  });

  it("does not touch a leg that belongs to another account or is already confirmed by hand", async () => {
    const { f, item, acct, conn } = await shop();
    const other = await storage.paymentAccountRepo.create({ storeId: f.storeId, label: "Second", kind: "bank" });
    await transferSale(f, item.id, other.id);
    await transferSale(f, item.id, acct.id, 1, { confirmed: true });
    expect(await storage.bankFeedRepo.ingest(conn, [credit("x1", 500)])).toMatchObject({ confirmed: 0, unmatchedCredits: 1 });
  });
});

describe("tax returns summary bank block", () => {
  it("is unlinked without a connection, and reports pending transfers and unmatched credits with one", async () => {
    const { f, item, acct, conn } = await shop();
    await transferSale(f, item.id, acct.id);
    const start = new Date(Date.now() - 86400000);
    const end = new Date(Date.now() + 86400000);

    await storage.bankFeedRepo.setStatus(conn.id, "disconnected");
    const unlinked = await storage.bankFeedRepo.taxReturnsSummary(f.storeId, start, end);
    expect(unlinked.sales.lines).toBe(1);
    expect(unlinked.bank).toMatchObject({ linked: false, refundsWithoutDebit: [] });

    await storage.bankFeedRepo.setStatus(conn.id, "active");
    await storage.bankFeedRepo.ingest(conn, [credit("u1", 77.5), debit("d1", 20)]);
    const linked = await storage.bankFeedRepo.taxReturnsSummary(f.storeId, start, end);
    expect(linked.bank.linked).toBe(true);
    expect(linked.bank.pendingTransfers).toEqual({ count: 1, total: 500 });
    expect(linked.bank.unmatchedCredits).toEqual({ count: 1, total: 77.5 });
    expect(linked.returns).toMatchObject({ count: 0, total: 0 });
    expect(linked.netTax).toBe(linked.sales.tax);
  });
});
