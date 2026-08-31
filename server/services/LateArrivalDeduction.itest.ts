import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { payrollDeductions, attendanceRecords, settings, payrollPostings } from "@shared/schema";
import { payrollService } from "./PayrollService";
import { lateArrivalDeductionService } from "./LateArrivalDeductionService";
import { payrollSettlementService } from "./PayrollSettlementService";
import { POSTING_ACCOUNTS } from "./PayrollPostingService";
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
 * The late-arrival charge shipped its schema (settings.lateDeductionEnabled/
 * Amount, attendance_records.isLate, the late_date column and its unique
 * index) well before this service existed to act on it — PayrollService's
 * drill-down computed what the charge *would* be, but nothing ever wrote it
 * to a real deduction. These pin the properties that make it real: the
 * proposal appears, disappears when the day is no longer late, respects a
 * manager's waiver, outranks staff credit for headroom, and reaches the
 * ledger once the period is paid.
 */

const PAY = 120_000;
const AMOUNT = 2_000;
const START = "2099-01-01";
const END = "2099-01-31";

let fixtures: Fixture[] = [];

async function newFixture() {
  const f = await createFixture({ payPerMonth: PAY });
  fixtures.push(f);
  return f;
}

async function enableLateDeduction(storeId: string, amount = AMOUNT) {
  await db.insert(settings).values({
    storeId,
    lateDeductionEnabled: true,
    lateDeductionAmount: amount,
  });
}

async function markLate(storeId: string, staffId: string, date: string, lateMinutes = 30) {
  await db.insert(attendanceRecords).values({
    storeId,
    staffId,
    date,
    status: "present",
    isLate: true,
    lateMinutes,
  });
}

