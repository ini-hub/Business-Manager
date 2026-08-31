import { storage } from "../storage";
import { isUniqueViolation } from "../db-errors";
import { getStoreTimezone, storeLocalDate } from "../lib/dateUtils";
import { haversineMeters, isValidLatitude, isValidLongitude } from "@shared/geo";
import { AttendancePunchRepository } from "../repositories/AttendancePunchRepository";
import { AttendanceRepository } from "../repositories/AttendanceRepository";
import { evaluateLateness } from "./attendance/lateness";
import { resolvePunchTime } from "./attendance/punchTime";
import { detectSharedDevice, detectRapidSuccession } from "./attendance/collusion";
import { buildScheduleResolver, exceptionKey } from "./attendance/scheduleResolver";
import type { AttendancePunch, Settings } from "@shared/schema";

export type PunchRejection = {
  ok: false;
  status: 400 | 401 | 403 | 409 | 422;
  code:
    | "clock_in_disabled"
    | "fence_not_configured"
    | "weak_gps"
    | "outside_fence"
    | "pin_required"
    | "already_punched"
    | "no_clock_in";
  message: string;
  distanceMeters?: number;
  radiusMeters?: number;
};

export type PunchAcceptance = {
  ok: true;
  punch: AttendancePunch;
  isLate: boolean;
  lateMinutes: number;
  localDate: string;
  replayed: boolean;
  deviceIsNew: boolean;
};

export type PunchResult = PunchAcceptance | PunchRejection;

export type RecordPunchInput = {
  storeId: string;
  staffId: string;
  kind: "clock_in" | "clock_out";
  source: "self" | "manager_proxy" | "retro_approved" | "offline_replay";
  latitude?: number | null;
  longitude?: number | null;
  accuracyMeters?: number | null;
  deviceId?: string | null;
  userAgent?: string | null;
  ipAddress?: string | null;
  clientPunchId?: string | null;
  clientCapturedAt?: Date | null;
  queued?: boolean;
  reason?: string | null;
  recordedByUserId?: string | null;
  /** Manager proxy and approved retro-requests bypass the geofence by design. */
  skipGeofence?: boolean;
  /** Overrides the resolved time; used when approving a retro-request. */
  effectiveAtOverride?: Date | null;
};

export class AttendanceService {
  private punchRepo = new AttendancePunchRepository();
  private recordRepo = new AttendanceRepository();

