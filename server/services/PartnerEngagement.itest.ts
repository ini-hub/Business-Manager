import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { db } from "../db";
import { eq, sql } from "drizzle-orm";
import { partnerObligations, partnerTransferItems } from "@shared/schema";

// No real mail from a test: the three partner senders are replaced, everything else in email.ts is untouched.
vi.mock("../email", async (importOriginal) => {
  const real = await importOriginal<typeof import("../email")>();
  return { ...real, sendPartnerReminderEmail: vi.fn(), sendPartnerStatementEmail: vi.fn(), sendPartnerInviteEmail: vi.fn() };
});

import * as email from "../email";
import { PartnerTransferRepository } from "../repositories/PartnerTransferRepository";
import { PartnerRuleError } from "../lib/partnerTransfer";
import { engagementFor, onBalanceSettled, onPartnershipActivated, onTransferReceived, partnerStats } from "./PartnerEngagementService";
import { runPartnerReminders, runPartnerStatements } from "./PartnerReminderService";
import { closePool } from "../test-support/integration-db";
import { partnerTestKit } from "../test-support/partner-fixtures";

const kit = partnerTestKit();
const { partners, biz, addProduct, qtyOf, connect, ledgerProblems } = kit;
const repo = new PartnerTransferRepository();

/** A sent-and-received transfer A -> B, so engagement and balances have something to measure. */
async function completedSend(A: Awaited<ReturnType<typeof biz>>, B: Awaited<ReturnType<typeof biz>>, over: Record<string, unknown> = {}, confirmQty?: number) {
  const w = await addProduct(A.f.storeId, `Widget-${Math.random().toString(36).slice(2, 7)}`, 20, 100);
  const t = await repo.create(A.ctx, { partnerOrgId: B.ctx.orgId, fromStoreId: A.f.storeId, toStoreId: B.f.storeId, kind: "send", settlementType: "payable", items: [{ fromInventoryId: w.id, quantity: 4, agreedUnitPrice: 100 }], ...over } as any);
  await repo.accept(B.ctx, t.id);
  await repo.ship(A.ctx, t.id);
  const item = (await repo.get(B.ctx.orgId, t.id))!.items[0];
  const done = await repo.receive(B.ctx, t.id, confirmQty == null ? {} : { [item.id]: confirmQty });
  return { t: done, w };
}

beforeAll(() => kit.setup());

afterEach(async () => {
  vi.clearAllMocks();
  await kit.teardown();
});

afterAll(async () => {
  await closePool();
});

