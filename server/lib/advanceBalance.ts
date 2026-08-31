/**
 * Pure arithmetic and policy for salary advances' recovery lifecycle.
 *
 * Mirrors server/lib/creditBalance.ts's shape for credit_entries — kept as
 * its own file for the same reason: no database access, safe to import from
 * anywhere without risking a module-init cycle.
 */
import { storeLocalDate } from "./dateUtils";

/**
 * What an advance's outstanding balance actually is, reconstructed from the
 * real payroll settlement ledger rather than trusted from a snapshot column.
 *
 * The single definition of "what does this advance still owe", used both to
 * settle it going forward and to reinstate the balance when a manual
 * recovery is undone — keeping it in one function is what stops a restore
 * from handing back a different number than what was actually collected.
 */
export function reconstructAdvanceBalance(
  advance: { amount: number },
  recoveredViaPayroll: number,
): { outstandingBalance: number; recoveryStatus: "unrecovered" | "partial" | "recovered" } {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const outstandingBalance = round2(Math.max(0, Number(advance.amount) - Number(recoveredViaPayroll)));

  if (outstandingBalance <= 0) return { outstandingBalance: 0, recoveryStatus: "recovered" };
  const recoveryStatus = recoveredViaPayroll > 0 ? "partial" : "unrecovered";
  return { outstandingBalance, recoveryStatus };
}

/**
 * Whether a manually-recovered advance may still be restored, and why not if
 * it may not.
 *
 * Unlike credit's write-off restore, a manual advance recovery never derives
 * a P&L line of its own — recovery only ever touches cash_out (via
 * payroll_postings), never wage_expense, and a manual override doesn't touch
 * payroll_postings at all. The month restriction here is a narrower,
 * general-purpose one: don't let a financial action from a closed
 * accounting period get quietly rewritten after the fact, matching the
 * "past periods are immutable" discipline this codebase already applies to
 * paid payroll periods and write-off restores.
 */
export function canRestoreManualRecovery(
  advance: { manualRecoveredAt: Date | null },
  opts: { now: Date; timezone: string },
): { allowed: boolean; reason?: string } {
  if (!advance.manualRecoveredAt) {
    return { allowed: false, reason: "This advance was not manually recovered outside payroll." };
  }
  const month = (d: Date) => storeLocalDate(d, opts.timezone).slice(0, 7);
  if (month(advance.manualRecoveredAt) !== month(opts.now)) {
    return {
      allowed: false,
      reason: "This advance was manually recovered in an earlier month. Restoring it now would change a closed accounting period's record after the fact.",
    };
  }
  return { allowed: true };
}
