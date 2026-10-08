import { db, type DbExecutor } from "../db";
import {
  payrollPeriods,
  payrollEntries,
  payrollDeductions,
  payrollDisbursements,
  payslipRecords,
  salaryAdvances,
  staff,
  stores,
  type PayrollPeriod,
  type InsertPayrollPeriod,
  type PayrollPeriodStatus,
  type PayrollEntryWithStaff,
  type DailySummaryLine,
  type CommissionBreakdown,
  type PayslipRecord,
} from "@shared/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { payrollService } from "../services/PayrollService";

export class PayrollRepository {
  async getPayrollPeriods(storeId: string): Promise<PayrollPeriod[]> {
    return await db.select().from(payrollPeriods)
      .where(eq(payrollPeriods.storeId, storeId))
      .orderBy(desc(payrollPeriods.createdAt));
  }

  /** The store's current approved-or-pending period, newest first (what the staff dashboard shows). */
  async getOpenPayrollPeriod(storeId: string): Promise<PayrollPeriod | undefined> {
    const [period] = await db.select().from(payrollPeriods)
      .where(and(eq(payrollPeriods.storeId, storeId), inArray(payrollPeriods.status, ["approved", "pending"])))
      .orderBy(desc(payrollPeriods.createdAt))
      .limit(1);
    return period;
  }

  /** The store's paid periods, newest first. */
  async getPaidPayrollPeriods(storeId: string): Promise<PayrollPeriod[]> {
    return await db.select().from(payrollPeriods)
      .where(and(eq(payrollPeriods.storeId, storeId), eq(payrollPeriods.status, "paid")))
      .orderBy(desc(payrollPeriods.createdAt));
  }

  /** One person's entry in one period (the full row), without loading everyone else's. */
  async getPayrollEntryForStaff(periodId: string, staffId: string) {
    const [entry] = await db.select().from(payrollEntries)
      .where(and(eq(payrollEntries.periodId, periodId), eq(payrollEntries.staffId, staffId)));
    return entry;
  }

  /** One person's net pay in each of the given periods. */
  async getNetPayForStaff(staffId: string, periodIds: string[]): Promise<Map<string, number>> {
    if (periodIds.length === 0) return new Map();
    const rows = await db.select({ periodId: payrollEntries.periodId, netPay: payrollEntries.netPay })
      .from(payrollEntries)
      .where(and(eq(payrollEntries.staffId, staffId), inArray(payrollEntries.periodId, periodIds)));
    return new Map(rows.map((r) => [r.periodId, r.netPay || 0]));
  }

  /** One person's non-waived deductions summed per period, by the database. */
  async getDeductionTotalsForStaff(staffId: string, periodIds: string[]): Promise<Map<string, number>> {
    if (periodIds.length === 0) return new Map();
    const rows = await db
      .select({ periodId: payrollDeductions.periodId, total: sql<number>`COALESCE(SUM(${payrollDeductions.amount}), 0)::float8` })
      .from(payrollDeductions)
      .where(and(eq(payrollDeductions.staffId, staffId), eq(payrollDeductions.isWaived, false), inArray(payrollDeductions.periodId, periodIds)))
      .groupBy(payrollDeductions.periodId);
    return new Map(rows.map((r) => [r.periodId, r.total]));
  }

  /**
   * Narrow per-person rows for several periods at once: just what a period total needs (no staff join, no
   * calculation JSON). Entries keep the "highest net pay first" order the per-period reads use, so totals
   * accumulate in the same order as before. Waived deductions are excluded, as in getPayrollDeductions.
   */
  async getPeriodSummaryInputs(periodIds: string[]) {
    if (periodIds.length === 0) return { entries: [], deductions: [] };
    const [entries, deductions] = await Promise.all([
      db.select({
        periodId: payrollEntries.periodId,
        staffId: payrollEntries.staffId,
        grossCommission: payrollEntries.grossCommission,
        totalTransport: payrollEntries.totalTransport,
        netPay: payrollEntries.netPay,
      }).from(payrollEntries).where(inArray(payrollEntries.periodId, periodIds)).orderBy(desc(payrollEntries.netPay)),
      db.select({
        periodId: payrollDeductions.periodId,
        staffId: payrollDeductions.staffId,
        amount: payrollDeductions.amount,
      }).from(payrollDeductions).where(and(inArray(payrollDeductions.periodId, periodIds), eq(payrollDeductions.isWaived, false))),
    ]);
    return { entries, deductions };
  }

  async getPayrollPeriod(id: string): Promise<PayrollPeriod | undefined> {
    const [period] = await db.select().from(payrollPeriods).where(eq(payrollPeriods.id, id));
    return period;
  }

  async createPayrollPeriod(data: InsertPayrollPeriod): Promise<PayrollPeriod> {
    const [period] = await db.insert(payrollPeriods).values(data).returning();
    return period;
  }

