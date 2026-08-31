import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { payrollPostings } from "@shared/schema";
import { storage } from "../storage";
import { payrollService } from "./PayrollService";
import { payrollSettlementService } from "./PayrollSettlementService";
import { analyticsService } from "./AnalyticsService";
import { payrollPostingService, POSTING_ACCOUNTS } from "./PayrollPostingService";
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
 * The gap this closes: handing a staff member a salary advance had no
 * accounting entry anywhere, so getCashOut (and everything downstream of it)
 * understated total cash paid to staff by however much of an advance payroll
 * went on to recover. These pin that the disbursement is booked the moment
 * the advance is created, reversed if it's rejected or deleted, and — the
 * actual identity this exists to satisfy — that a disbursement plus a
 * period's own settlement cash_out sum to exactly the staff member's total
 * compensation, with wage_expense and the P&L never touched by any of it.
 */

const START = "2099-01-01";
const END = "2099-01-31";

let fixtures: Fixture[] = [];

async function newFixture(opts?: { payPerMonth?: number }) {
  const f = await createFixture(opts);
  fixtures.push(f);
  return f;
}

async function calculate(storeId: string, periodId: string) {
  return payrollService.calculatePayrollForPeriod(periodId);
}

async function disbursementPostingFor(advanceId: string) {
  const [row] = await db.select().from(payrollPostings)
    .where(eq(payrollPostings.salaryAdvanceId, advanceId));
  return row;
}

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

describe("disbursement posting", () => {
  it("books a cash-out line the day the advance is created", async () => {
    const f = await newFixture();
    const advance = await storage.createSalaryAdvance({
      storeId: f.storeId, staffId: f.staffId, amount: 12_000, date: "2099-01-10", status: "approved",
    });

    const posting = await disbursementPostingFor(advance.id);
    expect(posting).toBeTruthy();
    expect(posting.periodId).toBeNull();
    expect(posting.account).toBe(POSTING_ACCOUNTS.advanceDisbursement);
    expect(posting.effectiveDate).toBe("2099-01-10");
    expect(Number(posting.amount)).toBe(12_000);

    expect(await payrollPostingService.getCashOut(f.storeId, "2099-01-01", "2099-01-31")).toBe(12_000);
  });

  it("leaves wage_expense and the P&L untouched", async () => {
    const f = await newFixture();
    await storage.createSalaryAdvance({
      storeId: f.storeId, staffId: f.staffId, amount: 12_000, date: "2099-01-10", status: "approved",
    });

    expect(await payrollPostingService.getWageExpense(f.storeId, "2099-01-01", "2099-01-31")).toBe(0);

    const pl = await analyticsService.getProfitLossSummary(f.storeId, "2099-01-01", "2099-01-31");
    expect(pl.totalPayrollExpenses).toBe(0);
    expect(pl.totalOperationalExpenses).toBe(0);
  });

  it("reverses the posting when the advance is deleted", async () => {
    const f = await newFixture();
    const advance = await storage.createSalaryAdvance({
      storeId: f.storeId, staffId: f.staffId, amount: 12_000, date: "2099-01-10", status: "approved",
    });
    expect(await disbursementPostingFor(advance.id)).toBeTruthy();

    await storage.deleteSalaryAdvance(advance.id);

    expect(await disbursementPostingFor(advance.id)).toBeUndefined();
    expect(await payrollPostingService.getCashOut(f.storeId, "2099-01-01", "2099-01-31")).toBe(0);
  });

  it("reverses the posting when the advance is rejected", async () => {
    const f = await newFixture();
    // Default status is "pending" — matches what a real reject can act on.
    const advance = await storage.createSalaryAdvance({
      storeId: f.storeId, staffId: f.staffId, amount: 12_000, date: "2099-01-10",
    });
    expect(await disbursementPostingFor(advance.id)).toBeTruthy();

    await storage.updateSalaryAdvanceStatus(advance.id, "rejected", undefined, "Requested in error");

    expect(await disbursementPostingFor(advance.id)).toBeUndefined();
    expect(await payrollPostingService.getCashOut(f.storeId, "2099-01-01", "2099-01-31")).toBe(0);
  });

  it("is idempotent — creating twice through the same call never double-posts", async () => {
    const f = await newFixture();
    const advance = await storage.createSalaryAdvance({
      storeId: f.storeId, staffId: f.staffId, amount: 12_000, date: "2099-01-10", status: "approved",
    });
    // Re-post directly (what a retried request would do) — the unique index
    // on salaryAdvanceId makes this a no-op.
    await payrollPostingService.postAdvanceDisbursement(db as any, advance);

    const rows = await db.select().from(payrollPostings).where(eq(payrollPostings.salaryAdvanceId, advance.id));
    expect(rows).toHaveLength(1);
  });

  it("a disbursement plus the period's own settlement sum to exactly total compensation", async () => {
    const f = await newFixture({ payPerMonth: 20_000 });
    const advance = await storage.createSalaryAdvance({
      storeId: f.storeId, staffId: f.staffId, amount: 12_000, date: "2099-01-05", status: "approved",
    });
    const period = await createPeriod(f.storeId, START, END);

    await calculate(f.storeId, period.id);
    const { totalAmount: settlementCashOut } = await payrollSettlementService.markPeriodPaid(period.id);

    // 12,000 already left as the advance; payroll only had 8,000 left to pay.
    expect(settlementCashOut).toBe(8_000);

    const [settledAdvance] = await db.select().from(payrollPostings)
      .where(eq(payrollPostings.salaryAdvanceId, advance.id));
    const totalCashOut = await payrollPostingService.getCashOut(f.storeId, START, END);
    // The identity this whole feature exists to satisfy: disbursement +
    // settlement cash_out nets to exactly the 20,000 the staff member earned
    // — not 32,000 (double-counted) and not 8,000 (the advance silently
    // unaccounted for).
    expect(totalCashOut).toBe(Number(settledAdvance.amount) + settlementCashOut);
    expect(totalCashOut).toBe(20_000);

    // And wage_expense recognises the full gross regardless — a cash-timing
    // event, not a cost-recognition one.
    expect(await payrollPostingService.getWageExpense(f.storeId, START, END)).toBe(20_000);
  });
});
