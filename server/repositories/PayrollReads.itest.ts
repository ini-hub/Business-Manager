import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import { eq, sql } from "drizzle-orm";
import { payrollPeriods, payrollEntries, payrollDeductions, staff, attendanceRecords } from "@shared/schema";
import { storage } from "../storage";
import { buildPayrollReport } from "../lib/payrollReport";
import { splitPeriod, splitPay } from "@shared/payroll-take-home";
import {
  assertTestDatabase, ensureSchema, createFixture, createPeriod, sweepResidue, closePool, type Fixture,
} from "../test-support/integration-db";

/**
 * The payroll report, the staff history and the staff summary used to read the whole store's rows per period.
 * They now read narrow, set-based. The per-period reads are kept here as the oracle.
 */

let f: Fixture;
let staffB: string;
let staffC: string;
let periodIds: string[] = [];

async function clearAll(storeId: string) {
  const s = sql`${storeId}`;
  await db.execute(sql`DELETE FROM payroll_deductions WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM payroll_entries WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM attendance_records WHERE store_id = ${s}`);
}

async function clearResidue() {
  const { rows } = await db.execute(sql`SELECT id FROM stores WHERE name LIKE 'Test Store itest-%'`);
  for (const r of rows) await clearAll(r.id as string);
  await sweepResidue();
}

const addStaff = async (name: string, n: number) =>
  (await db.insert(staff).values({
    storeId: f.storeId, name, email: `${name.toLowerCase().replace(/\s/g, "")}-${Date.now()}-${n}@test.local`,
    staffNumber: `SX${n}`, mobileNumber: `0800000${n}`, payPerMonth: 50000,
  } as any).returning())[0].id;

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
  await clearResidue();
  f = await createFixture();
  staffB = await addStaff("Bola Test", 11);
  staffC = await addStaff("Chidi Test", 12);

  const months = [["2026-01-01", "2026-01-31", "paid"], ["2026-02-01", "2026-02-28", "paid"], ["2026-03-01", "2026-03-31", "approved"], ["2026-04-01", "2026-04-30", "pending"]] as const;
  for (const [start, end, status] of months) {
    const p = await createPeriod(f.storeId, start, end);
    await db.update(payrollPeriods).set({ status, paidAt: status === "paid" ? new Date() : null }).where(eq(payrollPeriods.id, p.id));
    periodIds.push(p.id);
  }
  // Everyone has an entry in each period; the amounts differ so ordering and rounding are exercised.
  let n = 0;
  for (const periodId of periodIds) {
    for (const [staffId, net] of [[f.staffId, 65000.55], [staffB, 21000.1], [staffC, 0]] as const) {
      n++;
      await db.insert(payrollEntries).values({
        periodId, storeId: f.storeId, staffId, grossCommission: net * 0.9, totalTransport: net * 0.1, netPay: net + n * 0.01,
      } as any);
    }
  }
  const ded = (periodId: string, staffId: string, amount: number, isWaived = false) =>
    db.insert(payrollDeductions).values({ periodId, storeId: f.storeId, staffId, type: "other", label: "test", amount, isWaived } as any);
  await ded(periodIds[0], staffB, 30000);          // more than B earned: a shortfall
  await ded(periodIds[0], f.staffId, 5000);
  await ded(periodIds[0], f.staffId, 999, true);   // waived: must not count
  await ded(periodIds[1], f.staffId, 1200.5);
  await ded(periodIds[2], f.staffId, 700);

  for (const [date, status] of [["2026-03-02", "present"], ["2026-03-03", "leave"], ["2026-03-04", "holiday"], ["2026-03-05", "absent"], ["2026-03-06", "off_day"], ["2026-03-20", "present"], ["2026-04-01", "present"]] as const) {
    await db.insert(attendanceRecords).values({ storeId: f.storeId, staffId: f.staffId, date, status } as any);
  }
});

afterAll(async () => {
  if (f) { await clearAll(f.storeId); await f.cleanup(); }
  await clearResidue();
  await closePool();
});