async function lateDeductionsFor(periodId: string) {
  return db.select().from(payrollDeductions).where(
    and(eq(payrollDeductions.periodId, periodId), eq(payrollDeductions.type, "late_arrival")),
  );
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

describe("late-arrival deduction", () => {
  it("proposes a flat charge for a day attendance flagged late", async () => {
    const f = await newFixture();
    await enableLateDeduction(f.storeId);
    await markLate(f.storeId, f.staffId, "2099-01-10");
    const period = await createPeriod(f.storeId, START, END);

    await payrollService.calculatePayrollForPeriod(period.id);

    const rows = await lateDeductionsFor(period.id);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].amount)).toBe(AMOUNT);
    expect(rows[0].lateDate).toBe("2099-01-10");
    expect(rows[0].isWaived).toBe(false);
  });

  it("proposes one row per late day and re-derives the amount if the setting changes", async () => {
    const f = await newFixture();
    await enableLateDeduction(f.storeId, 1_000);
    await markLate(f.storeId, f.staffId, "2099-01-05");
    await markLate(f.storeId, f.staffId, "2099-01-12");
    const period = await createPeriod(f.storeId, START, END);

    await payrollService.calculatePayrollForPeriod(period.id);
    expect(await lateDeductionsFor(period.id)).toHaveLength(2);

    await db.update(settings).set({ lateDeductionAmount: 1_500 }).where(eq(settings.storeId, f.storeId));
    await lateArrivalDeductionService.syncProposals(period.id);

    const rows = await lateDeductionsFor(period.id);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(Number(row.amount)).toBe(1_500);
  });

  it("drops the proposal once the day is no longer late", async () => {
    const f = await newFixture();
    await enableLateDeduction(f.storeId);
    await markLate(f.storeId, f.staffId, "2099-01-10");
    const period = await createPeriod(f.storeId, START, END);
    await payrollService.calculatePayrollForPeriod(period.id);
    expect(await lateDeductionsFor(period.id)).toHaveLength(1);

    // Mirrors what a retro-approval's clearLateFlag, or a manual attendance
    // correction, does to the underlying record.
    await db.update(attendanceRecords)
      .set({ isLate: false, lateMinutes: null })
      .where(and(eq(attendanceRecords.storeId, f.storeId), eq(attendanceRecords.staffId, f.staffId), eq(attendanceRecords.date, "2099-01-10")));

    await lateArrivalDeductionService.syncProposals(period.id);
    expect(await lateDeductionsFor(period.id)).toHaveLength(0);
  });

  it("keeps a waived line even after the day is corrected, and never re-proposes it", async () => {
    const f = await newFixture();
    await enableLateDeduction(f.storeId);
    await markLate(f.storeId, f.staffId, "2099-01-10");
    const period = await createPeriod(f.storeId, START, END);
    await payrollService.calculatePayrollForPeriod(period.id);

    const [row] = await lateDeductionsFor(period.id);
    await db.update(payrollDeductions).set({ isWaived: true }).where(eq(payrollDeductions.id, row.id));

    // Re-sync while still late: waiver survives the recalculation that fires
    // on every sale.
    await lateArrivalDeductionService.syncProposals(period.id);
    let rows = await lateDeductionsFor(period.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].isWaived).toBe(true);

    // And after the day stops being late too — a forgiven charge must not
    // reappear once cleared, and the frozen row must not be deleted as stale.
    await db.update(attendanceRecords)
      .set({ isLate: false })
      .where(and(eq(attendanceRecords.storeId, f.storeId), eq(attendanceRecords.staffId, f.staffId), eq(attendanceRecords.date, "2099-01-10")));
    await lateArrivalDeductionService.syncProposals(period.id);
    rows = await lateDeductionsFor(period.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].isWaived).toBe(true);
  });

  it("removes every live proposal if the charge is switched off, but not a waived one", async () => {
    const f = await newFixture();
    await enableLateDeduction(f.storeId);
    await markLate(f.storeId, f.staffId, "2099-01-10");
    await markLate(f.storeId, f.staffId, "2099-01-11");
    const period = await createPeriod(f.storeId, START, END);
    await payrollService.calculatePayrollForPeriod(period.id);

    const rows = await lateDeductionsFor(period.id);
    await db.update(payrollDeductions).set({ isWaived: true }).where(eq(payrollDeductions.id, rows[0].id));

    await db.update(settings).set({ lateDeductionEnabled: false }).where(eq(settings.storeId, f.storeId));
    await lateArrivalDeductionService.syncProposals(period.id);

    const remaining = await lateDeductionsFor(period.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].isWaived).toBe(true);
  });

  it("outranks staff credit for headroom and actually reduces take-home pay", async () => {
    const f = await newFixture();
    await enableLateDeduction(f.storeId, 5_000);
    await markLate(f.storeId, f.staffId, "2099-01-10");
    await f.addDebt(200_000); // Big enough to want every naira of headroom left.
    const period = await createPeriod(f.storeId, START, END);

    await payrollService.calculatePayrollForPeriod(period.id);

    const [lateRow] = await lateDeductionsFor(period.id);
    expect(Number(lateRow.amount)).toBe(5_000);

    const [creditRow] = await db.select().from(payrollDeductions).where(
      and(eq(payrollDeductions.periodId, period.id), eq(payrollDeductions.type, "staff_credit")),
    );
    // Staff credit only gets what late_arrival left behind.
    expect(Number(creditRow.amount)).toBe(PAY - 5_000);

    const { totalAmount } = await payrollSettlementService.markPeriodPaid(period.id);
    expect(totalAmount).toBe(0); // Fully absorbed: late charge + staff credit == PAY.
  });

  it("posts to the ledger as its own deduction:late_arrival line", async () => {
    const f = await newFixture();
    await enableLateDeduction(f.storeId);
    await markLate(f.storeId, f.staffId, "2099-01-10");
    const period = await createPeriod(f.storeId, START, END);
    await payrollService.calculatePayrollForPeriod(period.id);

    await payrollSettlementService.markPeriodPaid(period.id);

    const lines = await db.select().from(payrollPostings).where(eq(payrollPostings.periodId, period.id));
    const lateLine = lines.find((l) => l.account === `${POSTING_ACCOUNTS.deductionPrefix}late_arrival`);
    expect(lateLine).toBeTruthy();
    expect(Number(lateLine!.amount)).toBe(AMOUNT);
  });

  it("never rewrites a paid period", async () => {
    const f = await newFixture();
    await enableLateDeduction(f.storeId);
    await markLate(f.storeId, f.staffId, "2099-01-10");
    const period = await createPeriod(f.storeId, START, END);
    await payrollService.calculatePayrollForPeriod(period.id);
    await payrollSettlementService.markPeriodPaid(period.id);

    const before = await lateDeductionsFor(period.id);

    // A late day added after the fact (a very late retro-approval, say) must
    // not touch a settled payslip.
    await markLate(f.storeId, f.staffId, "2099-01-20");
    await lateArrivalDeductionService.syncProposals(period.id);

    const after = await lateDeductionsFor(period.id);
    expect(after).toHaveLength(before.length);
  });
});