describe("sharing items with partners", () => {
  it("shows partners only what was ticked, whether it is in stock, and never counts or cost", async () => {
    const A = await biz(); const B = await biz();
    await connect(A, B);
    const shared = await addProduct(A.f.storeId, "Shared Widget", 7, 40);
    await addProduct(A.f.storeId, "Private Gadget", 9, 40);
    const soldOut = await addProduct(A.f.storeId, "Shared But Sold Out", 0, 40);
    await partners.setSharedItems(A.f.storeId, [shared.id, soldOut.id]);

    const catalog = await partners.listSharedCatalog(B.ctx.orgId, A.ctx.orgId, A.f.storeId);
    expect(catalog.map((c) => c.name).sort()).toEqual(["Shared But Sold Out", "Shared Widget"]);
    expect(catalog.find((c) => c.name === "Shared Widget")!.inStock).toBe(true);
    expect(catalog.find((c) => c.name === "Shared But Sold Out")!.inStock).toBe(false);
    for (const c of catalog) {
      expect(c).not.toHaveProperty("quantity");
      expect(c).not.toHaveProperty("costPrice");
    }
  });

  it("is closed to non-partners and to stores that are not the partner's", async () => {
    const A = await biz(); const B = await biz(); const C = await biz();
    await expect(partners.listSharedCatalog(B.ctx.orgId, A.ctx.orgId, A.f.storeId)).rejects.toThrow(/not partners/);
    await connect(A, B);
    await expect(partners.listSharedCatalog(B.ctx.orgId, A.ctx.orgId, C.f.storeId)).rejects.toThrow(/not one of your partner's/);
  });

  it("replaces the shared set, and cannot flag another store's items", async () => {
    const A = await biz(); const B = await biz();
    const mine = await addProduct(A.f.storeId, "Mine", 5, 10);
    const theirs = await addProduct(B.f.storeId, "Theirs", 5, 10);
    expect(await partners.setSharedItems(A.f.storeId, [mine.id, theirs.id])).toBe(1);
    expect((await qtyOf(theirs.id)).sharedWithPartners).toBe(false);
    await partners.setSharedItems(A.f.storeId, []);
    expect(await partners.getSharedItemIds(A.f.storeId)).toEqual([]);
  });

  it("lets a request name a shared item, refuses an unshared one, and the supplier's cost stays hidden", async () => {
    const A = await biz(); const B = await biz();
    await connect(A, B);
    const shared = await addProduct(A.f.storeId, "Shared Widget", 10, 61);
    const hidden = await addProduct(A.f.storeId, "Hidden Gadget", 10, 61);
    await partners.setSharedItems(A.f.storeId, [shared.id]);
    const ask = (id: string) => repo.create(B.ctx, { partnerOrgId: A.ctx.orgId, fromStoreId: A.f.storeId, toStoreId: B.f.storeId, kind: "request", settlementType: "none", items: [{ fromInventoryId: id, quantity: 2 }] } as any);

    await expect(ask(hidden.id)).rejects.toThrow(/not shared with partners/);
    const t = await ask(shared.id);
    const forRequester = (await repo.get(B.ctx.orgId, t.id))!.items[0] as Record<string, unknown>;
    expect(forRequester.name).toBe("Shared Widget");
    expect(forRequester).not.toHaveProperty("unitCostSnapshot");
    expect(forRequester).not.toHaveProperty("fromInventoryId");

    // The supplier accepts with no mapping at all: the line already names their item.
    await expect(repo.accept(A.ctx, t.id)).resolves.toMatchObject({ status: "accepted" });
    const forSupplier = (await repo.get(A.ctx.orgId, t.id))!.items[0] as Record<string, unknown>;
    expect(forSupplier.fromInventoryId).toBe(shared.id);
    expect(forSupplier.unitCostSnapshot).toBe(61);
  });
});

describe("shortfall reasons", () => {
  it("records why a line is short, and only missing stock can go back on the sender's shelf", async () => {
    const A = await biz(); const B = await biz();
    await connect(A, B);
    const lost = await addProduct(A.f.storeId, "Lost Widget", 10, 100);
    const broken = await addProduct(A.f.storeId, "Broken Gadget", 10, 100);
    const t = await repo.create(A.ctx, {
      partnerOrgId: B.ctx.orgId, fromStoreId: A.f.storeId, toStoreId: B.f.storeId, kind: "send", settlementType: "none",
      items: [{ fromInventoryId: lost.id, quantity: 4 }, { fromInventoryId: broken.id, quantity: 4 }],
    } as any);
    await repo.accept(B.ctx, t.id); await repo.ship(A.ctx, t.id);
    const items = (await repo.get(B.ctx.orgId, t.id))!.items;
    const byName = (n: string) => items.find((i) => i.name === n)!;

    const done = await repo.receive(B.ctx, t.id, { [byName("Lost Widget").id]: 1, [byName("Broken Gadget").id]: 1 }, {
      [byName("Lost Widget").id]: { reason: "missing", note: "never arrived" },
      [byName("Broken Gadget").id]: { reason: "damaged", note: "crushed box" },
    });
    expect(done.status).toBe("disputed");
    const rows = await db.select().from(partnerTransferItems).where(eq(partnerTransferItems.transferId, t.id));
    expect(rows.find((r) => r.name === "Broken Gadget")).toMatchObject({ shortfallReason: "damaged", shortfallNote: "crushed box" });

    await repo.resolveDispute(A.ctx, t.id, true);
    expect((await qtyOf(lost.id)).quantity).toBe(10 - 4 + 3); // the 3 that never arrived are back on the shelf
    expect((await qtyOf(broken.id)).quantity).toBe(10 - 4); // the 3 that arrived broken are not
  });

  it("treats an unexplained shortfall as missing", async () => {
    const A = await biz(); const B = await biz();
    await connect(A, B);
    const { t } = await completedSend(A, B, {}, 2);
    expect(t.status).toBe("disputed");
    const [row] = await db.select().from(partnerTransferItems).where(eq(partnerTransferItems.transferId, t.id));
    expect(row.shortfallReason).toBe("missing");
  });
});

describe("invitations", () => {
  it("rejects bad addresses, repeats within a week, and a runaway daily volume", async () => {
    const A = await biz();
    await expect(partners.recordInvite(A.ctx.orgId, null, "not-an-email")).rejects.toThrow(/valid email/);
    await partners.recordInvite(A.ctx.orgId, null, "Friend@Example.test");
    await expect(partners.recordInvite(A.ctx.orgId, null, "friend@example.TEST")).rejects.toThrow(/last week/);
    for (let i = 0; i < 9; i++) await partners.recordInvite(A.ctx.orgId, null, `bulk${i}@example.test`);
    await expect(partners.recordInvite(A.ctx.orgId, null, "one-too-many@example.test")).rejects.toThrow(/most invitations/);
  });

  it("credits the inviter exactly once, only when the invited address's business becomes a partner", async () => {
    const A = await biz(); const B = await biz({ owner: true }); const C = await biz({ owner: true });
    await partners.recordInvite(A.ctx.orgId, null, B.ownerEmail!);

    const pc = await connect(A, C); // C was never invited by A
    await onPartnershipActivated(pc.id);
    expect((await engagementFor(A.ctx.orgId)).points).toBe(0);

    const pb = await connect(A, B);
    await onPartnershipActivated(pb.id);
    await onPartnershipActivated(pb.id); // a retry must not pay twice
    const standing = await engagementFor(A.ctx.orgId);
    expect(standing.points).toBe(25);
    expect(standing.badges).toContain("partner_connector");
    expect((await engagementFor(B.ctx.orgId)).points).toBe(0);
  });
});

describe("badges, points and reputation", () => {
  it("rewards both branches once per completed transfer, however often the event replays", async () => {
    const A = await biz(); const B = await biz();
    await connect(A, B);
    const { t } = await completedSend(A, B);
    await onTransferReceived(t); await onTransferReceived(t);
    for (const org of [A, B]) {
      const standing = await engagementFor(org.ctx.orgId);
      expect(standing.points).toBe(10);
      expect(standing.badges).toContain("partner_first_share");
      expect(standing.badges).not.toContain("partner_trusted_trader");
    }
  });

  it("measures receipt accuracy and overdue balances from the real records", async () => {
    const A = await biz(); const B = await biz();
    await connect(A, B);
    await completedSend(A, B, { dueDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) }); // arrived complete, now overdue
    await completedSend(A, B, {}, 3); // arrived short
    const stats = await partnerStats(B.ctx.orgId);
    expect(stats).toMatchObject({ received: 2, receivedComplete: 1, overdueOpen: 1, settled: 0, completedTransfers: 2 });
    expect((await partnerStats(A.ctx.orgId)).received).toBe(0); // the sender received nothing
  });

  it("counts a balance cleared by its due date as on time", async () => {
    const A = await biz(); const B = await biz();
    await connect(A, B);
    const { t } = await completedSend(A, B, { dueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000) });
    const ob = (await repo.get(A.ctx.orgId, t.id))!.obligation!;
    await repo.recordSettlement(A.ctx, ob.id, { amount: ob.amountDue, method: "cash" });
    await onBalanceSettled(ob.id);
    expect(await partnerStats(B.ctx.orgId)).toMatchObject({ settled: 1, settledOnTime: 1, overdueOpen: 0 });
  });
});

