import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { db, pool } from "../db";
import { eq, sql, inArray } from "drizzle-orm";
import { inventory, products, expenses, partnerTransfers } from "@shared/schema";
import { PartnerRepository } from "./PartnerRepository";
import { PartnerTransferRepository, type PartnerCtx } from "./PartnerTransferRepository";
import { PartnerRuleError } from "../lib/partnerTransfer";
import {
  assertTestDatabase, ensureSchema, createFixture, sweepResidue, closePool, type Fixture,
} from "../test-support/integration-db";

/**
 * What only a real database can show: that stock leaves one business and arrives in
 * the other exactly once, that the books of the two sides agree, and that a stranger
 * or a double-click cannot change either.
 */

const partners = new PartnerRepository();
const repo = new PartnerTransferRepository();

let fixtures: Fixture[] = [];
const touchedStores: string[] = [];

async function biz() {
  const f = await createFixture();
  fixtures.push(f);
  touchedStores.push(f.storeId);
  const ctx: PartnerCtx = { orgId: f.businessId, userId: null };
  return { f, ctx };
}

async function addProduct(storeId: string, name: string, qty: number, cost: number, extra: Partial<typeof inventory.$inferInsert> = {}) {
  const [p] = await db.insert(products).values({ storeId, name, type: "product" }).returning();
  const [inv] = await db.insert(inventory).values({
    storeId, productId: p.id, name, type: "product", quantity: qty, costPrice: cost, sellingPrice: cost * 2, ...extra,
  }).returning();
  return inv;
}

const qtyOf = async (id: string) => (await db.select().from(inventory).where(eq(inventory.id, id)))[0];

async function connect(a: { ctx: PartnerCtx }, b: { ctx: PartnerCtx }) {
  const code = await partners.ensurePartnerCode(b.ctx.orgId);
  const req = await partners.request(a.ctx.orgId, null, code);
  return partners.respond(req.id, b.ctx.orgId, null, true);
}

/**
 * Removes everything these tests create for the given stores, children before parents. The shared
 * fixture's own teardown knows nothing about partner tables, inventory or the stock ledger, and
 * stores cannot be deleted while any of them still reference one.
 */
async function purge(storeIds: string[], orgIds: string[]) {
  if (!storeIds.length) return;
  const list = (xs: string[]) => sql.join(xs.map((i) => sql`${i}`), sql`, `);
  const transfers = sql`SELECT id FROM partner_transfers WHERE from_store_id IN (${list(storeIds)}) OR to_store_id IN (${list(storeIds)})`;
  await db.execute(sql`DELETE FROM partner_settlements WHERE obligation_id IN (SELECT id FROM partner_obligations WHERE transfer_id IN (${transfers}))`);
  await db.execute(sql`DELETE FROM partner_obligations WHERE transfer_id IN (${transfers})`);
  await db.execute(sql`DELETE FROM partner_transfer_events WHERE transfer_id IN (${transfers})`);
  await db.execute(sql`DELETE FROM partner_transfer_items WHERE transfer_id IN (${transfers})`);
  await db.execute(sql`DELETE FROM partner_transfers WHERE from_store_id IN (${list(storeIds)}) OR to_store_id IN (${list(storeIds)})`);
  if (orgIds.length) {
    await db.execute(sql`DELETE FROM business_partnerships WHERE requester_org_id IN (${list(orgIds)}) OR addressee_org_id IN (${list(orgIds)})`);
  }
  for (const id of storeIds) {
    await db.execute(sql`DELETE FROM stock_movements WHERE store_id = ${id}`);
    await db.execute(sql`DELETE FROM inventory_restock_events WHERE store_id = ${id}`);
    await db.execute(sql`DELETE FROM profit_loss WHERE store_id = ${id}`);
    await db.execute(sql`DELETE FROM inventory WHERE store_id = ${id}`);
    await db.execute(sql`DELETE FROM products WHERE store_id = ${id}`);
  }
}

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
  // A run that was interrupted leaves partner rows the shared sweep cannot remove.
  const { rows } = await pool.query<{ id: string; business_id: string }>(`SELECT id, business_id FROM stores WHERE name LIKE 'Test Store itest-%'`);
  await purge(rows.map((r) => r.id), Array.from(new Set(rows.map((r) => r.business_id))));
  await sweepResidue();
});

