/**
 * The one definition of what a staff member actually gets handed.
 *
 * `payroll_entries.net_pay` is a *pre-deduction* figure despite its name — it
 * is base + attendance + commission, computed before a single deduction is
 * applied. The money that leaves the business is what survives the deductions,
 * floored at zero per person: one staff member's surplus can never absorb
 * another's shortfall, and a deduction bigger than the pay does not create a
 * negative payment, it creates a carry-forward.
 *
 * That split was previously re-derived in five places with three different
 * answers — the settlement close and the posting ledger floored it, the payroll
 * UI did not, so a screen could show a negative take-home for a period the
 * business paid ₦0 on. Everything now reads it from here.
 *
 * Vocabulary, matching the PDF payslip and the public verify page:
 *   grossPay   the pre-deduction figure stored as net_pay
 *   netPay /
 *   takeHomePay what is actually paid out — max(0, gross − deductions)
 *   shortfall   the deductions that pay could not cover, which carry forward
 */

/** Money is numeric(12,2); keep all of this arithmetic on that grid. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type PaySplit = {
  /** Pre-deduction earnings — `payroll_entries.net_pay`. */
  grossPay: number;
  /** Sum of the deductions that apply (waived lines excluded by the caller). */
  deductionsTotal: number;
  /** What is actually paid out: max(0, gross − deductions). */
  takeHomePay: number;
  /** Deductions pay could not cover: max(0, deductions − gross). Carries forward. */
  shortfall: number;
};

export function splitPay(grossPay: number, deductionsTotal: number): PaySplit {
  const gross = round2(Number(grossPay) || 0);
  const deducted = round2(Number(deductionsTotal) || 0);
  return {
    grossPay: gross,
    deductionsTotal: deducted,
    takeHomePay: round2(Math.max(0, gross - deducted)),
    shortfall: round2(Math.max(0, deducted - gross)),
  };
}

/**
 * Totals deduction rows per staff member.
 *
 * Takes the rows rather than a period id so the caller controls whether waived
 * lines are in scope — `storage.getPayrollDeductions` already excludes them by
 * default, which is the behaviour every consumer here wants.
 */
export function deductionsByStaff(rows: { staffId: string; amount: number | string }[]): Map<string, number> {
  const byStaff = new Map<string, number>();
  for (const row of rows) {
    byStaff.set(row.staffId, round2((byStaff.get(row.staffId) ?? 0) + Number(row.amount)));
  }
  return byStaff;
}

/**
 * The per-staff split for a whole period, plus the period totals.
 *
 * `totalTakeHome` is the cash the payer hands out — the same figure the
 * mark-paid close reports and the posting ledger books as cash_out.
 */
export function splitPeriod(
  entries: { staffId: string; netPay: number | null }[],
  deductionRows: { staffId: string; amount: number | string }[],
): {
  byStaff: Map<string, PaySplit>;
  totalGross: number;
  totalDeductions: number;
  totalTakeHome: number;
  totalShortfall: number;
} {
  const deducted = deductionsByStaff(deductionRows);
  const byStaff = new Map<string, PaySplit>();
  let totalGross = 0, totalDeductions = 0, totalTakeHome = 0, totalShortfall = 0;

  for (const entry of entries) {
    const split = splitPay(entry.netPay || 0, deducted.get(entry.staffId) ?? 0);
    byStaff.set(entry.staffId, split);
    totalGross = round2(totalGross + split.grossPay);
    totalDeductions = round2(totalDeductions + split.deductionsTotal);
    totalTakeHome = round2(totalTakeHome + split.takeHomePay);
    totalShortfall = round2(totalShortfall + split.shortfall);
  }

  return { byStaff, totalGross, totalDeductions, totalTakeHome, totalShortfall };
}
