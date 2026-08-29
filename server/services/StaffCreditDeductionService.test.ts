import { describe, it, expect } from "vitest";
import { allocateAgainstPay, type DebtLike } from "./StaffCreditDeductionService";

const debts = (...balances: number[]): DebtLike[] =>
  balances.map((outstandingBalance, i) => ({ id: `d${i + 1}`, outstandingBalance }));

describe("allocateAgainstPay", () => {
  // Scenario 2: debt comfortably covered by pay.
  it("recovers a debt in full when pay covers it", () => {
    expect(allocateAgainstPay(120_000, debts(8_500))).toEqual([
      { creditEntryId: "d1", amount: 8_500 },
    ]);
  });

  // Scenario 3: take-home floors at zero, remainder stays owed.
  it("caps recovery at available pay, leaving the rest outstanding", () => {
    const out = allocateAgainstPay(20_000, debts(35_000));
    expect(out).toEqual([{ creditEntryId: "d1", amount: 20_000 }]);
    // The caller settles only what was allocated, so 15,000 stays on the entry.
    expect(35_000 - out[0].amount).toBe(15_000);
  });

  // Scenario 4: staff credit is last in DEDUCTION_PRIORITY, so it receives the
  // residual after a tax line has already taken its share of net pay.
  it("works against the residual left by higher-priority deductions", () => {
    const netPay = 20_000;
    const tax = 5_000;
    expect(allocateAgainstPay(netPay - tax, debts(35_000))).toEqual([
      { creditEntryId: "d1", amount: 15_000 },
    ]);
  });

  // Scenario 5: oldest-first, matching the Borrow Book's aging buckets.
  it("fills debts in order and stops when pay runs out", () => {
    expect(allocateAgainstPay(10_000, debts(4_000, 3_000, 9_000))).toEqual([
      { creditEntryId: "d1", amount: 4_000 },
      { creditEntryId: "d2", amount: 3_000 },
      { creditEntryId: "d3", amount: 3_000 },
    ]);
  });

  it("never allocates beyond the total debt owed", () => {
    const out = allocateAgainstPay(100_000, debts(2_000, 1_500));
    expect(out.reduce((s, a) => s + a.amount, 0)).toBe(3_500);
  });

  // Scenario 14: no pay, nothing to take.
  it("allocates nothing when there is no pay left", () => {
    expect(allocateAgainstPay(0, debts(5_000))).toEqual([]);
  });

  it("treats negative available pay as zero", () => {
    expect(allocateAgainstPay(-4_000, debts(5_000))).toEqual([]);
  });

  // Scenario 8: a debt paid off in cash before the sync must not produce a
  // zero-amount deduction line.
  it("omits debts with nothing outstanding rather than emitting empty lines", () => {
    expect(allocateAgainstPay(50_000, debts(0, 1_200, 0))).toEqual([
      { creditEntryId: "d2", amount: 1_200 },
    ]);
  });

  it("returns nothing when there are no open debts", () => {
    expect(allocateAgainstPay(50_000, [])).toEqual([]);
  });

  // Money is numeric(12,2); allocation must stay on that grid so the sum of
  // the lines equals the pay consumed, with no trailing float dust.
  it("keeps allocations on the 2-decimal money grid", () => {
    const out = allocateAgainstPay(100.05, debts(33.35, 33.35, 33.35, 10));
    expect(out).toEqual([
      { creditEntryId: "d1", amount: 33.35 },
      { creditEntryId: "d2", amount: 33.35 },
      { creditEntryId: "d3", amount: 33.35 },
    ]);
    expect(out.reduce((s, a) => s + a.amount, 0)).toBeCloseTo(100.05, 2);
  });

  it("splits the final partial allocation exactly against the remainder", () => {
    const out = allocateAgainstPay(1_000.10, debts(600.05, 900.20));
    expect(out).toEqual([
      { creditEntryId: "d1", amount: 600.05 },
      { creditEntryId: "d2", amount: 400.05 },
    ]);
  });
});