afterEach(async () => {
  const ids = touchedStores.splice(0);
  await purge(ids, fixtures.map((f) => f.businessId));
  for (const f of fixtures) await f.cleanup();
  fixtures = [];
});

afterAll(async () => {
  await closePool();
});

describe("partner transfer: stock", () => {
  it("moves stock out of one business and into the other exactly once, and the two sides reconcile", async () => {
    const A = await biz(); const B = await biz();
    await connect(A, B);
    const widgetA = await addProduct(A.f.storeId, "Widget", 10, 100);
    const widgetB = await addProduct(B.f.storeId, "Widget", 5, 80);

    const t = await repo.create(A.ctx, {
      partnerOrgId: B.ctx.orgId, fromStoreId: A.f.storeId, toStoreId: B.f.storeId, kind: "send", settlementType: "payable",
      items: [{ fromInventoryId: widgetA.id, quantity: 4, agreedUnitPrice: 120 }],
    });
    expect(t.status).toBe("offered");
    // An unanswered offer ties up nothing.
    expect((await qtyOf(widgetA.id)).quantity).toBe(10);

    await repo.accept(B.ctx, t.id);
    await repo.ship(A.ctx, t.id);
    expect((await qtyOf(widgetA.id)).quantity).toBe(6);
    expect((await qtyOf(widgetB.id)).quantity).toBe(5); // not there until it is confirmed received
    expect((await repo.stockAccounting(t.id)).every((l) => l.unreconciled === 0)).toBe(true);

    const items = (await repo.get(B.ctx.orgId, t.id))!.items;
    await repo.receive(B.ctx, t.id, { [items[0].id]: 4 });
    const after = await qtyOf(widgetB.id);
    expect(after.quantity).toBe(9);
    // Averaged with what was already on the shelf, not overwritten: (5*80 + 4*120) / 9.
    expect(after.costPrice).toBeCloseTo(97.78, 2);
    expect((await repo.stockAccounting(t.id)).every((l) => l.unreconciled === 0)).toBe(true);

    // Moving goods between businesses is not an expense for either of them.
    expect(await db.select().from(expenses).where(inArray(expenses.storeId, [A.f.storeId, B.f.storeId]))).toHaveLength(0);
  });

  it("creates the item in the receiving store when they do not stock it", async () => {
    const A = await biz(); const B = await biz();
    await connect(A, B);
    const gadget = await addProduct(A.f.storeId, "Gadget", 3, 50, { sku: "GAD-1" });
    const t = await repo.create(A.ctx, { partnerOrgId: B.ctx.orgId, fromStoreId: A.f.storeId, toStoreId: B.f.storeId, kind: "send", settlementType: "none", items: [{ fromInventoryId: gadget.id, quantity: 3 }] });
    await repo.accept(B.ctx, t.id);
    await repo.ship(A.ctx, t.id);
    await repo.receive(B.ctx, t.id);
    const [created] = await db.select().from(inventory).where(eq(inventory.storeId, B.f.storeId));
    expect(created.name).toBe("Gadget");
    expect(created.quantity).toBe(3);
    expect(created.sku).toBe("GAD-1");
  });

  it("flags a shortfall, bills only what arrived, and puts the rest back when the sender resolves it", async () => {
    const A = await biz(); const B = await biz();
    await connect(A, B);
    const w = await addProduct(A.f.storeId, "Widget", 10, 100);
    const t = await repo.create(A.ctx, { partnerOrgId: B.ctx.orgId, fromStoreId: A.f.storeId, toStoreId: B.f.storeId, kind: "send", settlementType: "payable", items: [{ fromInventoryId: w.id, quantity: 5, agreedUnitPrice: 100 }] });
    await repo.accept(B.ctx, t.id);
    await repo.ship(A.ctx, t.id);
    const item = (await repo.get(B.ctx.orgId, t.id))!.items[0];
    const received = await repo.receive(B.ctx, t.id, { [item.id]: 3 });
    expect(received.status).toBe("disputed");

    const view = (await repo.get(A.ctx.orgId, t.id))!;
    expect(view.obligation?.amountDue).toBe(300); // 3 arrived, not 5
    expect((await repo.stockAccounting(t.id)).every((l) => l.unreconciled === 0)).toBe(true);

    await repo.resolveDispute(A.ctx, t.id, true);
    expect((await qtyOf(w.id)).quantity).toBe(7); // 10 - 5 shipped + 2 back
  });
});

