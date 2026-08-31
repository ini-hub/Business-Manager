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
import { eq, and, desc, sql } from "drizzle-orm";
import { payrollService } from "../services/PayrollService";

export class PayrollRepository {
  async getPayrollPeriods(storeId: string): Promise<PayrollPeriod[]> {
    return await db.select().from(payrollPeriods)
      .where(eq(payrollPeriods.storeId, storeId))
      .orderBy(desc(payrollPeriods.createdAt));
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
