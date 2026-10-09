import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { db } from "../db";
import { eq, sql } from "drizzle-orm";
import {
  customers, inventory, products, checkouts, salePaymentLegs, storeCreditTransactions, cashRegisterSessions,
} from "@shared/schema";
import { storage } from "../storage";
import {
  assertTestDatabase, ensureSchema, createFixture, sweepResidue, closePool, type Fixture,
} from "../test-support/integration-db";

/**
 * The money paths added with payment accounts: which account a transfer landed in, the legs written per
 * receipt, loss-sale flagging, owed change becoming store credit, and store credit redemption.
 */

let fixtures: Fixture[] = [];
let seq = 0;

async function clearSales(storeId: string) {
  const s = sql`${storeId}`;
  await db.execute(sql`DELETE FROM gamification_points_ledger WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM gamification_badge_awards WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM gamification_streaks WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM sale_drafts WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM sale_payment_legs WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM store_credit_transactions WHERE store_id = ${s}`);
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

// A red run leaves fixture stores holding sales, which the shared sweep knows nothing about.
async function clearResidue() {
  const { rows } = await db.execute(sql`SELECT id FROM stores WHERE name LIKE 'Test Store itest-%'`);
  for (const r of rows) await clearSales(r.id as string);
  await sweepResidue();
}

async function shop(opts: { cost?: number; price?: number } = {}) {
  const f = await createFixture();
  fixtures.push(f);
  const [product] = await db.insert(products).values({ storeId: f.storeId, name: `Soap ${++seq}`, type: "product" }).returning();
  const [item] = await db.insert(inventory).values({
    storeId: f.storeId, productId: product.id, name: `Soap ${seq}`, type: "product",
    costPrice: opts.cost ?? 400, sellingPrice: opts.price ?? 500, quantity: 100,
  }).returning();
  const [session] = await db.insert(cashRegisterSessions).values({ storeId: f.storeId, status: "open", openingFloat: 0, expectedCash: 0 }).returning();
  return { f, item, session };
}

const sell = (f: Fixture, itemId: string, qty: number, extra: Record<string, unknown> = {}) =>
  storage.processCheckout({
    storeId: f.storeId, customerId: f.customerId, staffId: f.staffId,
    items: [{ inventoryId: itemId, quantity: qty }],
    paymentMethod: "cash",
    ...extra,
  } as any);

const legsFor = (storeId: string) => db.select().from(salePaymentLegs).where(eq(salePaymentLegs.storeId, storeId));
const balanceOf = async (id: string) => Number((await db.select().from(customers).where(eq(customers.id, id)))[0].storeCreditBalance);

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
  await clearResidue();
});

afterEach(async () => {
  for (const f of fixtures) {
    await clearSales(f.storeId);
    await f.cleanup();
  }
  fixtures = [];
});

afterAll(async () => {
  await clearResidue();
  await closePool();
});