describe("partner transfer: what is owed", () => {
  it("keeps a debtor's payment pending until the creditor confirms, and the ledger nets correctly", async () => {
    const A = await biz(); const B = await biz();
    await connect(A, B);
    const w = await addProduct(A.f.storeId, "Widget", 10, 100);
    const t = await repo.create(A.ctx, { partnerOrgId: B.ctx.orgId, fromStoreId: A.f.storeId, toStoreId: B.f.storeId, kind: "send", settlementType: "payable", items: [{ fromInventoryId: w.id, quantity: 4, agreedUnitPrice: 120 }] });
    await repo.accept(B.ctx, t.id); await repo.ship(A.ctx, t.id); await repo.receive(B.ctx, t.id);
    const ob = (await repo.get(A.ctx.orgId, t.id))!.obligation!;
    expect(ob.amountDue).toBe(480);

    const claim = await repo.recordSettlement(B.ctx, ob.id, { amount: 200, method: "transfer" });
    expect(claim.status).toBe("pending");
    expect((await repo.ledger(A.ctx.orgId)).totals.owedToMe).toBe(480); // the debtor cannot mark their own debt paid

    await repo.answerSettlement(A.ctx, claim.id, true);
    expect((await repo.ledger(A.ctx.orgId)).totals.owedToMe).toBe(280);
    expect((await repo.ledger(B.ctx.orgId)).totals.iOwe).toBe(280);

    await expect(repo.recordSettlement(A.ctx, ob.id, { amount: 300, method: "cash" })).rejects.toThrow(PartnerRuleError);
    await repo.recordSettlement(A.ctx, ob.id, { amount: 280, method: "cash" });
    expect((await repo.get(A.ctx.orgId, t.id))!.obligation?.status).toBe("settled");
  });

  it("will not impose a debt after receipt unless the receiver agrees", async () => {
    const A = await biz(); const B = await biz();
    await connect(A, B);
    const w = await addProduct(A.f.storeId, "Widget", 10, 100);
    const t = await repo.create(A.ctx, { partnerOrgId: B.ctx.orgId, fromStoreId: A.f.storeId, toStoreId: B.f.storeId, kind: "send", settlementType: "none", items: [{ fromInventoryId: w.id, quantity: 2, agreedUnitPrice: 150 }] });
    await repo.accept(B.ctx, t.id); await repo.ship(A.ctx, t.id); await repo.receive(B.ctx, t.id);
    expect((await repo.get(A.ctx.orgId, t.id))!.obligation).toBeNull();

    await repo.proposeSettlement(A.ctx, t.id, "payable", null);
    expect((await repo.get(A.ctx.orgId, t.id))!.obligation).toBeNull(); // still only a proposal

    await expect(repo.respondSettlement(A.ctx, t.id, true)).rejects.toThrow(PartnerRuleError); // sender cannot agree for them
    await repo.respondSettlement(B.ctx, t.id, true);
    expect((await repo.get(A.ctx.orgId, t.id))!.obligation?.amountDue).toBe(300);
  });

  it("a declined proposal leaves nothing owed but stays on the record", async () => {
    const A = await biz(); const B = await biz();
    await connect(A, B);
    const w = await addProduct(A.f.storeId, "Widget", 10, 100);
    const t = await repo.create(A.ctx, { partnerOrgId: B.ctx.orgId, fromStoreId: A.f.storeId, toStoreId: B.f.storeId, kind: "send", settlementType: "none", items: [{ fromInventoryId: w.id, quantity: 2 }] });
    await repo.accept(B.ctx, t.id); await repo.ship(A.ctx, t.id); await repo.receive(B.ctx, t.id);
    await repo.proposeSettlement(A.ctx, t.id, "return_in_kind", null);
    await repo.respondSettlement(B.ctx, t.id, false);
    const view = (await repo.get(A.ctx.orgId, t.id))!;
    expect(view.obligation).toBeNull();
    expect(view.events.map((e) => e.event)).toEqual(expect.arrayContaining(["settlement_proposed", "settlement_declined"]));
  });

  it("enforces the trade credit limit across open balances", async () => {
    const A = await biz(); const B = await biz();
    const p = await connect(A, B);
    await partners.setTradeCreditLimit(p.id, A.ctx.orgId, 500);
    const w = await addProduct(A.f.storeId, "Widget", 20, 100);
    const send = (qty: number) => repo.create(A.ctx, { partnerOrgId: B.ctx.orgId, fromStoreId: A.f.storeId, toStoreId: B.f.storeId, kind: "send", settlementType: "payable", items: [{ fromInventoryId: w.id, quantity: qty, agreedUnitPrice: 100 }] });
    const t = await send(4);
    await repo.accept(B.ctx, t.id); await repo.ship(A.ctx, t.id); await repo.receive(B.ctx, t.id);
    await expect(send(2)).rejects.toThrow(/credit limit/); // 400 owed + 200 > 500
    await expect(send(1)).resolves.toBeTruthy();
  });
});

