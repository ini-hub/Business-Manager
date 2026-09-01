import { db } from "../db";
import {
  attendancePunches,
  staffDevices,
  attendanceRetroRequests,
  type AttendancePunch,
  type InsertAttendancePunch,
  type StaffDevice,
  type AttendanceRetroRequest,
} from "@shared/schema";
import { eq, and, gte, lte, inArray, isNull, desc, asc, sql } from "drizzle-orm";

/** Punches, the devices they came from, and the requests to correct them. */
export class AttendancePunchRepository {
  // ── Punches ───────────────────────────────────────────────────────────────

  async insertPunch(data: InsertAttendancePunch): Promise<AttendancePunch> {
    const [row] = await db.insert(attendancePunches).values(data).returning();
    return row;
  }

  /** The replay guard: a queued punch resent after a flaky sync. */
  async findByClientPunchId(staffId: string, clientPunchId: string): Promise<AttendancePunch | undefined> {
    const [row] = await db.select().from(attendancePunches).where(and(
      eq(attendancePunches.staffId, staffId),
      eq(attendancePunches.clientPunchId, clientPunchId),
    )).limit(1);
    return row;
  }

  async findDayPunch(staffId: string, localDate: string, kind: string): Promise<AttendancePunch | undefined> {
    const [row] = await db.select().from(attendancePunches).where(and(
      eq(attendancePunches.staffId, staffId),
      eq(attendancePunches.localDate, localDate),
      eq(attendancePunches.kind, kind),
      isNull(attendancePunches.voidedAt),
    )).limit(1);
    return row;
  }

  async getPunchesForStaffDay(staffId: string, localDate: string): Promise<AttendancePunch[]> {
    return await db.select().from(attendancePunches).where(and(
      eq(attendancePunches.staffId, staffId),
      eq(attendancePunches.localDate, localDate),
      isNull(attendancePunches.voidedAt),
    )).orderBy(asc(attendancePunches.effectiveAt));
  }

  async getPunchesForStoreDay(storeId: string, localDate: string): Promise<AttendancePunch[]> {
    return await db.select().from(attendancePunches).where(and(
      eq(attendancePunches.storeId, storeId),
      eq(attendancePunches.localDate, localDate),
      isNull(attendancePunches.voidedAt),
    )).orderBy(asc(attendancePunches.effectiveAt));
  }

  async getPunchesInRange(storeId: string, startDate: string, endDate: string): Promise<AttendancePunch[]> {
    return await db.select().from(attendancePunches).where(and(
      eq(attendancePunches.storeId, storeId),
      gte(attendancePunches.localDate, startDate),
      lte(attendancePunches.localDate, endDate),
      isNull(attendancePunches.voidedAt),
    )).orderBy(desc(attendancePunches.effectiveAt));
  }

  /** Same as {@link getPunchesInRange}, narrowed to one or more staff — the log view. */
  async getPunchesInRangeForStaff(storeId: string, staffIds: string[], startDate: string, endDate: string): Promise<AttendancePunch[]> {
    if (staffIds.length === 0) return [];
    return await db.select().from(attendancePunches).where(and(
      eq(attendancePunches.storeId, storeId),
      inArray(attendancePunches.staffId, staffIds),
      gte(attendancePunches.localDate, startDate),
      lte(attendancePunches.localDate, endDate),
      isNull(attendancePunches.voidedAt),
    )).orderBy(asc(attendancePunches.effectiveAt));
  }

  async flagSharedDevice(punchIds: string[]): Promise<void> {
    if (punchIds.length === 0) return;
    await db.update(attendancePunches)
      .set({ sharedDeviceFlagged: true })
      .where(inArray(attendancePunches.id, punchIds));
  }

  /** Staff with an unclosed shift on a past local date. */
  async getOpenShifts(storeId: string, beforeDate: string): Promise<AttendancePunch[]> {
    const clockIns = await db.select().from(attendancePunches).where(and(
      eq(attendancePunches.storeId, storeId),
      eq(attendancePunches.kind, "clock_in"),
      lte(attendancePunches.localDate, beforeDate),
      isNull(attendancePunches.voidedAt),
    ));
    if (clockIns.length === 0) return [];

    const clockOuts = await db.select({
      staffId: attendancePunches.staffId,
      localDate: attendancePunches.localDate,
    }).from(attendancePunches).where(and(
      eq(attendancePunches.storeId, storeId),
      eq(attendancePunches.kind, "clock_out"),
      lte(attendancePunches.localDate, beforeDate),
      isNull(attendancePunches.voidedAt),
    ));

    const closed = new Set(clockOuts.map(c => `${c.staffId}|${c.localDate}`));
    return clockIns.filter(p => !closed.has(`${p.staffId}|${p.localDate}`));
  }

