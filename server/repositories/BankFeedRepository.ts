import { db } from "../db";
import {
  bankConnections,
  bankTransactions,
  salePaymentLegs,
  checkouts,
  storePaymentAccounts,
  returnLogs,
  type BankConnection,
} from "@shared/schema";
import { eq, and, ne, desc, isNull, gte, lte, sql } from "drizzle-orm";
import { matchCredits, refundsWithoutDebit, REFUND_MATCH_WINDOW_MS } from "../lib/bankMatch";
import type { MonoTransaction } from "../lib/mono";

export class BankFeedRepository {
  listForStore(storeId: string) {
    return db.select().from(bankConnections)
      .where(and(eq(bankConnections.storeId, storeId), ne(bankConnections.status, "disconnected")));
  }

  async get(id: string): Promise<BankConnection | undefined> {
    const [row] = await db.select().from(bankConnections).where(eq(bankConnections.id, id));
    return row;
  }

  async getByProviderAccount(providerAccountId: string): Promise<BankConnection | undefined> {
    const [row] = await db.select().from(bankConnections).where(eq(bankConnections.providerAccountId, providerAccountId));
    return row;
  }

  async create(data: { storeId: string; paymentAccountId: string; providerAccountId: string; userId?: string }): Promise<BankConnection> {
    const [row] = await db.insert(bankConnections).values({
      storeId: data.storeId,
      paymentAccountId: data.paymentAccountId,
      providerAccountId: data.providerAccountId,
      createdByUserId: data.userId ?? null,
    }).returning();
    return row;
  }

  async setStatus(id: string, status: BankConnection["status"]) {
    await db.update(bankConnections).set({ status }).where(eq(bankConnections.id, id));
  }

  /**
   * Stores new transactions (idempotent on the provider's id), then confirms any pending transfer legs
   * on this payment account that exactly one new credit fits. Returns counts for the sync response.
   */
  async ingest(conn: BankConnection, txs: MonoTransaction[]): Promise<{ stored: number; confirmed: number; unmatchedCredits: number }> {
    return db.transaction(async (tx) => {
      let stored = 0;
      const fresh: { id: string; amount: number; postedAt: Date; narration: string | null }[] = [];
      for (const t of txs) {
        const [row] = await tx.insert(bankTransactions).values({
          connectionId: conn.id,
          storeId: conn.storeId,
          externalId: t.externalId,
          direction: t.direction,
          amount: t.amount,
          narration: t.narration,
          postedAt: t.postedAt,
        }).onConflictDoNothing().returning({ id: bankTransactions.id });
        if (row) {
          stored += 1;
          if (t.direction === "credit") fresh.push({ id: row.id, amount: t.amount, postedAt: t.postedAt, narration: t.narration });
        }
      }

      const pending = await tx
        .select({
          id: salePaymentLegs.id, amount: salePaymentLegs.amount, createdAt: salePaymentLegs.createdAt,
          reference: salePaymentLegs.reference, senderName: salePaymentLegs.senderName,
        })
        .from(salePaymentLegs)
        .innerJoin(checkouts, eq(checkouts.id, salePaymentLegs.checkoutId))
        .where(and(
          eq(salePaymentLegs.storeId, conn.storeId),
          eq(salePaymentLegs.paymentAccountId, conn.paymentAccountId),
          eq(salePaymentLegs.confirmationStatus, "pending"),
          eq(checkouts.isVoided, false),
        ));

      let confirmed = 0;
      for (const m of matchCredits(fresh, pending)) {
        if (!m.legId) continue;
        const now = new Date();
        // The status guard keeps a leg a manager just confirmed by hand from being claimed twice.
        const updated = await tx.update(salePaymentLegs)
          .set({ confirmationStatus: "confirmed", confirmationSource: "bank_feed", confirmedAt: now })
          .where(and(eq(salePaymentLegs.id, m.legId), eq(salePaymentLegs.confirmationStatus, "pending")))
          .returning({ id: salePaymentLegs.id });
        if (updated.length === 0) continue;
        await tx.update(bankTransactions).set({ matchedLegId: m.legId, matchedAt: now }).where(eq(bankTransactions.id, m.creditId));
        confirmed += 1;
      }
      await tx.update(bankConnections).set({ lastSyncedAt: new Date() }).where(eq(bankConnections.id, conn.id));
      return { stored, confirmed, unmatchedCredits: fresh.length - confirmed };
    });
  }

  /** Credits no sale claimed, newest first, so a manager can see money that arrived without a matching sale. */
  async unmatchedCredits(storeId: string, limit = 100) {
    return db
      .select({
        id: bankTransactions.id,
        amount: bankTransactions.amount,
        narration: bankTransactions.narration,
        postedAt: bankTransactions.postedAt,
        accountLabel: storePaymentAccounts.label,
      })
      .from(bankTransactions)
      .innerJoin(bankConnections, eq(bankConnections.id, bankTransactions.connectionId))
      .innerJoin(storePaymentAccounts, eq(storePaymentAccounts.id, bankConnections.paymentAccountId))
      .where(and(
        eq(bankTransactions.storeId, storeId),
        eq(bankTransactions.direction, "credit"),
        isNull(bankTransactions.matchedLegId),
      ))
      .orderBy(desc(bankTransactions.postedAt))
      .limit(limit);
  }

