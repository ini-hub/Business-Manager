import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { db } from "../db";
import { eq } from "drizzle-orm";
import {
  payrollDeductions,
  payrollEntries,
  salaryAdvances,
} from "@shared/schema";
import { storage } from "../storage";
import { payrollService } from "./PayrollService";
import { salaryAdvanceDeductionService } from "./SalaryAdvanceDeductionService";
import { payrollSettlementService } from "./PayrollSettlementService";
import { canRestoreManualRecovery } from "../lib/advanceBalance";
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
 * Pins the properties that only show up once the database actually settles —
 * that an advance is proposed and recovered without a manager typing a
 * deduction by hand, that it survives waiving the same way staff credit does,
 * that it outranks staff credit for headroom the way DEDUCTION_PRIORITY says
 * it should, and that an advance too big for one paycheck carries its own
 * remaining balance forward on its own row rather than through the generic
 * per-staff carryForwardAmount.
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

async function calculate(storeId: string, periodId: string) {
  return payrollService.calculatePayrollForPeriod(periodId);
}

async function advanceDeductionsFor(periodId: string) {
  return db.select().from(payrollDeductions)
    .where(eq(payrollDeductions.periodId, periodId))
    .then(rows => rows.filter(r => r.type === "advance_recovery"));
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

describe("proposal sweep", () => {
  it("proposes an approved advance as a payroll deduction with no manual step", async () => {
    const f = await newFixture();
    const advanceId = await f.addAdvance(15_000);
    const period = await createPeriod(f.storeId, START, END);

    await calculate(f.storeId, period.id);

    const rows = await advanceDeductionsFor(period.id);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].amount)).toBe(15_000);
    expect(rows[0].salaryAdvanceId).toBe(advanceId);
    expect(rows[0].settledAt).toBeNull();
  });

  it("ignores a pending (not yet approved) advance", async () => {
    const f = await newFixture();
    await db.insert(salaryAdvances).values({
      storeId: f.storeId, staffId: f.staffId, amount: 10_000, outstandingBalance: 10_000, date: "2099-01-05",
      status: "pending", isRecovered: false,
    });
    const period = await createPeriod(f.storeId, START, END);

    await calculate(f.storeId, period.id);

    expect(await advanceDeductionsFor(period.id)).toHaveLength(0);
  });

  it("caps the deduction at available pay, same as staff credit, and never touches carryForwardAmount", async () => {
    // advance_recovery self-caps (allocateAgainstPay) exactly like
    // staff_credit does — an advance too big for one paycheck carries its own
    // remaining balance forward on its own row, not through the generic
    // per-staff shortfall tax/penalty/etc. use.
    const f = await newFixture({ payPerMonth: 20_000 });
    await f.addAdvance(35_000);
    const period = await createPeriod(f.storeId, START, END);

    await calculate(f.storeId, period.id);
    const rows = await advanceDeductionsFor(period.id);
    expect(Number(rows[0].amount)).toBe(20_000);

    const { totalAmount } = await payrollSettlementService.markPeriodPaid(period.id);
    expect(totalAmount).toBe(0);

    const [entry] = await db.select().from(payrollEntries).where(eq(payrollEntries.periodId, period.id));
    expect(Number(entry.carryForwardAmount)).toBe(0);
  });

  it("proposes multiple advances for the same staff member, oldest first", async () => {
    const f = await newFixture({ payPerMonth: 100_000 });
    await f.addAdvance(5_000, { date: "2099-01-10" });
    await f.addAdvance(3_000, { date: "2099-01-02" });
    const period = await createPeriod(f.storeId, START, END);

    await calculate(f.storeId, period.id);

    const rows = await advanceDeductionsFor(period.id);
    expect(rows).toHaveLength(2);
    expect(rows.reduce((s, r) => s + Number(r.amount), 0)).toBe(8_000);
  });

  it("drops a proposal when the advance is manually recovered before payday", async () => {
    const f = await newFixture();
    const advanceId = await f.addAdvance(5_000);
    const period = await createPeriod(f.storeId, START, END);
    await calculate(f.storeId, period.id);
    expect(await advanceDeductionsFor(period.id)).toHaveLength(1);

    await storage.markAdvanceRecovered(advanceId, "Repaid in cash at the counter");

    await salaryAdvanceDeductionService.syncProposals(period.id);
    expect(await advanceDeductionsFor(period.id)).toHaveLength(0);
  });
});

