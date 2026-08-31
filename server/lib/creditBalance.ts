/**
 * Pure arithmetic and policy for credit entries.
 *
 * Lives apart from CreditRepository because `storage` constructs that
 * repository, and the repository reaches TransactionRepository which reaches
 * storage back — importing these from there would close that cycle and break
 * module init. Nothing here touches the database.
 */
import { storeLocalDate } from "./dateUtils";

/**
 * What a credit entry's position is, derived purely from the amounts that
 * survive a write-off.
 *
 * This is the single definition of "what is this debt actually worth", used
 * both to value a write-off for the P&L (AnalyticsService) and to reinstate the
 * balance when one is undone. Keeping it in one function is what stops a
 * restore from handing back a different number than the one the P&L expensed.
 *
 * `overdue` is deliberately not produced here: the ledger read promotes
 * owing/partial to overdue on the way out, off the due date.
 */
export function reconstructBalance(
  entry: { amountOwed: number; amountPaidUpfront: number },
  repaid: number,
): { balance: number; status: "settled" | "partial" | "owing" } {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const owed = round2(Number(entry.amountOwed) - Number(entry.amountPaidUpfront));
  const balance = round2(Math.max(0, owed - Number(repaid)));

  if (balance <= 0) return { balance: 0, status: "settled" };
  // Anything already paid — at the counter or upfront at checkout — makes this
  // a part-paid debt rather than an untouched one.
  const status = repaid > 0 || Number(entry.amountPaidUpfront) > 0 ? "partial" : "owing";
  return { balance, status };
}

/**
 * Whether a written-off debt may still be restored, and why not if it may not.
 *
 * Two guards, each protecting its own thing:
 *
 *  - The write-off must still be in the CURRENT store-local month. Bad debt is
 *    dated by `updated_at`, so restoring bumps it to now and the expense
 *    silently leaves whatever month it was reported in. Confining restores to
 *    the open month means no already-reported P&L can change under anyone.
 *  - If the debt was recovered through payroll, that period must not be `paid`.
 *    A settled period's deductions are locked — every other payroll route
 *    refuses them too.
 *
 * Returns the reason rather than a bare false so the API and the greyed-out
 * menu item say the same sentence.
 */
export function canRestoreWriteOff(
  entry: { status: string; updatedAt: Date },
  opts: { now: Date; timezone: string; linkedPeriodStatus?: string | null },
): { allowed: boolean; reason?: string } {
  if (entry.status !== "written_off") {
    return { allowed: false, reason: "This debt is not written off." };
  }
  const month = (d: Date) => storeLocalDate(d, opts.timezone).slice(0, 7);
  if (month(entry.updatedAt) !== month(opts.now)) {
    return {
      allowed: false,
      reason: "This debt was written off in an earlier month. Restoring it would change a profit & loss figure that has already been reported.",
    };
  }
  if (opts.linkedPeriodStatus === "paid") {
    return {
      allowed: false,
      reason: "The payroll period that waived this debt has been paid and locked.",
    };
  }
  return { allowed: true };
}