  /**
   * Tax collected, tax given back through returns, and refunds by payout method for a period, plus (when the
   * store has a linked bank account) the places the bank disagrees with the books. Sales count in the period
   * they were made and returns in the period they were processed, which is how a VAT return nets them.
   * Money columns are cast to numeric: float arithmetic drifts on kobo.
   */
  async taxReturnsSummary(storeId: string, start: Date, end: Date) {
    const [sales] = await db.select({
      lines: sql<number>`COUNT(*)::int`,
      subtotal: sql<number>`COALESCE(SUM((${checkouts.subtotal})::numeric), 0)::float8`,
      tax: sql<number>`COALESCE(SUM((${checkouts.taxTotal})::numeric), 0)::float8`,
      gross: sql<number>`COALESCE(SUM((${checkouts.totalCharged})::numeric), 0)::float8`,
    }).from(checkouts).where(and(
      eq(checkouts.storeId, storeId), eq(checkouts.isVoided, false),
      gte(checkouts.createdAt, start), lte(checkouts.createdAt, end),
    ));

    // Returns against sales that were later voided are excluded: the voided sale's tax is already left out above.
    const returnRows = await db.select({
      id: returnLogs.id,
      method: returnLogs.refundMethod,
      amount: sql<number>`(${returnLogs.refundAmount})::numeric::float8`,
      tax: sql<number>`(${returnLogs.taxRefundAmount})::numeric::float8`,
      createdAt: returnLogs.createdAt,
      receiptNumber: checkouts.receiptNumber,
    }).from(returnLogs)
      .innerJoin(checkouts, eq(checkouts.id, returnLogs.checkoutId))
      .where(and(
        eq(returnLogs.storeId, storeId), eq(checkouts.isVoided, false),
        gte(returnLogs.createdAt, start), lte(returnLogs.createdAt, end),
      ));

    const byMethod = new Map<string, { method: string; count: number; total: number }>();
    let refundTotal = 0;
    let taxRefunded = 0;
    for (const r of returnRows) {
      const row = byMethod.get(r.method) ?? { method: r.method, count: 0, total: 0 };
      row.count += 1;
      row.total += r.amount;
      byMethod.set(r.method, row);
      refundTotal += r.amount;
      taxRefunded += r.tax;
    }
    const cents = (n: number) => Math.round(n * 100) / 100;

    const linked = (await this.listForStore(storeId)).length > 0;
    let bank = { linked, refundsWithoutDebit: [] as { id: string; receiptNumber: string; amount: number; createdAt: Date }[],
      pendingTransfers: { count: 0, total: 0 }, unmatchedCredits: { count: 0, total: 0 } };
    if (linked) {
      const debits = await db.select({
        id: bankTransactions.id,
        amount: sql<number>`(${bankTransactions.amount})::numeric::float8`,
        postedAt: bankTransactions.postedAt,
      }).from(bankTransactions).where(and(
        eq(bankTransactions.storeId, storeId), eq(bankTransactions.direction, "debit"),
        gte(bankTransactions.postedAt, new Date(start.getTime() - REFUND_MATCH_WINDOW_MS)),
        lte(bankTransactions.postedAt, new Date(end.getTime() + REFUND_MATCH_WINDOW_MS)),
      ));
      const transferRefunds = returnRows.filter((r) => r.method === "transfer");
      const missing = refundsWithoutDebit(
        transferRefunds.map((r) => ({ id: r.id, amount: r.amount, createdAt: r.createdAt })), debits);
      const missingIds = new Set(missing.map((m) => m.id));
      bank.refundsWithoutDebit = transferRefunds.filter((r) => missingIds.has(r.id))
        .map((r) => ({ id: r.id, receiptNumber: r.receiptNumber, amount: r.amount, createdAt: r.createdAt }));

      const [pend] = await db.select({
        count: sql<number>`COUNT(*)::int`,
        total: sql<number>`COALESCE(SUM((${salePaymentLegs.amount})::numeric), 0)::float8`,
      }).from(salePaymentLegs)
        .innerJoin(checkouts, eq(checkouts.id, salePaymentLegs.checkoutId))
        .where(and(
          eq(salePaymentLegs.storeId, storeId), eq(salePaymentLegs.confirmationStatus, "pending"),
          eq(salePaymentLegs.method, "transfer"), eq(checkouts.isVoided, false),
          gte(salePaymentLegs.createdAt, start), lte(salePaymentLegs.createdAt, end),
        ));
      bank.pendingTransfers = { count: pend.count, total: cents(pend.total) };

      const [unm] = await db.select({
        count: sql<number>`COUNT(*)::int`,
        total: sql<number>`COALESCE(SUM((${bankTransactions.amount})::numeric), 0)::float8`,
      }).from(bankTransactions).where(and(
        eq(bankTransactions.storeId, storeId), eq(bankTransactions.direction, "credit"), isNull(bankTransactions.matchedLegId),
        gte(bankTransactions.postedAt, start), lte(bankTransactions.postedAt, end),
      ));
      bank.unmatchedCredits = { count: unm.count, total: cents(unm.total) };
    }

    return {
      sales: { lines: sales.lines, subtotal: cents(sales.subtotal), tax: cents(sales.tax), gross: cents(sales.gross) },
      returns: {
        count: returnRows.length, total: cents(refundTotal), tax: cents(taxRefunded),
        byMethod: Array.from(byMethod.values()).map((m) => ({ ...m, total: cents(m.total) })),
      },
      netTax: cents(sales.tax - taxRefunded),
      bank,
    };
  }
}