describe("transfer accounts", () => {
  it("requires an account once the store has one, and records it with its confirmation state", async () => {
    const { f, item } = await shop();
    const acct = await storage.paymentAccountRepo.create({ storeId: f.storeId, label: "GTB main", kind: "bank", bankName: "GTBank", accountNumber: "0123456789" });
    expect(acct.isDefault).toBe(true);

    const noAccount = await sell(f, item.id, 1, { paymentMethod: "transfer" });
    expect(noAccount.success).toBe(false);
    expect(noAccount.message).toMatch(/account/i);

    const ok = await sell(f, item.id, 1, { paymentMethod: "transfer", paymentDetail: { accountId: acct.id, reference: "TRX1", confirmed: true }, actorUserId: undefined });
    expect(ok.success).toBe(true);
    const [leg] = await legsFor(f.storeId);
    expect(leg).toMatchObject({ method: "transfer", amount: 500, paymentAccountId: acct.id, accountLabel: "GTB main", confirmationStatus: "confirmed", confirmationSource: "manual", reference: "TRX1" });

    // The ledger page reads these slim summaries, one statement for the whole page.
    const summaries = await storage.paymentAccountRepo.getLegSummariesForReceipts([f.storeId], [leg.receiptNumber]);
    expect(summaries).toEqual([{ storeId: f.storeId, receiptNumber: leg.receiptNumber, method: "transfer", amount: 500, paymentAccountId: acct.id, accountLabel: "GTB main", confirmationStatus: "confirmed" }]);
    expect(await storage.paymentAccountRepo.getLegSummariesForReceipts([f.storeId], [])).toEqual([]);
  });

  it("rejects another store's account and records an unconfirmed transfer as pending", async () => {
    const a = await shop();
    const b = await shop();
    const mine = await storage.paymentAccountRepo.create({ storeId: a.f.storeId, label: "Mine" });
    const theirs = await storage.paymentAccountRepo.create({ storeId: b.f.storeId, label: "Theirs" });

    const bad = await sell(a.f, a.item.id, 1, { paymentMethod: "transfer", paymentDetail: { accountId: theirs.id } });
    expect(bad.success).toBe(false);

    const pending = await sell(a.f, a.item.id, 1, { paymentMethod: "transfer", paymentDetail: { accountId: mine.id } });
    expect(pending.success).toBe(true);
    expect((await legsFor(a.f.storeId))[0].confirmationStatus).toBe("pending");

    const report = await storage.paymentAccountRepo.reconcile(a.f.storeId, new Date(Date.now() - 86400000), new Date(Date.now() + 86400000));
    expect(report.accounts).toHaveLength(1);
    expect(report.accounts[0]).toMatchObject({ label: "Mine", expected: 500, confirmed: 0, pending: 500 });
    expect(await storage.paymentAccountRepo.confirmLegs(a.f.storeId, report.pendingLegs.map(l => l.id), undefined)).toBe(1);
  });

  it("splits one receipt across two accounts and cash, with legs summing to the amount collected", async () => {
    const { f, item } = await shop();
    const a1 = await storage.paymentAccountRepo.create({ storeId: f.storeId, label: "A1" });
    const a2 = await storage.paymentAccountRepo.create({ storeId: f.storeId, label: "A2" });
    const res = await sell(f, item.id, 2, {
      paymentMethod: "split",
      balanceCollectedToday: 1000,
      splitPayments: [
        { method: "transfer", amount: 400, accountId: a1.id },
        { method: "transfer", amount: 300, accountId: a2.id, confirmed: true },
        { method: "cash", amount: 300 },
      ],
    });
    expect(res.success).toBe(true);
    const legs = await legsFor(f.storeId);
    expect(legs).toHaveLength(3);
    expect(legs.reduce((s, l) => s + l.amount, 0)).toBe(1000);
    expect(legs.find(l => l.paymentAccountId === a2.id)?.confirmationStatus).toBe("confirmed");
  });
});

describe("payment link confirmation", () => {
  it("confirms the pending link leg from the webhook only when the amount paid covers it", async () => {
    const { f, item } = await shop();
    const res = await sell(f, item.id, 1, { paymentMethod: "flutterwave" });
    expect(res.success).toBe(true);
    const checkoutId = res.checkoutIds![0];
    expect((await legsFor(f.storeId))[0]).toMatchObject({ method: "flutterwave", confirmationStatus: "pending" });

    expect(await storage.paymentAccountRepo.confirmGatewayLeg(f.storeId, checkoutId, 100, "tx-short")).toBe(false);
    expect((await legsFor(f.storeId))[0].confirmationStatus).toBe("pending");

    expect(await storage.paymentAccountRepo.confirmGatewayLeg(f.storeId, checkoutId, 500, "tx-ok")).toBe(true);
    expect((await legsFor(f.storeId))[0]).toMatchObject({ confirmationStatus: "confirmed", confirmationSource: "gateway", reference: "tx-ok" });
    // A replayed webhook is a no-op.
    expect(await storage.paymentAccountRepo.confirmGatewayLeg(f.storeId, checkoutId, 500, "tx-ok")).toBe(false);
  });
});

describe("loss sales", () => {
  it("allows a below-cost custom price and flags it", async () => {
    const { f, item } = await shop({ cost: 400, price: 500 });
    const res = await storage.processCheckout({
      storeId: f.storeId, customerId: f.customerId, staffId: f.staffId,
      items: [{ inventoryId: item.id, quantity: 2, customPrice: 300 }],
      paymentMethod: "cash",
    } as any);
    expect(res.success).toBe(true);
    const [row] = await db.select().from(checkouts).where(eq(checkouts.storeId, f.storeId));
    expect(row.lossAmount).toBe(200); // (400 - 300) * 2

    const [check] = await storage.assessLoss(f.storeId, [{ inventoryId: item.id, quantity: 2, unitPrice: 300 }]);
    expect(check).toMatchObject({ belowCost: true, lossAmount: 200 });
  });

  it("does not flag a sale at list price", async () => {
    const { f, item } = await shop();
    await sell(f, item.id, 1);
    const [row] = await db.select().from(checkouts).where(eq(checkouts.storeId, f.storeId));
    expect(row.lossAmount).toBe(0);
  });
});

