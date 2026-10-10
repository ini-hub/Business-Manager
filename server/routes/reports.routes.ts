import { checkoutInScope, resolveTransactionScope } from "../lib/transactionAccess";
import { getMaskPolicy, isPhoneLikeQuery } from "../lib/dataMasking";
import { getCashFlowTotals } from "../lib/cashFlow";
import { isUniqueViolation } from "../db-errors";
import { getVatByMonth, getServiceStaffDays } from "../lib/storeSummaries";
import { parsePage, paginated } from "../lib/pagination";
import type { Express, Request, Response } from "express";
import { getStoreTimezone, toUtcStart, toUtcEnd, storeToday } from "../lib/dateUtils";
import { formatInTimeZone } from "date-fns-tz";
import { storage } from "../storage";
import { attendanceService } from "../services/AttendanceService";
import { auditLogger } from "../audit";
import { bulkUploadService } from "../services/BulkUploadService";
import { payrollPostingService } from "../services/PayrollPostingService";
import { getUserId, getAuditContext, getUserStores, resolveAccessibleStoreIds, verifyStoreAccess, triggerAutoRecalculate, broadcastChange } from './helpers';
import { requirePermission } from "../lib/permissionGate";

export type RouteMiddlewares = {
  isAuthenticated: any;
  requireRole: (...roles: any[]) => any;
  requireManagerOrOwner: any;
  checkStoreAccess: (storeId: string, req: Request, res: Response) => Promise<boolean>;
};

