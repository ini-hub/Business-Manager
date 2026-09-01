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
import { startOfISOWeek, endOfISOWeek, format, parseISO } from "date-fns";

export type PunchRejection = {
  ok: false;
  status: 400 | 401 | 403 | 409 | 422;
  code:
    | "clock_in_disabled"
    | "fence_not_configured"
    | "weak_gps"
    | "outside_fence"
    | "pin_required" // reserved: recordPunch() never returns this yet — see requirePunchPin below
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

export type AttendanceLogPunch = {
  id: string;
  kind: "clock_in" | "clock_out";
  source: string;
  effectiveAt: string;
  distanceMeters: number | null;
  withinGeofence: boolean | null;
  deviceTrusted: boolean;
  sharedDeviceFlagged: boolean;
  timeDivergenceFlagged: boolean;
  reason: string | null;
};

export type AttendanceLogDay = {
  date: string;
  status: string;
  isLate: boolean;
  lateMinutes: number | null;
  firstClockInAt: string | null;
  lastClockOutAt: string | null;
  punches: AttendanceLogPunch[];
};

export type AttendanceLogGroup = {
  staffId: string;
  staffName: string;
  weekStart: string;
  weekEnd: string;
  summary: { present: number; late: number; absent: number; offDay: number; holiday: number; leave: number };
  days: AttendanceLogDay[];
};

export type AttendanceLogResult = {
  groups: AttendanceLogGroup[];
  page: number;
  pageSize: number;
  totalGroups: number;
};

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
        message: "This branch has no clock-in/out location set yet. Ask your manager to set it in Settings.",
      };
    }

    // Checked before the Number() coercion below on purpose: Number(null) and
    // Number(undefined pass through a truthy-looking value) collapse to 0,
    // which is a valid latitude/longitude (0, 0) — so a missing fix from the
    // client was silently treated as "at null island" and compared against the
    // real branch, producing a false "you are 5,000+ km away" rejection instead
    // of the "couldn't read your location" one actually meant here.
    if (input.latitude == null || input.longitude == null
      || !isValidLatitude(Number(input.latitude)) || !isValidLongitude(Number(input.longitude))) {
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
        message: `You are about ${Math.round(distanceMeters)} m from the branch. Clocking ${input.kind === "clock_out" ? "out" : "in"} only works within ${radiusMeters} m.`,
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
      // Not yet enforced anywhere (recordPunch never checks it, no client sends a
      // PIN) and its settings-page toggle is hidden for that reason. Still
      // reported here so a client that adds a PIN prompt later has it for free.
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

  /**
   * The attendance log: day-status rows joined with their raw punches, grouped by
   * ISO week per staff member, and paginated over those (staff × week) groups.
   *
   * `staffIds` empty/omitted means "every staff member in the store" — the caller
   * (the route) is responsible for narrowing that to a single id for a staff-role
   * caller before this ever runs; this method does not re-check who is allowed to
   * see whom.
   */
  async getAttendanceLog(query: {
    storeId: string;
    staffIds?: string[];
    startDate: string;
    endDate: string;
    page?: number;
    pageSize?: number;
  }): Promise<AttendanceLogResult> {
    const page = Math.max(1, query.page ?? 1);
    // Capped well above the UI's own page size (6) so an export request — which
    // asks for everything in one page rather than paginating — can still get a
    // full store's worth of (staff × week) groups in one round trip.
    const pageSize = Math.min(500, Math.max(1, query.pageSize ?? 6));

    const allStaff = await storage.getStaffList(query.storeId);
    // An explicit list may name an archived staff member on purpose (e.g. pulling
    // a former employee's history for a dispute); the "everyone" default must not
    // — a manager narrowing the store-wide view only ever sees active staff to pick
    // from, so the unfiltered default should match what that picker shows.
    const staffIds = query.staffIds && query.staffIds.length > 0
      ? query.staffIds
      : allStaff.filter(s => !s.isArchived).map(s => s.id);
    if (staffIds.length === 0) return { groups: [], page, pageSize, totalGroups: 0 };

    const nameById = new Map(allStaff.map(s => [s.id, s.name]));

    const [records, punches] = await Promise.all([
      this.recordRepo.getAttendanceRecords(query.storeId, { staffIds, startDate: query.startDate, endDate: query.endDate }),
      this.punchRepo.getPunchesInRangeForStaff(query.storeId, staffIds, query.startDate, query.endDate),
    ]);

    const punchesByStaffDate = new Map<string, AttendanceLogPunch[]>();
    for (const p of punches) {
      const key = `${p.staffId}|${p.localDate}`;
      const list = punchesByStaffDate.get(key) ?? [];
      list.push({
        id: p.id,
        kind: p.kind as "clock_in" | "clock_out",
        source: p.source,
        effectiveAt: p.effectiveAt.toISOString(),
        distanceMeters: p.distanceMeters ?? null,
        withinGeofence: p.withinGeofence ?? null,
        deviceTrusted: p.deviceTrusted,
        sharedDeviceFlagged: p.sharedDeviceFlagged,
        timeDivergenceFlagged: p.timeDivergenceFlagged,
        reason: p.reason ?? null,
      });
      punchesByStaffDate.set(key, list);
    }

    type Bucket = { staffId: string; weekStart: string; weekEnd: string; days: AttendanceLogDay[] };
    const buckets = new Map<string, Bucket>();
    for (const r of records) {
      const dayDate = parseISO(r.date);
      const weekStart = format(startOfISOWeek(dayDate), "yyyy-MM-dd");
      const weekEnd = format(endOfISOWeek(dayDate), "yyyy-MM-dd");
      const key = `${r.staffId}|${weekStart}`;
      const bucket = buckets.get(key) ?? { staffId: r.staffId, weekStart, weekEnd, days: [] };
      bucket.days.push({
        date: r.date,
        status: r.status as AttendanceLogDay["status"],
        isLate: r.isLate,
        lateMinutes: r.lateMinutes,
        firstClockInAt: r.firstClockInAt ? r.firstClockInAt.toISOString() : null,
        lastClockOutAt: r.lastClockOutAt ? r.lastClockOutAt.toISOString() : null,
        punches: punchesByStaffDate.get(`${r.staffId}|${r.date}`) ?? [],
      });
      buckets.set(key, bucket);
    }

    const groups: AttendanceLogGroup[] = Array.from(buckets.values()).map((b) => {
      // Most recent day first within the week.
      b.days.sort((a, c) => (a.date < c.date ? 1 : a.date > c.date ? -1 : 0));
      const summary = { present: 0, late: 0, absent: 0, offDay: 0, holiday: 0, leave: 0 };
      for (const d of b.days) {
        if (d.status === "present") summary.present++;
        else if (d.status === "absent") summary.absent++;
        else if (d.status === "off_day") summary.offDay++;
        else if (d.status === "holiday") summary.holiday++;
        else if (d.status === "leave") summary.leave++;
        if (d.isLate) summary.late++;
      }
      return {
        staffId: b.staffId,
        staffName: nameById.get(b.staffId) ?? "Unknown",
        weekStart: b.weekStart,
        weekEnd: b.weekEnd,
        summary,
        days: b.days,
      };
    });

    // By staff name, then most recent week first within each staff member.
    groups.sort((a, c) => {
      const byName = a.staffName.localeCompare(c.staffName);
      if (byName !== 0) return byName;
      return a.weekStart < c.weekStart ? 1 : a.weekStart > c.weekStart ? -1 : 0;
    });

    const totalGroups = groups.length;
    const offset = (page - 1) * pageSize;
    return { groups: groups.slice(offset, offset + pageSize), page, pageSize, totalGroups };
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

  // Self-approval check for the retro-request queue: is the person deciding
  // this request the same person who filed it?
  private async isOwnRequest(requestStaffId: string, decidingUserId: string): Promise<boolean> {
    const requestStaff = await storage.getStaff(requestStaffId);
    return !!requestStaff && requestStaff.userId === decidingUserId;
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

    // Nobody decides their own request, manager or owner included — ask a
    // different manager or the owner to review it.
    if (await this.isOwnRequest(request.staffId, decidedByUserId)) {
      return { ok: false as const, status: 403, message: "You can't approve your own request. Ask another manager or the owner to review it." };
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
    if (await this.isOwnRequest(request.staffId, decidedByUserId)) {
      return { ok: false as const, status: 403, message: "You can't reject your own request. Ask another manager or the owner to review it." };
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