  /**
   * Records one clock-in or clock-out and projects it onto the day record the
   * payroll engine reads.
   *
   * Returns a typed rejection rather than throwing, because the caller needs to
   * distinguish "you are 180 m away" from "your GPS is too vague to tell" — those
   * two look identical to a user and mean completely different things.
   */
  async recordPunch(input: RecordPunchInput): Promise<PunchResult> {
    const settings = await storage.getSettings(input.storeId);
    if (!settings) {
      return { ok: false, status: 400, code: "clock_in_disabled", message: "This branch has no settings configured." };
    }

    if (input.source === "self" && !settings.clockInEnabled) {
      return { ok: false, status: 400, code: "clock_in_disabled", message: "Clock-in is not switched on for this branch." };
    }

    // Idempotent replay: the service worker resending a queued punch after a
    // flaky sync must not create a second one.
    if (input.clientPunchId) {
      const existing = await this.punchRepo.findByClientPunchId(input.staffId, input.clientPunchId);
      if (existing) {
        return {
          ok: true,
          punch: existing,
          isLate: false,
          lateMinutes: 0,
          localDate: existing.localDate,
          replayed: true,
          deviceIsNew: false,
        };
      }
    }

    const geofence = input.skipGeofence ? null : this.checkGeofence(settings, input);
    if (geofence && !geofence.ok) return geofence;

    const timezone = await getStoreTimezone(input.storeId);
    const serverReceivedAt = new Date();
    const timing = resolvePunchTime({
      clientCapturedAt: input.clientCapturedAt ?? null,
      serverReceivedAt,
      queued: input.queued,
      maxAgeMinutes: settings.maxOfflinePunchAgeMinutes ?? 720,
    });
    const effectiveAt = input.effectiveAtOverride ?? timing.effectiveAt;
    const localDate = storeLocalDate(effectiveAt, timezone);

    const duplicate = await this.punchRepo.findDayPunch(input.staffId, localDate, input.kind);
    if (duplicate) {
      return {
        ok: false,
        status: 409,
        code: "already_punched",
        message: input.kind === "clock_in"
          ? "You have already clocked in today."
          : "You have already clocked out today.",
      };
    }

    if (input.kind === "clock_out") {
      const clockIn = await this.punchRepo.findDayPunch(input.staffId, localDate, "clock_in");
      if (!clockIn) {
        return { ok: false, status: 409, code: "no_clock_in", message: "There is no clock-in to close for today." };
      }
    }

    // Bind the device before writing the punch, so the shared-device sweep below
    // sees a complete picture.
    let deviceIsNew = false;
    let deviceRevoked = false;
    if (input.deviceId) {
      const { device, isNew } = await this.punchRepo.touchDevice({
        storeId: input.storeId,
        staffId: input.staffId,
        deviceId: input.deviceId,
        userAgent: input.userAgent,
      });
      deviceIsNew = isNew;
      deviceRevoked = !!device.revokedAt;
    }

    const lateness = input.kind === "clock_in"
      ? evaluateLateness({
          effectiveAt,
          timezone,
          openingTime: settings.openingTime,
          graceMinutes: settings.lateGraceMinutes,
        })
      : null;

    let punch: AttendancePunch;
    try {
      punch = await this.punchRepo.insertPunch({
        storeId: input.storeId,
        staffId: input.staffId,
        localDate,
        kind: input.kind,
        source: input.source,
        effectiveAt,
        serverReceivedAt,
        clientCapturedAt: input.clientCapturedAt ?? null,
        clockSkewSeconds: timing.clockSkewSeconds,
        timeDivergenceFlagged: timing.divergenceFlagged,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        accuracyMeters: input.accuracyMeters ?? null,
        distanceMeters: geofence?.ok ? geofence.distanceMeters : null,
        withinGeofence: geofence?.ok ? true : (input.skipGeofence ? null : false),
        deviceId: input.deviceId ?? null,
        userAgent: input.userAgent ?? null,
        ipAddress: input.ipAddress ?? null,
        // Never trusted if the device was explicitly revoked, even if it isn't
        // "new" — revocation must not be silently overridden by punch history.
        deviceTrusted: input.deviceId ? (!deviceIsNew && !deviceRevoked) : false,
        clientPunchId: input.clientPunchId ?? null,
        reason: input.reason ?? null,
        recordedByUserId: input.recordedByUserId ?? null,
      });
    } catch (err) {
      // Two concurrent requests can both pass the findDayPunch check above
      // before either inserts — the day-kind unique index then rejects the
      // loser at the database instead of the application. That loser is not a
      // server error, it's the same "already punched" outcome the check above
      // exists to report.
      if (isUniqueViolation(err)) {
        return {
          ok: false,
          status: 409,
          code: "already_punched",
          message: input.kind === "clock_in"
            ? "You have already clocked in today."
            : "You have already clocked out today.",
        };
      }
      throw err;
    }

    if (deviceRevoked) {
      await this.notifyManagers(
        input.storeId,
        "attendance_revoked_device",
        `A punch was recorded from a device that was revoked for this staff member. Review the clock-in log for ${localDate}.`,
      );
    }

    if (input.kind === "clock_in" && lateness) {
      await this.recordRepo.applyClockIn({
        storeId: input.storeId,
        staffId: input.staffId,
        date: localDate,
        firstClockInAt: effectiveAt,
        isLate: lateness.isLate,
        lateMinutes: lateness.isLate ? lateness.lateMinutes : null,
        expectedStartTime: settings.openingTime ?? null,
        markedByUserId: input.recordedByUserId ?? null,
      });
    } else {
      await this.recordRepo.applyClockOut(input.storeId, input.staffId, localDate, effectiveAt);
    }

    await this.sweepForSharedDevices(input.storeId, localDate);

    if (timing.divergenceFlagged) {
      await this.notifyManagers(
        input.storeId,
        "attendance_time_divergence",
        `A clock-in was recorded with a device clock the server could not accept. Review the clock-in log for ${localDate}.`,
      );
    }

    return {
      ok: true,
      punch,
      isLate: lateness?.isLate ?? false,
      lateMinutes: lateness?.lateMinutes ?? 0,
      localDate,
      replayed: false,
      deviceIsNew,
    };
  }