export function registerReportsRoutes(app: Express, { isAuthenticated, requireRole, requireManagerOrOwner, checkStoreAccess }: RouteMiddlewares): void {
  // ========== SEARCH ==========
  app.get("/api/search", isAuthenticated, async (req, res) => {
    const empty = { customers: [], inventory: [], transactions: [] };
    try {
      const q = ((req.query.q as string) ?? "").trim();
      const storeId = req.query.storeId as string;
      if (!q || q.length < 2) return res.json(empty);
      // Masked viewers can't search by phone number (it would reveal hidden numbers).
      if (isPhoneLikeQuery(q) && (await getMaskPolicy(req)).contact) return res.json(empty);
      if (!storeId) return res.status(400).json({ error: "Store ID required." });

      // "all" is the owner's consolidated view, not a store id — resolving it
      // against the stores table would 404 (or blow up on the uuid cast).
      let storeIds: string[];
      if (storeId === "all") {
        ({ storeIds } = await resolveAccessibleStoreIds(req));
        if (storeIds.length === 0) return res.json(empty);
      } else {
        if (!(await checkStoreAccess(storeId, req, res))) return;
        storeIds = [storeId];
      }

      const [customersRes, inventoryRes, transactionsRes] = await Promise.all([
        storage.searchCustomers(storeIds, q),
        storage.searchInventory(storeIds, q),
        storage.searchTransactions(storeIds, q)
      ]);

      // Receipts are limited to the viewer's own checkouts, same rule as /api/transactions.
      const scope = await resolveTransactionScope((req as any).user, storeIds);
      const scopedTransactions = scope ? transactionsRes.filter((t: any) => checkoutInScope(t, scope)) : transactionsRes;

      res.json({
        customers: customersRes,
        inventory: inventoryRes,
        transactions: scopedTransactions,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Search failed." });
    }
  });
  // ========== NOTIFICATIONS ==========
  app.get("/api/notifications", isAuthenticated, async (req, res) => {
    try {
      const userId = (req as any).user.id;
      const notifications = await storage.getNotifications(userId);
      res.json(notifications);
    } catch (error) {
      console.error("Error loading notifications:", error);
      res.status(500).json({ error: "Could not load notifications." });
    }
  });

  app.patch("/api/notifications/:id/read", isAuthenticated, async (req, res) => {
    try {
      const userId = (req as any).user.id;
      const updated = await storage.markNotificationAsRead(req.params.id, userId);
      if (!updated) {
        return res.status(404).json({ error: "Notification not found." });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error marking notification as read:", error);
      res.status(500).json({ error: "Could not mark notification as read." });
    }
  });

  app.post("/api/notifications/read-all", isAuthenticated, async (req, res) => {
    try {
      const userId = (req as any).user.id;
      await storage.markAllNotificationsAsRead(userId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error marking all notifications as read:", error);
      res.status(500).json({ error: "Could not mark all notifications as read." });
    }
  });
  // ========== REPORTS ==========
  // Staff performance is gated on the GET itself (rule in shared/features.ts) -
  // it is a computed report with no underlying owned records to keep readable
  // after removal (unlike P&L/Expenses), so there is no mutating route to gate.
  app.get("/api/reports/staff-performance", requirePermission("/staffs/performance"), async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;

      if (!storeId) return res.status(400).json({ error: "Please select a store first." });

      if (storeId === "all") {
        const stores = await getUserStores(req);
        if (stores.length === 0) return res.json([]);

        const responses = await Promise.all(
          stores.map(s => storage.getStaffPerformance(s.id, startDate, endDate))
        );

        const mergedMap = new Map<string, any>();
        for (const list of responses) {
          for (const s of list) {
            const key = s.email?.toLowerCase() || s.name.toLowerCase();
            const existing = mergedMap.get(key);
            if (existing) {
              existing.totalRevenue += s.totalRevenue;
              existing.servicesCount += s.servicesCount;
              existing.productsCount += s.productsCount;
              existing.presentDays += s.presentDays;
              existing.absentDays += s.absentDays;
              existing.lateDays += s.lateDays;
            } else {
              mergedMap.set(key, { ...s });
            }
          }
        }
        return res.json(Array.from(mergedMap.values()));
      }

      if (!(await checkStoreAccess(storeId, req, res))) return;

      const data = await storage.getStaffPerformance(storeId, startDate, endDate);
      res.json(data);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Could not fetch staff performance data." });
    }
  });

  // Staff performance breakdown (services + products per staff member)
  app.get("/api/reports/staff-performance/:staffId/breakdown", requirePermission("/staffs/performance"), async (req, res) => {
    try {
      const { staffId } = req.params;
      const storeId = req.query.storeId as string;
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;

      if (!storeId) return res.status(400).json({ error: "Please select a store first." });
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const data = await storage.getStaffBreakdown(staffId, storeId, startDate, endDate);
      res.json(data);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Could not fetch staff breakdown data." });
    }
  });

  // A staff member's own performance — their personal record. staffId comes
  // from the authenticated user's staff record, never from the client, so
  // nobody can page through a colleague's numbers by editing the URL. storeId
  // DOES come from the client (the currently selected store) because the same
  // user can be linked to a staff row in more than one store — the scoped
  // lookup below is itself the access check: a miss means "not staff at that
  // store", not "no staff record at all".
  app.get("/api/reports/my-performance", isAuthenticated, async (req, res) => {
    try {
      const user = (req as any).user;
      const storeId = req.query.storeId as string | undefined;
      const staffMember = await storage.getStaffByUserId(user.id, storeId);
      if (!staffMember) return res.status(404).json({ error: "Staff record not found for this user." });

      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;

      const data = await storage.getStaffPerformance(staffMember.storeId, startDate, endDate, staffMember.id);
      const own = data.find(s => s.id === staffMember.id);
      res.json(own ?? {
        id: staffMember.id,
        name: staffMember.name,
        email: staffMember.email,
        role: staffMember.role,
        totalRevenue: 0,
        servicesCount: 0,
        productsCount: 0,
        presentDays: 0,
        absentDays: 0,
        lateDays: 0,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Could not fetch your performance data." });
    }
  });

  app.get("/api/reports/my-performance/breakdown", isAuthenticated, async (req, res) => {
    try {
      const user = (req as any).user;
      const storeId = req.query.storeId as string | undefined;
      const staffMember = await storage.getStaffByUserId(user.id, storeId);
      if (!staffMember) return res.status(404).json({ error: "Staff record not found for this user." });

      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;

      const data = await storage.getStaffBreakdown(staffMember.id, staffMember.storeId, startDate, endDate);
      res.json(data);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Could not fetch your performance breakdown." });
    }
  });

  // A staff account reading attendance may only ever see its own — `checkStoreAccess`
  // confirms membership of the store, not whose records are being asked for, and a
  // staff-role caller must never be trusted to supply the right `staffId` (or none at
  // all, which would otherwise mean "everyone"). A manager/owner keeps whatever
  // `requestedStaffId` they passed (including none, for "everyone").
  async function resolveAttendanceStaffScope(
    req: Request,
    res: Response,
    requestedStaffId: string | undefined,
    storeId?: string,
  ): Promise<{ ok: true; staffId: string | undefined } | { ok: false }> {
    const userRole = (req as any).user?.role;
    if (userRole !== "staff") return { ok: true, staffId: requestedStaffId };

    const userId = (req as any).user?.id;
    const ownStaff = await storage.getStaffByUserId(userId, storeId);
    if (!ownStaff) {
      res.status(404).json({ error: "No staff record is linked to your account. Ask your manager to link it." });
      return { ok: false };
    }
    return { ok: true, staffId: ownStaff.id };
  }

  // A manager/owner can write anyone's attendance EXCEPT their own — that path
  // has to go through the same punch/geofence flow (or a retro request) as
  // everyone else, so it can't be used to wave yourself in as present. Returns
  // null when the caller has no linked staff record at all, in which case there
  // is no "own record" to collide with.
  async function getOwnStaffId(req: Request, storeId?: string): Promise<string | null> {
    const userId = (req as any).user?.id;
    if (!userId) return null;
    const staffRecord = await storage.getStaffByUserId(userId, storeId);
    return staffRecord?.id ?? null;
  }
  const SELF_MARK_ERROR = "You can't set your own attendance this way — clock in yourself, or file a missed clock-in request if you weren't able to.";

  // Get attendance records
  app.get("/api/attendance", isAuthenticated, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) return res.status(400).json({ error: "Store ID required." });
      if (!(await checkStoreAccess(storeId, req, res))) return;

      // A staff account may only ever read its own attendance — never a colleague's
      // by name, and never the whole store's by omitting staffId. The query param is
      // not trusted; the caller's own linked staff record decides it here.
      const scope = await resolveAttendanceStaffScope(req, res, req.query.staffId as string | undefined, storeId);
      if (!scope.ok) return; // response already sent

      const page = parsePage(req.query);
      const { rows, total } = await storage.getAttendanceRecordsPage(storeId, {
        staffId: scope.staffId,
        startDate: req.query.startDate as string | undefined,
        endDate: req.query.endDate as string | undefined,
      }, page);
      res.json(paginated(rows, total, page));
    } catch (error) {
      res.status(500).json({ error: "Could not load attendance records." });
    }
  });

  // Staff-and-day pairs that did service work, for the attendance screen's active/passive marks. One grouped
  // statement instead of every receipt the store has ever made.
  app.get("/api/attendance/service-days", requirePermission("/staffs"), async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) return res.status(400).json({ error: "Store ID required." });
      if (!(await checkStoreAccess(storeId, req, res))) return;
      const days = await getServiceStaffDays(storeId, req.query.startDate as string | undefined, req.query.endDate as string | undefined);
      res.json({ days });
    } catch (error) {
      res.status(500).json({ error: "Could not load service activity." });
    }
  });

  // Upsert a single attendance record
  app.post("/api/attendance", requirePermission("/staffs"), async (req, res) => {
    try {
      const { storeId, staffId, date, status, notes, isLate, lateMinutes } = req.body;
      if (!storeId || !staffId || !date || !status) {
        return res.status(400).json({ error: "storeId, staffId, date and status are required." });
      }
      // Manual parity with self-check-in's automatic isLate/lateMinutes
      // (server/services/AttendanceService.ts's evaluateLateness) - a
      // manager marking someone present by hand can flag them late too,
      // rather than that information only ever existing for staff who
      // clocked themselves in. isLate is only meaningful alongside
      // "present" - AttendanceRepository.upsertAttendanceRecord already
      // clears it for any other status.
      if (isLate !== undefined && typeof isLate !== "boolean") {
        return res.status(400).json({ error: "isLate must be a boolean." });
      }
      if (lateMinutes !== undefined && lateMinutes !== null && (!Number.isInteger(lateMinutes) || lateMinutes < 0)) {
        return res.status(400).json({ error: "lateMinutes must be a non-negative whole number." });
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const ownStaffId = await getOwnStaffId(req, storeId);
      if (ownStaffId && staffId === ownStaffId) {
        return res.status(403).json({ error: SELF_MARK_ERROR });
      }

      const userId = (req as any).user?.id;
      const record = await storage.upsertAttendanceRecord({
        storeId,
        staffId,
        date,
        status,
        notes,
        markedByUserId: userId,
        ...(isLate !== undefined ? { isLate, lateMinutes: isLate ? (lateMinutes ?? null) : null } : {}),
      });

      const ctx = await getAuditContext(req, { storeId });
      auditLogger.logEvent(ctx, "ATTENDANCE_MARK", "attendance_record", record.id, "success", {
        newValues: { staffId, date, status, notes: notes ?? null, isLate: record.isLate, lateMinutes: record.lateMinutes },
      });

      triggerAutoRecalculate(storeId, date).catch(console.error);
      broadcastChange(req, "attendance", storeId, "updated");

      res.status(200).json(record);
    } catch (error) {
      res.status(500).json({ error: "Could not save attendance record." });
    }
  });

  // Bulk mark attendance for a day
  app.post("/api/attendance/bulk", requirePermission("/staffs"), async (req, res) => {
    try {
      const { storeId, date, status, staffIds } = req.body;
      if (!storeId || !date || !status || !Array.isArray(staffIds)) {
        return res.status(400).json({ error: "storeId, date, status and staffIds array are required." });
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const ownStaffId = await getOwnStaffId(req, storeId);
      if (ownStaffId && staffIds.includes(ownStaffId)) {
        return res.status(403).json({ error: SELF_MARK_ERROR });
      }

      const userId = (req as any).user?.id;
      const records = await storage.bulkMarkAttendance(storeId, date, status, staffIds, userId);

      const ctx = await getAuditContext(req, { storeId });
      auditLogger.logEvent(ctx, "ATTENDANCE_BULK_MARK", "attendance_record", undefined, "success", {
        newValues: { date, status, staffIds },
      });

      triggerAutoRecalculate(storeId, date).catch(console.error);
      broadcastChange(req, "attendance", storeId, "updated");

      res.json(records);
    } catch (error) {
      console.error("Bulk attendance error:", error);
      res.status(500).json({ error: "Could not bulk mark attendance.", detail: (error as Error).message });
    }
  });

  // Attendance summary for a staff member in a date range
  app.get("/api/attendance/summary", isAuthenticated, async (req, res) => {
    try {
      const { storeId, staffId, startDate, endDate } = req.query as Record<string, string>;
      if (!storeId || !staffId || !startDate || !endDate) {
        return res.status(400).json({ error: "storeId, staffId, startDate, and endDate are required." });
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const scope = await resolveAttendanceStaffScope(req, res, staffId, storeId);
      if (!scope.ok) return;

      const summary = await storage.getAttendanceSummary(storeId, scope.staffId!, startDate, endDate);
      res.json(summary);
    } catch (error) {
      res.status(500).json({ error: "Could not load attendance summary." });
    }
  });

  // The attendance log: punches joined onto their day, grouped by ISO week per staff
  // member, paginated over those groups. Powers both "My Attendance" (self, forced
  // below) and the manager Log tab (one person, a chosen group, or the whole store).
  app.get("/api/attendance/log", isAuthenticated, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;
      if (!storeId || !startDate || !endDate) {
        return res.status(400).json({ error: "storeId, startDate and endDate are required." });
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const requested = req.query.staffId;
      const requestedIds = Array.isArray(requested)
        ? (requested as string[])
        : typeof requested === "string" && requested.length > 0
          ? requested.split(",").map((s) => s.trim()).filter(Boolean)
          : [];

      // A staff caller can only ever request their own single id — same rule as
      // GET /api/attendance, applied here instead of via resolveAttendanceStaffScope
      // because this endpoint accepts a *list*, not a single optional staffId. A
      // manager/owner viewing their OWN "My Attendance" page passes `self=1`
      // explicitly — without it, no staffId means "the whole store" for them,
      // which is the Log tab's default and must stay untouched.
      const userRole = (req as any).user?.role;
      const wantsSelf = userRole === "staff" || req.query.self === "1" || req.query.self === "true";
      let staffIds = requestedIds;
      if (wantsSelf) {
        const ownStaff = await storage.getStaffByUserId((req as any).user?.id, storeId);
        if (!ownStaff) {
          return res.status(404).json({ error: "No staff record is linked to your account. Ask your manager to link it." });
        }
        staffIds = [ownStaff.id];
      }

      const page = req.query.page ? parseInt(req.query.page as string, 10) : undefined;
      const pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string, 10) : undefined;

      const log = await attendanceService.getAttendanceLog({ storeId, staffIds, startDate, endDate, page, pageSize });
      res.json(log);
    } catch (error) {
      console.error("Attendance log error:", error);
      res.status(500).json({ error: "Could not load the attendance log." });
    }
  });

  // ── Staff rosters ─────────────────────────────────────────────────────────
  // Which days each staff member is off. Replaces the rule the payroll engine
  // used to hardcode ("Sundays are off-days"), which no salon actually follows.

  app.get("/api/attendance/schedules", isAuthenticated, async (req, res) => {
    try {
      const { storeId, startDate, endDate } = req.query as Record<string, string>;
      if (!storeId) return res.status(400).json({ error: "Store ID required." });
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const settings = await storage.getSettings(storeId);
      const [schedules, exceptions] = await Promise.all([
        storage.getStaffSchedules(storeId),
        startDate && endDate
          ? storage.getStaffScheduleExceptions(storeId, startDate, endDate)
          : Promise.resolve([]),
      ]);

      res.json({
        defaultWeeklyOffDays: settings?.defaultWeeklyOffDays ?? [0],
        schedules,
        exceptions,
      });
    } catch (error) {
      console.error("Load schedules error:", error);
      res.status(500).json({ error: "Could not load staff schedules." });
    }
  });

  app.put("/api/attendance/schedules/:staffId", requirePermission("/staffs"), async (req, res) => {
    try {
      const { storeId, weeklyOffDays } = req.body;
      if (!storeId) return res.status(400).json({ error: "storeId is required." });
      if (!Array.isArray(weeklyOffDays)) {
        return res.status(400).json({ error: "weeklyOffDays must be an array of day numbers (0 = Sunday)." });
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const days = Array.from(new Set(
        weeklyOffDays
          .map((d: unknown) => Math.round(Number(d)))
          .filter((d: number) => Number.isInteger(d) && d >= 0 && d <= 6),
      )).sort((a, b) => a - b);

      const userId = (req as any).user?.id;
      const schedule = await storage.upsertStaffSchedule(storeId, req.params.staffId, days, userId);

      // A roster change re-types every unmarked day in the open period, so the
      // pending payroll has to be recomputed even though no single date changed.
      triggerAutoRecalculate(storeId, await storeToday(storeId)).catch(console.error);
      broadcastChange(req, "attendance", storeId, "updated");

      res.json(schedule);
    } catch (error) {
      console.error("Save schedule error:", error);
      res.status(500).json({ error: "Could not save the staff schedule." });
    }
  });

  app.post("/api/attendance/schedule-exceptions", requirePermission("/staffs"), async (req, res) => {
    try {
      const { storeId, staffId, date, kind, reason } = req.body;
      if (!storeId || !staffId || !date || !kind) {
        return res.status(400).json({ error: "storeId, staffId, date and kind are required." });
      }
      if (kind !== "off" && kind !== "working") {
        return res.status(400).json({ error: "kind must be either 'off' or 'working'." });
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: "date must be in YYYY-MM-DD format." });
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const exception = await storage.upsertStaffScheduleException({
        storeId, staffId, date, kind, reason: reason ?? null,
        createdByUserId: (req as any).user?.id ?? null,
      });

      const ctx = await getAuditContext(req, { storeId });
      auditLogger.logEvent(ctx, "ATTENDANCE_EXCEPTION_APPLY", "staff_schedule_exception", exception.id, "success", {
        newValues: { staffId, date, kind, reason: reason ?? null },
      });

      triggerAutoRecalculate(storeId, date).catch(console.error);
      broadcastChange(req, "attendance", storeId, "updated");

      res.status(201).json(exception);
    } catch (error) {
      console.error("Save schedule exception error:", error);
      res.status(500).json({ error: "Could not save the schedule exception." });
    }
  });

  // ── Self-service clock-in ─────────────────────────────────────────────────
  // These routes never read staffId from the body. The caller's own staff
  // record is the only identity that counts — same rule as
  // GET /api/payroll/my-summary, and the reason a staff member cannot punch in
  // a colleague by editing a request. storeId DOES come from the client (the
  // currently selected store): the same user can be linked to a staff row in
  // more than one store, so it's needed to pick the right one — see
  // getStaffByUserId.
  const resolveOwnStaff = async (req: Request, res: Response, storeId?: string) => {
    const user = (req as any).user;
    const staffRecord = await storage.getStaffByUserId(user.id, storeId);
    if (!staffRecord) {
      res.status(404).json({ error: "No staff record is linked to your account. Ask your manager to link it." });
      return null;
    }
    return staffRecord;
  };

  app.get("/api/attendance/today", isAuthenticated, async (req, res) => {
    try {
      const staffRecord = await resolveOwnStaff(req, res, req.query.storeId as string | undefined);
      if (!staffRecord) return;
      res.json(await attendanceService.getTodayContext(staffRecord.storeId, staffRecord.id));
    } catch (error) {
      console.error("Clock-in context error:", error);
      res.status(500).json({ error: "Could not load your attendance for today." });
    }
  });

  // Self check-in is the paid option (§1) - Attendance recorded by a manager
  // (the /punch/proxy route below) stays free and ungated.
  app.post("/api/attendance/punch", isAuthenticated, async (req, res) => {
    try {
      const staffRecord = await resolveOwnStaff(req, res, req.body?.storeId as string | undefined);
      if (!staffRecord) return;

      const { kind, latitude, longitude, accuracyMeters, deviceId, clientPunchId, clientCapturedAt, queued } = req.body;
      if (kind !== "clock_in" && kind !== "clock_out") {
        return res.status(400).json({ error: "kind must be either 'clock_in' or 'clock_out'." });
      }

      const result = await attendanceService.recordPunch({
        storeId: staffRecord.storeId,
        staffId: staffRecord.id,
        kind,
        source: queued ? "offline_replay" : "self",
        latitude: latitude ?? null,
        longitude: longitude ?? null,
        accuracyMeters: accuracyMeters ?? null,
        deviceId: deviceId ?? null,
        userAgent: req.get("user-agent") ?? null,
        ipAddress: req.ip ?? null,
        clientPunchId: clientPunchId ?? null,
        clientCapturedAt: clientCapturedAt ? new Date(clientCapturedAt) : null,
        queued: !!queued,
        recordedByUserId: (req as any).user?.id ?? null,
      });

      if (!result.ok) {
        // Object form so throwIfResNotOk surfaces `code` to the client — the UI
        // has to tell "you are 180 m away" apart from "your GPS is too vague".
        return res.status(result.status).json({
          error: {
            message: result.message,
            code: result.code,
            distanceMeters: result.distanceMeters,
            radiusMeters: result.radiusMeters,
          },
        });
      }

      triggerAutoRecalculate(staffRecord.storeId, result.localDate).catch(console.error);
      broadcastChange(req, "attendance", staffRecord.storeId, "updated");

      res.status(result.replayed ? 200 : 201).json(result);
    } catch (error) {
      console.error("Punch error:", error);
      res.status(500).json({ error: "Could not record your clock-in." });
    }
  });

  // The manager's safety valve: a phone that died, a staff member with no
  // smartphone at all. Reason is mandatory so the audit trail says why.
  app.post("/api/attendance/punch/proxy", requirePermission("/staffs"), async (req, res) => {
    try {
      const { storeId, staffId, kind, reason, effectiveAt } = req.body;
      if (!storeId || !staffId) return res.status(400).json({ error: "storeId and staffId are required." });
      if (kind !== "clock_in" && kind !== "clock_out") {
        return res.status(400).json({ error: "kind must be either 'clock_in' or 'clock_out'." });
      }
      if (typeof reason !== "string" || reason.trim().length === 0) {
        return res.status(400).json({ error: "A reason is required when clocking in on someone's behalf." });
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const ownStaffId = await getOwnStaffId(req, storeId);
      if (ownStaffId && staffId === ownStaffId) {
        return res.status(403).json({ error: "You can't proxy-punch yourself in — use your own clock-in card, which also keeps the geofence check intact." });
      }

      const result = await attendanceService.recordPunch({
        storeId,
        staffId,
        kind,
        source: "manager_proxy",
        skipGeofence: true,
        effectiveAtOverride: effectiveAt ? new Date(effectiveAt) : null,
        reason: reason.trim(),
        recordedByUserId: (req as any).user?.id ?? null,
      });

      if (!result.ok) return res.status(result.status).json({ error: { message: result.message, code: result.code } });

      const ctx = await getAuditContext(req, { storeId });
      auditLogger.logEvent(ctx, "ATTENDANCE_PROXY_PUNCH", "attendance_punch", result.punch.id, "success", {
        newValues: { staffId, kind, reason: reason.trim(), effectiveAt: effectiveAt ?? null },
      });

      triggerAutoRecalculate(storeId, result.localDate).catch(console.error);
      broadcastChange(req, "attendance", storeId, "updated");

      res.status(201).json(result);
    } catch (error) {
      console.error("Proxy punch error:", error);
      res.status(500).json({ error: "Could not record the clock-in." });
    }
  });

  app.get("/api/attendance/punches", isAuthenticated, async (req, res) => {
    try {
      const { storeId, startDate, endDate } = req.query as Record<string, string>;
      if (!storeId || !startDate || !endDate) {
        return res.status(400).json({ error: "storeId, startDate and endDate are required." });
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;
      const page = parsePage(req.query);
      const { rows, total } = await attendanceService.listPunchesPage(storeId, startDate, endDate, page);
      res.json(paginated(rows, total, page));
    } catch (error) {
      res.status(500).json({ error: "Could not load the clock-in log." });
    }
  });

  // ── Retro-requests ────────────────────────────────────────────────────────

  app.post("/api/attendance/retro-requests", isAuthenticated, async (req, res) => {
    try {
      const staffRecord = await resolveOwnStaff(req, res, req.body?.storeId as string | undefined);
      if (!staffRecord) return;

      const { date, requestedKind, requestedAt, reason } = req.body;
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: "date must be in YYYY-MM-DD format." });
      }
      if (typeof reason !== "string" || reason.trim().length === 0) {
        return res.status(400).json({ error: "Tell your manager what happened." });
      }

      const result = await attendanceService.createRetroRequest({
        storeId: staffRecord.storeId,
        staffId: staffRecord.id,
        date,
        requestedKind: requestedKind === "clock_out" ? "clock_out" : "clock_in",
        requestedAt: requestedAt ? new Date(requestedAt) : new Date(`${date}T09:00:00Z`),
        reason: reason.trim(),
      });

      if (!result.ok) return res.status(result.status).json({ error: result.message });

      broadcastChange(req, "attendance", staffRecord.storeId, "updated");
      res.status(201).json(result.request);
    } catch (error: any) {
      // The partial unique index is the real guard against duplicate open requests.
      if (isUniqueViolation(error)) {
        return res.status(409).json({ error: "You already have an open request for that date." });
      }
      console.error("Retro request error:", error);
      res.status(500).json({ error: "Could not submit your request." });
    }
  });

  app.get("/api/attendance/retro-requests", isAuthenticated, async (req, res) => {
    try {
      const user = (req as any).user;
      const status = req.query.status as string | undefined;
      const storeId = req.query.storeId as string | undefined;

      // Staff always see only their own. The personal "My Attendance" page
      // sends `self=1` explicitly (it needs storeId now too, to pick the
      // right one of a multi-store user's staff rows, so "no storeId" can no
      // longer double as the self signal — same convention as
      // GET /api/attendance/log). The manager queue never sends `self=1`.
      const wantsSelf = user?.role === "staff" || req.query.self === "1" || req.query.self === "true";
      if (wantsSelf) {
        const staffRecord = await resolveOwnStaff(req, res, storeId);
        if (!staffRecord) return;
        const page = parsePage(req.query);
        const own = await attendanceService.listRetroRequestsPage(staffRecord.storeId, { staffId: staffRecord.id, status }, page);
        return res.json(paginated(own.rows, own.total, page));
      }

      if (!storeId) return res.status(400).json({ error: "Store ID required." });
      if (!(await checkStoreAccess(storeId, req, res))) return;
      const page = parsePage(req.query);
      const queue = await attendanceService.listRetroRequestsPage(storeId, { status }, page);
      res.json(paginated(queue.rows, queue.total, page));
    } catch (error) {
      res.status(500).json({ error: "Could not load missed clock-in requests." });
    }
  });

  app.post("/api/attendance/retro-requests/:id/approve", requirePermission("/staffs"), async (req, res) => {
    try {
      const { clearsLateFlag, note } = req.body ?? {};
      const result = await attendanceService.approveRetroRequest(
        req.params.id,
        (req as any).user?.id ?? null,
        !!clearsLateFlag,
        note,
      );
      if (!result.ok) {
        const ctx = await getAuditContext(req);
        auditLogger.logEvent(ctx, "ATTENDANCE_RETRO_APPROVE", "attendance_retro_request", req.params.id, "failure", { errorMessage: result.message });
        return res.status(result.status).json({ error: result.message });
      }

      const request = result.request!;
      const ctx = await getAuditContext(req, { storeId: request.storeId });
      auditLogger.logEvent(ctx, "ATTENDANCE_RETRO_APPROVE", "attendance_retro_request", request.id, "success", {
        newValues: { status: request.status, clearsLateFlag: !!clearsLateFlag, note: note ?? null },
      });
      triggerAutoRecalculate(request.storeId, request.date).catch(console.error);
      broadcastChange(req, "attendance", request.storeId, "updated");
      res.json(result);
    } catch (error) {
      console.error("Approve retro request error:", error);
      res.status(500).json({ error: "Could not approve the request." });
    }
  });

  app.post("/api/attendance/retro-requests/:id/reject", requirePermission("/staffs"), async (req, res) => {
    try {
      const note = req.body?.note;
      if (typeof note !== "string" || note.trim().length === 0) {
        return res.status(400).json({ error: "Give a reason so the staff member knows why." });
      }
      const result = await attendanceService.rejectRetroRequest(req.params.id, (req as any).user?.id ?? null, note.trim());
      if (!result.ok) {
        const ctx = await getAuditContext(req);
        auditLogger.logEvent(ctx, "ATTENDANCE_RETRO_REJECT", "attendance_retro_request", req.params.id, "failure", { errorMessage: result.message });
        return res.status(result.status).json({ error: result.message });
      }

      const request = result.request!;
      const ctx = await getAuditContext(req, { storeId: request.storeId });
      auditLogger.logEvent(ctx, "ATTENDANCE_RETRO_REJECT", "attendance_retro_request", request.id, "success", {
        newValues: { status: request.status, note: note.trim() },
      });
      broadcastChange(req, "attendance", request.storeId, "updated");
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Could not reject the request." });
    }
  });

  // ── Devices ───────────────────────────────────────────────────────────────
  // One phone that clocked in several people is the one thing the geofence
  // cannot see, because everybody involved really is at the salon.

  app.get("/api/attendance/devices", requirePermission("/staffs"), async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) return res.status(400).json({ error: "Store ID required." });
      if (!(await checkStoreAccess(storeId, req, res))) return;
      res.json(await attendanceService.listDevices(storeId));
    } catch (error) {
      res.status(500).json({ error: "Could not load clock-in devices." });
    }
  });

  app.post("/api/attendance/devices/:id/approve", requirePermission("/staffs"), async (req, res) => {
    try {
      const device = await attendanceService.setDeviceApproval(req.params.id, (req as any).user?.id ?? null, false);
      if (!device) return res.status(404).json({ error: "Device not found." });
      broadcastChange(req, "attendance", device.storeId, "updated");
      res.json(device);
    } catch (error) {
      res.status(500).json({ error: "Could not approve the device." });
    }
  });

  app.post("/api/attendance/devices/:id/revoke", requirePermission("/staffs"), async (req, res) => {
    try {
      const device = await attendanceService.setDeviceApproval(req.params.id, null, true);
      if (!device) return res.status(404).json({ error: "Device not found." });
      broadcastChange(req, "attendance", device.storeId, "updated");
      res.json(device);
    } catch (error) {
      res.status(500).json({ error: "Could not revoke the device." });
    }
  });

  app.delete("/api/attendance/schedule-exceptions", requirePermission("/staffs"), async (req, res) => {
    try {
      const { storeId, staffId, date } = req.query as Record<string, string>;
      if (!storeId || !staffId || !date) {
        return res.status(400).json({ error: "storeId, staffId and date are required." });
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;

      await storage.deleteStaffScheduleException(storeId, staffId, date);

      const ctx = await getAuditContext(req, { storeId });
      auditLogger.logEvent(ctx, "ATTENDANCE_EXCEPTION_DELETE", "staff_schedule_exception", undefined, "success", {
        previousValues: { staffId, date },
      });

      triggerAutoRecalculate(storeId, date).catch(console.error);
      broadcastChange(req, "attendance", storeId, "updated");

      res.status(204).end();
    } catch (error) {
      console.error("Delete schedule exception error:", error);
      res.status(500).json({ error: "Could not remove the schedule exception." });
    }
  });

  app.post("/api/expenses/bulk", requirePermission("/expenses"), async (req, res) => {
    try {
      const storeId = req.body.storeId;
      const rawExpenses = req.body.expenses || req.body.data;
      if (!storeId) return res.status(400).json({ error: "Store ID is required." });
      if (!Array.isArray(rawExpenses)) return res.status(400).json({ error: "Expenses must be an array." });

      // Verify user has access to this store
      if (!await verifyStoreAccess(req, storeId)) {
        return res.status(403).json({ error: "You don't have access to this store." });
      }

      const results = await bulkUploadService.importExpenses(rawExpenses, storeId, getUserId(req));
      res.json(results);
    } catch (error) {
      res.status(500).json({ error: "Bulk expense import failed." });
    }
  });
  // VAT collected per month, summed by the database.
  app.get("/api/reports/vat-monthly", requireManagerOrOwner, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) return res.status(400).json({ error: "Store ID is required." });
      if (storeId === "all") {
        const stores = await getUserStores(req);
        const merged = new Map<string, { month: string; taxableSales: number; vatCollected: number; count: number }>();
        for (const list of await Promise.all(stores.map(s => getVatByMonth(s.id)))) {
          for (const m of list) {
            const cur = merged.get(m.month);
            if (cur) { cur.taxableSales += m.taxableSales; cur.vatCollected += m.vatCollected; cur.count += m.count; }
            else merged.set(m.month, { ...m });
          }
        }
        return res.json({ months: Array.from(merged.values()).sort((x, y) => y.month.localeCompare(x.month)) });
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;
      res.json({ months: await getVatByMonth(storeId) });
    } catch (error) {
      res.status(500).json({ error: "Could not load the VAT report." });
    }
  });

  // ---------- 11. CASH FLOW STATEMENT ----------
  app.get("/api/reports/cash-flow", isAuthenticated, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) return res.status(400).json({ error: "Store ID is required." });
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const startDateStr = req.query.startDate as string;
      const endDateStr = req.query.endDate as string;
      const tz = await getStoreTimezone(storeId);

      const start = startDateStr ? toUtcStart(startDateStr, tz) : new Date(new Date().setDate(new Date().getDate() - 30));
      const end = endDateStr ? toUtcEnd(endDateStr, tz) : new Date();

      // Paid expenses are matched on their store-local date. `expenses.date` is a text 'YYYY-MM-DD' already
      // written in store-local wall clock, so it must be compared against local date strings. Deriving them
      // from `start`/`end` via toISOString() re-introduced the very offset toUtcStart/toUtcEnd had just removed
      // — for a UTC+1 store, local midnight is 23:00 the previous day in UTC, so the range picked up an extra
      // day at the start and lost one at the end. Use the request's local dates directly.
      const startStr = startDateStr ?? formatInTimeZone(start, tz, "yyyy-MM-dd");
      const endStr = endDateStr ?? formatInTimeZone(end, tz, "yyyy-MM-dd");

      // Sales, repayments, expenses and drops are summed by the database (see getCashFlowTotals for the rules).
      // Every cost class counts in the expenses: this is a CASH statement, not the accrual P&L, so what matters
      // is money leaving the till. Soft-deleted rows do not count, and neither does the Payroll category —
      // payroll cash comes from the ledger below, net of every deduction and dated the day the period was paid.
      const [totals, payrollCashOut] = await Promise.all([
        getCashFlowTotals(storeId, start, end, startStr, endStr),
        payrollPostingService.getCashOut(storeId, startStr, endStr),
      ]);
      const { cashSales, nonCashSales, cashRepayments, expensesNonCashOut: operatingExpensesNonCashOut, cashDropsTotal } = totals;
      const operatingExpensesCashOut = totals.expensesCashOut + payrollCashOut;

      // Calculations
      const operatingInflow = cashSales + cashRepayments;
      const operatingOutflow = operatingExpensesCashOut + cashDropsTotal;
      const netOperating = operatingInflow - operatingOutflow;

      res.json({
        reportingPeriod: { start, end },
        operatingActivities: {
          cashReceiptsFromCustomers: operatingInflow,
          cashPaidForOperatingExpenses: operatingExpensesCashOut,
          cashDropsFromDrawer: cashDropsTotal,
          netCashFromOperatingActivities: netOperating
        },
        investingActivities: {
          capitalExpenditure: 0,
          netCashFromInvestingActivities: 0
        },
        financingActivities: {
          loansReceived: 0,
          netCashFromFinancingActivities: 0
        },
        netCashIncrease: netOperating,
        cashSummary: {
          cashSales,
          nonCashSales,
          cashRepayments,
          operatingExpensesNonCashOut
        }
      });
    } catch (error) {
      res.status(500).json({ error: "Could not calculate Cash Flow Statement." });
    }
  });

}