  // ── Devices ───────────────────────────────────────────────────────────────

  /**
   * Records that a device was used, returning whether it was already known.
   * A new device is never blocked — localStorage is cleared by private browsing
   * and evicted by iOS after a week idle, so blocking would manufacture a support
   * call every time a phone forgot its id.
   */
  async touchDevice(input: {
    storeId: string;
    staffId: string;
    deviceId: string;
    userAgent?: string | null;
  }): Promise<{ device: StaffDevice; isNew: boolean }> {
    const [existing] = await db.select().from(staffDevices).where(and(
      eq(staffDevices.staffId, input.staffId),
      eq(staffDevices.deviceId, input.deviceId),
    )).limit(1);

    if (existing) {
      const [updated] = await db.update(staffDevices)
        .set({ lastSeenAt: new Date(), punchCount: existing.punchCount + 1 })
        .where(eq(staffDevices.id, existing.id))
        .returning();
      return { device: updated, isNew: false };
    }

    const [inserted] = await db.insert(staffDevices).values({
      storeId: input.storeId,
      staffId: input.staffId,
      deviceId: input.deviceId,
      userAgent: input.userAgent ?? null,
      punchCount: 1,
    }).onConflictDoUpdate({
      target: [staffDevices.staffId, staffDevices.deviceId],
      set: { lastSeenAt: new Date(), punchCount: sql`${staffDevices.punchCount} + 1` },
    }).returning();

    return { device: inserted, isNew: true };
  }

  async getDevicesForStore(storeId: string): Promise<StaffDevice[]> {
    return await db.select().from(staffDevices)
      .where(eq(staffDevices.storeId, storeId))
      .orderBy(desc(staffDevices.lastSeenAt));
  }

  async setDeviceApproval(id: string, approvedByUserId: string | null, revoke: boolean): Promise<StaffDevice | undefined> {
    const [row] = await db.update(staffDevices).set(
      revoke
        ? { revokedAt: new Date(), approvedAt: null, approvedByUserId: null }
        : { approvedAt: new Date(), approvedByUserId, revokedAt: null },
    ).where(eq(staffDevices.id, id)).returning();
    return row;
  }

  // ── Retro requests ────────────────────────────────────────────────────────

  async createRetroRequest(data: {
    storeId: string;
    staffId: string;
    date: string;
    requestedKind: string;
    requestedAt: Date;
    reason: string;
  }): Promise<AttendanceRetroRequest> {
    const [row] = await db.insert(attendanceRetroRequests).values(data).returning();
    return row;
  }

  async getRetroRequests(storeId: string, options: { staffId?: string; status?: string } = {}): Promise<AttendanceRetroRequest[]> {
    const conditions: any[] = [eq(attendanceRetroRequests.storeId, storeId)];
    if (options.staffId) conditions.push(eq(attendanceRetroRequests.staffId, options.staffId));
    if (options.status) conditions.push(eq(attendanceRetroRequests.status, options.status));
    return await db.select().from(attendanceRetroRequests)
      .where(and(...conditions))
      .orderBy(desc(attendanceRetroRequests.createdAt));
  }

  async getRetroRequestById(id: string): Promise<AttendanceRetroRequest | undefined> {
    const [row] = await db.select().from(attendanceRetroRequests)
      .where(eq(attendanceRetroRequests.id, id)).limit(1);
    return row;
  }

  async decideRetroRequest(id: string, data: {
    status: "approved" | "rejected";
    decidedByUserId: string | null;
    decisionNote?: string | null;
    clearsLateFlag?: boolean;
    createdPunchId?: string | null;
  }): Promise<AttendanceRetroRequest | undefined> {
    const [row] = await db.update(attendanceRetroRequests).set({
      status: data.status,
      decidedByUserId: data.decidedByUserId,
      decidedAt: new Date(),
      decisionNote: data.decisionNote ?? null,
      clearsLateFlag: data.clearsLateFlag ?? false,
      createdPunchId: data.createdPunchId ?? null,
    }).where(eq(attendanceRetroRequests.id, id)).returning();
    return row;
  }
}