  /**
   * `exec` lets the mark-paid close (PayrollSettlementService) run this inside
   * the same transaction as the ledger posting, so a crash between the two can
   * never leave a posted-but-not-paid period behind. Ordinary callers omit it
   * and get the pool directly, same as before.
   */
  async updatePayrollPeriodStatus(id: string, status: PayrollPeriodStatus, userId?: string, exec: DbExecutor = db): Promise<PayrollPeriod | undefined> {
    const setData: Partial<PayrollPeriod> = { status };
    if (status === "approved") {
      setData.approvedByUserId = userId;
      setData.approvedAt = new Date();
    }
    if (status === "paid") {
      setData.paidAt = new Date();

      const [period] = await exec.select().from(payrollPeriods).where(eq(payrollPeriods.id, id));
      if (!period) throw new Error("Period not found");

      const overlaps = await exec.select()
        .from(payrollPeriods)
        .where(and(
          eq(payrollPeriods.storeId, period.storeId),
          eq(payrollPeriods.status, "paid"),
          sql`${payrollPeriods.id} != ${id}`,
          sql`(${payrollPeriods.startDate}::DATE, ${payrollPeriods.endDate}::DATE) OVERLAPS (${period.startDate}::DATE, ${period.endDate}::DATE)`
        ));

      if (overlaps.length > 0) {
        throw new Error(`This period overlaps with an existing Paid period: ${overlaps[0].startDate} to ${overlaps[0].endDate}`);
      }
    }
    const [updated] = await exec.update(payrollPeriods).set(setData).where(eq(payrollPeriods.id, id)).returning();
    return updated;
  }

  async deletePayrollPeriod(id: string): Promise<boolean> {
    const period = await this.getPayrollPeriod(id);
    if (!period) return false;

    if (period.status === "paid") {
      throw new Error("You cannot delete a payroll period that has already been marked as Paid.");
    }

    await db.transaction(async (tx) => {
      await tx.update(salaryAdvances).set({ recoveredPeriodId: null }).where(eq(salaryAdvances.recoveredPeriodId, id));
      await tx.delete(payslipRecords).where(eq(payslipRecords.periodId, id));
      await tx.delete(payrollDeductions).where(eq(payrollDeductions.periodId, id));
      await tx.delete(payrollDisbursements).where(eq(payrollDisbursements.periodId, id));
      await tx.delete(payrollEntries).where(eq(payrollEntries.periodId, id));
      await tx.delete(payrollPeriods).where(eq(payrollPeriods.id, id));
    });

    return true;
  }

  async getPayrollEntries(periodId: string): Promise<PayrollEntryWithStaff[]> {
    const rows = await db.select({
      entry: payrollEntries,
      staffMember: staff,
    })
      .from(payrollEntries)
      .leftJoin(staff, eq(payrollEntries.staffId, staff.id))
      .where(eq(payrollEntries.periodId, periodId))
      .orderBy(desc(payrollEntries.netPay));

    return rows.map(r => ({ ...r.entry, staff: r.staffMember! }));
  }

  async calculatePayrollForPeriod(periodId: string): Promise<PayrollEntryWithStaff[]> {
    return await payrollService.calculatePayrollForPeriod(periodId);
  }

  async getPayrollDrillDown(periodId: string, staffId: string): Promise<{
    dailySummary: DailySummaryLine[];
    transactions: CommissionBreakdown[];
  }> {
    return await payrollService.getPayrollDrillDown(periodId, staffId);
  }

  async getPaidPayrollExpenses(storeId: string, startDate?: string, endDate?: string): Promise<{ label: string; amount: number }[]> {
    const { ExpenseRepository } = await import("./ExpenseRepository");
    const expenseRepo = new ExpenseRepository();
    return expenseRepo.getPaidPayrollExpenses(storeId, startDate, endDate);
  }

  async registerPayslip(data: {
    storeId: string;
    periodId: string;
    staffId: string;
    generatedByUserId?: string;
    grossPay: number;
    netPay: number;
  }): Promise<PayslipRecord> {
    const [record] = await db.insert(payslipRecords).values(data).returning();
    return record;
  }

  async getPayslipRecord(id: string): Promise<(PayslipRecord & {
    staff: { name: string; staffNumber: string } | null;
    store: { name: string } | null;
    period: { startDate: string; endDate: string } | null;
  }) | undefined> {
    const [row] = await db.select({
      record: payslipRecords,
      staffMember: staff,
      store: stores,
      period: payrollPeriods,
    })
      .from(payslipRecords)
      .leftJoin(staff, eq(payslipRecords.staffId, staff.id))
      .leftJoin(stores, eq(payslipRecords.storeId, stores.id))
      .leftJoin(payrollPeriods, eq(payslipRecords.periodId, payrollPeriods.id))
      .where(eq(payslipRecords.id, id));

    if (!row) return undefined;
    return {
      ...row.record,
      staff: row.staffMember ? { name: row.staffMember.name, staffNumber: row.staffMember.staffNumber } : null,
      store: row.store ? { name: row.store.name } : null,
      period: row.period ? { startDate: row.period.startDate, endDate: row.period.endDate } : null,
    };
  }
}
