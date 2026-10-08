import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import {
  inventory, products, checkouts, expenses, expenseCategories, creditEntries, repayments, cashDrops, cashRegisterSessions,
} from "@shared/schema";
import { storage } from "../storage";
import { getCashFlowTotals } from "./cashFlow";
import {
  assertTestDatabase, ensureSchema, createFixture, sweepResidue, closePool, type Fixture,
} from "../test-support/integration-db";

/**
 * getCashFlowTotals replaces loops that loaded every row of the period. The loops are reproduced here, verbatim in
 * behaviour, and both run over the same mix of sales (cash, split, transfer, voided, pending), repayments,
 * expenses (cash, split, transfer, the Payroll category, a deleted one) and drops.
 */

let f: Fixture;
let sessionId: string;
const day = new Date().toISOString().slice(0, 10);

async function clearSales(storeId: string) {
  const s = sql`${storeId}`;
  for (const t of ["gamification_points_ledger", "gamification_badge_awards", "gamification_streaks", "sale_payment_legs", "store_credit_transactions", "checkout_idempotency_keys", "stock_movements"]) {
    await db.execute(sql`DELETE FROM ${sql.raw(t)} WHERE store_id = ${s}`);
  }
  await db.execute(sql`DELETE FROM repayments WHERE credit_entry_id IN (SELECT id FROM credit_entries WHERE store_id = ${s})`);
  await db.execute(sql`DELETE FROM credit_entries WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM expenses WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM expense_categories WHERE store_id = ${s}`);
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

const sell = (lines: Array<{ inventoryId: string; quantity: number }>, extra: Record<string, unknown>) =>
  storage.processCheckout({ storeId: f.storeId, customerId: f.customerId, staffId: f.staffId, items: lines, paymentMethod: "cash", ...extra } as any);

/** The old calculation, as it was in the route. */
async function legacy(start: Date, end: Date, startDay: string, endDay: string) {
  const rows = await db.select().from(checkouts).where(and(eq(checkouts.storeId, f.storeId), gte(checkouts.createdAt, start), lte(checkouts.createdAt, end), eq(checkouts.isVoided, false)));
  let cashSales = 0, nonCashSales = 0;
  for (const c of rows) {
    if (c.paymentMethod === "cash") cashSales += c.totalCharged;
    else if (c.paymentMethod === "split" && c.splitPayments) {
      const cashPortion = (c.splitPayments as any[]).find((p) => p.method === "cash")?.amount || 0;
      cashSales += cashPortion;
      nonCashSales += c.totalCharged - cashPortion;
    } else nonCashSales += c.totalCharged;
  }
  const reps = await db.select({ repayment: repayments, credit: creditEntries }).from(repayments).innerJoin(creditEntries, eq(repayments.creditEntryId, creditEntries.id))
    .where(and(eq(creditEntries.storeId, f.storeId), gte(repayments.createdAt, start), lte(repayments.createdAt, end)));
  let cashRepayments = 0;
  for (const r of reps) if (r.repayment.paymentMethod === "cash") cashRepayments += r.repayment.amountReceived;

  const exps = await db.select().from(expenses).where(and(eq(expenses.storeId, f.storeId), eq(expenses.isDeleted, false), gte(expenses.date, startDay), lte(expenses.date, endDay)));
  const payrollIds = new Set((await storage.getExpenseCategories(f.storeId)).filter((c) => c.isSystem && c.name === "Payroll").map((c) => c.id));
  let expensesCashOut = 0, expensesNonCashOut = 0;
  for (const e of exps) {
    if (e.categoryId && payrollIds.has(e.categoryId)) continue;
    if (e.paymentMethod === "cash") expensesCashOut += e.amount;
    else if (e.paymentMethod === "split" && e.splitPayments) {
      const cashPortion = (e.splitPayments as any[]).find((p) => p.method === "cash")?.amount || 0;
      expensesCashOut += cashPortion;
      expensesNonCashOut += e.amount - cashPortion;
    } else expensesNonCashOut += e.amount;
  }
  const drops = await db.select({ drop: cashDrops }).from(cashDrops).innerJoin(cashRegisterSessions, eq(cashDrops.sessionId, cashRegisterSessions.id))
    .where(and(eq(cashRegisterSessions.storeId, f.storeId), gte(cashDrops.droppedAt, start), lte(cashDrops.droppedAt, end)));
  const cashDropsTotal = drops.reduce((sum, r) => sum + Number(r.drop.amount), 0);
  return { cashSales, nonCashSales, cashRepayments, expensesCashOut, expensesNonCashOut, cashDropsTotal };
}

const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(0.01);

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
  await clearResidue();
  f = await createFixture();
  const [session] = await db.insert(cashRegisterSessions).values({ storeId: f.storeId, status: "open", openingFloat: 0, expectedCash: 0 }).returning();
  sessionId = session.id;

  const mk = async (name: string, price: number) => {
    const [product] = await db.insert(products).values({ storeId: f.storeId, name, type: "product" } as any).returning();
    return (await db.insert(inventory).values({ storeId: f.storeId, productId: product.id, name, type: "product", costPrice: 100, sellingPrice: price, quantity: 100 } as any).returning())[0];
  };
  const a = await mk("A", 1000), b = await mk("B", 700), c = await mk("C", 300);

  await sell([{ inventoryId: a.id, quantity: 1 }], {});                                                   // cash, one line
  await sell([{ inventoryId: a.id, quantity: 2 }, { inventoryId: b.id, quantity: 1 }], {});               // cash, two lines
  await sell([{ inventoryId: c.id, quantity: 1 }], { paymentMethod: "transfer" });                        // transfer
  await sell([{ inventoryId: a.id, quantity: 1 }], { paymentMethod: "split", splitPayments: [{ method: "cash", amount: 400 }, { method: "transfer", amount: 600 }] }); // split, one line
  await sell([{ inventoryId: a.id, quantity: 1 }, { inventoryId: b.id, quantity: 1 }], { paymentMethod: "split", splitPayments: [{ method: "transfer", amount: 1000 }, { method: "cash", amount: 700 }] }); // split, two lines, cash leg second
  const voided = await sell([{ inventoryId: b.id, quantity: 1 }], {});
  await db.update(checkouts).set({ isVoided: true }).where(eq(checkouts.id, voided.checkoutIds![0]));
  const pending = await sell([{ inventoryId: c.id, quantity: 2 }], {});
  await db.update(checkouts).set({ paymentStatus: "pending" }).where(eq(checkouts.id, pending.checkoutIds![0]));

  const [credit] = await db.insert(creditEntries).values({ storeId: f.storeId, customerId: f.customerId, amountOwed: 9000, outstandingBalance: 9000 } as any).returning();
  await db.insert(repayments).values([
    { creditEntryId: credit.id, amountReceived: 1500, paymentMethod: "cash" },
    { creditEntryId: credit.id, amountReceived: 2500, paymentMethod: "transfer" },
    { creditEntryId: credit.id, amountReceived: 500.5, paymentMethod: "cash" },
  ] as any);

  const [misc] = await db.insert(expenseCategories).values({ storeId: f.storeId, name: "Misc" } as any).returning();
  const [payroll] = await db.insert(expenseCategories).values({ storeId: f.storeId, name: "Payroll", isSystem: true } as any).returning();
  const ex = (title: string, o: Record<string, unknown>) =>
    db.insert(expenses).values({ storeId: f.storeId, title, categoryId: misc.id, date: day, amount: 100, ...o } as any);
  await ex("cash", { amount: 1200, paymentMethod: "cash" });
  await ex("transfer", { amount: 800, paymentMethod: "transfer" });
  await ex("split", { amount: 1000, paymentMethod: "split", splitPayments: [{ method: "transfer", amount: 300 }, { method: "cash", amount: 700 }] });
  await ex("payroll", { amount: 99999, paymentMethod: "cash", categoryId: payroll.id });
  await ex("deleted", { amount: 5555, paymentMethod: "cash", isDeleted: true });
  await ex("old", { amount: 7777, paymentMethod: "cash", date: "2020-01-01" });

  await db.insert(cashDrops).values([
    { sessionId, amount: 300 },
    { sessionId, amount: 150.25 },
    { sessionId, amount: 9999, droppedAt: new Date(Date.now() - 40 * 86400000) },
  ] as any);
});