  /**
   * Hard block, as specified: outside the radius there is no override. The one
   * distinction that matters is a fix too vague to prove anything either way —
   * that gets its own answer, because telling somebody standing in the salon that
   * they are somewhere else is how a fallback path becomes the daily path.
   */
  private checkGeofence(
    settings: Settings,
    input: RecordPunchInput,
  ): { ok: true; distanceMeters: number } | PunchRejection {
    const centreLat = settings.geofenceLatitude;
    const centreLng = settings.geofenceLongitude;

    if (!isValidLatitude(Number(centreLat)) || !isValidLongitude(Number(centreLng))) {
      return {
        ok: false,
        status: 400,
        code: "fence_not_configured",
        message: "This branch has no clock-in location set yet. Ask your manager to set it in Settings.",
      };
    }

    if (!isValidLatitude(Number(input.latitude)) || !isValidLongitude(Number(input.longitude))) {
      return {
        ok: false,
        status: 422,
        code: "weak_gps",
        message: "Could not read your location. Move near a window or step outside, then try again.",
      };
    }

    const maxAccuracy = settings.geofenceMaxAccuracyMeters ?? 100;
    const accuracy = Number(input.accuracyMeters ?? 0);
    if (accuracy > maxAccuracy) {
      return {
        ok: false,
        status: 422,
        code: "weak_gps",
        message: `Your GPS signal is too weak to confirm you are at the branch (±${Math.round(accuracy)} m). Move near a window or step outside, then try again.`,
      };
    }

    const distanceMeters = haversineMeters(
      { latitude: Number(centreLat), longitude: Number(centreLng) },
      { latitude: Number(input.latitude), longitude: Number(input.longitude) },
    );

    const radiusMeters = settings.geofenceRadiusMeters ?? 50;
    if (distanceMeters > radiusMeters) {
      return {
        ok: false,
        status: 403,
        code: "outside_fence",
        message: `You are about ${Math.round(distanceMeters)} m from the branch. Clock-in only works within ${radiusMeters} m.`,
        distanceMeters: Math.round(distanceMeters),
        radiusMeters,
      };
    }

    return { ok: true, distanceMeters: Math.round(distanceMeters * 100) / 100 };
  }

