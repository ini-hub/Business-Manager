import { db } from "../db";
import { eq } from "drizzle-orm";
import { payrollEntries, type PayrollPeriod } from "@shared/schema";
import { storage } from "../storage";
import { staffCreditDeductionService } from "./StaffCreditDeductionService";
import { salaryAdvanceDeductionService } from "./SalaryAdvanceDeductionService";
import { lateArrivalDeductionService } from "./LateArrivalDeductionService";
import { payrollPostingService } from "./PayrollPostingService";
import { splitPeriod } from "@shared/payroll-take-home";

export type MarkPaidResult = {
  period: PayrollPeriod | undefined;
  /** Cash actually leaving the business: sum of max(0, netPay − deductions). */
  totalAmount: number;
};

/**
 * Closing a payroll period.
 *
 * Extracted from the route handler so the sequence can be exercised directly by
 * the integration suite — the ordering here is load-bearing and worth pinning:
 * re-sync, then settle, then total from what settlement actually wrote.
 */
export class PayrollSettlementService {
  async markPeriodPaid(periodId: string, userId?: string): Promise<MarkPaidResult> {
    const period = await storage.getPayrollPeriod(periodId);
    if (!period) throw new Error("Payroll period not found.");

    const entries = await storage.getPayrollEntries(periodId);

    // Late-arrival re-syncs first — it outranks everything below it in
    // DEDUCTION_PRIORITY, and advance_recovery's and staff_credit's own headroom
    // calcs read whatever is already on the period. No settle() step: it isn't
    // a receivable recovered from elsewhere, just a flat charge already final
    // once written, so a sync immediately before posting is enough.
    await lateArrivalDeductionService.syncProposals(periodId);

    // Advances settle first — advance_recovery outranks staff_credit in
    // DEDUCTION_PRIORITY, and staff credit's headroom calc reads whatever
    // advance_recovery amount is on the period. Re-sync immediately before
    // settling: an advance may have been rejected or manually recovered since
    // the manager approved the period. `settle` owns its own transaction, so a
    // failure there cannot leave a salary docked for a stale figure.
    await salaryAdvanceDeductionService.syncProposals(periodId);
    await salaryAdvanceDeductionService.settle(periodId);

    // Re-clamp the proposals against current state first: a debt may have been
    // paid down in cash since the manager approved the period, and settling the
    // stale figure would recover more than is owed. Then convert each surviving
    // line into a real repayment. `settle` owns its own transaction, so a
    // failure there cannot leave a salary docked for a still-open debt; the
    // re-sync sits outside it because proposals are advisory and re-derived.
    await staffCreditDeductionService.syncProposals(periodId);
    await staffCreditDeductionService.settle(periodId);

    // Read AFTER settlement: settle() clamps amounts down to what was actually
    // recoverable. Waived lines are excluded by the accessor's default.
    const allDeductions = await storage.getPayrollDeductions(periodId);

    // The CASH figure, carried by the mirror expense below. The P&L recognises
    // wages at raw netPay instead and skips this row, because a deduction
    // settles a receivable rather than reducing the cost of the wage.
    const { byStaff, totalTakeHome: totalAmount } = splitPeriod(entries, allDeductions);

    // Post the run to the payroll ledger, flip the status, and write the
    // carry-forward figures as one transaction. All three used to be separate
    // calls: a crash between the posting write and the status flip left
    // paid-shaped postings sitting under a period still reading "approved" —
    // still open to deduction edits, which would then silently disagree with
    // the ledger until someone retried mark-paid. One transaction means either
    // the whole close lands or none of it does, and the period stays approved
    // for a clean retry either way.
    const updated = await db.transaction(async (tx) => {
      await payrollPostingService.postPeriod(tx, periodId);
      const period = await storage.updatePayrollPeriodStatus(periodId, "paid", userId, tx);

      // Carry forward any deduction the period could not cover. Staff credit
      // never contributes: it is allocated against available pay, so it floors
      // take-home at zero rather than driving it negative.
      for (const entry of entries) {
        const shortfall = byStaff.get(entry.staffId)?.shortfall ?? 0;
        if (shortfall > 0) {
          await tx.update(payrollEntries)
            .set({ carryForwardAmount: shortfall })
            .where(eq(payrollEntries.id, entry.id));
        }
      }

      return period;
    });

    return { period: updated, totalAmount };
  }

}

export const payrollSettlementService = new PayrollSettlementService();