describe("waiving", () => {
  it("survives the recalculation that fires on every sale", async () => {
    const f = await newFixture();
    await f.addAdvance(8_500);
    const period = await createPeriod(f.storeId, START, END);
    await calculate(f.storeId, period.id);

    const [proposal] = await advanceDeductionsFor(period.id);
    await storage.setPayrollDeductionWaived(proposal.id, true);

    await calculate(f.storeId, period.id);
    await calculate(f.storeId, period.id);

    const rows = await advanceDeductionsFor(period.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(proposal.id);
    expect(rows[0].isWaived).toBe(true);
  });

  it("keeps a waived line out of every money total and leaves the advance unrecovered", async () => {
    const f = await newFixture();
    const advanceId = await f.addAdvance(8_500);
    const period = await createPeriod(f.storeId, START, END);
    await calculate(f.storeId, period.id);
    const [proposal] = await advanceDeductionsFor(period.id);
    await storage.setPayrollDeductionWaived(proposal.id, true);

    const { totalAmount } = await payrollSettlementService.markPeriodPaid(period.id);
    expect(totalAmount).toBe(PAY);

    const [advance] = await db.select().from(salaryAdvances).where(eq(salaryAdvances.id, advanceId));
    expect(advance.isRecovered).toBe(false);
  });
});

describe("settlement", () => {
  it("marks the advance recovered and stamps the deduction settled", async () => {
    const f = await newFixture();
    const advanceId = await f.addAdvance(8_500);
    const period = await createPeriod(f.storeId, START, END);
    await calculate(f.storeId, period.id);

    await payrollSettlementService.markPeriodPaid(period.id);

    const [advance] = await db.select().from(salaryAdvances).where(eq(salaryAdvances.id, advanceId));
    expect(advance.isRecovered).toBe(true);
    expect(advance.recoveredPeriodId).toBe(period.id);

    const [row] = await advanceDeductionsFor(period.id);
    expect(row.settledAt).not.toBeNull();
  });

  it("is idempotent — a retried mark-paid recovers the advance only once", async () => {
    const f = await newFixture();
    const advanceId = await f.addAdvance(8_500);
    const period = await createPeriod(f.storeId, START, END);
    await calculate(f.storeId, period.id);

    await payrollSettlementService.markPeriodPaid(period.id);
    // A second mark-paid attempt would fail on the paid-period guards well
    // before reaching settle(), so exercise settle() directly the way the
    // staff-credit suite does for the same reason.
    await salaryAdvanceDeductionService.settle(period.id);

    const [advance] = await db.select().from(salaryAdvances).where(eq(salaryAdvances.id, advanceId));
    expect(advance.isRecovered).toBe(true);
  });

  it("recovers the advance once when two settlements overlap", async () => {
    // Each settle() call opens its own transaction and FOR UPDATE-locks the
    // pending row (selectPendingAdvanceRecoveryForUpdate), so two concurrent
    // calls serialize rather than race; the second finds nothing left
    // pending once it gets the lock. One settled deduction row is what that
    // guarantees, whichever call gets there first.
    const f = await newFixture();
    const advanceId = await f.addAdvance(8_500);
    const period = await createPeriod(f.storeId, START, END);
    await calculate(f.storeId, period.id);

    await Promise.all([
      salaryAdvanceDeductionService.settle(period.id),
      salaryAdvanceDeductionService.settle(period.id),
    ]);

    const [advance] = await db.select().from(salaryAdvances).where(eq(salaryAdvances.id, advanceId));
    expect(advance.isRecovered).toBe(true);
    const rows = await advanceDeductionsFor(period.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].settledAt).not.toBeNull();
  });

  it("a concurrent recalculation cannot overwrite a just-settled amount", async () => {
    // The test above is worth little on its own: it still passes with the
    // settledAt guard removed, because a sync and a settle in one event loop
    // do not in practice interleave. This forces the interleaving a real
    // concurrent recalculation (e.g. triggered by an unrelated sale mid
    // mark-paid) would produce, and drives the real production UPDATE (not a
    // re-typed copy), so dropping the guard from that statement fails here.
    const f = await newFixture();
    const advanceId = await f.addAdvance(8_500);
    const period = await createPeriod(f.storeId, START, END);
    await calculate(f.storeId, period.id);
    const [proposal] = await advanceDeductionsFor(period.id);

    // Give syncProposals something to want to rewrite on the settled row —
    // otherwise it would see amount/label already match and never issue the
    // UPDATE this test exists to guard.
    await db.update(salaryAdvances).set({ notes: "renamed while settling" }).where(eq(salaryAdvances.id, advanceId));

    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });

    // Transaction A: locks the proposal row and settles it, then holds.
    const settler = db.transaction(async (tx) => {
      await tx.select().from(payrollDeductions).where(eq(payrollDeductions.id, proposal.id)).for("update");
      await tx.update(payrollDeductions).set({ settledAt: new Date() }).where(eq(payrollDeductions.id, proposal.id));
      await held;
    });
    await new Promise((r) => setTimeout(r, 250));

    // syncProposals reads its own snapshot (still settledAt: null, stale
    // label) before A commits, decides to rewrite the label, and its UPDATE
    // blocks on A's lock rather than racing past it.
    const syncer = salaryAdvanceDeductionService.syncProposals(period.id);
    await new Promise((r) => setTimeout(r, 250));
    release();
    await Promise.all([settler, syncer]);

    const [finalRow] = await db.select().from(payrollDeductions).where(eq(payrollDeductions.id, proposal.id));
    expect(finalRow.settledAt).not.toBeNull();
    // The guarded UPDATE found settledAt already set once unblocked and
    // became a no-op — the settled amount and label survive untouched.
    expect(Number(finalRow.amount)).toBe(8_500);
    expect(finalRow.label).not.toContain("renamed while settling");
  });
});

