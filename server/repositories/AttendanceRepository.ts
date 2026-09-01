import { db } from "../db";
import {
  attendanceRecords,
  type AttendanceRecord,
  type InsertAttendanceRecord,
  type AttendanceStatus,
} from "@shared/schema";
import { eq, and, gte, lte, asc, inArray, sql } from "drizzle-orm";

export class AttendanceRepository {
  async getAttendanceRecords(storeId: string, options: {
    staffId?: string;
    /** Multiple staff at once — the manager "group" view. staffId wins if both are given. */
    staffIds?: string[];
    startDate?: string;
    endDate?: string;
  } = {}): Promise<AttendanceRecord[]> {
    const conditions: any[] = [eq(attendanceRecords.storeId, storeId)];
    if (options.staffId) conditions.push(eq(attendanceRecords.staffId, options.staffId));
    else if (options.staffIds && options.staffIds.length > 0) conditions.push(inArray(attendanceRecords.staffId, options.staffIds));
    if (options.startDate) conditions.push(gte(attendanceRecords.date, options.startDate));
    if (options.endDate) conditions.push(lte(attendanceRecords.date, options.endDate));

    return await db.select().from(attendanceRecords)
      .where(and(...conditions))
      .orderBy(asc(attendanceRecords.date));
  }

  async upsertAttendanceRecord(data: InsertAttendanceRecord): Promise<AttendanceRecord> {
    const existing = await db.select().from(attendanceRecords).where(
      and(
        eq(attendanceRecords.storeId, data.storeId),
        eq(attendanceRecords.staffId, data.staffId),
        eq(attendanceRecords.date, data.date)
      )
    );
    if (existing.length > 0) {
      // A manager overriding the day away from "present" is correcting the
      // record, not adding to it — a stale isLate/lateMinutes left over from an
      // earlier punch must not go on charging a late deduction for a day now
      // marked absent, on leave, or otherwise not worked as scheduled.
      const clearsLateFlag = data.status !== "present" && existing[0].isLate;
      const [updated] = await db.update(attendanceRecords)
        .set({
          status: data.status,
          notes: data.notes ?? null,
          markedByUserId: data.markedByUserId ?? null,
          ...(clearsLateFlag ? { isLate: false, lateMinutes: null } : {}),
          updatedAt: new Date(),
        })
        .where(eq(attendanceRecords.id, existing[0].id))
        .returning();
      return updated;
    }
    const [inserted] = await db.insert(attendanceRecords)
      .values({ ...data, updatedAt: new Date() })
      .returning();
    return inserted;
  }

  async getAttendanceRecord(storeId: string, staffId: string, date: string): Promise<AttendanceRecord | undefined> {
    const [row] = await db.select().from(attendanceRecords).where(and(
      eq(attendanceRecords.storeId, storeId),
      eq(attendanceRecords.staffId, staffId),
      eq(attendanceRecords.date, date),
    )).limit(1);
    return row;
  }

  /**
   * Projects a clock-in onto the day record the payroll engine reads.
   *
   * Promotes an absence, an off-day, or a missing row to `present` — a staff
   * member who came in on their day off is present, which is the whole point of
   * letting them clock in. Deliberately does NOT overwrite `leave` or `holiday`:
   * those are decisions somebody made on purpose, and a punch should not silently
   * undo them. The times are still recorded either way.
   */
  async applyClockIn(input: {
    storeId: string;
    staffId: string;
    date: string;
    firstClockInAt: Date;
    isLate: boolean;
    lateMinutes: number | null;
    expectedStartTime: string | null;
    markedByUserId?: string | null;
  }): Promise<AttendanceRecord> {
    const existing = await this.getAttendanceRecord(input.storeId, input.staffId, input.date);

    if (!existing) {
      const [inserted] = await db.insert(attendanceRecords).values({
        storeId: input.storeId,
        staffId: input.staffId,
        date: input.date,
        status: "present",
        markedByUserId: input.markedByUserId ?? null,
        firstClockInAt: input.firstClockInAt,
        isLate: input.isLate,
        lateMinutes: input.lateMinutes,
        expectedStartTime: input.expectedStartTime,
        updatedAt: new Date(),
      }).returning();
      return inserted;
    }

    const keepsDeliberateStatus = existing.status === "leave" || existing.status === "holiday";
    // First punch of the day wins, so a later clock-out or a correction cannot
    // quietly move someone's arrival time forward.
    const firstClockInAt = existing.firstClockInAt ?? input.firstClockInAt;
    const isFirst = existing.firstClockInAt === null;

    const [updated] = await db.update(attendanceRecords).set({
      status: keepsDeliberateStatus ? existing.status : "present",
      firstClockInAt,
      isLate: isFirst ? input.isLate : existing.isLate,
      lateMinutes: isFirst ? input.lateMinutes : existing.lateMinutes,
      expectedStartTime: isFirst ? input.expectedStartTime : existing.expectedStartTime,
      updatedAt: new Date(),
    }).where(eq(attendanceRecords.id, existing.id)).returning();
    return updated;
  }

