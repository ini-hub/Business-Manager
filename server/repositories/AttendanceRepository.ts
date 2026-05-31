import { db } from "../db";
import {
  attendanceRecords,
  type AttendanceRecord,
  type InsertAttendanceRecord,
  type AttendanceStatus,
} from "@shared/schema";
import { eq, and, gte, lte, asc } from "drizzle-orm";

export class AttendanceRepository {
  async getAttendanceRecords(storeId: string, options: {
    staffId?: string;
    startDate?: string;
    endDate?: string;
  } = {}): Promise<AttendanceRecord[]> {
    const conditions: any[] = [eq(attendanceRecords.storeId, storeId)];
    if (options.staffId) conditions.push(eq(attendanceRecords.staffId, options.staffId));
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
      const [updated] = await db.update(attendanceRecords)
        .set({
          status: data.status,
          notes: data.notes ?? null,
          markedByUserId: data.markedByUserId ?? null,
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

  async bulkMarkAttendance(storeId: string, date: string, status: AttendanceStatus, staffIds: string[], markedByUserId?: string): Promise<AttendanceRecord[]> {
    const results: AttendanceRecord[] = [];
    for (const staffId of staffIds) {
      const record = await this.upsertAttendanceRecord({ storeId, staffId, date, status, markedByUserId });
      results.push(record);
    }
    return results;
  }

  async getAttendanceSummary(storeId: string, staffId: string, startDate: string, endDate: string): Promise<{
    present: number;
    absent: number;
    offDay: number;
    holiday: number;
    totalWorkingDays: number;
  }> {
    const records = await this.getAttendanceRecords(storeId, { staffId, startDate, endDate });
    const summary = { present: 0, absent: 0, offDay: 0, holiday: 0, totalWorkingDays: 0 };
    for (const r of records) {
      if (r.status === "present") { summary.present++; summary.totalWorkingDays++; }
      else if (r.status === "absent") { summary.absent++; summary.totalWorkingDays++; }
      else if (r.status === "off_day") summary.offDay++;
      else if (r.status === "holiday") summary.holiday++;
    }
    return summary;
  }
}