describe("cash change owed", () => {
  it("credits owed change to the customer, keeps it in the drawer, and the void withdraws it", async () => {
    const { f, item, session } = await shop();
    const res = await sell(f, item.id, 1, { paymentDetail: { cashTendered: 1000, changeOwed: 200 } });
    expect(res.success).toBe(true);

    const [leg] = await legsFor(f.storeId);
    expect(leg).toMatchObject({ method: "cash", amount: 500, cashTendered: 1000, changeGiven: 300, changeOwed: 200 });
    expect(await balanceOf(f.customerId)).toBe(200);
    const [drawer] = await db.select().from(cashRegisterSessions).where(eq(cashRegisterSessions.id, session.id));
    expect(drawer.expectedCash).toBe(700); // 500 sale + 200 kept as owed change

    const ledger = await db.select().from(storeCreditTransactions).where(eq(storeCreditTransactions.storeId, f.storeId));
    expect(ledger).toMatchObject([{ type: "change_owed", amount: 200 }]);

    await storage.voidCheckout(res.checkoutIds![0], "test", (await db.execute(sql`SELECT id FROM users LIMIT 1`)).rows[0].id as string);
    expect(await balanceOf(f.customerId)).toBe(0);
  });

  it("rejects owed change larger than the change due, and short cash", async () => {
    const { f, item } = await shop();
    expect((await sell(f, item.id, 1, { paymentDetail: { cashTendered: 600, changeOwed: 200 } })).success).toBe(false);
    expect((await sell(f, item.id, 1, { paymentDetail: { cashTendered: 100 } })).success).toBe(false);
  });
});

describe("store credit redemption", () => {
  it("settles part of a sale from credit and the rest in cash", async () => {
    const { f, item } = await shop();
    await db.update(customers).set({ storeCreditBalance: 300 }).where(eq(customers.id, f.customerId));
    const res = await sell(f, item.id, 1, {
      paymentMethod: "split",
      balanceCollectedToday: 200,
      splitPayments: [{ method: "cash", amount: 200 }, { method: "store_credit", amount: 300 }],
    });
    expect(res.message).toBe("Sale completed successfully");
    expect(res.success).toBe(true);
    expect(await balanceOf(f.customerId)).toBe(0);
  });

  it("settles a whole sale from credit", async () => {
    const { f, item } = await shop();
    await db.update(customers).set({ storeCreditBalance: 800 }).where(eq(customers.id, f.customerId));
    const res = await sell(f, item.id, 1, { paymentMethod: "store_credit", balanceCollectedToday: 0 });
    expect(res.success).toBe(true);
    expect(await balanceOf(f.customerId)).toBe(300);
  });
});

describe("draft payment detail", () => {
  it("keeps per-leg account, reference and cash detail through save, update and read", async () => {
    const { f, item } = await shop();
    const cartData = [{ inventoryId: item.id, name: item.name, type: "product", quantity: 1, customPrice: 500, totalPrice: 500, leadStaffId: null, assistingStaff1Id: null, assistingStaff2Id: null, commissionSplit: "standard" }];
    const splitPayments = [
      { method: "cash", amount: 200, cashTendered: 500, changeOwed: 300 },
      { method: "transfer", amount: 300, accountId: "acct-1", reference: "TRF-9", senderName: "Ada", confirmed: false },
    ];
    const saved = await storage.saveDraft({ storeId: f.storeId, cartData, paymentMethod: "split", splitPayments });
    expect((await storage.getDraft(saved.id, f.storeId))?.splitPayments).toEqual(splitPayments);

    const paymentDetail = { accountId: "acct-2", reference: "TRF-10", confirmed: true };
    await storage.updateDraft(saved.id, f.storeId, { paymentMethod: "transfer", paymentDetail });
    expect((await storage.getDraft(saved.id, f.storeId))?.paymentDetail).toEqual(paymentDetail);
  });
});
