import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { payrollPostings } from "@shared/schema";
import { storage } from "../storage";
import { payrollService } from "./PayrollService";
import { payrollSettlementService } from "./PayrollSettlementService";
import { analyticsService } from "./AnalyticsService";
import { postingsBalance, POSTING_ACCOUNTS } from "./PayrollPostingService";
import {
  assertTestDatabase,
  ensureSchema,
  createFixture,
  createPeriod,
  sweepResidue,
  closePool,
  type Fixture,
} from "../test-support/integration-db";

/**
 * The payroll ledger, end to end.
 *
 * The case that matters most is a period straddling a month boundary. The
 * legacy P&L path selects periods by an overlap test and then adds the whole
 * period total, so such a run is reported in FULL in both months. These tests
 * pin that the ledger splits it instead — and pin the identity that makes the
 * ledger trustworthy in the first place.
 */

const PAY = 120_000;

let fixtures: Fixture[] = [];

async function newFixture(opts?: { payPerMonth?: number }) {
  const f = await createFixture(opts);
  fixtures.push(f);
  return f;
}

async function postingsFor(periodId: string) {
  const rows = await db.select().from(payrollPostings)
    .where(eq(payrollPostings.periodId, periodId));
  return rows.map(r => ({
    account: r.account,
    effectiveDate: r.effectiveDate,
    amount: Number(r.amount),
    staffId: r.staffId,
  }));
}

const sumOf = (lines: { account: string; amount: number }[], account: string) =>
  Math.round(lines.filter(l => l.account === account).reduce((s, l) => s + l.amount, 0) * 100) / 100;

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
  await sweepResidue();
});

afterEach(async () => {
  for (const f of fixtures) await f.cleanup();
  fixtures = [];
});

afterAll(async () => {
  await closePool();
});

