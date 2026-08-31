import { describe, it, expect } from "vitest";
import { splitPay, deductionsByStaff, splitPeriod } from "./payroll-take-home";

describe("splitPay", () => {
  it("subtracts deductions from gross", () => {
    expect(splitPay(2000, 800)).toEqual({
      grossPay: 2000, deductionsTotal: 800, takeHomePay: 1200, shortfall: 0,
    });
  });

  // The case that started this: the screen used to show the gross as the
  // headline while the business handed over nothing.
  it("floors take-home at zero when deductions consume the whole wage", () => {
    expect(splitPay(2000, 2000)).toEqual({
      grossPay: 2000, deductionsTotal: 2000, takeHomePay: 0, shortfall: 0,
    });
  });

  it("never returns a negative take-home — the excess becomes a shortfall", () => {
    expect(splitPay(2000, 2500)).toEqual({
      grossPay: 2000, deductionsTotal: 2500, takeHomePay: 0, shortfall: 500,
    });
  });

  it("keeps arithmetic on the numeric(12,2) grid", () => {
    const { takeHomePay } = splitPay(1000.1, 333.33);
    expect(takeHomePay).toBe(666.77);
  });

  it("treats missing figures as zero", () => {
    expect(splitPay(0, 0)).toEqual({ grossPay: 0, deductionsTotal: 0, takeHomePay: 0, shortfall: 0 });
  });
});

describe("deductionsByStaff", () => {
  it("totals multiple lines per person and accepts numeric strings", () => {
    const totals = deductionsByStaff([
      { staffId: "s1", amount: 100 },
      { staffId: "s1", amount: "250.50" },
      { staffId: "s2", amount: 40 },
    ]);
    expect(totals.get("s1")).toBe(350.5);
    expect(totals.get("s2")).toBe(40);
  });
});

describe("splitPeriod", () => {
  const entries = [
    { staffId: "s1", netPay: 2000 },
    { staffId: "s2", netPay: 5000 },
  ];

  it("totals the cash actually payable, not the gross", () => {
    const result = splitPeriod(entries, [
      { staffId: "s1", amount: 2500 },
      { staffId: "s2", amount: 1000 },
    ]);
    expect(result.totalGross).toBe(7000);
    expect(result.totalDeductions).toBe(3500);
    // s2's surplus must not absorb s1's shortfall: 0 + 4000, not 7000 − 3500.
    expect(result.totalTakeHome).toBe(4000);
    expect(result.totalShortfall).toBe(500);
  });

  it("exposes the per-staff split", () => {
    const { byStaff } = splitPeriod(entries, [{ staffId: "s1", amount: 750 }]);
    expect(byStaff.get("s1")?.takeHomePay).toBe(1250);
    expect(byStaff.get("s2")?.takeHomePay).toBe(5000);
    expect(byStaff.get("s2")?.deductionsTotal).toBe(0);
  });

  it("ignores deductions for staff with no entry in the period", () => {
    const { totalTakeHome, totalDeductions } = splitPeriod(
      [{ staffId: "s1", netPay: 1000 }],
      [{ staffId: "s1", amount: 100 }, { staffId: "ghost", amount: 999 }],
    );
    expect(totalDeductions).toBe(100);
    expect(totalTakeHome).toBe(900);
  });
});
