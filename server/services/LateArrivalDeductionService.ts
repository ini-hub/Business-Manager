import { db } from "../db";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import {
  payrollPeriods,
  payrollEntries,
  payrollDeductions,
  attendanceRecords,
} from "@shared/schema";
import { storage } from "../storage";

/**
 * Turns a flagged-late day into a visible, forgivable payroll deduction.
 *
 * Mirrors StaffCreditDeductionService and SalaryAdvanceDeductionService's
 * shape — propose on every payroll calculation, re-derive on every sync — but
 * needs neither their allocation cap nor a settle() step: a late charge is not
 * a receivable being recovered from somewhere else, it is a flat amount the
 * business charges for that day, and 0021-era design left it deliberately
 * uncapped (see migration 0038's note on late_deduction_amount). Where it
 * exceeds a staff member's pay for the period, the ordinary mark-paid clamp
 * carries the excess forward on payroll_entries.carryForwardAmount the same
 * way any other deduction type would.
 *
 * One row per (period, staff, late_date) — payroll_deduction_period_late_date_unique
 * is the natural key this upserts against, so the resync that fires on every
 * sale is idempotent, and a manager can forgive a single day without touching
 * any other late day on the payslip.
 */
export class LateArrivalDeductionService {
  /**
   * Rewrites this period's `late_arrival` proposals from the current state of
   * attendance_records.
   *
   * Safe and cheap to call repeatedly — invoked after every payroll
   * calculation and after any manual deduction change. Never touches a waived
   * line (a manager's forgiveness has to survive the recalculation that fires
   * on every sale) or an already-paid period.
   */
  async syncProposals(periodId: string): Promise<void> {
    const [period] = await db.select().from(payrollPeriods).where(eq(payrollPeriods.id, periodId));
    if (!period) return;
    // A paid period is closed: its deductions are locked and must never be rewritten.
    if (period.status === "paid") return;

    const entries = await db.select().from(payrollEntries).where(eq(payrollEntries.periodId, periodId));
    if (entries.length === 0) return;

    const settings = await storage.getSettings(period.storeId);
    const enabled = !!settings?.lateDeductionEnabled;
    const amount = Number(settings?.lateDeductionAmount ?? 0);

    const staffIds = entries.map(e => e.staffId);
    const existing = await db.select().from(payrollDeductions).where(eq(payrollDeductions.periodId, periodId));

    // The charge is switched off, or has no amount: nothing should be proposed.
    // Any live proposal already on the period is stale and must go — a waived
    // line stays, since the manager's decision on it must survive regardless
    // of what the setting does afterwards.
    const lateRows = existing.filter(d => d.type === "late_arrival");
    if (!enabled || amount <= 0) {
      const stale = lateRows.filter(r => !r.isWaived);
      if (stale.length > 0) {
        await db.delete(payrollDeductions).where(inArray(payrollDeductions.id, stale.map(r => r.id)));
      }
      return;
    }

    const lateByStaff = new Map<string, Set<string>>();
    const records = await db.select().from(attendanceRecords).where(and(
      eq(attendanceRecords.storeId, period.storeId),
      inArray(attendanceRecords.staffId, staffIds),
      gte(attendanceRecords.date, period.startDate),
      lte(attendanceRecords.date, period.endDate),
      eq(attendanceRecords.isLate, true),
    ));
    for (const r of records) {
      if (!lateByStaff.has(r.staffId)) lateByStaff.set(r.staffId, new Set());
      lateByStaff.get(r.staffId)!.add(r.date);
    }

    for (const entry of entries) {
      const mine = lateRows.filter(d => d.staffId === entry.staffId);
      const stillLate = lateByStaff.get(entry.staffId) ?? new Set<string>();

      // Rows already waived are fixed points: kept regardless of today's
      // attendance state, and never re-created if forgiven then cleared again.
      const frozen = new Map(mine.filter(r => r.isWaived).map(r => [r.lateDate, r]));

      // A day that is no longer late — corrected by a manager, or forgiven via
      // a retro-request that cleared the flag — drops its proposal. Never a
      // waived row; those are frozen above.
      const stale = mine.filter(r => !r.isWaived && r.lateDate && !stillLate.has(r.lateDate));
      if (stale.length > 0) {
        await db.delete(payrollDeductions).where(inArray(payrollDeductions.id, stale.map(r => r.id)));
      }

      for (const date of Array.from(stillLate)) {
        if (frozen.has(date)) continue;
        const row = mine.find(r => r.lateDate === date && !r.isWaived);
        const label = this.labelFor(date);

        if (row) {
          if (Number(row.amount) !== amount || row.label !== label) {
            await db.update(payrollDeductions)
              .set({ amount, label })
              .where(eq(payrollDeductions.id, row.id));
          }
        } else {
          await db.insert(payrollDeductions).values({
            periodId,
            storeId: period.storeId,
            staffId: entry.staffId,
            type: "late_arrival",
            label,
            amount,
            lateDate: date,
          }).onConflictDoNothing();
        }
      }
    }
  }

  private labelFor(date: string): string {
    return `Late arrival — ${date}`;
  }
}

export const lateArrivalDeductionService = new LateArrivalDeductionService();
