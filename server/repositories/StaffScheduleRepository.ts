import { db } from "../db";
import {
  staffSchedules,
  staffScheduleExceptions,
  type StaffSchedule,
  type StaffScheduleException,
} from "@shared/schema";
import { eq, and, gte, lte, asc, sql } from "drizzle-orm";

/**
 * Per-staff off-day rosters: a weekly pattern, plus per-date exceptions for the
 * swaps and cover days a weekly pattern cannot express.
 */
export class StaffScheduleRepository {
  async getSchedulesForStore(storeId: string): Promise<StaffSchedule[]> {
    return await db.select().from(staffSchedules).where(eq(staffSchedules.storeId, storeId));
  }

  async upsertSchedule(
    storeId: string,
    staffId: string,
    weeklyOffDays: number[],
    updatedByUserId?: string,
  ): Promise<StaffSchedule> {
    const [row] = await db
      .insert(staffSchedules)
      .values({
        storeId,
        staffId,
        weeklyOffDays,
        updatedByUserId: updatedByUserId ?? null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: staffSchedules.staffId,
        set: {
          weeklyOffDays: sql`excluded.weekly_off_days`,
          updatedByUserId: sql`excluded.updated_by_user_id`,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  async getExceptionsInRange(
    storeId: string,
    startDate: string,
    endDate: string,
  ): Promise<StaffScheduleException[]> {
    return await db
      .select()
      .from(staffScheduleExceptions)
      .where(and(
        eq(staffScheduleExceptions.storeId, storeId),
        gte(staffScheduleExceptions.date, startDate),
        lte(staffScheduleExceptions.date, endDate),
      ))
      .orderBy(asc(staffScheduleExceptions.date));
  }

  async upsertException(data: {
    storeId: string;
    staffId: string;
    date: string;
    kind: "off" | "working";
    reason?: string | null;
    createdByUserId?: string | null;
  }): Promise<StaffScheduleException> {
    const [row] = await db
      .insert(staffScheduleExceptions)
      .values({
        storeId: data.storeId,
        staffId: data.staffId,
        date: data.date,
        kind: data.kind,
        reason: data.reason ?? null,
        createdByUserId: data.createdByUserId ?? null,
      })
      .onConflictDoUpdate({
        target: [staffScheduleExceptions.staffId, staffScheduleExceptions.date],
        set: {
          kind: sql`excluded.kind`,
          reason: sql`excluded.reason`,
          createdByUserId: sql`excluded.created_by_user_id`,
        },
      })
      .returning();
    return row;
  }

  async deleteException(storeId: string, staffId: string, date: string): Promise<void> {
    await db.delete(staffScheduleExceptions).where(and(
      eq(staffScheduleExceptions.storeId, storeId),
      eq(staffScheduleExceptions.staffId, staffId),
      eq(staffScheduleExceptions.date, date),
    ));
  }
}
