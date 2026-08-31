import { BaseRepository } from "./BaseRepository";
import { db, type DbExecutor } from "../db";
import {
  creditEntries,
  repayments,
  reminderLogs,
  customers,
  checkouts,
  staff,
  payrollDeductions,
  payrollPeriods,
  type CreditEntry,
  type InsertCreditEntry,
  type Repayment,
  type InsertRepayment,
  type ReminderLog,
  type InsertReminderLog,
} from "@shared/schema";
import { eq, and, gte, lte, or, desc, sql, inArray, asc } from "drizzle-orm";
import { resolveTransactionIdsForCheckouts } from "./TransactionRepository";
import { getStoreTimezone } from "../lib/dateUtils";
import { reconstructBalance, canRestoreWriteOff } from "../lib/creditBalance";

/**
 * The payroll period each of these debts was waived on, if any, and whether it
 * has been paid. Queried here rather than through `storage` because storage
 * constructs this repository — routing it that way would close an import cycle.
 */
export async function staffCreditPeriodStatusFor(
  creditEntryIds: string[],
): Promise<Map<string, { deductionId: string; periodId: string; periodStatus: string }>> {
  if (creditEntryIds.length === 0) return new Map();
  const rows = await db
    .select({
      deductionId: payrollDeductions.id,
      creditEntryId: payrollDeductions.creditEntryId,
      periodId: payrollPeriods.id,
      periodStatus: payrollPeriods.status,
    })
    .from(payrollDeductions)
    .innerJoin(payrollPeriods, eq(payrollDeductions.periodId, payrollPeriods.id))
    .where(inArray(payrollDeductions.creditEntryId, creditEntryIds));

  const byEntry = new Map<string, { deductionId: string; periodId: string; periodStatus: string }>();
  for (const r of rows) {
    if (!r.creditEntryId) continue;
    // A paid period is the binding one: if any period locked this debt, that is
    // what blocks the restore, so it wins over an open one.
    if (byEntry.get(r.creditEntryId)?.periodStatus === "paid") continue;
    byEntry.set(r.creditEntryId, {
      deductionId: r.deductionId, periodId: r.periodId, periodStatus: r.periodStatus,
    });
  }
  return byEntry;
}

export class CreditRepository extends BaseRepository<typeof creditEntries> {
  constructor() {
    super(creditEntries);
  }

  async getCreditSummary(storeId: string): Promise<{
    totalOwed: number;
    totalOwedCount: number;
    totalOverdue: number;
    totalOverdueCount: number;
    totalDueThisWeek: number;
    totalDueThisWeekCount: number;
    totalCollectedThisMonth: number;
  }> {
    const now = new Date();
    const endOfWeek = new Date();
    endOfWeek.setDate(now.getDate() + 7);

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // 1. Total Outstanding (status 'owing' or 'partial')
    const activeCredits = await db
      .select()
      .from(creditEntries)
      .where(
        and(
          eq(creditEntries.storeId, storeId),
          inArray(creditEntries.status, ["owing", "partial", "overdue"])
        )
      );

    let totalOwed = 0;
    let totalOwedCount = 0;
    let totalOverdue = 0;
    let totalOverdueCount = 0;
    let totalDueThisWeek = 0;
    let totalDueThisWeekCount = 0;

    for (const entry of activeCredits) {
      const balance = entry.outstandingBalance;
      if (balance > 0) {
        totalOwed += balance;
        totalOwedCount++;

        // Overdue check
        if (entry.dueDate && new Date(entry.dueDate) < now) {
          totalOverdue += balance;
          totalOverdueCount++;
        }

        // Due this week check
        if (entry.dueDate && new Date(entry.dueDate) >= now && new Date(entry.dueDate) <= endOfWeek) {
          totalDueThisWeek += balance;
          totalDueThisWeekCount++;
        }
      }
    }

    // 2. Collected this month (sum of repayments in current month)
    const monthRepayments = await db
      .select({ amount: repayments.amountReceived })
      .from(repayments)
      .innerJoin(creditEntries, eq(repayments.creditEntryId, creditEntries.id))
      .where(
        and(
          eq(creditEntries.storeId, storeId),
          gte(repayments.createdAt, startOfMonth)
        )
      );

    const totalCollectedThisMonth = monthRepayments.reduce((sum, r) => sum + r.amount, 0);

    return {
      totalOwed,
      totalOwedCount,
      totalOverdue,
      totalOverdueCount,
      totalDueThisWeek,
      totalDueThisWeekCount,
      totalCollectedThisMonth,
    };
  }