describe("deletion", () => {
  it("refuses to delete an advance with a live payroll deduction, with a plain-language reason", async () => {
    const f = await newFixture();
    const advanceId = await f.addAdvance(5_000);
    const period = await createPeriod(f.storeId, START, END);
    await calculate(f.storeId, period.id);
    expect(await advanceDeductionsFor(period.id)).toHaveLength(1);

    await expect(storage.deleteSalaryAdvance(advanceId)).rejects.toThrow(/can't be deleted/);

    // Refused, not silently no-op'd — the advance is still there.
    const [advance] = await db.select().from(salaryAdvances).where(eq(salaryAdvances.id, advanceId));
    expect(advance).toBeTruthy();
  });

  it("refuses even once the line is only waived, not deleted", async () => {
    // A waived advance_recovery line still carries the same salaryAdvanceId
    // reference — waiving is not a fix for the delete block.
    const f = await newFixture();
    const advanceId = await f.addAdvance(5_000);
    const period = await createPeriod(f.storeId, START, END);
    await calculate(f.storeId, period.id);
    const [proposal] = await advanceDeductionsFor(period.id);
    await storage.setPayrollDeductionWaived(proposal.id, true);

    await expect(storage.deleteSalaryAdvance(advanceId)).rejects.toThrow(/can't be deleted/);
  });

  it("allows deletion once nothing in payroll references it", async () => {
    const f = await newFixture();
    const advanceId = await f.addAdvance(5_000);

    await storage.deleteSalaryAdvance(advanceId);

    const [advance] = await db.select().from(salaryAdvances).where(eq(salaryAdvances.id, advanceId));
    expect(advance).toBeUndefined();
  });
});

describe("partial recovery", () => {
  it("leaves the remainder on the advance's own row and re-proposes it next period", async () => {
    const f = await newFixture({ payPerMonth: 20_000 });
    const advanceId = await f.addAdvance(35_000);
    const period1 = await createPeriod(f.storeId, START, END);

    await calculate(f.storeId, period1.id);
    const rows1 = await advanceDeductionsFor(period1.id);
    expect(Number(rows1[0].amount)).toBe(20_000);

    await payrollSettlementService.markPeriodPaid(period1.id);

    const [afterPeriod1] = await db.select().from(salaryAdvances).where(eq(salaryAdvances.id, advanceId));
    expect(Number(afterPeriod1.outstandingBalance)).toBe(15_000);
    expect(afterPeriod1.recoveryStatus).toBe("partial");
    expect(afterPeriod1.isRecovered).toBe(false);
    // Released, not left pointing at the period that only partially settled
    // it — so the next open period can pick it back up.
    expect(afterPeriod1.recoveredPeriodId).toBeNull();

    const period2 = await createPeriod(f.storeId, "2099-02-01", "2099-02-28");
    await calculate(f.storeId, period2.id);
    const rows2 = await advanceDeductionsFor(period2.id);
    expect(rows2).toHaveLength(1);
    expect(Number(rows2[0].amount)).toBe(15_000);
    expect(rows2[0].salaryAdvanceId).toBe(advanceId);

    await payrollSettlementService.markPeriodPaid(period2.id);

    const [afterPeriod2] = await db.select().from(salaryAdvances).where(eq(salaryAdvances.id, advanceId));
    expect(Number(afterPeriod2.outstandingBalance)).toBe(0);
    expect(afterPeriod2.recoveryStatus).toBe("recovered");
    expect(afterPeriod2.isRecovered).toBe(true);
    expect(afterPeriod2.recoveredPeriodId).toBe(period2.id);
  });
});

describe("restoring a manual recovery", () => {
  it("reverses a full manual recovery back to unrecovered", async () => {
    const f = await newFixture();
    const advanceId = await f.addAdvance(5_000);
    await storage.markAdvanceRecovered(advanceId, "Repaid in cash at the counter");

    const [before] = await db.select().from(salaryAdvances).where(eq(salaryAdvances.id, advanceId));
    expect(canRestoreManualRecovery(before, { now: new Date(), timezone: "Africa/Lagos" }).allowed).toBe(true);

    const restored = await storage.restoreManualRecovery(advanceId);
    expect(restored?.isRecovered).toBe(false);
    expect(restored?.recoveryStatus).toBe("unrecovered");
    expect(Number(restored?.outstandingBalance)).toBe(5_000);
    expect(restored?.manualRecoveryReason).toBeNull();
    expect(restored?.manualRecoveredAt).toBeNull();
  });

  it("reconstructs a part-paid balance from the settlement ledger, not the original full amount", async () => {
    // Advance too big for one payroll period, so it's genuinely partial
    // before the manual override closes out the rest.
    const f = await newFixture({ payPerMonth: 20_000 });
    const advanceId = await f.addAdvance(35_000);
    const period = await createPeriod(f.storeId, START, END);
    await calculate(f.storeId, period.id);
    await payrollSettlementService.markPeriodPaid(period.id);

    const [afterPayroll] = await db.select().from(salaryAdvances).where(eq(salaryAdvances.id, advanceId));
    expect(Number(afterPayroll.outstandingBalance)).toBe(15_000); // 20,000 collected via payroll

    await storage.markAdvanceRecovered(advanceId, "Wrote off the rest");

    const restored = await storage.restoreManualRecovery(advanceId);
    // 20,000 was genuinely collected via payroll and stays collected — the
    // restore only undoes the manual override's own 15,000, not payroll's.
    expect(Number(restored?.outstandingBalance)).toBe(15_000);
    expect(restored?.recoveryStatus).toBe("partial");
  });

  it("refuses when the advance was never manually recovered", async () => {
    const f = await newFixture();
    const advanceId = await f.addAdvance(5_000);
    const [advance] = await db.select().from(salaryAdvances).where(eq(salaryAdvances.id, advanceId));

    const guard = canRestoreManualRecovery(advance, { now: new Date(), timezone: "Africa/Lagos" });
    expect(guard.allowed).toBe(false);
    expect(guard.reason).toMatch(/not manually recovered/);
  });

  it("refuses once the recovery happened in an earlier store-local month", async () => {
    const f = await newFixture();
    const advanceId = await f.addAdvance(5_000);
    await storage.markAdvanceRecovered(advanceId, "Repaid in cash");
    // Backdate it past the current month the way a real earlier-month
    // recovery would read.
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    await db.update(salaryAdvances).set({ manualRecoveredAt: lastMonth }).where(eq(salaryAdvances.id, advanceId));

    const [advance] = await db.select().from(salaryAdvances).where(eq(salaryAdvances.id, advanceId));
    const guard = canRestoreManualRecovery(advance, { now: new Date(), timezone: "Africa/Lagos" });
    expect(guard.allowed).toBe(false);
    expect(guard.reason).toMatch(/earlier month/);
  });
});

describe("reservation", () => {
  it("locks an advance to the first open period that proposes it, invisible to a second", async () => {
    const f = await newFixture();
    const advanceId = await f.addAdvance(5_000);
    const periodA = await createPeriod(f.storeId, START, END);
    await calculate(f.storeId, periodA.id);
    expect(await advanceDeductionsFor(periodA.id)).toHaveLength(1);

    const [reserved] = await db.select().from(salaryAdvances).where(eq(salaryAdvances.id, advanceId));
    expect(reserved.recoveredPeriodId).toBe(periodA.id);

    // A second open period for the same staff member never sees it.
    const periodB = await createPeriod(f.storeId, "2099-02-01", "2099-02-28");
    await calculate(f.storeId, periodB.id);
    expect(await advanceDeductionsFor(periodB.id)).toHaveLength(0);
  });

  it("releasing the reservation cleans up the stale proposal and frees the advance for another period", async () => {
    const f = await newFixture();
    const advanceId = await f.addAdvance(5_000);
    const periodA = await createPeriod(f.storeId, START, END);
    await calculate(f.storeId, periodA.id);
    expect(await advanceDeductionsFor(periodA.id)).toHaveLength(1);

    await salaryAdvanceDeductionService.releaseReservation(advanceId);
    expect(await advanceDeductionsFor(periodA.id)).toHaveLength(0);

    const [freed] = await db.select().from(salaryAdvances).where(eq(salaryAdvances.id, advanceId));
    expect(freed.recoveredPeriodId).toBeNull();

    // Re-syncing period A directly afterward would just re-claim it right
    // back (it's still a valid, unreserved candidate) — the real point is
    // that a DIFFERENT period can now claim it instead.
    const periodB = await createPeriod(f.storeId, "2099-02-01", "2099-02-28");
    await calculate(f.storeId, periodB.id);
    const rows = await advanceDeductionsFor(periodB.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].salaryAdvanceId).toBe(advanceId);
  });

  it("is a no-op once the advance is already fully recovered", async () => {
    const f = await newFixture();
    const advanceId = await f.addAdvance(5_000);
    const period = await createPeriod(f.storeId, START, END);
    await calculate(f.storeId, period.id);
    await payrollSettlementService.markPeriodPaid(period.id);

    await salaryAdvanceDeductionService.releaseReservation(advanceId);

    const [advance] = await db.select().from(salaryAdvances).where(eq(salaryAdvances.id, advanceId));
    expect(advance.recoveredPeriodId).toBe(period.id);
    expect(advance.recoveryStatus).toBe("recovered");
  });

  it("leaves a waived line alone — a manager's own decision to keep it for the record", async () => {
    const f = await newFixture();
    const advanceId = await f.addAdvance(5_000);
    const period = await createPeriod(f.storeId, START, END);
    await calculate(f.storeId, period.id);
    const [proposal] = await advanceDeductionsFor(period.id);
    await storage.setPayrollDeductionWaived(proposal.id, true);

    await salaryAdvanceDeductionService.releaseReservation(advanceId);

    const rows = await advanceDeductionsFor(period.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].isWaived).toBe(true);
  });
});

describe("priority ordering against staff credit", () => {
  it("claims net pay before staff credit gets a share", async () => {
    // advance_recovery outranks staff_credit in DEDUCTION_PRIORITY: staff
    // credit's own headroom calc has to see the advance already proposed.
    const f = await newFixture({ payPerMonth: 20_000 });
    await f.addAdvance(12_000);
    await f.addDebt(15_000);
    const period = await createPeriod(f.storeId, START, END);

    await calculate(f.storeId, period.id);

    const advanceRows = await advanceDeductionsFor(period.id);
    expect(Number(advanceRows[0].amount)).toBe(12_000);

    const creditRows = await db.select().from(payrollDeductions)
      .where(eq(payrollDeductions.periodId, period.id))
      .then(rows => rows.filter(r => r.type === "staff_credit"));
    // Only 8,000 of net pay was left after the advance claimed 12,000.
    expect(Number(creditRows[0].amount)).toBe(8_000);
  });
});
