import { db } from "../db";
import {
  payrollPeriods,
  payrollEntries,
  staff,
  type PayrollPeriod,
  type InsertPayrollPeriod,
  type PayrollPeriodStatus,
  type PayrollEntryWithStaff,
  type DailySummaryLine,
  type CommissionBreakdown,
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

  async updatePayrollPeriodStatus(id: string, status: PayrollPeriodStatus, userId?: string): Promise<PayrollPeriod | undefined> {
    const setData: Partial<PayrollPeriod> = { status };
    if (status === "approved") {
      setData.approvedByUserId = userId;
      setData.approvedAt = new Date();
    }
    if (status === "paid") {
      setData.paidAt = new Date();

      const period = await this.getPayrollPeriod(id);
      if (!period) throw new Error("Period not found");

      const overlaps = await db.select()
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
    const [updated] = await db.update(payrollPeriods).set(setData).where(eq(payrollPeriods.id, id)).returning();
    return updated;
  }

  async deletePayrollPeriod(id: string): Promise<boolean> {
    const period = await this.getPayrollPeriod(id);
    if (!period) return false;

    if (period.status === "paid") {
      throw new Error("You cannot delete a payroll period that has already been marked as Paid.");
    }

    await db.transaction(async (tx) => {
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
}