afterAll(async () => {
  if (f) { await clearSales(f.storeId); await f.cleanup(); }
  await clearResidue();
  await closePool();
});

describe("cash flow totals", () => {
  it("agree with the row-by-row calculation over the period", async () => {
    const start = new Date(Date.now() - 86400000);
    const end = new Date(Date.now() + 86400000);
    const want = await legacy(start, end, day, day);
    const got = await getCashFlowTotals(f.storeId, start, end, day, day);
    for (const key of Object.keys(want) as (keyof typeof want)[]) close(got[key], want[key]);
  });

  it("is not comparing empty figures", async () => {
    const got = await getCashFlowTotals(f.storeId, new Date(Date.now() - 86400000), new Date(Date.now() + 86400000), day, day);
    expect(got.cashSales).toBeGreaterThan(0);
    expect(got.nonCashSales).toBeGreaterThan(0);
    close(got.cashRepayments, 2000.5);
    close(got.expensesCashOut, 1200 + 700);   // cash + the cash leg of the split; payroll, deleted and old excluded
    close(got.expensesNonCashOut, 800 + 300);
    close(got.cashDropsTotal, 450.25);        // the 40-day-old drop is outside the window
  });

  it("returns zeros for a window with nothing in it", async () => {
    const got = await getCashFlowTotals(f.storeId, new Date("2000-01-01"), new Date("2000-01-02"), "2000-01-01", "2000-01-02");
    expect(got).toEqual({ cashSales: 0, nonCashSales: 0, cashRepayments: 0, expensesCashOut: 0, expensesNonCashOut: 0, cashDropsTotal: 0 });
  });
});