  async getCreditLedger(
    storeId: string,
    filters?: {
      status?: string[];
      minOutstanding?: number;
      maxOutstanding?: number;
      customerId?: string;
      search?: string;
      startDate?: string;
      endDate?: string;
    }
  ): Promise<any[]> {
    const conditions = [eq(creditEntries.storeId, storeId)];

    if (filters?.customerId) {
      conditions.push(eq(creditEntries.customerId, filters.customerId));
    }

    if (filters?.status && filters.status.length > 0) {
      conditions.push(inArray(creditEntries.status, filters.status));
    }

    if (filters?.minOutstanding !== undefined) {
      conditions.push(gte(creditEntries.outstandingBalance, filters.minOutstanding));
    }

    if (filters?.maxOutstanding !== undefined) {
      conditions.push(lte(creditEntries.outstandingBalance, filters.maxOutstanding));
    }

    if (filters?.startDate) {
      conditions.push(gte(creditEntries.createdAt, new Date(filters.startDate)));
    }

    if (filters?.endDate) {
      conditions.push(lte(creditEntries.createdAt, new Date(filters.endDate)));
    }

    const rows = await db
      .select({
        credit: creditEntries,
        customer: customers,
        checkout: checkouts,
      })
      .from(creditEntries)
      .innerJoin(customers, eq(creditEntries.customerId, customers.id))
      .leftJoin(checkouts, eq(creditEntries.linkedTransactionId, checkouts.id))
      .where(and(...conditions))
      .orderBy(desc(creditEntries.createdAt));

    const txIdByCheckout = await resolveTransactionIdsForCheckouts(
      rows.map((r) => r.checkout?.id).filter((id): id is string => !!id)
    );

    let mapped = rows.map((r) => ({
      ...r.credit,
      customer: {
        name: r.customer.name,
        customerNumber: r.customer.customerNumber,
        phone: r.customer.mobileNumber,
        // Marks the debtor as a staff member, so the Borrow Book can show that
        // this debt is recoverable from payroll rather than chased for cash.
        staffId: r.customer.staffId,
      },
      receiptNumber: r.checkout?.receiptNumber || null,
      transactionId: r.checkout ? txIdByCheckout.get(r.checkout.id) ?? null : null,
    }));

    // Filter by search keyword on customer name or phone if supplied
    if (filters?.search) {
      const q = filters.search.toLowerCase();
      mapped = mapped.filter(
        (m) =>
          m.customer.name.toLowerCase().includes(q) ||
          (m.customer.phone && m.customer.phone.includes(q))
      );
    }

    // Auto-compute overdue status for the returned list
    const now = new Date();
    const overdueIds: string[] = [];
    for (const item of mapped) {
      if (
        (item.status === "owing" || item.status === "partial") &&
        item.dueDate &&
        new Date(item.dueDate) < now
      ) {
        item.status = "overdue";
        overdueIds.push(item.id);
      }
    }

    if (overdueIds.length > 0) {
      // Persist the computed status out-of-band, batched in one statement — don't block this read on it.
      db.update(creditEntries)
        .set({ status: "overdue" })
        .where(inArray(creditEntries.id, overdueIds))
        .catch((err) => console.error("Failed to persist overdue credit status:", err));
    }

    const entryIds = mapped.map((item) => item.id);
    const repaymentTotals = entryIds.length > 0
      ? await db
          .select({
            creditEntryId: repayments.creditEntryId,
            total: sql<number>`sum(${repayments.amountReceived})`,
          })
          .from(repayments)
          .where(inArray(repayments.creditEntryId, entryIds))
          .groupBy(repayments.creditEntryId)
      : [];

    const repaidByEntry = new Map(
      repaymentTotals.map((r) => [r.creditEntryId, parseFloat(String(r.total || 0))])
    );

    // Whether each written-off row can still be undone, resolved here so the
    // Borrow Book can grey out the ones it cannot and say why, rather than the
    // action silently vanishing. Only written-off rows need the payroll lookup.
    const writtenOffIds = mapped.filter(m => m.status === "written_off").map(m => m.id);
    const linkedByEntry = await staffCreditPeriodStatusFor(writtenOffIds);
    const tz = await getStoreTimezone(storeId);

    return mapped.map((item) => {
      const guard = item.status === "written_off"
        ? canRestoreWriteOff(item, {
            now, timezone: tz, linkedPeriodStatus: linkedByEntry.get(item.id)?.periodStatus,
          })
        : { allowed: false, reason: undefined };
      return {
        ...item,
        totalRepayments: repaidByEntry.get(item.id) || 0,
        canRestore: guard.allowed,
        restoreBlockedReason: guard.allowed ? null : guard.reason ?? null,
      };
    });
  }

  async createCreditEntry(data: InsertCreditEntry): Promise<CreditEntry> {
    const [inserted] = await db.insert(creditEntries).values(data).returning();
    return inserted;
  }