describe("reminders", () => {
  async function owing(dueInDays: number) {
    const A = await biz({ owner: true }); const B = await biz({ owner: true });
    await connect(A, B);
    const { t } = await completedSend(A, B);
    const ob = (await repo.get(A.ctx.orgId, t.id))!.obligation!;
    await db.update(partnerObligations).set({ dueDate: new Date(Date.now() + dueInDays * 24 * 60 * 60 * 1000) }).where(eq(partnerObligations.id, ob.id));
    return { A, B, ob, t };
  }

  it("reminds the debtor once inside the window, and not again the same day", async () => {
    const { B, ob } = await owing(2);
    const only = [B.ctx.orgId];
    expect(await runPartnerReminders(new Date(), only)).toBe(1);
    expect(email.sendPartnerReminderEmail).toHaveBeenCalledTimes(1);
    expect((email.sendPartnerReminderEmail as any).mock.calls[0][0]).toBe(B.ownerEmail);
    expect((email.sendPartnerReminderEmail as any).mock.calls[0][2]).toMatchObject({ kind: "upcoming", amount: ob.amountDue });
    expect(await runPartnerReminders(new Date(), only)).toBe(0);
  });

  it("stays quiet for a distant due date and for a balance already paid", async () => {
    const far = await owing(30);
    expect(await runPartnerReminders(new Date(), [far.B.ctx.orgId])).toBe(0);

    const paid = await owing(1);
    await repo.recordSettlement(paid.A.ctx, paid.ob.id, { amount: paid.ob.amountDue, method: "cash" });
    expect(await runPartnerReminders(new Date(), [paid.B.ctx.orgId])).toBe(0);
  });

  it("escalates when overdue and tells the creditor's branch too", async () => {
    const { B } = await owing(-10);
    expect(await runPartnerReminders(new Date(), [B.ctx.orgId])).toBe(1);
    expect((email.sendPartnerReminderEmail as any).mock.calls[0][2].kind).toBe("overdue");
  });
});

