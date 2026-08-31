import { describe, it, expect } from "vitest";
import {
  splitAcrossMonths,
  buildPostings,
  postingsBalance,
  postingsImbalances,
  POSTING_ACCOUNTS,
  type PostingLine,
} from "./PayrollPostingService";

const wage = (lines: ReturnType<typeof buildPostings>) =>
  lines.filter(l => l.account === POSTING_ACCOUNTS.wageExpense);
const account = (lines: ReturnType<typeof buildPostings>, name: string) =>
  lines.filter(l => l.account === name);

describe("splitAcrossMonths", () => {
  it("leaves a period inside one month as a single slice", () => {
    expect(splitAcrossMonths("2026-08-03", "2026-08-16", 60_000)).toEqual([
      { effectiveDate: "2026-08-16", amount: 60_000 },
    ]);
  });

  it("splits a straddling period by day count", () => {
    // 31 Aug – 13 Sep: 1 day in August, 13 in September. This is the case the
    // old shape reported in FULL in both months.
    const out = splitAcrossMonths("2026-08-31", "2026-09-13", 80_000);
    expect(out).toEqual([
      { effectiveDate: "2026-08-31", amount: 5_714.29 },
      { effectiveDate: "2026-09-13", amount: 74_285.71 },
    ]);
    expect(out.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(80_000, 2);
  });

  it("dates each slice to its own last day so cost lands in the right month", () => {
    const out = splitAcrossMonths("2026-01-15", "2026-03-10", 90_000);
    expect(out.map(s => s.effectiveDate)).toEqual(["2026-01-31", "2026-02-28", "2026-03-10"]);
  });

  it("always sums back to the total, with the remainder on the last slice", () => {
    const out = splitAcrossMonths("2026-01-15", "2026-03-10", 100);
    expect(out.reduce((s, x) => s + x.amount, 0)).toBe(100);
  });

  it("handles a single-day period", () => {
    expect(splitAcrossMonths("2026-08-31", "2026-08-31", 1_000)).toEqual([
      { effectiveDate: "2026-08-31", amount: 1_000 },
    ]);
  });

  it("handles a leap-year February", () => {
    const out = splitAcrossMonths("2028-02-01", "2028-03-01", 2_900);
    expect(out.map(s => s.effectiveDate)).toEqual(["2028-02-29", "2028-03-01"]);
    expect(out.reduce((s, x) => s + x.amount, 0)).toBe(2_900);
  });

  it("spans a year boundary", () => {
    const out = splitAcrossMonths("2026-12-20", "2027-01-10", 22_000);
    expect(out.map(s => s.effectiveDate)).toEqual(["2026-12-31", "2027-01-10"]);
    expect(out.reduce((s, x) => s + x.amount, 0)).toBe(22_000);
  });

  it("returns nothing for an inverted range", () => {
    expect(splitAcrossMonths("2026-09-01", "2026-08-01", 100)).toEqual([]);
  });
});

describe("buildPostings", () => {
  const entries = [{ staffId: "s1", netPay: 120_000 }];

  it("posts gross wages and cash out, with the deduction explaining the gap", () => {
    const lines = buildPostings({
      startDate: "2026-08-01", endDate: "2026-08-31",
      entries,
      deductions: [{ staffId: "s1", type: "staff_credit", amount: 8_500 }],
    });

    expect(wage(lines)).toEqual([
      { account: "wage_expense", effectiveDate: "2026-08-31", amount: 120_000, staffId: "s1" },
    ]);
    expect(account(lines, "cash_out")).toEqual([
      { account: "cash_out", effectiveDate: "2026-08-31", amount: 111_500, staffId: "s1" },
    ]);
    expect(account(lines, "deduction:staff_credit")).toEqual([
      { account: "deduction:staff_credit", effectiveDate: "2026-08-31", amount: 8_500, staffId: "s1" },
    ]);
    expect(postingsBalance(lines).balanced).toBe(true);
  });

  it("keeps wage expense gross while cash out follows the deductions", () => {
    const lines = buildPostings({
      startDate: "2026-08-01", endDate: "2026-08-31",
      entries,
      deductions: [
        { staffId: "s1", type: "tax", amount: 5_000 },
        { staffId: "s1", type: "staff_credit", amount: 8_500 },
      ],
    });
    expect(wage(lines)[0].amount).toBe(120_000);
    expect(account(lines, "cash_out")[0].amount).toBe(106_500);
    expect(account(lines, "deduction:tax")[0].amount).toBe(5_000);
    expect(postingsBalance(lines).balanced).toBe(true);
  });

  it("splits a straddling period's wages but keeps settlement on the end date", () => {
    const lines = buildPostings({
      startDate: "2026-08-31", endDate: "2026-09-13",
      entries: [{ staffId: "s1", netPay: 80_000 }],
      deductions: [],
    });
    expect(wage(lines).map(l => l.effectiveDate)).toEqual(["2026-08-31", "2026-09-13"]);
    // Cash leaves once, when the period is paid — it is not spread.
    expect(account(lines, "cash_out")).toHaveLength(1);
    expect(account(lines, "cash_out")[0].effectiveDate).toBe("2026-09-13");
    expect(postingsBalance(lines).balanced).toBe(true);
  });

  it("defers what pay could not cover, so the identity still closes", () => {
    const lines = buildPostings({
      startDate: "2026-08-01", endDate: "2026-08-31",
      entries: [{ staffId: "s1", netPay: 20_000 }],
      deductions: [{ staffId: "s1", type: "carry_forward", amount: 35_000 }],
    });
    expect(wage(lines)[0].amount).toBe(20_000);
    expect(account(lines, "cash_out")).toHaveLength(0); // nothing left to pay
    expect(account(lines, "carry_forward_deferred")[0].amount).toBe(15_000);
    expect(postingsBalance(lines).balanced).toBe(true);
  });

  it("nets per staff member, not across them", () => {
    // s2's surplus must not absorb s1's shortfall: each person's take-home
    // floors at zero independently.
    const lines = buildPostings({
      startDate: "2026-08-01", endDate: "2026-08-31",
      entries: [{ staffId: "s1", netPay: 10_000 }, { staffId: "s2", netPay: 50_000 }],
      deductions: [{ staffId: "s1", type: "carry_forward", amount: 30_000 }],
    });
    expect(wage(lines).reduce((s, l) => s + l.amount, 0)).toBe(60_000);
    expect(account(lines, "cash_out").reduce((s, l) => s + l.amount, 0)).toBe(50_000);
    expect(account(lines, "carry_forward_deferred")[0].amount).toBe(20_000);
    expect(postingsBalance(lines).balanced).toBe(true);
  });

  it("posts nothing for a period with no entries", () => {
    expect(buildPostings({
      startDate: "2026-08-01", endDate: "2026-08-31", entries: [], deductions: [],
    })).toEqual([]);
  });

  it("balances across a range of shapes", () => {
    const shapes = [
      { pay: [120_000], ded: [] },
      { pay: [120_000], ded: [8_500] },
      { pay: [0], ded: [] },
      { pay: [1_000, 2_000, 3_000], ded: [500, 4_000] },
    ];
    for (const shape of shapes) {
      const entries = shape.pay.map((netPay, i) => ({ staffId: `s${i}`, netPay }));
      const deductions = shape.ded.map((amount, i) => ({ staffId: `s${i}`, type: "other", amount }));
      const lines = buildPostings({
        startDate: "2026-08-20", endDate: "2026-09-05", entries, deductions,
      });
      expect(postingsBalance(lines)).toEqual({ balanced: true, delta: 0 });
    }
  });
});

describe("postingsBalance", () => {
  const line = (account: string, amount: number, staffId: string | null): PostingLine =>
    ({ account, effectiveDate: "2026-08-31", amount, staffId });

  it("rejects two staff members whose errors cancel to a period net of zero", () => {
    // s1 is paid 1,000 more than their wages justify and s2 1,000 less. Summed
    // across the period the identity closes exactly, which is why the check has
    // to be per person: both of these ledgers are wrong.
    const lines = [
      line(POSTING_ACCOUNTS.wageExpense, 50_000, "s1"),
      line(POSTING_ACCOUNTS.cashOut, 51_000, "s1"),
      line(POSTING_ACCOUNTS.wageExpense, 50_000, "s2"),
      line(POSTING_ACCOUNTS.cashOut, 49_000, "s2"),
    ];

    const periodNet = lines
      .filter(l => l.account === POSTING_ACCOUNTS.wageExpense)
      .reduce((s, l) => s + l.amount, 0)
      - lines.filter(l => l.account === POSTING_ACCOUNTS.cashOut).reduce((s, l) => s + l.amount, 0);
    expect(periodNet).toBe(0);

    expect(postingsBalance(lines).balanced).toBe(false);
    expect(postingsImbalances(lines)).toEqual([
      { staffId: "s1", delta: -1_000 },
      { staffId: "s2", delta: 1_000 },
    ]);
  });

  it("reports the worst single person, not the period net", () => {
    const lines = [
      line(POSTING_ACCOUNTS.wageExpense, 10_000, "s1"),
      line(POSTING_ACCOUNTS.cashOut, 10_500, "s1"),
      line(POSTING_ACCOUNTS.wageExpense, 10_000, "s2"),
      line(POSTING_ACCOUNTS.cashOut, 7_000, "s2"),
    ];
    expect(postingsBalance(lines).delta).toBe(3_000);
  });

  it("flags a line belonging to nobody", () => {
    const lines = [line(POSTING_ACCOUNTS.wageExpense, 500, null)];
    expect(postingsImbalances(lines)).toEqual([{ staffId: null, delta: 500 }]);
  });

  it("tolerates sub-kobo rounding within a staff member's lines", () => {
    const lines = [
      line(POSTING_ACCOUNTS.wageExpense, 100.004, "s1"),
      line(POSTING_ACCOUNTS.cashOut, 100, "s1"),
    ];
    expect(postingsBalance(lines).balanced).toBe(true);
  });
});