  /**
   * The check the geofence cannot make. Everyone punched from one phone is inside
   * the fence by definition; what gives it away is that it was the same phone.
   */
  private async sweepForSharedDevices(storeId: string, localDate: string): Promise<void> {
    try {
      const dayPunches = await this.punchRepo.getPunchesForStoreDay(storeId, localDate);
      const punches = dayPunches.map(p => ({
        id: p.id,
        staffId: p.staffId,
        deviceId: p.deviceId,
        effectiveAt: p.effectiveAt,
      }));

      const shared = detectSharedDevice(punches);
      if (shared.length === 0) return;

      await this.punchRepo.flagSharedDevice(shared.flatMap(g => g.punchIds));

      const burst = detectRapidSuccession(punches, 5);
      const worst = burst.length > 0 ? burst : shared;
      const staffCount = Math.max(...worst.map(g => g.staffIds.length));

      await this.notifyManagers(
        storeId,
        "attendance_shared_device",
        burst.length > 0
          ? `${staffCount} staff clocked in from the same device within minutes of each other on ${localDate}. Review the clock-in log.`
          : `${staffCount} staff clocked in from the same device on ${localDate}. Review the clock-in log.`,
      );
    } catch (err) {
      // A detection failure must never cost somebody their clock-in.
      console.error("Shared-device sweep failed:", err);
    }
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  /** Everything the staff clock-in card needs in one round trip. */
  async getTodayContext(storeId: string, staffId: string) {
    const settings = await storage.getSettings(storeId);
    const timezone = await getStoreTimezone(storeId);
    const localDate = storeLocalDate(new Date(), timezone);

    const [punches, record, schedules, exceptions] = await Promise.all([
      this.punchRepo.getPunchesForStaffDay(staffId, localDate),
      this.recordRepo.getAttendanceRecord(storeId, staffId, localDate),
      storage.getStaffSchedules(storeId),
      storage.getStaffScheduleExceptions(storeId, localDate, localDate),
    ]);

    const isOff = buildScheduleResolver({
      defaultWeeklyOffDays: settings?.defaultWeeklyOffDays ?? [0],
      schedulesByStaff: new Map(schedules.map(r => [r.staffId, r.weeklyOffDays ?? []])),
      exceptionsByStaffDate: new Map(exceptions.map(e => [exceptionKey(e.staffId, e.date), e.kind as "off" | "working"])),
    })(staffId, localDate);

    return {
      localDate,
      timezone,
      clockInEnabled: !!settings?.clockInEnabled,
      openingTime: settings?.openingTime ?? null,
      graceMinutes: settings?.lateGraceMinutes ?? 0,
      requirePunchPin: !!settings?.requirePunchPin,
      // Sent so the button can enable itself without a round trip per GPS tick.
      // The server re-validates every punch regardless; this is only for the UI.
      geofence: settings?.geofenceLatitude != null && settings?.geofenceLongitude != null
        ? {
            latitude: Number(settings.geofenceLatitude),
            longitude: Number(settings.geofenceLongitude),
            radiusMeters: settings.geofenceRadiusMeters ?? 50,
            maxAccuracyMeters: settings.geofenceMaxAccuracyMeters ?? 100,
            label: settings.geofencePlaceLabel ?? null,
          }
        : null,
      scheduledOff: isOff,
      clockedInAt: punches.find(p => p.kind === "clock_in")?.effectiveAt ?? null,
      clockedOutAt: punches.find(p => p.kind === "clock_out")?.effectiveAt ?? null,
      isLate: record?.isLate ?? false,
      lateMinutes: record?.lateMinutes ?? null,
      status: record?.status ?? null,
    };
  }

  listPunches(storeId: string, startDate: string, endDate: string) {
    return this.punchRepo.getPunchesInRange(storeId, startDate, endDate);
  }

  listDevices(storeId: string) {
    return this.punchRepo.getDevicesForStore(storeId);
  }

  setDeviceApproval(id: string, approvedByUserId: string | null, revoke: boolean) {
    return this.punchRepo.setDeviceApproval(id, approvedByUserId, revoke);
  }

  // ── Retro-requests ────────────────────────────────────────────────────────

  /**
   * The only way back in after a hard geofence block. Bounded by the store's
   * retro window so it cannot be used to rewrite a settled month.
   */
  async createRetroRequest(input: {
    storeId: string;
    staffId: string;
    date: string;
    requestedKind: "clock_in" | "clock_out";
    requestedAt: Date;
    reason: string;
  }): Promise<{ ok: true; request: any } | { ok: false; status: number; message: string }> {
    const settings = await storage.getSettings(input.storeId);
    const timezone = await getStoreTimezone(input.storeId);
    const today = storeLocalDate(new Date(), timezone);

    if (input.date > today) {
      return { ok: false, status: 400, message: "You cannot request a clock-in for a future date." };
    }

    const maxAgeDays = settings?.retroRequestMaxAgeDays ?? 7;
    const ageDays = Math.floor(
      (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${input.date}T00:00:00Z`)) / 86_400_000,
    );
    if (ageDays > maxAgeDays) {
      return { ok: false, status: 400, message: `Missed clock-ins can only be requested within ${maxAgeDays} days.` };
    }

    // A paid period is closed. Reopening it would mean rewriting a payslip that
    // has already been handed over.
    if (await this.isDateInPaidPeriod(input.storeId, input.date)) {
      return { ok: false, status: 409, message: "That date is in a payroll period that has already been paid." };
    }

    const request = await this.punchRepo.createRetroRequest(input);
    await this.notifyManagers(
      input.storeId,
      "attendance_retro_request",
      `A missed clock-in was reported for ${input.date}. Review it in Attendance.`,
    );
    return { ok: true, request };
  }

  private async isDateInPaidPeriod(storeId: string, date: string): Promise<boolean> {
    const periods = await storage.getPayrollPeriods(storeId);
    const covering = periods.find(p => p.startDate <= date && p.endDate >= date);
    return covering?.status === "paid";
  }

  listRetroRequests(storeId: string, options: { staffId?: string; status?: string } = {}) {
    return this.punchRepo.getRetroRequests(storeId, options);
  }

  /**
   * Approving restores the day. Whether it also forgives the lateness is a
   * separate decision the manager makes here — a dead battery and a genuinely
   * late arrival both arrive as requests, and only a person can tell them apart.
   */
  async approveRetroRequest(id: string, decidedByUserId: string, clearsLateFlag: boolean, note?: string) {
    const request = await this.punchRepo.getRetroRequestById(id);
    if (!request) return { ok: false as const, status: 404, message: "Request not found." };
    if (request.status !== "pending") {
      return { ok: false as const, status: 409, message: "That request has already been decided." };
    }

    // The period may have been paid between the request being filed and being
    // decided — createRetroRequest only checks at filing time. Reopening a paid
    // payslip's attendance here would silently disagree with what was handed out.
    if (await this.isDateInPaidPeriod(request.storeId, request.date)) {
      return { ok: false as const, status: 409, message: "That date is now in a payroll period that has already been paid. This request can no longer be approved." };
    }

    const result = await this.recordPunch({
      storeId: request.storeId,
      staffId: request.staffId,
      kind: request.requestedKind === "clock_out" ? "clock_out" : "clock_in",
      source: "retro_approved",
      skipGeofence: true,
      effectiveAtOverride: request.requestedAt,
      reason: request.reason,
      recordedByUserId: decidedByUserId,
    });

    // An existing punch for that day is not a failure of the approval — the day
    // is already restored, so record the decision and move on. Any other
    // rejection (most commonly "no_clock_in" on a retro clock-out, when the
    // staff member never clocked in at all) means the day was NOT restored, and
    // must not be reported as an approval.
    if (!result.ok && result.code !== "already_punched") {
      return { ok: false as const, status: result.status, message: result.message };
    }
    const punchId = result.ok ? result.punch.id : null;

    if (clearsLateFlag) {
      await this.recordRepo.clearLateFlag(request.storeId, request.staffId, request.date);
    }

    const updated = await this.punchRepo.decideRetroRequest(id, {
      status: "approved",
      decidedByUserId,
      decisionNote: note ?? null,
      clearsLateFlag,
      createdPunchId: punchId,
    });

    return { ok: true as const, request: updated, punchCreated: !!punchId };
  }

  async rejectRetroRequest(id: string, decidedByUserId: string, note: string) {
    const request = await this.punchRepo.getRetroRequestById(id);
    if (!request) return { ok: false as const, status: 404, message: "Request not found." };
    if (request.status !== "pending") {
      return { ok: false as const, status: 409, message: "That request has already been decided." };
    }
    const updated = await this.punchRepo.decideRetroRequest(id, {
      status: "rejected",
      decidedByUserId,
      decisionNote: note,
    });
    return { ok: true as const, request: updated };
  }

  private async notifyManagers(storeId: string, type: string, message: string): Promise<void> {
    try {
      await storage.notifyManagers(storeId, type, message);
    } catch (err) {
      console.error("Attendance notification failed:", err);
    }
  }
}

export const attendanceService = new AttendanceService();