describe("monthly statements", () => {
  it("goes out once per business per month, only to those with something to report", async () => {
    const A = await biz({ owner: true }); const B = await biz({ owner: true }); const idle = await biz({ owner: true });
    await connect(A, B);
    await connect(idle, await biz({ owner: true })); // partners, but no activity and nothing owed
    await completedSend(A, B);

    const firstWeek = new Date(new Date().getFullYear(), new Date().getMonth(), 3, 9, 0);
    const orgs = [A.ctx.orgId, B.ctx.orgId, idle.ctx.orgId];
    expect(await runPartnerStatements(firstWeek, orgs)).toBe(2);
    const recipients = (email.sendPartnerStatementEmail as any).mock.calls.map((c: any[]) => c[0]).sort();
    expect(recipients).toEqual([A.ownerEmail, B.ownerEmail].sort());

    expect(await runPartnerStatements(firstWeek, orgs)).toBe(0); // a second pass the same month adds nothing
    expect(await runPartnerStatements(new Date(new Date().getFullYear(), new Date().getMonth(), 20), orgs)).toBe(0); // and not mid-month
  });

  it("shows each side its own position", async () => {
    const A = await biz({ owner: true }); const B = await biz({ owner: true });
    await connect(A, B);
    await completedSend(A, B); // 4 x 100 owed to A
    await runPartnerStatements(new Date(new Date().getFullYear(), new Date().getMonth(), 2), [A.ctx.orgId, B.ctx.orgId]);
    const byEmail = new Map((email.sendPartnerStatementEmail as any).mock.calls.map((c: any[]) => [c[0], c[2]]));
    expect((byEmail.get(A.ownerEmail) as any).partners[0].balance).toBe(400);
    expect((byEmail.get(B.ownerEmail) as any).partners[0].balance).toBe(-400);
  });
});

describe("the stock ledger", () => {
  it("stays in step through a send, a shortfall put back, and a request", async () => {
    const A = await biz(); const B = await biz();
    await connect(A, B);
    const stores = [A.f.storeId, B.f.storeId];

    // A send, received short, with the missing units returned to the sender's shelf.
    const sent = await completedSend(A, B, {}, 2);
    await repo.resolveDispute(A.ctx, sent.t.id, true);
    expect(await ledgerProblems(stores)).toEqual([]);

    // A request from a shared item, partly supplied, into an item the requester already stocks.
    const mine = await addProduct(B.f.storeId, "Already stocked", 3, 10, { sku: "SKU-9" });
    const theirs = await addProduct(A.f.storeId, "Supplier item", 8, 20, { sku: "SKU-9" });
    await partners.setSharedItems(A.f.storeId, [theirs.id]);
    const t = await repo.create(B.ctx, { partnerOrgId: A.ctx.orgId, fromStoreId: A.f.storeId, toStoreId: B.f.storeId, kind: "request", settlementType: "none", items: [{ fromInventoryId: theirs.id, toInventoryId: mine.id, quantity: 5 }] } as any);
    await repo.accept(A.ctx, t.id); await repo.ship(A.ctx, t.id);
    await repo.receive(B.ctx, t.id);
    expect(await qtyOf(mine.id)).toMatchObject({ quantity: 8 });
    expect(await qtyOf(theirs.id)).toMatchObject({ quantity: 3 });
    expect(await ledgerProblems(stores)).toEqual([]);
  });

  it("gives an item created by a receipt an opening balance, with the partner transfer as its source", async () => {
    const A = await biz(); const B = await biz();
    await connect(A, B);
    const { t } = await completedSend(A, B);
    const rows = await db.execute(sql`SELECT m.reason, m.ref_type, m.ref_id, m.delta::text FROM stock_movements m JOIN inventory i ON i.id = m.inventory_id WHERE i.store_id = ${B.f.storeId}`);
    expect(rows.rows).toEqual([expect.objectContaining({ reason: "opening_balance", ref_type: "partner_transfer", ref_id: t.id })]);
    expect(await ledgerProblems([A.f.storeId, B.f.storeId])).toEqual([]);
  });
});

describe("rules still hold", () => {
  it("keeps a stranger out of another business's transfer even with the new fields", async () => {
    const A = await biz(); const B = await biz(); const C = await biz();
    await connect(A, B);
    const { t } = await completedSend(A, B, {}, 3);
    expect(await repo.get(C.ctx.orgId, t.id)).toBeNull();
    await expect(repo.resolveDispute(C.ctx, t.id, true)).rejects.toThrow(PartnerRuleError);
  });
});
