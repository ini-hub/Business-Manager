import { db } from "../db";
import {
  storePaymentAccounts,
  salePaymentLegs,
  checkouts,
  type StorePaymentAccount,
  type InsertStorePaymentAccount,
} from "@shared/schema";
import { eq, and, desc, gte, lte, inArray } from "drizzle-orm";

export class PaymentAccountRepository {
  async list(storeId: string, opts: { includeInactive?: boolean } = {}): Promise<StorePaymentAccount[]> {
    const where = opts.includeInactive
      ? eq(storePaymentAccounts.storeId, storeId)
      : and(eq(storePaymentAccounts.storeId, storeId), eq(storePaymentAccounts.isActive, true));
    return db.select().from(storePaymentAccounts).where(where)
      .orderBy(desc(storePaymentAccounts.isDefault), storePaymentAccounts.label);
  }

  async get(id: string): Promise<StorePaymentAccount | undefined> {
    const [row] = await db.select().from(storePaymentAccounts).where(eq(storePaymentAccounts.id, id));
    return row;
  }

  async create(data: InsertStorePaymentAccount): Promise<StorePaymentAccount> {
    return db.transaction(async (tx) => {
      const existing = await tx.select({ id: storePaymentAccounts.id }).from(storePaymentAccounts)
        .where(and(eq(storePaymentAccounts.storeId, data.storeId), eq(storePaymentAccounts.isActive, true)));
      // The first active account becomes the default so transfer checkout is pre-filled.
      const makeDefault = !!data.isDefault || existing.length === 0;
      if (makeDefault) {
        await tx.update(storePaymentAccounts).set({ isDefault: false })
          .where(and(eq(storePaymentAccounts.storeId, data.storeId), eq(storePaymentAccounts.isDefault, true)));
      }
      const [row] = await tx.insert(storePaymentAccounts).values({ ...data, isDefault: makeDefault, isActive: true }).returning();
      return row;
    });
  }

  async update(id: string, storeId: string, data: Partial<Pick<InsertStorePaymentAccount,
    "label" | "kind" | "bankName" | "bankCode" | "accountNumber" | "accountName" | "accountVerifiedAt" | "isDefault" | "isActive">>): Promise<StorePaymentAccount | undefined> {
    return db.transaction(async (tx) => {
      const [current] = await tx.select().from(storePaymentAccounts)
        .where(and(eq(storePaymentAccounts.id, id), eq(storePaymentAccounts.storeId, storeId)));
      if (!current) return undefined;
      const patch = { ...data };
      // A deactivated account can't stay the default.
      if (patch.isActive === false) patch.isDefault = false;
      if (patch.isDefault) {
        await tx.update(storePaymentAccounts).set({ isDefault: false })
          .where(and(eq(storePaymentAccounts.storeId, storeId), eq(storePaymentAccounts.isDefault, true)));
      }
      const [row] = await tx.update(storePaymentAccounts).set(patch).where(eq(storePaymentAccounts.id, id)).returning();
      return row;
    });
  }

  /** Non-voided transfer/gateway legs in the window, joined to the sale they belong to. */
  private legsInWindow(storeId: string, start: Date, end: Date) {
    return db
      .select({
        id: salePaymentLegs.id,
        receiptNumber: salePaymentLegs.receiptNumber,
        checkoutId: salePaymentLegs.checkoutId,
        method: salePaymentLegs.method,
        amount: salePaymentLegs.amount,
        paymentAccountId: salePaymentLegs.paymentAccountId,
        accountLabel: salePaymentLegs.accountLabel,
        accountDetail: salePaymentLegs.accountDetail,
        confirmationStatus: salePaymentLegs.confirmationStatus,
        confirmationSource: salePaymentLegs.confirmationSource,
        confirmedAt: salePaymentLegs.confirmedAt,
        reference: salePaymentLegs.reference,
        senderName: salePaymentLegs.senderName,
        createdAt: salePaymentLegs.createdAt,
      })
      .from(salePaymentLegs)
      .innerJoin(checkouts, eq(checkouts.id, salePaymentLegs.checkoutId))
      .where(and(
        eq(salePaymentLegs.storeId, storeId),
        inArray(salePaymentLegs.method, ["transfer", "flutterwave"]),
        eq(checkouts.isVoided, false),
        gte(salePaymentLegs.createdAt, start),
        lte(salePaymentLegs.createdAt, end),
      ))
      .orderBy(desc(salePaymentLegs.createdAt));
  }

