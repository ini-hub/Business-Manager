import { describe, it, expect } from "vitest";
import { commissionForFormula, attendanceDeductionFor, type CommissionFormulaInputs } from "./commissionFormula";

/**
 * Modelled on the live G.R.A. Branch defaults: ₦1,000 active transport,
 * ₦500 passive, 30% commission.
 */
const inputs = (over: Partial<CommissionFormulaInputs> = {}): CommissionFormulaInputs => ({
  serviceRevenueContribution: 5000,
  serviceCountWorked: 4,
  commissionRate: 0.3,
  commissionFixedAmount: 0,
  activeDays: 4,
  passiveDays: 0,
  activeDayRate: 1000,
  activePay: 4000,
  passivePay: 0,
  leavePay: 0,
  holidayPay: 0,
  ...over,
});

describe("commissionForFormula", () => {
  // The real paid period: ₦5,000 revenue share, ₦4,000 transport, 30%.
  it("nets transport off the revenue share before applying the rate (B)", () => {
    expect(commissionForFormula("formula_b", inputs())).toEqual({
      attendanceDeduction: 4000,
      commissionableRevenue: 1000,
      grossCommission: 300,
    });
  });

  // The case that prompted this work: one ₦1,000 service against a day of
  // active and a day of passive transport.
  it("floors at zero when transport outran the revenue share", () => {
    const result = commissionForFormula("formula_b", inputs({
      serviceRevenueContribution: 1000,
      serviceCountWorked: 1,
      activeDays: 1,
      passiveDays: 1,
      activePay: 1000,
      passivePay: 1000,
    }));

    expect(result.attendanceDeduction).toBe(2000);
    // Kept negative so the explainer can say the offset is what consumed it,
    // rather than presenting a zero base as if no revenue existed.
    expect(result.commissionableRevenue).toBe(-1000);
    expect(result.grossCommission).toBe(0);
  });

  it("charges every present day at the active rate (A)", () => {
    const result = commissionForFormula("formula_a", inputs({
      serviceRevenueContribution: 10000,
      activeDays: 3,
      passiveDays: 2,
      activePay: 3000,
      passivePay: 1000,
    }));

    // 5 present days x ₦1,000, not the ₦4,000 actually paid out.
    expect(result.attendanceDeduction).toBe(5000);
    expect(result.grossCommission).toBe(1500);
  });

  it("also nets off paid leave and holiday (C)", () => {
    const result = commissionForFormula("formula_c", inputs({
      serviceRevenueContribution: 10000,
      leavePay: 800,
      holidayPay: 1200,
    }));

    expect(result.attendanceDeduction).toBe(6000);
    expect(result.grossCommission).toBe(1200);
  });

  it("takes no deduction at all (D)", () => {
    expect(commissionForFormula("formula_d", inputs())).toEqual({
      attendanceDeduction: 0,
      commissionableRevenue: 5000,
      grossCommission: 1500,
    });
  });

  it("pays a flat amount per service, ignoring revenue entirely (F)", () => {
    const result = commissionForFormula("formula_f", inputs({
      commissionFixedAmount: 750,
      serviceCountWorked: 6,
      serviceRevenueContribution: 999999,
    }));

    expect(result.grossCommission).toBe(4500);
    expect(result.attendanceDeduction).toBe(0);
    expect(result.commissionableRevenue).toBe(6);
  });

  it("falls back to Formula B for an unrecognised formula", () => {
    expect(commissionForFormula("formula_z", inputs()))
      .toEqual(commissionForFormula("formula_b", inputs()));
  });

  it("earns nothing when no services were worked", () => {
    const result = commissionForFormula("formula_d", inputs({
      serviceRevenueContribution: 0,
      serviceCountWorked: 0,
    }));

    expect(result.grossCommission).toBe(0);
  });
});

describe("attendanceDeductionFor", () => {
  // The whole point of the formula choice, in one assertion.
  it("is the only thing the percentage formulas disagree on", () => {
    const i = inputs({ activePay: 4000, passivePay: 500, leavePay: 800, holidayPay: 1200, activeDays: 4, passiveDays: 1 });

    expect(attendanceDeductionFor("formula_a", i)).toBe(5000);
    expect(attendanceDeductionFor("formula_b", i)).toBe(4500);
    expect(attendanceDeductionFor("formula_c", i)).toBe(6500);
    expect(attendanceDeductionFor("formula_d", i)).toBe(0);
  });
});
