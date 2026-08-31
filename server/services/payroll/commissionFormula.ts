/**
 * The commission arithmetic, on its own.
 *
 * Extracted from PayrollService's formula switch, where the same
 * `Math.max(0, revenue - deduction) * rate` was written out four times amid the
 * audit-trail narration. The narration stays with the caller; only the money
 * moves here, so it can be tested directly — this is the calculation that
 * decides what people are paid, and it had no coverage at all.
 *
 * What the formulas differ on is one thing: how much of the transport already
 * paid out during the period is treated as an advance against commission.
 *   A  every present day at the active rate
 *   B  active + passive transport as actually paid
 *   C  B, plus paid leave and holiday
 *   D  nothing — commission on the full revenue share
 *   F  no revenue at all; a flat amount per service worked
 * Anything unrecognised falls back to B, which is the store default.
 */

export interface CommissionFormulaInputs {
  /** The staff member's share of service revenue — the commission base. */
  serviceRevenueContribution: number;
  serviceCountWorked: number;
  commissionRate: number;
  commissionFixedAmount: number;
  activeDays: number;
  passiveDays: number;
  activeDayRate: number;
  activePay: number;
  passivePay: number;
  leavePay: number;
  holidayPay: number;
}

export interface CommissionFormulaResult {
  /** Transport treated as an advance against commission. */
  attendanceDeduction: number;
  /** What the rate is applied to. Negative means transport outran revenue. */
  commissionableRevenue: number;
  grossCommission: number;
}

/** Transport offset against commission, per formula. */
export function attendanceDeductionFor(formula: string, i: CommissionFormulaInputs): number {
  switch (formula) {
    case "formula_a": return (i.activeDays + i.passiveDays) * i.activeDayRate;
    case "formula_c": return i.activePay + i.passivePay + i.leavePay + i.holidayPay;
    case "formula_d": return 0;
    // B and the fallback.
    default:          return i.activePay + i.passivePay;
  }
}

export function commissionForFormula(formula: string, i: CommissionFormulaInputs): CommissionFormulaResult {
  if (formula === "formula_f") {
    // Paid per service worked, so revenue never enters it. `commissionableRevenue`
    // carries the count here — the shape the stored snapshot has always had.
    return {
      attendanceDeduction: 0,
      commissionableRevenue: i.serviceCountWorked,
      grossCommission: i.serviceCountWorked * i.commissionFixedAmount,
    };
  }

  const attendanceDeduction = attendanceDeductionFor(formula, i);
  const commissionableRevenue = i.serviceRevenueContribution - attendanceDeduction;

  return {
    attendanceDeduction,
    commissionableRevenue,
    // Floored: a staff member whose transport outran their revenue owes nothing
    // back, they simply earn no commission on top of it.
    grossCommission: Math.max(0, commissionableRevenue) * i.commissionRate,
  };
}
