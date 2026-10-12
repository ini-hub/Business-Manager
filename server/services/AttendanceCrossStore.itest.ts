import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { db } from "../db";
import { and, eq, sql } from "drizzle-orm";
import { attendanceRecords, payrollDeductions, settings, staffStoreAssignments } from "@shared/schema";
import { attendanceService } from "./AttendanceService";
import { payrollService } from "./PayrollService";
import { closeStoreDay, previousLocalDate } from "./AttendanceDayCloseService";
import { storage } from "../storage";
import { storeLocalDate } from "../lib/dateUtils";
import {
  assertTestDatabase, ensureSchema, createFixture, createPeriod, closePool, type Fixture,
} from "../test-support/integration-db";

/**
 * A person assigned to two stores: one clock-in per store per day, lateness judged once on the day's
 * first arrival, late days charged by the home payroll at the home amount. No sweepResidue(): the shared
 * test DB can hold another run's live fixtures.
 *
 * Both stores are Africa/Lagos (UTC+1), opening 09:00 with no grace, so 08:00Z is 09:00 local.
 */

let fixtures: Fixture[] = [];
const AMOUNT = 2_000;
const DAY = "2099-01-10";

async function world() {
  const home = await createFixture({ payPerMonth: 120_000 });
  const away = await createFixture();
  fixtures.push(home, away);
  for (const f of [home, away]) {
    await db.insert(settings).values({ storeId: f.storeId, clockInEnabled: true, openingTime: "09:00", lateGraceMinutes: 0 });
  }
  await db.update(settings).set({ lateDeductionEnabled: true, lateDeductionAmount: AMOUNT }).where(eq(settings.storeId, home.storeId));
  // The person is homed at `home` (fixture staff) and assigned to `away`.
  await db.insert(staffStoreAssignments).values({
    staffId: home.staffId, storeId: away.storeId, staffNumber: `XS-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  });
  const x = home.staffId;

  const punch = (storeId: string, kind: "clock_in" | "clock_out", utc: string) =>
    attendanceService.recordPunch({
      storeId, staffId: x, kind, source: "manager_proxy", skipGeofence: true,
      effectiveAtOverride: new Date(utc), reason: "test", recordedByUserId: null,
    } as any);
  const record = async (storeId: string, date = DAY) =>
    (await db.select().from(attendanceRecords).where(and(
      eq(attendanceRecords.storeId, storeId), eq(attendanceRecords.staffId, x), eq(attendanceRecords.date, date),
    )))[0];
  return { home, away, x, punch, record };
}

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
});

afterEach(async () => {
  for (const f of fixtures) {
    const s = sql`${f.storeId}`;
    await db.execute(sql`DELETE FROM payroll_deductions WHERE store_id = ${s}`);
    await db.execute(sql`DELETE FROM attendance_records WHERE store_id = ${s}`);
    await db.execute(sql`DELETE FROM attendance_retro_requests WHERE store_id = ${s}`);
    await db.execute(sql`DELETE FROM attendance_punches WHERE store_id = ${s}`);
    await db.execute(sql`DELETE FROM staff_devices WHERE store_id = ${s}`);
    await db.execute(sql`DELETE FROM gamification_points_ledger WHERE store_id = ${s}`);
    await db.execute(sql`DELETE FROM gamification_badge_awards WHERE store_id = ${s}`);
    await db.execute(sql`DELETE FROM gamification_streaks WHERE store_id = ${s}`);
    await db.execute(sql`DELETE FROM notifications WHERE store_id = ${s}`).catch(() => undefined);
    await db.execute(sql`DELETE FROM staff_store_assignments WHERE store_id = ${s}`);
  }
  for (const f of fixtures) await f.cleanup();
  fixtures = [];
});

afterAll(async () => {
  await closePool();
});

describe("clock-ins at two stores on one day", () => {
  it("records both, judges only the first arrival, and a later arrival at the other store is not late", async () => {
    const w = await world();
    const first = await w.punch(w.home.storeId, "clock_in", `${DAY}T09:00:00Z`); // 10:00 Lagos: 60 min late
    expect(first.ok && first.isLate).toBe(true);

    const second = await w.punch(w.away.storeId, "clock_in", `${DAY}T13:00:00Z`); // 14:00 Lagos
    expect(second.ok).toBe(true);
    expect(second.ok && second.isLate).toBe(false);

    expect((await w.record(w.home.storeId))?.isLate).toBe(true);
    expect((await w.record(w.away.storeId))?.isLate).toBe(false);
    expect((await w.record(w.away.storeId))?.status).toBe("present");
  });

  it("still refuses a second clock-in at the same store the same day", async () => {
    const w = await world();
    await w.punch(w.home.storeId, "clock_in", `${DAY}T07:30:00Z`);
    const again = await w.punch(w.home.storeId, "clock_in", `${DAY}T07:45:00Z`);
    expect(again.ok).toBe(false);
    expect(!again.ok && again.code).toBe("already_punched");
  });

  it("clock-out closes the clock-in at the same store, and needs one there", async () => {
    const w = await world();
    await w.punch(w.home.storeId, "clock_in", `${DAY}T07:30:00Z`);
    const noClockInHere = await w.punch(w.away.storeId, "clock_out", `${DAY}T15:00:00Z`);
    expect(noClockInHere.ok).toBe(false);
    expect(!noClockInHere.ok && noClockInHere.code).toBe("no_clock_in");

    const out = await w.punch(w.home.storeId, "clock_out", `${DAY}T16:00:00Z`);
    expect(out.ok).toBe(true);
  });

  it("an earlier punch arriving later (offline replay) becomes the day's first and clears the other store's late flag", async () => {
    const w = await world();
    // Recorded first, but really the later arrival: 14:00 Lagos at the away store, judged late.
    const lateAtAway = await w.punch(w.away.storeId, "clock_in", `${DAY}T13:00:00Z`);
    expect(lateAtAway.ok && lateAtAway.isLate).toBe(true);
    expect((await w.record(w.away.storeId))?.isLate).toBe(true);

    // The real first arrival is replayed afterwards: 09:30 Lagos at home, 30 minutes late.
    const replay = await w.punch(w.home.storeId, "clock_in", `${DAY}T08:30:00Z`);
    expect(replay.ok && replay.isLate).toBe(true);

    expect((await w.record(w.home.storeId))?.isLate).toBe(true);
    expect((await w.record(w.away.storeId))?.isLate).toBe(false);
  });

  it("today's context only shows the punches made at that store", async () => {
    const w = await world();
    await attendanceService.recordPunch({
      storeId: w.home.storeId, staffId: w.x, kind: "clock_in", source: "manager_proxy", skipGeofence: true,
      effectiveAtOverride: new Date(), reason: "test", recordedByUserId: null,
    } as any);
    const home = await attendanceService.getTodayContext(w.home.storeId, w.x);
    const away = await attendanceService.getTodayContext(w.away.storeId, w.x);
    expect(home.clockedInAt).not.toBeNull();
    expect(away.clockedInAt).toBeNull();
  });
});

describe("late days across stores in payroll", () => {
  it("charges a late day at an assigned store once, at the home store's amount", async () => {
    const w = await world();
    // Late at the AWAY store (its own record), not at home.
    await db.insert(attendanceRecords).values({
      storeId: w.away.storeId, staffId: w.x, date: "2099-01-12", status: "present", isLate: true, lateMinutes: 25,
    });
    const period = await createPeriod(w.home.storeId, "2099-01-01", "2099-01-31");
    await payrollService.calculatePayrollForPeriod(period.id);

    const rows = await db.select().from(payrollDeductions).where(and(
      eq(payrollDeductions.periodId, period.id), eq(payrollDeductions.type, "late_arrival"),
    ));
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].amount)).toBe(AMOUNT);
    expect(rows[0].lateDate).toBe("2099-01-12");
  });

  it("charges the same date once even if both stores flagged it", async () => {
    const w = await world();
    await db.insert(attendanceRecords).values([
      { storeId: w.home.storeId, staffId: w.x, date: "2099-01-12", status: "present", isLate: true, lateMinutes: 10 },
      { storeId: w.away.storeId, staffId: w.x, date: "2099-01-12", status: "present", isLate: true, lateMinutes: 30 },
    ]);
    const period = await createPeriod(w.home.storeId, "2099-01-01", "2099-01-31");
    await payrollService.calculatePayrollForPeriod(period.id);
    const rows = await db.select().from(payrollDeductions).where(and(
      eq(payrollDeductions.periodId, period.id), eq(payrollDeductions.type, "late_arrival"),
    ));
    expect(rows).toHaveLength(1);
  });

  it("an archived assignment's late days are no longer charged", async () => {
    const w = await world();
    await db.update(staffStoreAssignments).set({ isArchived: true }).where(and(
      eq(staffStoreAssignments.staffId, w.x), eq(staffStoreAssignments.storeId, w.away.storeId),
    ));
    await db.insert(attendanceRecords).values({
      storeId: w.away.storeId, staffId: w.x, date: "2099-01-12", status: "present", isLate: true, lateMinutes: 25,
    });
    const period = await createPeriod(w.home.storeId, "2099-01-01", "2099-01-31");
    await payrollService.calculatePayrollForPeriod(period.id);
    const rows = await db.select().from(payrollDeductions).where(and(
      eq(payrollDeductions.periodId, period.id), eq(payrollDeductions.type, "late_arrival"),
    ));
    expect(rows).toHaveLength(0);
  });
});

describe("day close and visiting staff", () => {
  it("does not mark someone absent at home when they have a record at another store that day", async () => {
    const w = await world();
    const yesterday = previousLocalDate(storeLocalDate(new Date(), "Africa/Lagos"));
    await db.insert(attendanceRecords).values({ storeId: w.away.storeId, staffId: w.x, date: yesterday, status: "present" });

    await closeStoreDay(w.home.storeId);
    expect(await w.record(w.home.storeId, yesterday)).toBeUndefined();
  });

  it("marks them absent at home as before when they have no record anywhere", async () => {
    const w = await world();
    const yesterday = previousLocalDate(storeLocalDate(new Date(), "Africa/Lagos"));
    await closeStoreDay(w.home.storeId);
    const rec = await w.record(w.home.storeId, yesterday);
    expect(["absent", "off_day"]).toContain(rec?.status);
  });

  it("lists visiting staff for operational pickers only, and not once the assignment is archived", async () => {
    const w = await world();
    const opts = { page: 1, limit: 100, includeArchived: true };
    const homed = await storage.getStaffPaginated(w.away.storeId, opts);
    expect(homed.data.map((s) => s.id)).not.toContain(w.x);

    const withVisiting = await storage.getStaffPaginated(w.away.storeId, { ...opts, includeVisiting: true });
    expect(withVisiting.data.map((s) => s.id)).toContain(w.x);

    await db.update(staffStoreAssignments).set({ isArchived: true }).where(and(
      eq(staffStoreAssignments.staffId, w.x), eq(staffStoreAssignments.storeId, w.away.storeId),
    ));
    const after = await storage.getStaffPaginated(w.away.storeId, { ...opts, includeVisiting: true });
    expect(after.data.map((s) => s.id)).not.toContain(w.x);
  });
});
