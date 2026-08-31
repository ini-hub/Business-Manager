import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import {
  payrollDeductions,
  payrollEntries,
  creditEntries,
  repayments,
  expenses,
  expenseCategories,
} from "@shared/schema";
import { storage } from "../storage";
import { payrollService } from "./PayrollService";
import { staffCreditDeductionService, selectPendingStaffCreditForUpdate } from "./StaffCreditDeductionService";
import { payrollSettlementService } from "./PayrollSettlementService";
import { analyticsService } from "./AnalyticsService";
import { payrollPostingService } from "./PayrollPostingService";
import { storeLocalDate } from "../lib/dateUtils";
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
 * The properties here cannot be observed from pure functions: they are about
 * what the database actually ends up holding after a payroll run settles staff
 * shop debt. Each block pins one of the judgment calls that shipped with this
 * feature, so a future change that breaks the reasoning fails loudly.
 */

const PAY = 120_000;
const START = "2099-01-01";
const END = "2099-01-31";

let fixtures: Fixture[] = [];

async function newFixture(opts?: { payPerMonth?: number }) {
  const f = await createFixture(opts);
  fixtures.push(f);
  return f;
}

/** Runs the real engine, which is also what triggers proposal sync. */
async function calculate(storeId: string, periodId: string) {
  return payrollService.calculatePayrollForPeriod(periodId);
}

async function deductionsFor(periodId: string) {
  return db.select().from(payrollDeductions)
    .where(eq(payrollDeductions.periodId, periodId));
}

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
  // A previous red run can leave fixtures behind; start from a clean slate.
  await sweepResidue();
});

afterEach(async () => {
  for (const f of fixtures) await f.cleanup();
  fixtures = [];
});

afterAll(async () => {
  await closePool();
});