  /** Per-account expected vs confirmed vs pending, plus the pending legs themselves. */
  async reconcile(storeId: string, start: Date, end: Date) {
    const legs = await this.legsInWindow(storeId, start, end);
    const byAccount = new Map<string, {
      paymentAccountId: string | null; label: string; detail: string | null;
      expected: number; confirmed: number; pending: number; legCount: number;
    }>();
    for (const leg of legs) {
      const key = leg.paymentAccountId ?? (leg.method === "flutterwave" ? "gateway" : "unassigned");
      const row = byAccount.get(key) ?? {
        paymentAccountId: leg.paymentAccountId,
        label: leg.accountLabel ?? (key === "gateway" ? "Payment link (Flutterwave)" : "Unassigned account"),
        detail: leg.accountDetail,
        expected: 0, confirmed: 0, pending: 0, legCount: 0,
      };
      row.expected += leg.amount;
      if (leg.confirmationStatus === "confirmed") row.confirmed += leg.amount;
      else row.pending += leg.amount;
      row.legCount += 1;
      byAccount.set(key, row);
    }
    return {
      accounts: Array.from(byAccount.values()),
      pendingLegs: legs.filter(l => l.confirmationStatus === "pending"),
    };
  }

  async confirmLegs(storeId: string, legIds: string[], userId: string | undefined): Promise<number> {
    if (legIds.length === 0) return 0;
    const updated = await db.update(salePaymentLegs)
      .set({ confirmationStatus: "confirmed", confirmationSource: "manual", confirmedAt: new Date(), confirmedByUserId: userId ?? null })
      .where(and(
        eq(salePaymentLegs.storeId, storeId),
        inArray(salePaymentLegs.id, legIds),
        eq(salePaymentLegs.confirmationStatus, "pending"),
      ))
      .returning({ id: salePaymentLegs.id });
    return updated.length;
  }

  async getLegsForReceipt(storeId: string, receiptNumber: string) {
    return db.select().from(salePaymentLegs)
      .where(and(eq(salePaymentLegs.storeId, storeId), eq(salePaymentLegs.receiptNumber, receiptNumber)));
  }

  /**
   * A provider webhook says this checkout's payment link was paid. Confirms the receipt's pending
   * gateway leg, but only when the amount paid covers it: a short payment stays pending for a person
   * to look at. Returns whether a leg was confirmed.
   */
  async confirmGatewayLeg(storeId: string, checkoutId: string, paidAmount: number, reference: string): Promise<boolean> {
    const [checkout] = await db.select({ receiptNumber: checkouts.receiptNumber }).from(checkouts)
      .where(and(eq(checkouts.id, checkoutId), eq(checkouts.storeId, storeId)));
    if (!checkout) return false;
    const [leg] = await db.select().from(salePaymentLegs).where(and(
      eq(salePaymentLegs.storeId, storeId),
      eq(salePaymentLegs.receiptNumber, checkout.receiptNumber),
      eq(salePaymentLegs.method, "flutterwave"),
      eq(salePaymentLegs.confirmationStatus, "pending"),
    ));
    if (!leg || paidAmount + 0.01 < leg.amount) return false;
    const updated = await db.update(salePaymentLegs)
      .set({ confirmationStatus: "confirmed", confirmationSource: "gateway", confirmedAt: new Date(), reference })
      .where(and(eq(salePaymentLegs.id, leg.id), eq(salePaymentLegs.confirmationStatus, "pending")))
      .returning({ id: salePaymentLegs.id });
    return updated.length > 0;
  }
}
