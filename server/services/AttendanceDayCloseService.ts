import { db } from "../db";
import { stores, settings as settingsTable, staff as staffTable } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { storage } from "../storage";
import { getStoreTimezone, storeLocalDate } from "../lib/dateUtils";
import { AttendancePunchRepository } from "../repositories/AttendancePunchRepository";
import { AttendanceRepository } from "../repositories/AttendanceRepository";
import { buildScheduleResolver, exceptionKey } from "./attendance/scheduleResolver";

/**
 * Closes out the previous store-local day.
 *
 * Two jobs, both of which have to happen after midnight in the *branch's* own
 * timezone rather than the server's:
 *
 *   1. Reset an unclosed shift. Clocking out is optional, so a missing clock-out
 *      is normal — the shift is simply marked closed and nothing punitive follows.
 *   2. Write the absences. A staff member with no clock-in on a working day is
 *      absent; on a rostered day off they are off. This is what makes the day
 *      visible to a manager and to the staff member while it can still be
 *      corrected, rather than surfacing as a smaller payslip weeks later.
 *
 * Runs every 15 minutes rather than once at midnight so that a restart, a missed
 * tick, or a Render free-tier spin-down cannot lose a day, and every write is
 * either insert-if-missing or a flag set to a constant, so running twice is
 * harmless.
 */

const POLL_INTERVAL_MS = 15 * 60 * 1000;

/** The local date before `today` in the store's timezone. */
export function previousLocalDate(today: string): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export async function closeStoreDay(storeId: string): Promise<{ closed: number; marked: number } | null> {
  const [config] = await db.select().from(settingsTable).where(eq(settingsTable.storeId, storeId)).limit(1);
  if (!config?.clockInEnabled) return null;

  const timezone = await getStoreTimezone(storeId);
  const today = storeLocalDate(new Date(), timezone);
  const yesterday = previousLocalDate(today);

  const punchRepo = new AttendancePunchRepository();
  const recordRepo = new AttendanceRepository();

  // 1. Unclosed shifts — flag them on the day record and move on.
  const openShifts = await punchRepo.getOpenShifts(storeId, yesterday);
  const recordIds: string[] = [];
  for (const shift of openShifts) {
    const record = await recordRepo.getAttendanceRecord(storeId, shift.staffId, shift.localDate);
    if (record && !record.shiftAutoClosed) recordIds.push(record.id);
  }
  await recordRepo.markShiftsAutoClosed(recordIds);

  // 2. Absences for yesterday, for anyone with no record at all.
  const activeStaff = await db.select().from(staffTable).where(and(
    eq(staffTable.storeId, storeId),
    eq(staffTable.isArchived, false),
  ));

  const existing = await storage.getAttendanceRecords(storeId, { startDate: yesterday, endDate: yesterday });
  const haveRecord = new Set(existing.map(r => r.staffId));

  const [schedules, exceptions] = await Promise.all([
    storage.getStaffSchedules(storeId),
    storage.getStaffScheduleExceptions(storeId, yesterday, yesterday),
  ]);
  const isOff = buildScheduleResolver({
    defaultWeeklyOffDays: config.defaultWeeklyOffDays ?? [0],
    schedulesByStaff: new Map(schedules.map(r => [r.staffId, r.weeklyOffDays ?? []])),
    exceptionsByStaffDate: new Map(exceptions.map(e => [exceptionKey(e.staffId, e.date), e.kind as "off" | "working"])),
  });

  const missing = activeStaff
    .filter(s => !haveRecord.has(s.id))
    .map(s => ({
      storeId,
      staffId: s.id,
      date: yesterday,
      status: (isOff(s.id, yesterday) ? "off_day" : "absent") as "off_day" | "absent",
    }));

  // onConflictDoNothing, so a manager correction made during the day survives.
  const marked = await recordRepo.insertMissingDayRecords(missing);

  const absences = missing.filter(m => m.status === "absent").length;
  if (marked > 0 && absences > 0) {
    await storage.notifyManagers(
      storeId,
      "attendance_absences",
      `${absences} staff had no clock-in on ${yesterday} and were recorded absent. Correct it in Attendance if that is wrong.`,
    ).catch(err => console.error("[AttendanceDayClose] notify failed:", err));
  }

  return { closed: recordIds.length, marked };
}

export async function runAttendanceDayClose(): Promise<void> {
  const allStores = await db.select({ id: stores.id, name: stores.name }).from(stores).where(eq(stores.isActive, true));

  for (const store of allStores) {
    try {
      const result = await closeStoreDay(store.id);
      if (result && (result.closed > 0 || result.marked > 0)) {
        console.log(`[AttendanceDayClose] ${store.name}: ${result.closed} shift(s) closed, ${result.marked} day(s) recorded.`);
      }
    } catch (err) {
      console.error(`[AttendanceDayClose] Error processing store ${store.id}:`, err);
    }
  }
}

export function startAttendanceDayCloseService(): void {
  setTimeout(() => runAttendanceDayClose().catch(e => console.error("[AttendanceDayClose]", e)), 15_000);
  setInterval(() => runAttendanceDayClose().catch(e => console.error("[AttendanceDayClose]", e)), POLL_INTERVAL_MS);
  console.log("[AttendanceDayClose] Service started — sweeping every 15 minutes.");
}