  async applyClockOut(storeId: string, staffId: string, date: string, at: Date): Promise<AttendanceRecord | undefined> {
    const existing = await this.getAttendanceRecord(storeId, staffId, date);
    if (!existing) return undefined;
    const [updated] = await db.update(attendanceRecords)
      .set({ lastClockOutAt: at, updatedAt: new Date() })
      .where(eq(attendanceRecords.id, existing.id))
      .returning();
    return updated;
  }

  /**
   * Clears a late flag after a manager approved a retro-request and chose to
   * forgive the lateness. Only ever reached from that decision — a punch can
   * never clear its own flag.
   */
  async clearLateFlag(storeId: string, staffId: string, date: string): Promise<void> {
    await db.update(attendanceRecords)
      .set({ isLate: false, lateMinutes: null, updatedAt: new Date() })
      .where(and(
        eq(attendanceRecords.storeId, storeId),
        eq(attendanceRecords.staffId, staffId),
        eq(attendanceRecords.date, date),
      ));
  }

  async markShiftsAutoClosed(recordIds: string[]): Promise<void> {
    if (recordIds.length === 0) return;
    await db.update(attendanceRecords)
      .set({ shiftAutoClosed: true, updatedAt: new Date() })
      .where(inArray(attendanceRecords.id, recordIds));
  }

  /**
   * Writes the day rows the nightly sweep decided were missing. Never overwrites
   * an existing row, so a manager correction made during the day survives.
   */
  async insertMissingDayRecords(rows: Array<{
    storeId: string;
    staffId: string;
    date: string;
    status: AttendanceStatus;
  }>): Promise<number> {
    if (rows.length === 0) return 0;
    const inserted = await db.insert(attendanceRecords)
      .values(rows.map(r => ({ ...r, updatedAt: new Date() })))
      .onConflictDoNothing({
        target: [attendanceRecords.storeId, attendanceRecords.staffId, attendanceRecords.date],
      })
      .returning();
    return inserted.length;
  }

  async getAttendanceSummary(storeId: string, staffId: string, startDate: string, endDate: string): Promise<{
    present: number;
    absent: number;
    leave: number;
    offDay: number;
    holiday: number;
    totalWorkingDays: number;
  }> {
    const records = await this.getAttendanceRecords(storeId, { staffId, startDate, endDate });
    const summary = { present: 0, absent: 0, leave: 0, offDay: 0, holiday: 0, totalWorkingDays: 0 };
    for (const r of records) {
      if (r.status === "present") { summary.present++; summary.totalWorkingDays++; }
      else if (r.status === "absent") { summary.absent++; summary.totalWorkingDays++; }
      else if (r.status === "leave") { summary.leave++; summary.totalWorkingDays++; }
      else if (r.status === "off_day") summary.offDay++;
      else if (r.status === "holiday") summary.holiday++;
    }
    return summary;
  }

  async bulkMarkAttendance(
    storeId: string,
    date: string,
    status: import("@shared/schema").AttendanceStatus,
    staffIds: string[],
    markedByUserId?: string
  ): Promise<AttendanceRecord[]> {
    if (staffIds.length === 0) return [];
    // True bulk upsert — single SQL statement instead of N individual round-trips
    const values = staffIds.map(staffId => ({
      storeId,
      staffId,
      date,
      status,
      markedByUserId: markedByUserId ?? null,
      updatedAt: new Date(),
    }));
    const inserted = await db
      .insert(attendanceRecords)
      .values(values)
      .onConflictDoUpdate({
        target: [attendanceRecords.storeId, attendanceRecords.staffId, attendanceRecords.date],
        set: {
          status: sql`excluded.status`,
          markedByUserId: sql`excluded.marked_by_user_id`,
          // Same correction rule as upsertAttendanceRecord: bulk-marking a day
          // away from "present" must not leave a stale late flag behind.
          ...(status !== "present" ? { isLate: false, lateMinutes: null } : {}),
          updatedAt: new Date(),
        },
      })
      .returning();
    return inserted;
  }
}