  /**
   * Writes a repayment and rolls the debt's balance/status forward.
   *
   * Takes an executor so the payroll settlement path can run this inside the
   * mark-paid transaction while the ordinary "customer walked in and paid"
   * path runs it standalone — both share one implementation of the arithmetic
   * rather than each recomputing outstanding balance and status.
   */
  async applyRepayment(exec: DbExecutor, data: InsertRepayment): Promise<Repayment> {
    const [inserted] = await exec.insert(repayments).values(data).returning();

    // Fetch the linked entry to adjust balance
    const [entry] = await exec
      .select()
      .from(creditEntries)
      .where(eq(creditEntries.id, data.creditEntryId));

    if (entry) {
      const nextOutstanding = Math.max(0, entry.outstandingBalance - data.amountReceived);
      const nextStatus = nextOutstanding <= 0 ? "settled" : "partial";

      await exec
        .update(creditEntries)
        .set({
          outstandingBalance: nextOutstanding,
          status: nextStatus,
          updatedAt: new Date(),
        })
        .where(eq(creditEntries.id, entry.id));
    }

    return inserted;
  }

  async createRepayment(data: InsertRepayment): Promise<Repayment> {
    return this.applyRepayment(db, data);
  }

  /**
   * Open debt owed by a given set of customer profiles, for the payroll sweep.
   *
   * Scoped by storeId on purpose: customers.staff_id carries no FK and no
   * store guard, so a stale or cross-store link must not pull another store's
   * debt into this store's payroll.
   *
   * Voided checkouts are excluded. voidCheckout() does not currently touch the
   * linked credit entry, so without this filter a voided sale's debt would
   * still be garnished from a salary.
   *
   * Ordered oldest-first so limited pay recovers the most-aged debt.
   */
  async getOpenEntriesForCustomers(
    storeId: string,
    customerIds: string[],
    asOfUtc: Date,
  ): Promise<CreditEntry[]> {
    if (customerIds.length === 0) return [];

    const rows = await db
      .select({ entry: creditEntries })
      .from(creditEntries)
      .leftJoin(checkouts, eq(creditEntries.linkedTransactionId, checkouts.id))
      .where(
        and(
          eq(creditEntries.storeId, storeId),
          inArray(creditEntries.customerId, customerIds),
          inArray(creditEntries.status, ["owing", "partial", "overdue"]),
          sql`${creditEntries.outstandingBalance} > 0`,
          lte(creditEntries.createdAt, asOfUtc),
          or(sql`${checkouts.id} IS NULL`, eq(checkouts.isVoided, false)),
        )
      )
      .orderBy(asc(creditEntries.createdAt));

    return rows.map(r => r.entry);
  }

  async writeOffDebt(id: string, reason: string): Promise<CreditEntry | undefined> {
    const [updated] = await db
      .update(creditEntries)
      .set({
        status: "written_off",
        writeOffReason: reason,
        outstandingBalance: 0,
        updatedAt: new Date(),
      })
      .where(eq(creditEntries.id, id))
      .returning();
    return updated;
  }

  /**
   * Undoes a write-off, putting the debt back the way it was.
   *
   * Possible only because `writeOffDebt` zeroes `outstanding_balance` but leaves
   * `amount_owed` and `amount_paid_upfront` alone, and repayments live in their
   * own rows — so nothing about the original position is actually lost.
   *
   * Bad debt is derived, never journaled: the P&L computes it on the fly from
   * `status = 'written_off'` (AnalyticsService.getWrittenOffBadDebtTotal), so
   * flipping the status back removes the expense with no reversing entry. That
   * is also why the caller must check the write-off is still in the current
   * month — see canRestoreWriteOff.
   */
  async restoreWrittenOffDebt(id: string): Promise<CreditEntry | undefined> {
    const [entry] = await db.select().from(creditEntries).where(eq(creditEntries.id, id));
    if (!entry) return undefined;

    const [repaid] = await db
      .select({ total: sql<number>`COALESCE(SUM(${repayments.amountReceived}), 0)` })
      .from(repayments)
      .where(eq(repayments.creditEntryId, id));

    const { balance, status } = reconstructBalance(entry, Number(repaid?.total ?? 0));

    const [updated] = await db
      .update(creditEntries)
      .set({
        status,
        writeOffReason: null,
        outstandingBalance: balance,
        updatedAt: new Date(),
      })
      .where(eq(creditEntries.id, id))
      .returning();
    return updated;
  }