describe("payroll report", () => {
  it("matches the per-period calculation for every period", async () => {
    const periods = await storage.getPayrollPeriods(f.storeId);
    const { entries, deductions } = await storage.getPeriodSummaryInputs(periods.map((p) => p.id));
    const got = buildPayrollReport(periods, entries, deductions);

    for (const p of periods) {
      const perEntries = await storage.getPayrollEntries(p.id);
      const perDeductions = await storage.getPayrollDeductions(p.id);
      const want = splitPeriod(perEntries, perDeductions);
      const row = got.find((r) => r.id === p.id)!;
      expect(row.staffCount).toBe(perEntries.length);
      expect(row.totalGrossCommission).toBeCloseTo(perEntries.reduce((s, e) => s + (e.grossCommission || 0), 0), 6);
      expect(row.totalTransport).toBeCloseTo(perEntries.reduce((s, e) => s + (e.totalTransport || 0), 0), 6);
      expect(row.totalNetPay).toBe(want.totalGross);
      expect(row.totalDeductions).toBe(want.totalDeductions);
      expect(row.totalTakeHome).toBe(want.totalTakeHome);
      expect(row.totalShortfall).toBe(want.totalShortfall);
    }
    expect(got.some((r) => r.totalShortfall > 0)).toBe(true); // the shortfall case really is in the data
  });
});

describe("staff history", () => {
  it("matches the per-period reads for the paid periods", async () => {
    const paid = await storage.getPaidPayrollPeriods(f.storeId);
    expect(paid.map((p) => p.status)).toEqual(paid.map(() => "paid"));
    expect(paid).toHaveLength(2);
    const ids = paid.map((p) => p.id);
    const [netPay, deducted] = await Promise.all([storage.getNetPayForStaff(f.staffId, ids), storage.getDeductionTotalsForStaff(f.staffId, ids)]);
    for (const p of paid) {
      const entry = (await storage.getPayrollEntries(p.id)).find((e) => e.staffId === f.staffId);
      const deductions = await storage.getPayrollDeductions(p.id, f.staffId);
      expect(netPay.get(p.id) ?? 0).toBeCloseTo(entry?.netPay || 0, 6);
      expect(splitPay(netPay.get(p.id) ?? 0, deducted.get(p.id) ?? 0)).toEqual(
        splitPay(entry?.netPay || 0, deductions.reduce((s, d) => s + Number(d.amount), 0)),
      );
    }
    // The waived 999 never counts.
    expect(deducted.get(periodIds[0])).toBeCloseTo(5000, 6);
  });
});

describe("staff summary", () => {
  it("finds the open period, the person's own entry and their attendance without loading the rest", async () => {
    const periods = await storage.getPayrollPeriods(f.storeId);
    const wantOpen = periods.find((p) => p.status === "approved" || p.status === "pending");
    const open = await storage.getOpenPayrollPeriod(f.storeId);
    expect(open?.id).toBe(wantOpen?.id);

    const entry = await storage.getPayrollEntryForStaff(open!.id, f.staffId);
    const want = (await storage.getPayrollEntries(open!.id)).find((e) => e.staffId === f.staffId);
    expect(entry?.id).toBe(want?.id);

    const counts = await storage.getAttendanceCounts(f.storeId, f.staffId, "2026-03-01", "2026-03-31");
    const records = await storage.getAttendanceRecords(f.storeId, { staffId: f.staffId, startDate: "2026-03-01", endDate: "2026-03-31" });
    expect(counts).toEqual({
      present: records.filter((r) => r.status === "present" || r.status === "leave" || r.status === "holiday").length,
      absent: records.filter((r) => r.status === "absent").length,
    });
    expect(counts).toEqual({ present: 4, absent: 1 });
  });

  it("has no open period when every period is paid", async () => {
    expect(await storage.getOpenPayrollPeriod("no-such-store")).toBeUndefined();
  });
});