describe("payroll postings", () => {
  it("posts wages, cash and the deduction that explains the gap", async () => {
    const f = await newFixture();
    await f.addDebt(8_500);
    const period = await createPeriod(f.storeId, "2099-01-01", "2099-01-31");
    await payrollService.calculatePayrollForPeriod(period.id);

    await payrollSettlementService.markPeriodPaid(period.id);

    const lines = await postingsFor(period.id);
    expect(sumOf(lines, POSTING_ACCOUNTS.wageExpense)).toBe(PAY);
    expect(sumOf(lines, POSTING_ACCOUNTS.cashOut)).toBe(PAY - 8_500);
    expect(sumOf(lines, "deduction:staff_credit")).toBe(8_500);
    expect(postingsBalance(lines).balanced).toBe(true);
  });

  it("splits a straddling period across the months that earned it", async () => {
    // 31 Jan – 13 Feb: one day in January, thirteen in February. The legacy
    // P&L reports the whole 120,000 in BOTH months; the ledger apportions it.
    const f = await newFixture();
    const period = await createPeriod(f.storeId, "2099-01-31", "2099-02-13");
    await payrollService.calculatePayrollForPeriod(period.id);

    await payrollSettlementService.markPeriodPaid(period.id);

    const lines = await postingsFor(period.id);
    const wages = lines.filter(l => l.account === POSTING_ACCOUNTS.wageExpense);
    expect(wages).toHaveLength(2);
    expect(wages.map(w => w.effectiveDate).sort()).toEqual(["2099-01-31", "2099-02-13"]);

    // 1/14 and 13/14 of the month's pay.
    const jan = wages.find(w => w.effectiveDate === "2099-01-31")!;
    const feb = wages.find(w => w.effectiveDate === "2099-02-13")!;
    expect(jan.amount).toBeCloseTo(PAY / 14, 1);
    expect(feb.amount).toBeCloseTo((PAY * 13) / 14, 1);
    expect(jan.amount + feb.amount).toBeCloseTo(PAY, 2);

    // And the legacy path still double counts, which is what we are replacing.
    const legacyJan = (await storage.getPaidPayrollExpenses(f.storeId, "2099-01-01", "2099-01-31"))
      .reduce((s, x) => s + x.amount, 0);
    const legacyFeb = (await storage.getPaidPayrollExpenses(f.storeId, "2099-02-01", "2099-02-28"))
      .reduce((s, x) => s + x.amount, 0);
    expect(legacyJan).toBe(PAY);
    expect(legacyFeb).toBe(PAY);
    expect(legacyJan + legacyFeb).toBe(PAY * 2); // the bug, stated plainly

    // The ledger reports the same run once.
    const ledgerJan = await db.select().from(payrollPostings).where(and(
      eq(payrollPostings.storeId, f.storeId),
      eq(payrollPostings.account, POSTING_ACCOUNTS.wageExpense),
      eq(payrollPostings.effectiveDate, "2099-01-31"),
    ));
    expect(Number(ledgerJan[0].amount) + feb.amount).toBeCloseTo(PAY, 2);
  });

  it("stops the P&L double counting a straddling period", async () => {
    // The fix, observed where it matters. Before the reader was flipped, the
    // statement reported this 120,000 run in full in January AND in February.
    const f = await newFixture();
    const period = await createPeriod(f.storeId, "2099-01-31", "2099-02-13");
    await payrollService.calculatePayrollForPeriod(period.id);
    await payrollSettlementService.markPeriodPaid(period.id);

    const jan = await analyticsService.getProfitLossSummary(f.storeId, "2099-01-01", "2099-01-31");
    const feb = await analyticsService.getProfitLossSummary(f.storeId, "2099-02-01", "2099-02-28");

    expect(jan.totalPayrollExpenses).toBeCloseTo(PAY / 14, 1);
    expect(feb.totalPayrollExpenses).toBeCloseTo((PAY * 13) / 14, 1);
    expect(jan.totalPayrollExpenses + feb.totalPayrollExpenses).toBeCloseTo(PAY, 2);

    // The legacy accessor still shows the old behaviour, which is why it is
    // being retired rather than left as a second source of truth.
    const legacyJan = (await storage.getPaidPayrollExpenses(f.storeId, "2099-01-01", "2099-01-31"))
      .reduce((s, x) => s + x.amount, 0);
    expect(legacyJan).toBe(PAY);
  });

  it("keeps cash out on the payment date rather than spreading it", async () => {
    const f = await newFixture();
    const period = await createPeriod(f.storeId, "2099-01-31", "2099-02-13");
    await payrollService.calculatePayrollForPeriod(period.id);
    await payrollSettlementService.markPeriodPaid(period.id);

    const cash = (await postingsFor(period.id))
      .filter(l => l.account === POSTING_ACCOUNTS.cashOut);
    expect(cash).toHaveLength(1);
    expect(cash[0].effectiveDate).toBe("2099-02-13");
    expect(cash[0].amount).toBe(PAY);
  });

  it("agrees with the mirror expense row it will replace", async () => {
    const f = await newFixture();
    await f.addDebt(8_500);
    const period = await createPeriod(f.storeId, "2099-01-01", "2099-01-31");
    await payrollService.calculatePayrollForPeriod(period.id);

    const { totalAmount } = await payrollSettlementService.markPeriodPaid(period.id);

    const lines = await postingsFor(period.id);
    expect(sumOf(lines, POSTING_ACCOUNTS.cashOut)).toBe(totalAmount);
  });

  it("defers what pay could not cover so the identity still closes", async () => {
    const f = await newFixture({ payPerMonth: 20_000 });
    await f.addDebt(35_000);
    const period = await createPeriod(f.storeId, "2099-01-01", "2099-01-31");
    await payrollService.calculatePayrollForPeriod(period.id);

    await payrollSettlementService.markPeriodPaid(period.id);

    const lines = await postingsFor(period.id);
    expect(sumOf(lines, POSTING_ACCOUNTS.wageExpense)).toBe(20_000);
    expect(sumOf(lines, POSTING_ACCOUNTS.cashOut)).toBe(0);
    expect(sumOf(lines, "deduction:staff_credit")).toBe(20_000);
    expect(postingsBalance(lines).balanced).toBe(true);
  });

  it("never counts a waived deduction", async () => {
    const f = await newFixture();
    await f.addDebt(8_500);
    const period = await createPeriod(f.storeId, "2099-01-01", "2099-01-31");
    await payrollService.calculatePayrollForPeriod(period.id);
    const [proposal] = await storage.getPayrollDeductions(period.id);
    await storage.setPayrollDeductionWaived(proposal.id, true);

    await payrollSettlementService.markPeriodPaid(period.id);

    const lines = await postingsFor(period.id);
    expect(sumOf(lines, POSTING_ACCOUNTS.cashOut)).toBe(PAY);
    expect(lines.filter(l => l.account.startsWith("deduction:"))).toHaveLength(0);
    expect(postingsBalance(lines).balanced).toBe(true);
  });

  it("is idempotent — re-posting replaces rather than duplicates", async () => {
    const f = await newFixture();
    const period = await createPeriod(f.storeId, "2099-01-01", "2099-01-31");
    await payrollService.calculatePayrollForPeriod(period.id);
    await payrollSettlementService.markPeriodPaid(period.id);

    const first = await postingsFor(period.id);
    await payrollSettlementService.markPeriodPaid(period.id);
    const second = await postingsFor(period.id);

    expect(second).toHaveLength(first.length);
    expect(sumOf(second, POSTING_ACCOUNTS.wageExpense)).toBe(sumOf(first, POSTING_ACCOUNTS.wageExpense));
  });

  it("posts nothing until the period is actually paid", async () => {
    const f = await newFixture();
    const period = await createPeriod(f.storeId, "2099-01-01", "2099-01-31");
    await payrollService.calculatePayrollForPeriod(period.id);

    expect(await postingsFor(period.id)).toHaveLength(0);
  });
});