  async getRepayments(creditEntryId: string): Promise<any[]> {
    const rows = await db
      .select({
        repayment: repayments,
        staff: staff,
        deduction: payrollDeductions,
      })
      .from(repayments)
      .leftJoin(staff, eq(repayments.recordedByStaffId, staff.id))
      // A repayment withheld from salary was written by payroll settlement and
      // is pointed at by the deduction line that recovered it. Carrying the
      // period back here lets the Borrow Book link to the payslip it came off,
      // which is the reverse of the receipt link on the payslip itself.
      .leftJoin(payrollDeductions, eq(payrollDeductions.repaymentId, repayments.id))
      .where(eq(repayments.creditEntryId, creditEntryId))
      .orderBy(asc(repayments.createdAt));

    return rows.map((r) => ({
      ...r.repayment,
      recordedBy: r.staff?.name || "System/Owner",
      payrollPeriodId: r.deduction?.periodId ?? null,
      payrollStaffId: r.deduction?.staffId ?? null,
    }));
  }

  async getReminderLogs(creditEntryId: string): Promise<ReminderLog[]> {
    return db
      .select()
      .from(reminderLogs)
      .where(eq(reminderLogs.creditEntryId, creditEntryId))
      .orderBy(desc(reminderLogs.createdAt));
  }

  async logReminder(data: InsertReminderLog): Promise<ReminderLog> {
    const [inserted] = await db.insert(reminderLogs).values(data).returning();
    return inserted;
  }

  async getBorrowBookReport(
    storeId: string,
    startDate?: string,
    endDate?: string
  ): Promise<{
    totalExtended: number;
    totalCollected: number;
    collectionRate: number;
    totalWrittenOff: number;
    aging: {
      zeroToSeven: number;
      eightToThirty: number;
      thirtyOneToSixty: number;
      sixtyPlus: number;
    };
    topOwing: any[];
  }> {
    const conditions = [eq(creditEntries.storeId, storeId)];
    if (startDate) conditions.push(gte(creditEntries.createdAt, new Date(startDate)));
    if (endDate) conditions.push(lte(creditEntries.createdAt, new Date(endDate)));

    const entries = await db.select().from(creditEntries).where(and(...conditions));

    let totalExtended = 0;
    let totalWrittenOff = 0;
    let outstandingTotal = 0;

    const aging = {
      zeroToSeven: 0,
      eightToThirty: 0,
      thirtyOneToSixty: 0,
      sixtyPlus: 0,
    };

    const now = new Date();

    for (const entry of entries) {
      totalExtended += entry.amountOwed;
      if (entry.status === "written_off") {
        totalWrittenOff += entry.amountOwed - entry.amountPaidUpfront; // or whatever was outstanding at write-off
      } else if (entry.status !== "settled" && entry.status !== "void") {
        const bal = entry.outstandingBalance;
        outstandingTotal += bal;

        // Calculate age
        const ageInMs = now.getTime() - new Date(entry.createdAt).getTime();
        const ageInDays = Math.floor(ageInMs / (1000 * 60 * 60 * 24));

        if (ageInDays <= 7) aging.zeroToSeven += bal;
        else if (ageInDays <= 30) aging.eightToThirty += bal;
        else if (ageInDays <= 60) aging.thirtyOneToSixty += bal;
        else aging.sixtyPlus += bal;
      }
    }

    // Sum of collections in period
    const repaymentConditions = [eq(creditEntries.storeId, storeId)];
    if (startDate) repaymentConditions.push(gte(repayments.createdAt, new Date(startDate)));
    if (endDate) repaymentConditions.push(lte(repayments.createdAt, new Date(endDate)));

    const collections = await db
      .select({ amount: repayments.amountReceived })
      .from(repayments)
      .innerJoin(creditEntries, eq(repayments.creditEntryId, creditEntries.id))
      .where(and(...repaymentConditions));

    const totalCollected = collections.reduce((sum, c) => sum + c.amount, 0);

    const collectionRate = totalExtended > 0 ? (totalCollected / totalExtended) * 100 : 100;

    // Top owing customers
    const owingRows = await db
      .select({
        credit: creditEntries,
        customer: customers,
      })
      .from(creditEntries)
      .innerJoin(customers, eq(creditEntries.customerId, customers.id))
      .where(
        and(
          eq(creditEntries.storeId, storeId),
          inArray(creditEntries.status, ["owing", "partial", "overdue"])
        )
      );

    // Group outstanding balances by customer
    const customerMap: Record<string, { name: string; phone: string; balance: number }> = {};
    for (const r of owingRows) {
      const cId = r.customer.id;
      if (!customerMap[cId]) {
        customerMap[cId] = {
          name: r.customer.name,
          phone: r.customer.mobileNumber || "",
          balance: 0,
        };
      }
      customerMap[cId].balance += r.credit.outstandingBalance;
    }

    const topOwing = Object.values(customerMap)
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 5);

    return {
      totalExtended,
      totalCollected,
      collectionRate,
      totalWrittenOff,
      aging,
      topOwing,
    };
  }
}
