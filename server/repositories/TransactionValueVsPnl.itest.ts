import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync } from "fs";
import { db } from "../db";
import { eq, inArray, sql } from "drizzle-orm";
import { inventory, products, checkouts, orders, transactions, cashRegisterSessions } from "@shared/schema";
import { storage } from "../storage";
import { parseDateWindow } from "../routes/transaction.routes";
import {
  assertTestDatabase, ensureSchema, createFixture, sweepResidue, closePool, type Fixture,
} from "../test-support/integration-db";

/**
 * Simulation: the Transactions "Transaction Value" tile (storage.getReceiptTotals) against the Profit & Loss
 * "Actual Revenue (Net)" (storage.getProfitLossSummary) for the same branch and range.
 *
 * A seeded generator sells a mix of products and services over six days, discounting, voiding, leaving
 * payments pending and returning some of it. Because the generator is seeded the run is reproducible, and every
 * receipt keeps a ledger entry so the gap between the two screens can be explained line by line rather than
 * just observed.
 */

let f: Fixture;
const ids: Record<string, string> = {};

async function clearSales(storeId: string) {
  const s = sql`${storeId}`;
  for (const t of ["gamification_points_ledger", "gamification_badge_awards", "gamification_streaks", "sale_payment_legs", "store_credit_transactions", "checkout_idempotency_keys", "stock_movements", "order_consumables", "service_consumables"]) {
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

async function item(key: string, o: { type: "product" | "service"; cost: number; price: number }) {
  const [product] = await db.insert(products).values({ storeId: f.storeId, name: key, type: o.type }).returning();
  const [row] = await db.insert(inventory).values({
    storeId: f.storeId, productId: product.id, name: key, type: o.type, quantity: 100000,
    costPrice: o.cost, sellingPrice: o.price,
  } as any).returning();
  ids[key] = row.id;
  return row;
}

/** mulberry32: small seeded PRNG so the simulated shop is the same every run. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Seeded {
  day: string;            // yyyy-MM-dd
  checkoutIds: string[];
  discount: number;
  voided: boolean;
  pending: boolean;
  refunded: number;
}
const sales: Seeded[] = [];
const DAYS = 6;
const RECEIPTS = 24;
const dayString = (offset: number) => new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);

const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(0.01);

/** The tile's call: the window the route builds from the page's plain dates, read in the store's timezone. */
const tile = async (from?: string, to?: string) =>
  storage.getReceiptTotals([f.storeId], {
    scope: null,
    ...(await parseDateWindow({ startDate: from, endDate: to }, [f.storeId]))!,
  });
const pnl = (from?: string, to?: string) => storage.getProfitLossSummary(f.storeId, from, to);

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
  await clearResidue();
  f = await createFixture();
  await db.insert(cashRegisterSessions).values({ storeId: f.storeId, status: "open", openingFloat: 0, expectedCash: 0 });

  await item("shampoo", { type: "product", cost: 600, price: 2000 });
  await item("gel", { type: "product", cost: 300, price: 1500 });
  await item("braids", { type: "service", cost: 500, price: 12000 });
  await item("wash", { type: "service", cost: 100, price: 3000 });
  const catalogue = ["shampoo", "gel", "braids", "wash"];

  const rand = rng(20261011);
  for (let i = 0; i < RECEIPTS; i++) {
    const lineCount = 1 + Math.floor(rand() * 3);
    const picked = new Set<string>();
    while (picked.size < lineCount) picked.add(catalogue[Math.floor(rand() * catalogue.length)]);
    const lines = Array.from(picked).map((k) => ({ inventoryId: ids[k], quantity: 1 + Math.floor(rand() * 2) }));
    const discountRoll = rand() < 0.25 ? 100 * (1 + Math.floor(rand() * 5)) : 0;
    const discount = i === 0 ? 300 : discountRoll; // the first four receipts are pinned so every case is always present
    const day = dayString(Math.floor(rand() * DAYS));

    const res = await storage.processCheckout({
      storeId: f.storeId, customerId: f.customerId, staffId: f.staffId, items: lines, paymentMethod: "cash",
      ...(discount ? { discountAmount: discount, discountReason: "sim", discountApprovedBy: "sim" } : {}),
    } as any);
    expect(res.success, res.message).toBe(true);

    // Move the receipt to a noon-UTC timestamp on its day (clear of any timezone boundary).
    const when = new Date(`${day}T12:00:00.000Z`);
    for (const checkoutId of res.checkoutIds!) {
      await db.update(transactions).set({ transactionDate: when }).where(eq(transactions.checkoutId, checkoutId));
      await db.update(checkouts).set({ createdAt: when }).where(eq(checkouts.id, checkoutId));
    }

    const roll = rand();
    const voided = i === 1 || (i > 3 && roll < 0.1);
    const pending = i === 2 || (!voided && i > 3 && roll < 0.18);
    if (voided) await db.update(checkouts).set({ isVoided: true }).where(inArray(checkouts.id, res.checkoutIds!));
    if (pending) await db.update(checkouts).set({ paymentStatus: "pending" }).where(inArray(checkouts.id, res.checkoutIds!));

    // Returns: receipt 3 and a fifth of the rest give one line back, in part or in full.
    let refunded = 0;
    const returnRoll = rand();
    if (!voided && (i === 3 || returnRoll < 0.2)) {
      const [first] = await db.select().from(checkouts).where(eq(checkouts.id, res.checkoutIds![0]));
      const [order] = await db.select().from(orders).where(eq(orders.id, first.orderId));
      const giveBack = order.quantity > 1 && rand() < 0.5 ? 1 : order.quantity;
      refunded = Math.round((order.totalPrice / order.quantity) * giveBack * 100) / 100;
      await db.update(orders).set({ returnedQuantity: giveBack, refundedAmount: refunded }).where(eq(orders.id, order.id));
    }
    sales.push({ day, checkoutIds: res.checkoutIds!, discount, voided, pending, refunded });
  }
}, 300_000);