describe("proposal sweep", () => {
  it("proposes a staff member's open debt as a capped deduction", async () => {
    const f = await newFixture();
    await f.addDebt(8_500);
    const period = await createPeriod(f.storeId, START, END);

    await calculate(f.storeId, period.id);

    const rows = await deductionsFor(period.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("staff_credit");
    expect(Number(rows[0].amount)).toBe(8_500);
    expect(rows[0].creditEntryId).toBeTruthy();
    expect(rows[0].repaymentId).toBeNull();
  });

  it("caps the deduction at net pay and leaves the remainder owing", async () => {
    const f = await newFixture({ payPerMonth: 20_000 });
    const debtId = await f.addDebt(35_000);
    const period = await createPeriod(f.storeId, START, END);

    await calculate(f.storeId, period.id);
    const rows = await deductionsFor(period.id);
    expect(Number(rows[0].amount)).toBe(20_000);

    await payrollSettlementService.markPeriodPaid(period.id);

    const [debt] = await db.select().from(creditEntries).where(eq(creditEntries.id, debtId));
    expect(Number(debt.outstandingBalance)).toBe(15_000);
    expect(debt.status).toBe("partial");
  });

  it("ignores debt owed by a customer who is not linked to staff", async () => {
    const f = await newFixture();
    const debtId = await f.addDebt(5_000);
    // Break the link the way the unlink endpoint does.
    await storage.unlinkStaffFromCustomer(f.customerId);
    const period = await createPeriod(f.storeId, START, END);

    await calculate(f.storeId, period.id);

    expect(await deductionsFor(period.id)).toHaveLength(0);
    const [debt] = await db.select().from(creditEntries).where(eq(creditEntries.id, debtId));
    expect(Number(debt.outstandingBalance)).toBe(5_000);
  });

  it("drops a proposal when the debt is settled in cash before payday", async () => {
    const f = await newFixture();
    const debtId = await f.addDebt(5_000);
    const period = await createPeriod(f.storeId, START, END);
    await calculate(f.storeId, period.id);
    expect(await deductionsFor(period.id)).toHaveLength(1);

    // The staff member walks in and pays it off.
    await storage.creditRepo.createRepayment({
      creditEntryId: debtId, amountReceived: 5_000, paymentMethod: "cash",
    } as any);

    await staffCreditDeductionService.syncProposals(period.id);
    expect(await deductionsFor(period.id)).toHaveLength(0);
  });

  it("sweeps debt across every customer profile linked to the same staff record", async () => {
    // customers.staff_id has no uniqueness guarantee; a duplicate profile's
    // debt must not be silently ignored.
    const f = await newFixture();
    await f.addDebt(3_000);
    const secondProfile = await f.addSecondProfile();
    await db.insert(creditEntries).values({
      storeId: f.storeId, customerId: secondProfile,
      amountOwed: 2_000, amountPaidUpfront: 0, outstandingBalance: 2_000,
      description: "Second profile debt", status: "owing",
    });
    const period = await createPeriod(f.storeId, START, END);

    await calculate(f.storeId, period.id);

    const rows = await deductionsFor(period.id);
    expect(rows).toHaveLength(2);
    expect(rows.reduce((s, r) => s + Number(r.amount), 0)).toBe(5_000);
  });
});

describe("waiving", () => {
  it("survives the recalculation that fires on every sale", async () => {
    // The reason waiving is a flag rather than a delete: payroll is
    // auto-recalculated whenever a sale is checked out, so a deleted proposal
    // would be re-inserted and the manager's exclusion silently undone.
    const f = await newFixture();
    await f.addDebt(8_500);
    const period = await createPeriod(f.storeId, START, END);
    await calculate(f.storeId, period.id);

    const [proposal] = await deductionsFor(period.id);
    await storage.setPayrollDeductionWaived(proposal.id, true);

    await calculate(f.storeId, period.id);
    await calculate(f.storeId, period.id);

    const rows = await deductionsFor(period.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(proposal.id);
    expect(rows[0].isWaived).toBe(true);
  });

  it("keeps a waived line out of every money total", async () => {
    const f = await newFixture();
    const debtId = await f.addDebt(8_500);
    const period = await createPeriod(f.storeId, START, END);
    await calculate(f.storeId, period.id);
    const [proposal] = await deductionsFor(period.id);
    await storage.setPayrollDeductionWaived(proposal.id, true);

    // The default accessor is the safe one: summing callers never see it.
    expect(await storage.getPayrollDeductions(period.id)).toHaveLength(0);
    // Only an explicit opt-in returns it, for display.
    expect(await storage.getPayrollDeductions(period.id, undefined, { includeWaived: true })).toHaveLength(1);

    const { totalAmount } = await payrollSettlementService.markPeriodPaid(period.id);
    expect(totalAmount).toBe(PAY);

    // Waived means the debt was never touched.
    const [debt] = await db.select().from(creditEntries).where(eq(creditEntries.id, debtId));
    expect(Number(debt.outstandingBalance)).toBe(8_500);
    expect(debt.status).toBe("owing");
    expect(await db.select().from(repayments).where(eq(repayments.creditEntryId, debtId))).toHaveLength(0);
  });

  it("restores a waived line and re-proposes the debt", async () => {
    const f = await newFixture();
    await f.addDebt(8_500);
    const period = await createPeriod(f.storeId, START, END);
    await calculate(f.storeId, period.id);
    const [proposal] = await deductionsFor(period.id);

    await storage.setPayrollDeductionWaived(proposal.id, true);
    await staffCreditDeductionService.syncProposals(period.id);
    await storage.setPayrollDeductionWaived(proposal.id, false);
    await staffCreditDeductionService.syncProposals(period.id);

    const active = await storage.getPayrollDeductions(period.id);
    expect(active).toHaveLength(1);
    expect(Number(active[0].amount)).toBe(8_500);
  });
});

describe("settlement", () => {
  it("writes one non-cash repayment and settles the debt", async () => {
    const f = await newFixture();
    const debtId = await f.addDebt(8_500);
    const period = await createPeriod(f.storeId, START, END);
    await calculate(f.storeId, period.id);

    await payrollSettlementService.markPeriodPaid(period.id);

    const reps = await db.select().from(repayments).where(eq(repayments.creditEntryId, debtId));
    expect(reps).toHaveLength(1);
    expect(Number(reps[0].amountReceived)).toBe(8_500);
    // Must not read as cash: the cash-flow statement filters on "cash", so
    // this is what keeps a salary deduction out of the till.
    expect(reps[0].paymentMethod).toBe("payroll_deduction");

    const [debt] = await db.select().from(creditEntries).where(eq(creditEntries.id, debtId));
    expect(Number(debt.outstandingBalance)).toBe(0);
    expect(debt.status).toBe("settled");
  });

  it("is idempotent — a retried mark-paid recovers the debt only once", async () => {
    const f = await newFixture();
    const debtId = await f.addDebt(8_500);
    const period = await createPeriod(f.storeId, START, END);
    await calculate(f.storeId, period.id);

    await payrollSettlementService.markPeriodPaid(period.id);
    await payrollSettlementService.markPeriodPaid(period.id);

    expect(await db.select().from(repayments).where(eq(repayments.creditEntryId, debtId))).toHaveLength(1);
  });

  it("recovers the debt once when two settlements overlap", async () => {
    const f = await newFixture();
    const debtId = await f.addDebt(8_500);
    const period = await createPeriod(f.storeId, START, END);
    await calculate(f.storeId, period.id);

    await Promise.all([
      staffCreditDeductionService.settle(period.id),
      staffCreditDeductionService.settle(period.id),
    ]);

    const reps = await db.select().from(repayments).where(eq(repayments.creditEntryId, debtId));
    expect(reps).toHaveLength(1);
    const [debt] = await db.select().from(creditEntries).where(eq(creditEntries.id, debtId));
    expect(Number(debt.outstandingBalance)).toBe(0);
  });

  it("blocks a second transaction from claiming the same pending line", async () => {
    // The test above is worth little on its own: it still passes with the
    // FOR UPDATE removed, because two settlements in one event loop do not in
    // practice interleave. This forces the interleaving a second server process
    // would produce, and it drives the REAL production query (not a re-typed
    // copy), so dropping the lock from that query fails here.
    const f = await newFixture();
    await f.addDebt(8_500);
    const period = await createPeriod(f.storeId, START, END);
    await calculate(f.storeId, period.id);

    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });

    // Transaction A claims the pending rows and holds them.
    const holder = db.transaction(async (tx) => {
      const rows = await selectPendingStaffCreditForUpdate(tx, period.id);
      expect(rows).toHaveLength(1);
      await held;
    });
    await new Promise((r) => setTimeout(r, 250));

    // Transaction B asks for the same rows. It must wait on A rather than read
    // them; the timeout turns "blocked" into an observable failure.
    const contender = db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL statement_timeout = '750ms'`);
      return selectPendingStaffCreditForUpdate(tx, period.id);
    });

    await expect(contender).rejects.toThrow(/timeout|canceling statement/i);

    release();
    await holder;
  });

  it("a concurrent recalculation cannot overwrite a just-settled amount", async () => {
    // Mirrors the same regression on SalaryAdvanceDeductionService: `row` in
    // syncProposals comes from a snapshot read at the top of the call, so a
    // concurrent settle() (mark-paid mid-flight, e.g. triggered by an
    // unrelated sale's recalculation) could settle this exact row in
    // between. Drives the real production UPDATE, not a re-typed copy.
    const f = await newFixture();
    const debtId = await f.addDebt(8_500);
    const period = await createPeriod(f.storeId, START, END);
    await calculate(f.storeId, period.id);
    const [proposal] = await deductionsFor(period.id);

    // Give syncProposals something to want to rewrite on the settled row —
    // otherwise it would see amount/label already match and never issue the
    // UPDATE this test exists to guard.
    await db.update(creditEntries).set({ description: "Renamed while settling" }).where(eq(creditEntries.id, debtId));

    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });

    // Transaction A: locks the proposal row and settles it, then holds.
    const settler = db.transaction(async (tx) => {
      await tx.select().from(payrollDeductions).where(eq(payrollDeductions.id, proposal.id)).for("update");
      const [repayment] = await tx.insert(repayments).values({
        creditEntryId: debtId, amountReceived: 8_500, paymentMethod: "payroll_deduction",
      }).returning();
      await tx.update(payrollDeductions).set({ repaymentId: repayment.id }).where(eq(payrollDeductions.id, proposal.id));
      await held;
    });
    await new Promise((r) => setTimeout(r, 250));

    // syncProposals reads its own snapshot (still repaymentId: null, stale
    // label) before A commits, decides to rewrite the label, and its UPDATE
    // blocks on A's lock rather than racing past it.
    const syncer = staffCreditDeductionService.syncProposals(period.id);
    await new Promise((r) => setTimeout(r, 250));
    release();
    await Promise.all([settler, syncer]);

    const [finalRow] = await db.select().from(payrollDeductions).where(eq(payrollDeductions.id, proposal.id));
    expect(finalRow.repaymentId).not.toBeNull();
    // The guarded UPDATE found repaymentId already set once unblocked and
    // became a no-op — the settled amount and label survive untouched.
    expect(Number(finalRow.amount)).toBe(8_500);
    expect(finalRow.label).not.toContain("Renamed while settling");
  });
});

describe("accounting invariant", () => {
  it("leaves wage expense gross, moves cash and the receivable by the recovery", async () => {
    // The claim this feature rests on. Recovering 8,500 of shop debt must:
    //   wage expense (accrual, P&L)  unchanged at gross netPay
    //   cash out                     lower by 8,500
    //   receivable                   lower by 8,500
    // Counting the recovery as a wage saving as well as revenue would book the
    // same 8,500 twice, which is exactly what these assertions rule out.
    const f = await newFixture();
    const debtId = await f.addDebt(8_500);
    const period = await createPeriod(f.storeId, START, END);
    await calculate(f.storeId, period.id);

    const { totalAmount } = await payrollSettlementService.markPeriodPaid(period.id);

    // 1. Cash out is net of the recovery.
    expect(totalAmount).toBe(PAY - 8_500);

    // 2. The ledger's cash_out carries that figure. This used to assert on a
    //    mirror row in `expenses`; payroll no longer writes one, and no fake
    //    expense row is created at all.
    expect(await payrollPostingService.getCashOut(f.storeId, START, END)).toBe(PAY - 8_500);
    const [payrollCat] = await db.select().from(expenseCategories)
      .where(and(eq(expenseCategories.storeId, f.storeId), eq(expenseCategories.name, "Payroll")));
    expect(payrollCat).toBeUndefined();

    // 3. Wages are recognised at GROSS, ignoring the deduction entirely.
    expect(await payrollPostingService.getWageExpense(f.storeId, START, END)).toBe(PAY);

    // 3b. And the statement counts that wage bill exactly once — never as both
    // a wage and an operating expense.
    const pl = await analyticsService.getProfitLossSummary(f.storeId, START, END);
    expect(pl.totalPayrollExpenses).toBe(PAY);
    expect(pl.totalOperationalExpenses).toBe(0);
    expect(pl.totalExpenses).toBe(PAY);

    // 4. The receivable fell by exactly the recovery.
    const [debt] = await db.select().from(creditEntries).where(eq(creditEntries.id, debtId));
    expect(Number(debt.outstandingBalance)).toBe(0);

    // 5. And none of it counted as cash collected.
    const reps = await db.select().from(repayments).where(eq(repayments.creditEntryId, debtId));
    expect(reps.filter(r => r.paymentMethod === "cash")).toHaveLength(0);
  });

  it("never drives take-home negative or feeds carry-forward", async () => {
    const f = await newFixture({ payPerMonth: 20_000 });
    await f.addDebt(35_000);
    const period = await createPeriod(f.storeId, START, END);
    await calculate(f.storeId, period.id);

    const { totalAmount } = await payrollSettlementService.markPeriodPaid(period.id);
    expect(totalAmount).toBe(0);

    const [entry] = await db.select().from(payrollEntries).where(eq(payrollEntries.periodId, period.id));
    expect(Number(entry.carryForwardAmount)).toBe(0);
  });

  // The reported bug: a staff member pays part of their tab in cash at the
  // counter, and payroll keeps proposing to deduct the original amount.
  it("re-clamps the proposal when a debt is part-paid in cash, with no recalculation", async () => {
    const f = await newFixture();
    const debtId = await f.addDebt(8_500);
    const period = await createPeriod(f.storeId, START, END);
    await calculate(f.storeId, period.id);

    expect(Number((await deductionsFor(period.id))[0].amount)).toBe(8_500);

    // Paid at the counter, not through payroll.
    await storage.creditRepo.createRepayment({
      creditEntryId: debtId, amountReceived: 5_000, paymentMethod: "cash", recordedByStaffId: null,
    } as any);
    await staffCreditDeductionService.syncOpenPeriodsForCustomer(f.storeId, f.customerId);

    // Crucially without re-running calculate(): the payroll screen has to be
    // right the moment the manager looks at it.
    const afterPart = await deductionsFor(period.id);
    expect(afterPart).toHaveLength(1);
    expect(Number(afterPart[0].amount)).toBe(3_500);

    // Settling the rest in cash retires the proposal entirely.
    await storage.creditRepo.createRepayment({
      creditEntryId: debtId, amountReceived: 3_500, paymentMethod: "cash", recordedByStaffId: null,
    } as any);
    await staffCreditDeductionService.syncOpenPeriodsForCustomer(f.storeId, f.customerId);
    expect(await deductionsFor(period.id)).toHaveLength(0);

    // And payday hands over the full wage, with nothing withheld.
    const { totalAmount } = await payrollSettlementService.markPeriodPaid(period.id);
    expect(totalAmount).toBe(PAY);
  });

  it("drops the proposal when the debt is written off as bad debt", async () => {
    const f = await newFixture();
    const debtId = await f.addDebt(8_500);
    const period = await createPeriod(f.storeId, START, END);
    await calculate(f.storeId, period.id);
    expect(await deductionsFor(period.id)).toHaveLength(1);

    await storage.creditRepo.writeOffDebt(debtId, "Waived at payroll");
    await staffCreditDeductionService.syncOpenPeriodsForCustomer(f.storeId, f.customerId);

    // A forgiven debt must not still be garnished from a salary.
    expect(await deductionsFor(period.id)).toHaveLength(0);
    const { totalAmount } = await payrollSettlementService.markPeriodPaid(period.id);
    expect(totalAmount).toBe(PAY);
  });

  it("restores a written-off debt to its pre-write-off balance and re-proposes it", async () => {
    const f = await newFixture();
    const debtId = await f.addDebt(8_500);
    const period = await createPeriod(f.storeId, START, END);
    await calculate(f.storeId, period.id);

    await storage.creditRepo.writeOffDebt(debtId, "Waived at payroll");
    await staffCreditDeductionService.syncOpenPeriodsForCustomer(f.storeId, f.customerId);
    expect(await deductionsFor(period.id)).toHaveLength(0);

    // The P&L for the month the write-off actually landed in (real "now",
    // since updatedAt is a real timestamp) must carry the bad debt expense.
    //
    // The month has to be computed in the STORE's timezone (Africa/Lagos,
    // per createFixture), not the test runner machine's own local system
    // clock: getWrittenOffBadDebtTotal compares updatedAt against the range
    // via the store's timezone, and `new Date().getMonth()` reads whatever
    // zone the machine running the suite happens to be in. The two disagree
    // right at a month boundary whenever the machine's local clock has
    // already rolled over to a new month while Lagos hasn't (or vice versa)
    // — which is exactly what made this test flip from green to red with no
    // code change: the machine crossed into September while Lagos, one hour
    // behind, was still in August.
    const now = new Date();
    const todayInStore = storeLocalDate(now, "Africa/Lagos"); // yyyy-MM-dd
    const yearMonth = todayInStore.slice(0, 7); // yyyy-MM
    const monthStart = `${yearMonth}-01`;
    const [year, month] = yearMonth.split("-").map(Number);
    // Date.UTC avoids the same local-timezone trap this fix exists to close.
    const monthEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    const plBefore = await analyticsService.getProfitLossSummary(f.storeId, monthStart, monthEnd);
    expect(plBefore.expensesGrouped.find((e: any) => e.category === "Bad Debt — Written Off")?.amount).toBe(8_500);

    const restored = await storage.creditRepo.restoreWrittenOffDebt(debtId);
    expect(Number(restored?.outstandingBalance)).toBe(8_500);
    expect(restored?.status).toBe("owing");
    expect(restored?.writeOffReason).toBeNull();

    // The debt is open again, so it re-earns its place in the sweep — without
    // the payslip's own un-waive step, which is the controller's job, not
    // syncProposals'. This proves the underlying debt genuinely came back.
    await staffCreditDeductionService.syncProposals(period.id);
    const afterRestore = await deductionsFor(period.id);
    expect(afterRestore).toHaveLength(1);
    expect(Number(afterRestore[0].amount)).toBe(8_500);

    // And the P&L no longer carries the expense — no reversing entry needed,
    // because bad debt is derived from `status`, not journaled.
    const plAfter = await analyticsService.getProfitLossSummary(f.storeId, monthStart, monthEnd);
    expect(plAfter.expensesGrouped.find((e: any) => e.category === "Bad Debt — Written Off")).toBeUndefined();
  });

  it("reconstructs a part-paid balance on restore, not the original full debt", async () => {
    const f = await newFixture();
    const debtId = await f.addDebt(8_500);
    const period = await createPeriod(f.storeId, START, END);
    await calculate(f.storeId, period.id);

    // Paid down in cash before the rest was written off.
    await storage.creditRepo.createRepayment({
      creditEntryId: debtId, amountReceived: 5_000, paymentMethod: "cash", recordedByStaffId: null,
    } as any);
    await staffCreditDeductionService.syncOpenPeriodsForCustomer(f.storeId, f.customerId);
    await storage.creditRepo.writeOffDebt(debtId, "Waived at payroll");

    const restored = await storage.creditRepo.restoreWrittenOffDebt(debtId);
    // 3,500 remaining, not the original 8,500 — the repayment must survive.
    expect(Number(restored?.outstandingBalance)).toBe(3_500);
    expect(restored?.status).toBe("partial");
  });

  it("leaves an ordinary customer's repayment alone", async () => {
    const f = await newFixture();
    await f.addDebt(8_500);
    const period = await createPeriod(f.storeId, START, END);
    await calculate(f.storeId, period.id);

    // A customer id that is not linked to any staff member: the sweep must
    // return early rather than rewriting proposals it has no business touching.
    await staffCreditDeductionService.syncOpenPeriodsForCustomer(f.storeId, crypto.randomUUID());
    expect(Number((await deductionsFor(period.id))[0].amount)).toBe(8_500);
  });

  it("gives statutory deductions priority over shop debt", async () => {
    const f = await newFixture({ payPerMonth: 20_000 });
    await f.addDebt(35_000);
    const period = await createPeriod(f.storeId, START, END);
    await calculate(f.storeId, period.id);

    const entries = await storage.getPayrollEntries(period.id);
    await storage.createPayrollDeduction({
      periodId: period.id, storeId: f.storeId, staffId: entries[0].staffId,
      type: "tax", label: "PAYE", amount: 5_000,
    } as any);
    await staffCreditDeductionService.syncProposals(period.id);

    const staffCredit = (await storage.getPayrollDeductions(period.id))
      .filter(d => d.type === "staff_credit");
    expect(Number(staffCredit[0].amount)).toBe(15_000);
  });
});