describe("partner transfer: safety", () => {
  it("is idempotent on the sender's key", async () => {
    const A = await biz(); const B = await biz();
    await connect(A, B);
    const w = await addProduct(A.f.storeId, "Widget", 10, 100);
    const input = { partnerOrgId: B.ctx.orgId, fromStoreId: A.f.storeId, toStoreId: B.f.storeId, kind: "send" as const, settlementType: "none" as const, idempotencyKey: "same-key-12345", items: [{ fromInventoryId: w.id, quantity: 1 }] };
    const [one, two] = [await repo.create(A.ctx, input), await repo.create(A.ctx, input)];
    expect(two.id).toBe(one.id);
    expect(await db.select().from(partnerTransfers).where(eq(partnerTransfers.fromStoreId, A.f.storeId))).toHaveLength(1);
  });

  it("shipping twice at once takes the stock only once", async () => {
    const A = await biz(); const B = await biz();
    await connect(A, B);
    const w = await addProduct(A.f.storeId, "Widget", 10, 100);
    const t = await repo.create(A.ctx, { partnerOrgId: B.ctx.orgId, fromStoreId: A.f.storeId, toStoreId: B.f.storeId, kind: "send", settlementType: "none", items: [{ fromInventoryId: w.id, quantity: 4 }] });
    await repo.accept(B.ctx, t.id);
    const results = await Promise.allSettled([repo.ship(A.ctx, t.id), repo.ship(A.ctx, t.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await qtyOf(w.id)).quantity).toBe(6);
  });

  it("treats a third business as if the transfer does not exist", async () => {
    const A = await biz(); const B = await biz(); const C = await biz();
    await connect(A, B);
    const w = await addProduct(A.f.storeId, "Widget", 10, 100);
    const t = await repo.create(A.ctx, { partnerOrgId: B.ctx.orgId, fromStoreId: A.f.storeId, toStoreId: B.f.storeId, kind: "send", settlementType: "none", items: [{ fromInventoryId: w.id, quantity: 1 }] });
    expect(await repo.get(C.ctx.orgId, t.id)).toBeNull();
    await expect(repo.accept(C.ctx, t.id)).rejects.toThrow("Transfer not found.");
    expect(await repo.list(C.ctx.orgId)).toHaveLength(0);
  });

  it("keeps the sender's cost from the receiver, and the receiver's inventory ids from the sender", async () => {
    const A = await biz(); const B = await biz();
    await connect(A, B);
    const w = await addProduct(A.f.storeId, "Widget", 10, 61);
    const t = await repo.create(A.ctx, { partnerOrgId: B.ctx.orgId, fromStoreId: A.f.storeId, toStoreId: B.f.storeId, kind: "send", settlementType: "none", items: [{ fromInventoryId: w.id, quantity: 1 }] });
    const forReceiver = (await repo.get(B.ctx.orgId, t.id))!.items[0] as Record<string, unknown>;
    expect(forReceiver).not.toHaveProperty("unitCostSnapshot");
    expect(forReceiver).not.toHaveProperty("fromInventoryId");
    const forSender = (await repo.get(A.ctx.orgId, t.id))!.items[0] as Record<string, unknown>;
    expect(forSender).not.toHaveProperty("toInventoryId");
  });

  it("refuses to send without an active partnership, to oneself, or more than is in stock", async () => {
    const A = await biz(); const B = await biz();
    const w = await addProduct(A.f.storeId, "Widget", 3, 100);
    const base = { partnerOrgId: B.ctx.orgId, fromStoreId: A.f.storeId, toStoreId: B.f.storeId, kind: "send" as const, settlementType: "none" as const };
    await expect(repo.create(A.ctx, { ...base, items: [{ fromInventoryId: w.id, quantity: 1 }] })).rejects.toThrow(/not partners/);
    const p = await connect(A, B);
    await expect(repo.create(A.ctx, { ...base, items: [{ fromInventoryId: w.id, quantity: 4 }] })).rejects.toThrow(/Not enough/);
    await partners.revoke(p.id, B.ctx.orgId);
    await expect(repo.create(A.ctx, { ...base, items: [{ fromInventoryId: w.id, quantity: 1 }] })).rejects.toThrow(/not partners/);
  });

  it("keeps an open balance when the partnership ends", async () => {
    const A = await biz(); const B = await biz();
    const p = await connect(A, B);
    const w = await addProduct(A.f.storeId, "Widget", 10, 100);
    const t = await repo.create(A.ctx, { partnerOrgId: B.ctx.orgId, fromStoreId: A.f.storeId, toStoreId: B.f.storeId, kind: "send", settlementType: "payable", items: [{ fromInventoryId: w.id, quantity: 2, agreedUnitPrice: 100 }] });
    await repo.accept(B.ctx, t.id); await repo.ship(A.ctx, t.id); await repo.receive(B.ctx, t.id);
    await partners.revoke(p.id, A.ctx.orgId);
    expect((await repo.ledger(A.ctx.orgId)).totals.owedToMe).toBe(200);
    const ob = (await repo.get(B.ctx.orgId, t.id))!.obligation!;
    await expect(repo.recordSettlement(B.ctx, ob.id, { amount: 200, method: "cash" })).resolves.toBeTruthy();
  });
});

describe("partnerships", () => {
  it("turns two mirror-image requests into one active link", async () => {
    const A = await biz(); const B = await biz();
    const codeA = await partners.ensurePartnerCode(A.ctx.orgId);
    const codeB = await partners.ensurePartnerCode(B.ctx.orgId);
    await partners.request(A.ctx.orgId, null, codeB);
    const second = await partners.request(B.ctx.orgId, null, codeA);
    expect(second.status).toBe("active");
    await expect(partners.request(A.ctx.orgId, null, codeB)).rejects.toThrow(/already partners/);
  });

  it("rejects your own code and unknown codes", async () => {
    const A = await biz();
    const mine = await partners.ensurePartnerCode(A.ctx.orgId);
    await expect(partners.request(A.ctx.orgId, null, mine)).rejects.toThrow(/own/);
    await expect(partners.request(A.ctx.orgId, null, "PT-NOPE00")).rejects.toThrow(/No business/);
  });

  it("only exposes a partner's stores to an active partner", async () => {
    const A = await biz(); const B = await biz();
    await expect(partners.listPartnerStores(A.ctx.orgId, B.ctx.orgId)).rejects.toThrow(PartnerRuleError);
    await connect(A, B);
    const stores = await partners.listPartnerStores(A.ctx.orgId, B.ctx.orgId);
    expect(stores.map((s) => s.id)).toEqual([B.f.storeId]);
  });
});

describe("partner transfer: requests", () => {
  // B (the requester) asks A (the supplier) for stock. B's ctx opens it; the supplier's store is `fromStoreId`.
  const ask = (B: { f: Fixture; ctx: PartnerCtx }, A: { f: Fixture; ctx: PartnerCtx }, items: any[], extra: Record<string, unknown> = {}) =>
    repo.create(B.ctx, {
      partnerOrgId: A.ctx.orgId, fromStoreId: A.f.storeId, toStoreId: B.f.storeId, kind: "request", settlementType: "none", items, ...extra,
    } as any);

  it("runs end to end: supplier maps the line, ships, requester receives, and what is owed is the supplier's", async () => {
    const A = await biz(); const B = await biz();
    await connect(A, B);
    const supplyA = await addProduct(A.f.storeId, "Widget Pro", 10, 100, { sku: "WID-1" });
    const mineB = await addProduct(B.f.storeId, "Widget", 2, 80, { sku: "WID-1" });

    const t = await ask(B, A, [{ toInventoryId: mineB.id, quantity: 4, agreedUnitPrice: 120 }], { settlementType: "payable" });
    expect(t.status).toBe("requested");
    expect(t.fromOrgId).toBe(A.ctx.orgId); // stock flows from the supplier
    expect((await qtyOf(supplyA.id)).quantity).toBe(10); // asking reserves nothing

    // Matches on the sku the requester's own item carries, even though the names differ.
    await repo.accept(A.ctx, t.id);
    await repo.ship(A.ctx, t.id);
    expect((await qtyOf(supplyA.id)).quantity).toBe(6);
    const item = (await repo.get(B.ctx.orgId, t.id))!.items[0];
    await repo.receive(B.ctx, t.id, { [item.id]: 4 });

    expect((await qtyOf(mineB.id)).quantity).toBe(6);
    expect((await repo.stockAccounting(t.id)).every((l) => l.unreconciled === 0)).toBe(true);
    const ob = (await repo.get(A.ctx.orgId, t.id))!.obligation!;
    expect(ob.creditorOrgId).toBe(A.ctx.orgId);
    expect(ob.amountDue).toBe(480);
    expect((await repo.ledger(B.ctx.orgId)).totals.iOwe).toBe(480);
  });

  it("lets only the supplier answer, and the requester withdraw only before it is accepted", async () => {
    const A = await biz(); const B = await biz();
    await connect(A, B);
    await addProduct(A.f.storeId, "Widget", 10, 100);
    const t = await ask(B, A, [{ name: "Widget", quantity: 2 }]);

    await expect(repo.accept(B.ctx, t.id)).rejects.toThrow(PartnerRuleError); // cannot approve their own request
    await expect(repo.reject(B.ctx, t.id, null)).rejects.toThrow(PartnerRuleError);
    await expect(repo.cancel(A.ctx, t.id)).rejects.toThrow(PartnerRuleError); // the supplier declines instead

    await repo.accept(A.ctx, t.id);
    await expect(repo.cancel(B.ctx, t.id)).rejects.toThrow(PartnerRuleError); // too late to withdraw
    expect((await repo.cancel(A.ctx, t.id)).status).toBe("cancelled");

    const withdrawn = await ask(B, A, [{ name: "Widget", quantity: 1 }]);
    expect((await repo.cancel(B.ctx, withdrawn.id)).status).toBe("cancelled");
  });

  it("lets the supplier supply less or drop a line, never more, and never re-price what the requester set", async () => {
    const A = await biz(); const B = await biz();
    await connect(A, B);
    await addProduct(A.f.storeId, "Widget", 10, 100);
    await addProduct(A.f.storeId, "Gadget", 10, 50);
    const t = await ask(B, A, [{ name: "Widget", quantity: 5, agreedUnitPrice: 110 }, { name: "Gadget", quantity: 3 }], { settlementType: "payable" });
    const [w, g] = (await repo.get(A.ctx.orgId, t.id))!.items;

    await expect(repo.accept(A.ctx, t.id, { lines: { [w.id]: { quantity: 6 } } })).rejects.toThrow(/at most 5/);
    await expect(repo.accept(A.ctx, t.id, { lines: { [w.id]: { agreedUnitPrice: 200 } } })).rejects.toThrow(/already set a price/);

    // Lower the Widget, price the Gadget (the requester left it blank), and the transfer is re-valued.
    const accepted = await repo.accept(A.ctx, t.id, { lines: { [w.id]: { quantity: 2 }, [g.id]: { agreedUnitPrice: 60 } } });
    expect(accepted.status).toBe("accepted");
    expect(accepted.agreedTotal).toBe(2 * 110 + 3 * 60);

    const t2 = await ask(B, A, [{ name: "Widget", quantity: 1 }, { name: "Gadget", quantity: 1 }]);
    const [w2, g2] = (await repo.get(A.ctx.orgId, t2.id))!.items;
    await repo.accept(A.ctx, t2.id, { lines: { [g2.id]: { quantity: 0 } } });
    const left = (await repo.get(A.ctx.orgId, t2.id))!.items;
    expect(left.map((i) => i.id)).toEqual([w2.id]); // the dropped line is gone
    await expect(repo.accept(A.ctx, t.id)).rejects.toThrow(PartnerRuleError); // already accepted
  });

  it("will not accept a line it cannot match or cannot cover, and rolls the whole acceptance back", async () => {
    const A = await biz(); const B = await biz();
    await connect(A, B);
    await addProduct(A.f.storeId, "Widget", 3, 100);
    const t = await ask(B, A, [{ name: "Widget", quantity: 2 }, { name: "Mystery", quantity: 1 }]);
    await expect(repo.accept(A.ctx, t.id)).rejects.toThrow(/Choose which of your items covers "Mystery"/);
    expect((await repo.get(A.ctx.orgId, t.id))!.status).toBe("requested");
    expect((await repo.get(A.ctx.orgId, t.id))!.items.every((i: any) => i.fromInventoryId === null)).toBe(true); // nothing half-mapped

    const big = await ask(B, A, [{ name: "Widget", quantity: 9 }]);
    await expect(repo.accept(A.ctx, big.id)).rejects.toThrow(/Not enough/);
  });

  it("enforces the credit limit when the supplier accepts, since only then is the value known", async () => {
    const A = await biz(); const B = await biz();
    const p = await connect(A, B);
    await partners.setTradeCreditLimit(p.id, A.ctx.orgId, 300);
    await addProduct(A.f.storeId, "Widget", 10, 100);
    const t = await ask(B, A, [{ name: "Widget", quantity: 5, agreedUnitPrice: 100 }], { settlementType: "payable" }); // 500 > 300
    await expect(repo.accept(A.ctx, t.id)).rejects.toThrow(/credit limit/);
    const [w] = (await repo.get(A.ctx.orgId, t.id))!.items;
    await expect(repo.accept(A.ctx, t.id, { lines: { [w.id]: { quantity: 3 } } })).resolves.toBeTruthy(); // 300 fits
  });

  it("keeps requesters' idempotency keys apart, so one business cannot reach another's request", async () => {
    const A = await biz(); const B = await biz(); const C = await biz();
    await connect(A, B); await connect(A, C);
    await addProduct(A.f.storeId, "Widget", 10, 100);
    const items = [{ name: "Widget", quantity: 1 }];
    const key = { idempotencyKey: "shared-key-12345" };
    const fromB = await ask(B, A, items, key);
    const fromC = await ask(C, A, items, key);
    expect(fromC.id).not.toBe(fromB.id);
    expect((await ask(B, A, items, key)).id).toBe(fromB.id); // a retry by the same requester is still deduplicated
    expect(await repo.get(C.ctx.orgId, fromB.id)).toBeNull();
  });

  it("refuses to request from a business you are not partners with", async () => {
    const A = await biz(); const B = await biz();
    await expect(ask(B, A, [{ name: "Widget", quantity: 1 }])).rejects.toThrow(/not partners/);
  });

  it("only lets a requester ask for their own store, and name items from their own shelf", async () => {
    const A = await biz(); const B = await biz();
    await connect(A, B);
    const theirs = await addProduct(A.f.storeId, "Widget", 5, 100);
    await expect(ask(B, A, [{ toInventoryId: theirs.id, quantity: 1 }])).rejects.toThrow(/not a product in your store/);
    await expect(
      repo.create(B.ctx, { partnerOrgId: A.ctx.orgId, fromStoreId: A.f.storeId, toStoreId: A.f.storeId, kind: "request", settlementType: "none", items: [{ name: "x", quantity: 1 }] } as any),
    ).rejects.toThrow(PartnerRuleError);
  });
});