afterAll(async () => {
  if (f) { await clearSales(f.storeId); await f.cleanup(); }
  await clearResidue();
  await closePool();
});

/** Sum of a column over the seeded receipts that fall inside the range and pass `keep`. */
async function ledger(from: string | undefined, to: string | undefined, keep: (s: Seeded) => boolean) {
  const inRange = sales.filter((s) => (!from || s.day >= from) && (!to || s.day <= to) && keep(s));
  const cids = inRange.flatMap((s) => s.checkoutIds);
  if (cids.length === 0) return { charged: 0, orderPrice: 0, refunded: 0, receipts: 0 };
  const { rows } = await db.execute(sql`
    SELECT COALESCE(SUM(c.total_charged), 0)::float8 AS charged,
           COALESCE(SUM(o.total_price), 0)::float8 AS order_price,
           COALESCE(SUM(o.refunded_amount), 0)::float8 AS refunded
    FROM checkouts c JOIN orders o ON o.id = c.order_id
    WHERE c.id IN (${sql.join(cids.map((c) => sql`${c}`), sql`, `)})`);
  const r = rows[0] as any;
  return { charged: Number(r.charged), orderPrice: Number(r.order_price), refunded: Number(r.refunded), receipts: inRange.length };
}

const windows: Array<[string, string | undefined, string | undefined]> = [
  ["whole history", undefined, undefined],
  ["all six days", dayString(DAYS - 1), dayString(0)],
  ["last three days", dayString(2), dayString(0)],
  ["a single day", dayString(4), dayString(4)],
];

describe("Transaction Value tile vs Profit & Loss — seeded simulation", () => {
  it("seeded a shop with every awkward case present", () => {
    expect(sales.length).toBe(RECEIPTS);
    expect(sales.some((s) => s.discount > 0 && !s.voided && !s.pending)).toBe(true);
    expect(sales.some((s) => s.voided)).toBe(true);
    expect(sales.some((s) => s.pending)).toBe(true);
    expect(sales.some((s) => s.refunded > 0)).toBe(true);
  });

  it("report: prints both screens and the explained gap for each window", async () => {
    const rows: Record<string, unknown>[] = [];
    for (const [label, from, to] of windows) {
      const t = await tile(from, to);
      const p = await pnl(from, to);
      const live = await ledger(from, to, (s) => !s.voided && !s.pending);
      const pendingOnly = await ledger(from, to, (s) => !s.voided && s.pending);
      rows.push({
        window: label,
        tileGross: t.gross, tileRefunded: t.refunded, tileNet: t.gross - t.refunded,
        pnlGross: p.grossRevenue, pnlRefunded: p.returnedRevenue, pnlNet: p.totalRevenue,
        gap: (t.gross - t.refunded) - p.totalRevenue,
        discountsOnLive: live.orderPrice - live.charged,
        pendingCharged: pendingOnly.charged,
      });
    }
    console.table(rows);
    // The integration config silences stdout; SIM_REPORT_PATH lets a run keep the table.
    if (process.env.SIM_REPORT_PATH) writeFileSync(process.env.SIM_REPORT_PATH, JSON.stringify({ sales, rows }, null, 2));
    expect(rows).toHaveLength(windows.length);
  });

  it("agrees on refunds in every window", async () => {
    for (const [, from, to] of windows) {
      const t = await tile(from, to);
      const p = await pnl(from, to);
      const pendingRefunds = (await ledger(from, to, (s) => !s.voided && s.pending)).refunded;
      // The tile counts pending receipts; the P&L only counts completed payments.
      close(t.refunded - pendingRefunds, p.returnedRevenue);
    }
  });

  it("explains the gross gap exactly: pending receipts, and discounts the P&L does not net off", async () => {
    for (const [, from, to] of windows) {
      const t = await tile(from, to);
      const p = await pnl(from, to);
      const live = await ledger(from, to, (s) => !s.voided && !s.pending);
      const pending = await ledger(from, to, (s) => !s.voided && s.pending);
      // Tile gross = charged (after discount) on every non-voided receipt, pending included.
      close(t.gross, live.charged + pending.charged);
      // P&L gross = order line prices on completed, non-voided receipts only.
      close(p.grossRevenue, live.orderPrice);
    }
  });

  it("shows a breakdown that accounts for the whole gap to the P&L", async () => {
    for (const [, from, to] of windows) {
      const t = await tile(from, to);
      const p = await pnl(from, to);
      const live = await ledger(from, to, (s) => !s.voided && !s.pending);
      const pending = await ledger(from, to, (s) => !s.voided && s.pending);
      // The pieces the tile's breakdown dialog shows.
      close(t.pending, pending.charged);
      close(t.listPrice, live.orderPrice + pending.orderPrice);
      close(t.discounts, (live.orderPrice - live.charged) + (pending.orderPrice - pending.charged));
      close(t.listPrice - t.discounts + t.tax, t.gross);
      // Take the pending part off, put the discounts back and drop the tax: that is the P&L's gross.
      close(t.gross - t.pending + (live.orderPrice - live.charged) - t.tax, p.grossRevenue);
    }
  });

  it("counts the same receipts: completed sales never exceed the receipts the P&L sees", async () => {
    const t = await tile();
    const live = sales.filter((s) => !s.voided);
    expect(t.receiptCount).toBe(sales.length);
    expect(t.completedCount).toBeLessThanOrEqual(live.length);
  });
});
