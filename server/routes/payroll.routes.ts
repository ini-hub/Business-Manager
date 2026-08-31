import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { isAuthenticated } from "../auth";
import {
  insertBusinessSchema,
  insertStoreSchema,
  insertCustomerSchema,
  insertStaffSchema,
  insertInventorySchema,
  insertPromotionSchema,
  insertCustomRoleSchema,
  insertStoreIntegrationSchema,
  insertExpenseSchema,
  type UserRole,
  orders,
  checkouts,
  promotions,
  transactions,
  customers,
  inventory,
  staff,
  customRoles,
  taxRates,
  repayments,
  expenses,
  cashDrops,
  creditEntries,
  cashRegisterSessions,
  salaryAdvances,
  expenseCategories,
  payrollEntries,
  payrollDeductions,
} from "@shared/schema";
import { z } from "zod";
import { db } from "../db";
import { eq, and, gte, lte, gt, count, desc, sql } from "drizzle-orm";
import { sanitizeString, sanitizeUUID, sanitizeNumber, sanitizeBoolean, sanitizePhoneNumber, sanitizeStoreCode } from "../sanitize";
import { auditLogger } from "../audit";
import { bulkUploadService } from "../services/BulkUploadService";
import { analyticsService } from "../services/AnalyticsService";
import { staffCreditDeductionService } from "../services/StaffCreditDeductionService";
import { salaryAdvanceDeductionService } from "../services/SalaryAdvanceDeductionService";
import { canRestoreManualRecovery } from "../lib/advanceBalance";
import { getStoreTimezone } from "../lib/dateUtils";
import { lateArrivalDeductionService } from "../services/LateArrivalDeductionService";
import { splitPay, splitPeriod } from "@shared/payroll-take-home";
import { explainCommission } from "@shared/commission-explainer";
import { payrollSettlementService } from "../services/PayrollSettlementService";
import { getUserId, getClientIp, getAuditContext, formatZodErrors, checkBusinessAccess, getUserStores, verifyStoreAccess, verifyRecordStoreAccess, triggerAutoRecalculate, broadcastChange } from './helpers';
import { withExpenseId } from '../utils/slug-resolver';

export type RouteMiddlewares = {
  isAuthenticated: any;
  requireRole: (...roles: any[]) => any;
  requireManagerOrOwner: any;
  checkStoreAccess: (storeId: string, req: Request, res: Response) => Promise<boolean>;
};

// Re-clamp late-arrival, advance-recovery, and staff-credit proposals after a
// deduction changed. Used on paths where the mutation has already committed:
// the caller's response must still report success, and stale proposals are
// corrected by the next calculation. Late-arrival goes first, then advances —
// each downstream headroom calc reads whatever is already written above it.
async function resyncPriorityDeductions(periodId: string): Promise<void> {
  try {
    await lateArrivalDeductionService.syncProposals(periodId);
  } catch (e) {
    console.error("Failed to re-sync late-arrival deductions:", e);
  }
  try {
    await salaryAdvanceDeductionService.syncProposals(periodId);
  } catch (e) {
    console.error("Failed to re-sync salary advance deductions:", e);
  }
  try {
    await staffCreditDeductionService.syncProposals(periodId);
  } catch (e) {
    console.error("Failed to re-sync staff credit deductions:", e);
  }
}

/**
 * Why an entry's commission came out the way it did.
 *
 * Prefers the explanation snapshotted when the period was calculated — a paid
 * period keeps the one that matches its frozen figures — and derives one for
 * entries written before that snapshot existed.
 */
function commissionExplanationFor(entry: { grossCommission?: number | null; calculationDetails?: unknown } | undefined) {
  const details = (entry?.calculationDetails ?? {}) as Record<string, any>;
  return details.commissionExplanation
    ?? explainCommission({ ...details, grossCommission: entry?.grossCommission ?? 0 });
}

export function registerPayrollRoutes(app: Express, { isAuthenticated, requireRole, requireManagerOrOwner, checkStoreAccess }: RouteMiddlewares): void {
  // ========== STAFF SELF-SERVICE ==========
  app.get("/api/payroll/my-summary", isAuthenticated, async (req, res) => {
    try {
      const user = (req as any).user;
      const staff = await storage.getStaffByUserId(user.id);
      if (!staff) return res.status(404).json({ error: "Staff record not found for this user." });

      const storeId = staff.storeId;
      // Get latest approved payroll period
      const periods = await storage.getPayrollPeriods(storeId);
      const activePeriod = periods.find(p => p.status === "approved" || p.status === "pending");
      
      if (!activePeriod) {
        return res.json({ earnings: 0, attendance: { present: 0, absent: 0 } });
      }

      const entries = await storage.getPayrollEntries(activePeriod.id);
      const entry = entries.find(e => e.staffId === staff.id);
      const attendance = await storage.getAttendanceRecords(storeId, { 
        staffId: staff.id, 
        startDate: activePeriod.startDate, 
        endDate: activePeriod.endDate 
      });

      const present = attendance.filter(r => r.status === "present" || r.status === "leave" || r.status === "holiday").length;
      const absent = attendance.filter(r => r.status === "absent").length;

      // What this person will actually be handed. `earnings` stays on the raw
      // pre-deduction figure for compatibility, but the dashboard leads with
      // takeHomePay — showing the gross made staff expect more than they got.
      const deductions = await storage.getPayrollDeductions(activePeriod.id, staff.id);
      const split = splitPay(entry?.netPay || 0, deductions.reduce((s, d) => s + Number(d.amount), 0));

      res.json({
        period: {
          ...activePeriod,
          label: `${activePeriod.startDate} to ${activePeriod.endDate} (${activePeriod.periodType})`
        },
        earnings: entry?.netPay || 0,
        ...split,
        transport: entry?.totalTransport || 0,
        commission: entry?.grossCommission || 0,
        // Staff see this figure before anyone else does, and a bare zero is
        // the one most likely to be read as the system losing their money.
        commissionExplanation: commissionExplanationFor(entry),
        attendance: { present, absent }
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Could not fetch summary." });
    }
  });

  app.get("/api/payroll/my-history", isAuthenticated, async (req, res) => {
    try {
      const user = (req as any).user;
      const staff = await storage.getStaffByUserId(user.id);
      if (!staff) return res.status(404).json({ error: "Staff record not found for this user." });

      const periods = await storage.getPayrollPeriods(staff.storeId);
      const paidPeriods = periods.filter(p => p.status === "paid");
      
      const history = await Promise.all(paidPeriods.map(async p => {
        const entries = await storage.getPayrollEntries(p.id);
        const entry = entries.find(e => e.staffId === staff.id);
        const deductions = await storage.getPayrollDeductions(p.id, staff.id);
        return {
          id: p.id,
          label: `${p.startDate} to ${p.endDate} (${p.periodType})`,
          startDate: p.startDate,
          endDate: p.endDate,
          netPay: entry?.netPay || 0,
          ...splitPay(entry?.netPay || 0, deductions.reduce((s, d) => s + Number(d.amount), 0)),
          paidAt: p.paidAt || p.createdAt
        };
      }));

      // Filtered on gross, not take-home: a period fully consumed by deductions
      // is still one the staff member worked and should see in their history.
      res.json(history.filter(h => h.grossPay > 0));
    } catch (error) {
      res.status(500).json({ error: "Could not fetch history." });
    }
  });
  // ========== PAYROLL ==========

  // List payroll periods for a store
  app.get("/api/payroll/periods", requireManagerOrOwner, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) return res.status(400).json({ error: "Store ID required." });
      if (!(await checkStoreAccess(storeId, req, res))) return;
      const periods = await storage.getPayrollPeriods(storeId);
      res.json(periods);
    } catch (error) {
      res.status(500).json({ error: "Could not load payroll periods." });
    }
  });

  // Create a new payroll period
  app.post("/api/payroll/periods", requireManagerOrOwner, async (req, res) => {
    try {
      const { storeId, periodType, startDate, endDate } = req.body;
      if (!storeId || !startDate || !endDate) {
        return res.status(400).json({ error: "storeId, startDate, and endDate are required." });
      }
      if (startDate >= endDate) {
        return res.status(400).json({ error: "End date must be after start date." });
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;

      // Block overlapping pending/approved/paid periods (not just paid)
      const existing = await storage.getPayrollPeriods(storeId);
      const overlap = existing.find(p =>
        p.startDate <= endDate && p.endDate >= startDate
      );
      if (overlap) {
        return res.status(409).json({
          error: `This period overlaps with an existing ${overlap.status} period (${overlap.startDate} – ${overlap.endDate}). Please adjust the dates.`,
        });
      }

      const userId = (req as any).user?.id;
      const period = await storage.createPayrollPeriod({ storeId, periodType: periodType || "monthly", startDate, endDate, status: "pending" });
      auditLogger.log({ action: "PAYROLL_PERIOD_CREATE", resource: "payroll_period", resourceId: period.id, userId, ip: getClientIp(req), status: "success", details: { storeId, periodType: periodType || "monthly", startDate, endDate } });
      broadcastChange(req, "payroll", storeId, "created");
      res.status(201).json(period);
    } catch (error) {
      res.status(500).json({ error: "Could not create payroll period." });
    }
  });

  // Get a single payroll period
  app.get("/api/payroll/periods/:id", requireManagerOrOwner, async (req, res) => {
    try {
      const period = await storage.getPayrollPeriod(req.params.id);
      if (!period) return res.status(404).json({ error: "Payroll period not found." });
      if (!(await checkStoreAccess(period.storeId, req, res))) return;
      res.json(period);
    } catch (error) {
      res.status(500).json({ error: "Could not load payroll period." });
    }
  });

  // Calculate (or recalculate) payroll for a period
  app.post("/api/payroll/periods/:id/calculate", requireManagerOrOwner, async (req, res) => {
    try {
      const period = await storage.getPayrollPeriod(req.params.id);
      if (!period) return res.status(404).json({ error: "Payroll period not found." });
      if (!(await checkStoreAccess(period.storeId, req, res))) return;
      const userId = (req as any).user?.id;
      const entries = await storage.calculatePayrollForPeriod(req.params.id);
      auditLogger.log({ action: "PAYROLL_PERIOD_CALCULATE", resource: "payroll_period", resourceId: req.params.id, userId, ip: getClientIp(req), status: "success", details: { periodId: req.params.id } });
      res.json(entries);
    } catch (error) {
      console.error("Calculation error:", error);
      const message = (error as Error).message;
      if (message.includes("column") && message.includes("does not exist")) {
        res.status(500).json({ error: "System configuration error: A required database column is missing. Please run migrations." });
      } else {
        res.status(400).json({ error: error instanceof Error ? error.message : "Error calculating payroll" });
      }
    }
  });

  // Approve a payroll period
  app.post("/api/payroll/periods/:id/approve", requireManagerOrOwner, async (req, res) => {
    try {
      const period = await storage.getPayrollPeriod(req.params.id);
      if (!period) return res.status(404).json({ error: "Payroll period not found." });
      if (!(await checkStoreAccess(period.storeId, req, res))) return;
      const userId = (req as any).user?.id;
      const updated = await storage.updatePayrollPeriodStatus(req.params.id, "approved", userId);
      if (!updated) return res.status(404).json({ error: "Payroll period not found." });
      const ctx = await getAuditContext(req, { storeId: period.storeId });
      auditLogger.logEvent(ctx, "PAYROLL_PERIOD_APPROVE", "payroll_period", req.params.id, "success", {
        previousValues: { status: period.status },
        newValues: { status: updated.status, approvedByUserId: updated.approvedByUserId, approvedAt: updated.approvedAt },
        changedFields: ["status", "approvedByUserId", "approvedAt"],
      });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Could not approve payroll period." });
    }
  });

  // Mark a payroll period as paid (locks it)
  app.post("/api/payroll/periods/:id/mark-paid", requireManagerOrOwner, async (req, res) => {
    try {
      const period = await storage.getPayrollPeriod(req.params.id);
      if (!period) return res.status(404).json({ error: "Payroll period not found." });
      if (!(await checkStoreAccess(period.storeId, req, res))) return;
      const userId = (req as any).user?.id;

      // The whole close sequence — re-sync, settle shop debt, total, carry
      // forward, mirror expense — lives in the service so the integration
      // suite can drive it without going through HTTP.
      const { period: updated, totalAmount } = await payrollSettlementService.markPeriodPaid(req.params.id, userId);

      auditLogger.log({ action: "PAYROLL_PERIOD_MARK_PAID", resource: "payroll_period", resourceId: req.params.id, userId, ip: getClientIp(req), status: "success", details: { periodId: req.params.id, totalAmount } });

      broadcastChange(req, "payroll", period.storeId, "paid");
      broadcastChange(req, "expense", period.storeId, "created");
      // Settlement moved money in the Borrow Book — refresh anyone watching it.
      broadcastChange(req, "credit", period.storeId, "updated");
      res.json(updated);
    } catch (error) {
      console.error("Mark paid error:", error);
      const message = (error as Error).message;
      if (message.includes("overlaps") || message.includes("pg_catalog.overlaps")) {
        res.status(400).json({ error: "This payroll period overlaps with another one that is already marked as Paid. Please check your dates." });
      } else {
        res.status(500).json({ error: error instanceof Error ? error.message : "Error marking payroll as paid" });
      }
    }
  });

  app.delete("/api/payroll/periods/:id", requireRole("owner"), async (req, res) => {
    try {
      const { id } = req.params;
      const period = await storage.getPayrollPeriod(id);
      if (!period) return res.status(404).json({ error: "Payroll period not found." });
      if (!(await checkStoreAccess(period.storeId, req, res))) return;
      const userId = (req as any).user?.id;
      const success = await storage.deletePayrollPeriod(id);
      if (!success) return res.status(404).json({ error: "Payroll period not found." });
      auditLogger.log({ action: "PAYROLL_PERIOD_DELETE", resource: "payroll_period", resourceId: id, userId, ip: getClientIp(req), status: "success", details: { periodId: id } });
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  // Get payroll entries (per-staff breakdown) for a period
  app.get("/api/payroll/periods/:id/entries", requireManagerOrOwner, async (req, res) => {
    try {
      const period = await storage.getPayrollPeriod(req.params.id);
      if (!period) return res.status(404).json({ error: "Payroll period not found." });
      if (!(await checkStoreAccess(period.storeId, req, res))) return;
      const entries = await storage.getPayrollEntries(req.params.id);
      // `netPay` on the row is pre-deduction. Decorate every entry with the
      // split so the payroll screens render what is actually payable instead of
      // each one subtracting deductions its own way (and getting the floor
      // wrong). Waived lines are excluded by the accessor's default.
      const deductions = await storage.getPayrollDeductions(req.params.id);
      const { byStaff } = splitPeriod(entries, deductions);
      res.json(entries.map(e => ({ ...e, ...byStaff.get(e.staffId)! })));
    } catch (error) {
      res.status(500).json({ error: "Could not load payroll entries." });
    }
  });

  // Commission drill-down for one staff member in a period
  app.get("/api/payroll/periods/:id/entries/:staffId/drilldown", requireManagerOrOwner, async (req, res) => {
    try {
      const period = await storage.getPayrollPeriod(req.params.id);
      if (!period) return res.status(404).json({ error: "Payroll period not found." });
      if (!(await checkStoreAccess(period.storeId, req, res))) return;
      const breakdown = await storage.getPayrollDrillDown(req.params.id, req.params.staffId);
      res.json(breakdown);
    } catch (error) {
      res.status(500).json({ error: "Could not load commission breakdown." });
    }
  });
  // ──────────────────────────────────────────────────────────────────────────
  // PAYROLL DEDUCTIONS
  // ──────────────────────────────────────────────────────────────────────────

  app.get("/api/payroll/periods/:id/deductions", requireManagerOrOwner, async (req, res) => {
    try {
      const period = await storage.getPayrollPeriod(req.params.id);
      if (!period) return res.status(404).json({ error: "Period not found." });
      if (!(await checkStoreAccess(period.storeId, req, res))) return;
      // The one caller that wants waived rows: the payroll UI renders them
      // struck through so a manager can see and undo an exclusion.
      const deductions = await storage.getPayrollDeductionsWithCredit(
        req.params.id,
        req.query.staffId as string | undefined,
        { includeWaived: true },
      );
      res.json(deductions);
    } catch (e) { res.status(500).json({ error: "Could not fetch deductions." }); }
  });

  app.post("/api/payroll/periods/:id/deductions", requireManagerOrOwner, async (req, res) => {
    try {
      const period = await storage.getPayrollPeriod(req.params.id);
      if (!period) return res.status(404).json({ error: "Period not found." });
      if (period.status === "paid") return res.status(400).json({ error: "Cannot add deductions to a paid period." });
      if (!(await checkStoreAccess(period.storeId, req, res))) return;
      const { staffId, type, label, amount } = req.body;
      if (!staffId || !type || !label || !amount) return res.status(400).json({ error: "staffId, type, label, and amount are required." });
      const userId = (req as any).user?.id;
      if (type === "staff_credit") return res.status(400).json({ error: "Staff credit deductions are proposed automatically from the Borrow Book and cannot be added by hand." });
      const deduction = await storage.createPayrollDeduction({ periodId: req.params.id, storeId: period.storeId, staffId, type, label, amount: Number(amount), createdByUserId: userId });
      auditLogger.log({ action: "PAYROLL_DEDUCTION_CREATE", resource: "payroll_deduction", resourceId: deduction.id, userId, ip: getClientIp(req), status: "success", details: { periodId: req.params.id, staffId, type, label, amount } });
      // A new deduction outranks staff credit, so the residual left for debt
      // recovery has shrunk — re-clamp the proposals against it. The deduction
      // is already committed, so a sync failure must not fail the request;
      // proposals are re-derived on the next calculation.
      await resyncPriorityDeductions(req.params.id);
      res.status(201).json(deduction);
    } catch (e) { res.status(500).json({ error: "Could not create deduction." }); }
  });

  app.delete("/api/payroll/periods/:id/deductions/:deductionId", requireManagerOrOwner, async (req, res) => {
    try {
      const period = await storage.getPayrollPeriod(req.params.id);
      if (!period) return res.status(404).json({ error: "Period not found." });
      if (period.status === "paid") return res.status(400).json({ error: "Cannot delete deductions from a paid period." });
      if (!(await checkStoreAccess(period.storeId, req, res))) return;
      const userId = (req as any).user?.id;
      const existing = await storage.getPayrollDeduction(req.params.deductionId);
      if (!existing || existing.periodId !== req.params.id) return res.status(404).json({ error: "Deduction not found." });

      // A system-proposed line — staff credit, or an advance_recovery line
      // tied to a salary advance — is waived, never deleted. Payroll is
      // recalculated on every sale, so a deleted proposal would be
      // re-inserted within minutes and the manager's decision silently
      // undone. A manager's own free-text advance_recovery line (no
      // salaryAdvanceId) has no proposal to re-insert, so it stays deletable.
      const isSystemProposed = existing.type === "staff_credit"
        || (existing.type === "advance_recovery" && !!existing.salaryAdvanceId);
      if (isSystemProposed) {
        const waived = await storage.setPayrollDeductionWaived(req.params.deductionId, true, userId);
        auditLogger.log({ action: "PAYROLL_DEDUCTION_WAIVE", resource: "payroll_deduction", resourceId: req.params.deductionId, userId, ip: getClientIp(req), status: "success", details: { periodId: req.params.id, creditEntryId: existing.creditEntryId, salaryAdvanceId: existing.salaryAdvanceId, amount: existing.amount } });
        // Waiving frees up pay that other outstanding debts can now claim.
        await resyncPriorityDeductions(req.params.id);
        return res.json(waived);
      }

      await storage.deletePayrollDeduction(req.params.deductionId);
      auditLogger.log({ action: "PAYROLL_DEDUCTION_DELETE", resource: "payroll_deduction", resourceId: req.params.deductionId, userId, ip: getClientIp(req), status: "success", details: { periodId: req.params.id, deductionId: req.params.deductionId } });
      // Removing a higher-priority line frees pay for debt recovery.
      await resyncPriorityDeductions(req.params.id);
      res.status(204).end();
    } catch (e) { res.status(500).json({ error: "Could not delete deduction." }); }
  });

  // Un-waive a staff-credit or advance-recovery line the manager previously excluded.
  app.post("/api/payroll/periods/:id/deductions/:deductionId/restore", requireManagerOrOwner, async (req, res) => {
    try {
      const period = await storage.getPayrollPeriod(req.params.id);
      if (!period) return res.status(404).json({ error: "Period not found." });
      if (period.status === "paid") return res.status(400).json({ error: "Cannot change deductions on a paid period." });
      if (!(await checkStoreAccess(period.storeId, req, res))) return;
      const existing = await storage.getPayrollDeduction(req.params.deductionId);
      if (!existing || existing.periodId !== req.params.id) return res.status(404).json({ error: "Deduction not found." });
      const isSystemProposed = existing.type === "staff_credit"
        || (existing.type === "advance_recovery" && !!existing.salaryAdvanceId);
      if (!isSystemProposed) return res.status(400).json({ error: "Only system-proposed deductions can be restored." });

      const userId = (req as any).user?.id;
      const restored = await storage.setPayrollDeductionWaived(req.params.deductionId, false, userId);
      auditLogger.log({ action: "PAYROLL_DEDUCTION_RESTORE", resource: "payroll_deduction", resourceId: req.params.deductionId, userId, ip: getClientIp(req), status: "success", details: { periodId: req.params.id, creditEntryId: existing.creditEntryId, salaryAdvanceId: existing.salaryAdvanceId } });
      // Re-clamp: the restored line has to fit in whatever pay is left.
      await resyncPriorityDeductions(req.params.id);
      res.json(restored);
    } catch (e) { res.status(500).json({ error: "Could not restore deduction." }); }
  });

  /**
   * Waive a staff-credit line AND give up on the debt behind it.
   *
   * Distinct from the plain waive above, which only skips the line for this
   * period and leaves the debt open in the Borrow Book for the next one. This
   * forgives it: the credit entry is written off as operational bad debt and
   * never comes back. Owner-only and one-way, matching the Borrow Book's own
   * write-off — a manager can defer a deduction, only an owner can forgive it.
   */
  app.post("/api/payroll/periods/:id/deductions/:deductionId/write-off", requireRole("owner"), async (req, res) => {
    try {
      const period = await storage.getPayrollPeriod(req.params.id);
      if (!period) return res.status(404).json({ error: "Period not found." });
      if (period.status === "paid") return res.status(400).json({ error: "Cannot change deductions on a paid period." });
      if (!(await checkStoreAccess(period.storeId, req, res))) return;

      const existing = await storage.getPayrollDeduction(req.params.deductionId);
      if (!existing || existing.periodId !== req.params.id) return res.status(404).json({ error: "Deduction not found." });
      if (existing.type !== "staff_credit" || !existing.creditEntryId) {
        return res.status(400).json({ error: "Only staff credit deductions can be written off as bad debt." });
      }
      // A settled line already recovered the money; writing it off now would
      // zero a balance that was genuinely repaid.
      if (existing.repaymentId) return res.status(400).json({ error: "This debt has already been recovered from payroll." });

      const userId = (req as any).user?.id;
      const reason = sanitizeString(req.body?.reason) || `Waived at payroll ${period.startDate} – ${period.endDate}`;

      // Waive first: if the write-off fails, the worst outcome is a skipped
      // deduction on an open period, not a forgiven debt still being garnished.
      await storage.setPayrollDeductionWaived(req.params.deductionId, true, userId);
      const writtenOff = await storage.creditRepo.writeOffDebt(existing.creditEntryId, reason);

      auditLogger.log({
        action: "PAYROLL_DEDUCTION_WRITE_OFF", resource: "payroll_deduction", resourceId: req.params.deductionId,
        userId, ip: getClientIp(req), status: "success",
        details: { periodId: req.params.id, creditEntryId: existing.creditEntryId, amount: existing.amount, reason },
      });

      // The debt is gone from the open-debt sweep; drop its proposal too.
      await resyncPriorityDeductions(req.params.id);
      res.json(writtenOff);
    } catch (e) { res.status(500).json({ error: "Could not write off this debt." }); }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // PAYROLL DISBURSEMENTS
  // ──────────────────────────────────────────────────────────────────────────

  app.get("/api/payroll/periods/:id/disbursements", requireManagerOrOwner, async (req, res) => {
    try {
      const period = await storage.getPayrollPeriod(req.params.id);
      if (!period) return res.status(404).json({ error: "Period not found." });
      if (!(await checkStoreAccess(period.storeId, req, res))) return;
      const disbursements = await storage.getPayrollDisbursements(req.params.id);
      res.json(disbursements);
    } catch (e) { res.status(500).json({ error: "Could not fetch disbursements." }); }
  });

  app.post("/api/payroll/periods/:id/disbursements", requireManagerOrOwner, async (req, res) => {
    try {
      const period = await storage.getPayrollPeriod(req.params.id);
      if (!period) return res.status(404).json({ error: "Period not found." });
      if (!(await checkStoreAccess(period.storeId, req, res))) return;
      const { staffId, amountPaid, method, reference, notes } = req.body;
      if (!staffId || amountPaid === undefined) return res.status(400).json({ error: "staffId and amountPaid are required." });
      const userId = (req as any).user?.id;
      const disbursement = await storage.upsertPayrollDisbursement({
        periodId: req.params.id, storeId: period.storeId, staffId,
        amountPaid: Number(amountPaid), method: method || "cash",
        reference: reference || null, notes: notes || null,
        paidByUserId: userId, paidAt: new Date(),
      });
      auditLogger.log({ action: "PAYROLL_DISBURSEMENT_CREATE", resource: "payroll_disbursement", resourceId: disbursement.id, userId, ip: getClientIp(req), status: "success", details: { periodId: req.params.id, staffId, amountPaid, method: method || "cash" } });
      res.status(201).json(disbursement);
    } catch (e) { res.status(500).json({ error: "Could not record disbursement." }); }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // SALARY ADVANCES
  // ──────────────────────────────────────────────────────────────────────────

  app.get("/api/payroll/advances", requireManagerOrOwner, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) return res.status(400).json({ error: "storeId required." });
      if (!(await checkStoreAccess(storeId, req, res))) return;
      const advances = await storage.getSalaryAdvances(storeId, req.query.staffId as string | undefined);
      res.json(advances);
    } catch (e) { res.status(500).json({ error: "Could not fetch advances." }); }
  });

  app.post("/api/payroll/advances", requireManagerOrOwner, async (req, res) => {
    try {
      const { storeId, staffId, amount, date, notes } = req.body;
      if (!storeId || !staffId || !amount || !date) return res.status(400).json({ error: "storeId, staffId, amount, and date are required." });
      if (!(await checkStoreAccess(storeId, req, res))) return;
      const userId = (req as any).user?.id;
      const advance = await storage.createSalaryAdvance({ storeId, staffId, amount: Number(amount), date, notes: notes || null, givenByUserId: userId });
      const ctx = await getAuditContext(req, { storeId });
      auditLogger.logEvent(ctx, "SALARY_ADVANCE_CREATE", "salary_advance", advance.id, "success", { newValues: advance });
      res.status(201).json(advance);
    } catch (e) { res.status(500).json({ error: "Could not create salary advance." }); }
  });

  // Approve a pending advance — approver identity is kept distinct from the
  // requester (givenByUserId) so the audit trail shows both actors.
  app.post("/api/payroll/advances/:id/approve", requireManagerOrOwner, async (req, res) => {
    try {
      const [adv] = await db.select().from(salaryAdvances).where(eq(salaryAdvances.id, req.params.id));
      if (!adv) return res.status(404).json({ error: "Advance not found." });
      if (!(await checkStoreAccess(adv.storeId, req, res))) return;
      if (adv.status !== "pending") return res.status(400).json({ error: `Advance is already ${adv.status}.` });
      const userId = (req as any).user?.id;
      const advance = await storage.updateSalaryAdvanceStatus(req.params.id, "approved", userId);
      const ctx = await getAuditContext(req, { storeId: adv.storeId });
      auditLogger.logEvent(ctx, "SALARY_ADVANCE_APPROVE", "salary_advance", req.params.id, "success", {
        previousValues: { status: adv.status },
        newValues: { status: advance.status, approvedByUserId: advance.approvedByUserId, approvedAt: advance.approvedAt },
        changedFields: ["status", "approvedByUserId", "approvedAt"],
      });
      res.json(advance);
    } catch (e) { res.status(500).json({ error: "Could not approve advance." }); }
  });

  app.post("/api/payroll/advances/:id/reject", requireManagerOrOwner, async (req, res) => {
    try {
      const { reason } = req.body;
      const [adv] = await db.select().from(salaryAdvances).where(eq(salaryAdvances.id, req.params.id));
      if (!adv) return res.status(404).json({ error: "Advance not found." });
      if (!(await checkStoreAccess(adv.storeId, req, res))) return;
      if (adv.status !== "pending") return res.status(400).json({ error: `Advance is already ${adv.status}.` });
      const userId = (req as any).user?.id;
      const advance = await storage.updateSalaryAdvanceStatus(req.params.id, "rejected", userId, reason);
      const ctx = await getAuditContext(req, { storeId: adv.storeId });
      auditLogger.logEvent(ctx, "SALARY_ADVANCE_REJECT", "salary_advance", req.params.id, "success", {
        previousValues: { status: adv.status },
        newValues: { status: advance.status, approvedByUserId: advance.approvedByUserId, rejectionReason: advance.rejectionReason },
        changedFields: ["status", "approvedByUserId", "rejectionReason"],
      });
      res.json(advance);
    } catch (e) { res.status(500).json({ error: "Could not reject advance." }); }
  });

  /**
   * Manual override only. The normal path no longer runs through here: an
   * approved advance is auto-proposed as a payroll deduction by
   * SalaryAdvanceDeductionService and settled automatically when that period
   * is marked paid (see PayrollSettlementService.markPeriodPaid). This
   * endpoint exists for the cases that path can't reach — an advance repaid
   * in cash outside payroll, or written off — which is why it now requires a
   * reason and refuses to run while payroll already has a live proposal for
   * it (that proposal will settle it automatically; hand-flipping the flag
   * here would leave a deduction line on the books with nothing behind it).
   */
  app.post("/api/payroll/advances/:id/recover", requireManagerOrOwner, async (req, res) => {
    try {
      const reason = sanitizeString(req.body?.reason);
      if (!reason) return res.status(400).json({ error: "A reason is required to manually mark an advance recovered outside payroll (e.g. repaid in cash, written off)." });
      const [adv] = await db.select().from(salaryAdvances).where(eq(salaryAdvances.id, req.params.id));
      if (!adv) return res.status(404).json({ error: "Advance not found." });
      if (!(await checkStoreAccess(adv.storeId, req, res))) return;
      if (adv.status !== "approved") return res.status(400).json({ error: "Only approved advances can be recovered." });
      if (adv.isRecovered) return res.status(400).json({ error: "This advance has already been recovered." });

      // Blocks on ANY unsettled deduction line, waived or not. A waived line
      // is only excluded FOR THAT PERIOD — the advance stays open and gets
      // re-proposed next payroll calculation (see syncProposals' stale-row
      // handling, which never deletes a waived row). Letting the manual
      // override proceed past a waived-but-live line would leave that stale
      // line sitting on the period forever: nothing re-syncs it once the
      // advance this override just fully recovered no longer exists to
      // propose.
      const [liveProposal] = await db.select().from(payrollDeductions).where(and(
        eq(payrollDeductions.salaryAdvanceId, req.params.id),
        sql`${payrollDeductions.settledAt} IS NULL`,
      ));
      if (liveProposal) {
        return res.status(400).json({ error: "This advance still has a payroll deduction line on an open period — waived or not, it will be recovered automatically when that period is marked paid. Delete or restore that line first if you need to recover it outside payroll." });
      }

      const advance = await storage.markAdvanceRecovered(req.params.id, reason);
      const ctx = await getAuditContext(req, { storeId: adv.storeId });
      auditLogger.logEvent(ctx, "SALARY_ADVANCE_RECOVER", "salary_advance", req.params.id, "success", {
        previousValues: { isRecovered: adv.isRecovered, recoveredPeriodId: adv.recoveredPeriodId },
        newValues: { isRecovered: advance.isRecovered, recoveredPeriodId: advance.recoveredPeriodId, manualRecoveryReason: advance.manualRecoveryReason },
        changedFields: ["isRecovered", "manualRecoveryReason"],
      });
      res.json(advance);
    } catch (e) { res.status(500).json({ error: "Could not mark advance as recovered." }); }
  });

  /**
   * `recoveredPeriodId` doubles as a pre-settlement reservation
   * (SalaryAdvanceDeductionService.syncProposals sets it the moment a
   * proposal is written), so an advance can end up locked to an open period
   * that's simply never marked paid or deleted — invisible to every other
   * open period for that staff member, with no timeout. Owner-only escape
   * hatch: release the reservation and let the reserved period's own
   * proposals self-correct via the existing stale-cleanup path (no new
   * cleanup logic needed — syncProposals already deletes a proposal whose
   * advance no longer qualifies as a candidate).
   */
  app.post("/api/payroll/advances/:id/release-reservation", requireRole("owner"), async (req, res) => {
    try {
      const [adv] = await db.select().from(salaryAdvances).where(eq(salaryAdvances.id, req.params.id));
      if (!adv) return res.status(404).json({ error: "Advance not found." });
      if (!(await checkStoreAccess(adv.storeId, req, res))) return;
      if (!adv.recoveredPeriodId) return res.status(400).json({ error: "This advance isn't reserved to any period." });
      if (adv.recoveryStatus === "recovered") return res.status(400).json({ error: "This advance is already fully recovered — there's nothing to release." });

      const reservedPeriodId = adv.recoveredPeriodId;
      await salaryAdvanceDeductionService.releaseReservation(req.params.id);
      const [advance] = await db.select().from(salaryAdvances).where(eq(salaryAdvances.id, req.params.id));

      const ctx = await getAuditContext(req, { storeId: adv.storeId });
      auditLogger.logEvent(ctx, "SALARY_ADVANCE_RELEASE_RESERVATION", "salary_advance", req.params.id, "success", {
        previousValues: { recoveredPeriodId: reservedPeriodId },
        newValues: { recoveredPeriodId: null },
        changedFields: ["recoveredPeriodId"],
      });
      res.json(advance);
    } catch (e) { res.status(500).json({ error: "Could not release the reservation." }); }
  });

  /**
   * Undoes a mistaken manual /recover call. Owner-only and time-boxed to the
   * same store-local calendar month, mirroring credit_entries' write-off
   * restore (canRestoreWriteOff) — this codebase's established "don't let a
   * closed accounting period's record change after the fact" discipline.
   */
  app.post("/api/payroll/advances/:id/restore-manual-recovery", requireRole("owner"), async (req, res) => {
    try {
      const [adv] = await db.select().from(salaryAdvances).where(eq(salaryAdvances.id, req.params.id));
      if (!adv) return res.status(404).json({ error: "Advance not found." });
      if (!(await checkStoreAccess(adv.storeId, req, res))) return;

      const tz = await getStoreTimezone(adv.storeId);
      const guard = canRestoreManualRecovery(adv, { now: new Date(), timezone: tz });
      if (!guard.allowed) return res.status(400).json({ error: guard.reason });

      const restored = await storage.restoreManualRecovery(req.params.id);
      const ctx = await getAuditContext(req, { storeId: adv.storeId });
      auditLogger.logEvent(ctx, "SALARY_ADVANCE_RESTORE_MANUAL_RECOVERY", "salary_advance", req.params.id, "success", {
        previousValues: { isRecovered: adv.isRecovered, outstandingBalance: adv.outstandingBalance, recoveryStatus: adv.recoveryStatus },
        newValues: { isRecovered: restored?.isRecovered, outstandingBalance: restored?.outstandingBalance, recoveryStatus: restored?.recoveryStatus },
        changedFields: ["isRecovered", "outstandingBalance", "recoveryStatus", "manualRecoveryReason", "manualRecoveredAt"],
      });
      res.json(restored);
    } catch (e) { res.status(500).json({ error: "Could not restore this advance." }); }
  });

  app.delete("/api/payroll/advances/:id", requireManagerOrOwner, async (req, res) => {
    try {
      const [adv] = await db.select().from(salaryAdvances).where(eq(salaryAdvances.id, req.params.id));
      if (!adv) return res.status(404).json({ error: "Advance not found." });
      if (!(await checkStoreAccess(adv.storeId, req, res))) return;
      await storage.deleteSalaryAdvance(req.params.id);
      const ctx = await getAuditContext(req, { storeId: adv.storeId });
      auditLogger.logEvent(ctx, "SALARY_ADVANCE_DELETE", "salary_advance", req.params.id, "success", { previousValues: adv });
      res.status(204).end();
    } catch (e) {
      // deleteSalaryAdvance throws a plain-language Error for the one
      // expected failure mode (a payroll deduction still references it) —
      // surface that as a 400 instead of the generic 500 for anything else.
      if (e instanceof Error && e.message.includes("can't be deleted")) {
        return res.status(400).json({ error: e.message });
      }
      res.status(500).json({ error: "Could not delete advance." });
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // UNRECORDED ATTENDANCE CHECK
  // ──────────────────────────────────────────────────────────────────────────

  app.get("/api/payroll/periods/:id/unrecorded", requireManagerOrOwner, async (req, res) => {
    try {
      const period = await storage.getPayrollPeriod(req.params.id);
      if (!period) return res.status(404).json({ error: "Period not found." });
      if (!(await checkStoreAccess(period.storeId, req, res))) return;
      const unrecorded = await storage.getUnrecordedAttendanceDays(period.storeId, period.startDate, period.endDate);
      res.json(unrecorded);
    } catch (e) { res.status(500).json({ error: "Could not check unrecorded days." }); }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // CONSOLIDATED PAYROLL REPORT
  // ──────────────────────────────────────────────────────────────────────────

  app.get("/api/payroll/report", requireManagerOrOwner, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) return res.status(400).json({ error: "storeId required." });
      if (!(await checkStoreAccess(storeId, req, res))) return;
      const periods = await storage.getPayrollPeriods(storeId);
      const report = await Promise.all(periods.map(async (p) => {
        const entries = await storage.getPayrollEntries(p.id);
        const totalGross = entries.reduce((s, e) => s + (e.grossCommission || 0), 0);
        const totalTransport = entries.reduce((s, e) => s + (e.totalTransport || 0), 0);
        const deductions = await storage.getPayrollDeductions(p.id);
        // totalTakeHome is the cash that left, floored per person — it is not
        // totalNetPay − totalDeductions, because one person's surplus cannot
        // absorb another's shortfall.
        const { totalGross: totalNet, totalDeductions, totalTakeHome, totalShortfall } =
          splitPeriod(entries, deductions);
        return {
          id: p.id, periodType: p.periodType, startDate: p.startDate, endDate: p.endDate,
          status: p.status, staffCount: entries.length,
          totalGrossCommission: totalGross, totalTransport, totalDeductions,
          totalNetPay: totalNet, totalTakeHome, totalShortfall, paidAt: p.paidAt,
        };
      }));
      res.json(report);
    } catch (e) { res.status(500).json({ error: "Could not generate report." }); }
  });

  // ==========================================
  // EXPENSES MODULE
  // ==========================================

  app.get("/api/expense-categories", requireManagerOrOwner, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) return res.status(400).json({ error: "Store ID required." });
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const categories = await storage.getExpenseCategories(storeId);
      res.json(categories);
    } catch (error) {
      res.status(500).json({ error: "Could not fetch expense categories." });
    }
  });

  app.post("/api/expense-categories", requireRole("owner"), async (req, res) => {
    try {
      const { storeId, name } = req.body;
      if (!storeId || !name) return res.status(400).json({ error: "Store ID and name required." });
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const userId = (req as any).user?.id;
      const category = await storage.createExpenseCategory({ storeId, name, isSystem: false });
      auditLogger.log({ action: "EXPENSE_CATEGORY_CREATE", resource: "expense_category", resourceId: category.id, userId, ip: getClientIp(req), status: "success", details: { storeId, name } });
      res.status(201).json(category);
    } catch (error) {
      res.status(500).json({ error: "Could not create expense category." });
    }
  });

  app.patch("/api/expense-categories/:id", requireRole("owner"), async (req, res) => {
    try {
      const { name } = req.body;
      if (!name) return res.status(400).json({ error: "Category name is required." });
      const [cat] = await db.select().from(expenseCategories).where(eq(expenseCategories.id, req.params.id));
      if (!cat) return res.status(404).json({ error: "Category not found." });
      if (!(await checkStoreAccess(cat.storeId, req, res))) return;
      const userId = (req as any).user?.id;
      const updated = await storage.updateExpenseCategory(req.params.id, name);
      auditLogger.log({ action: "EXPENSE_CATEGORY_UPDATE", resource: "expense_category", resourceId: req.params.id, userId, ip: getClientIp(req), status: "success", details: { categoryId: req.params.id, name } });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Could not update expense category." });
    }
  });

  app.delete("/api/expense-categories/:id", requireRole("owner"), async (req, res) => {
    try {
      const [cat] = await db.select().from(expenseCategories).where(eq(expenseCategories.id, req.params.id));
      if (!cat) return res.status(404).json({ error: "Category not found." });
      if (!(await checkStoreAccess(cat.storeId, req, res))) return;
      const userId = (req as any).user?.id;
      await storage.deleteExpenseCategory(req.params.id);
      auditLogger.log({ action: "EXPENSE_CATEGORY_DELETE", resource: "expense_category", resourceId: req.params.id, userId, ip: getClientIp(req), status: "success", details: { categoryId: req.params.id } });
      res.status(204).end();
    } catch (error) {
      const err = error as Error;
      if (err.message.startsWith("conflict:")) {
        return res.status(409).json({ error: err.message.substring(9) });
      }
      res.status(500).json({ error: "Could not delete expense category. It may be in use." });
    }
  });

  app.get("/api/expenses", requireManagerOrOwner, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;
      const type = req.query.type as any;
      const inventoryId = req.query.inventoryId as string | undefined;

      if (!storeId) return res.status(400).json({ error: "Store ID required." });
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const expenses = await storage.getExpenses(storeId, startDate, endDate, type, inventoryId);
      res.json(expenses);
    } catch (error) {
      res.status(500).json({ error: "Could not fetch expenses." });
    }
  });

  app.get("/api/expenses/:id", withExpenseId, requireManagerOrOwner, async (req, res) => {
    try {
      const expense = await storage.getExpenseById(req.params.id);
      if (!expense) return res.status(404).json({ error: "Expense not found." });
      if (!(await checkStoreAccess(expense.storeId, req, res))) return;
      res.json(expense);
    } catch (error) {
      res.status(500).json({ error: "Could not fetch expense." });
    }
  });

  app.post("/api/expenses", requireManagerOrOwner, async (req, res) => {
    try {
      const sanitizedBody = {
        ...req.body,
        amount: req.body.amount !== undefined ? Number(req.body.amount) : undefined,
      };
      const data = insertExpenseSchema.parse(sanitizedBody);
      if (!(await checkStoreAccess(data.storeId, req, res))) return;

      // If split, validate splitPayments sum matches amount
      if (data.paymentMethod === "split") {
        if (!data.splitPayments || data.splitPayments.length === 0) {
          return res.status(400).json({ error: "Split payments details are required when payment method is 'split'." });
        }
        const splitSum = data.splitPayments.reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0);
        if (Math.abs(splitSum - (data.amount ?? 0)) > 0.01) {
          return res.status(400).json({ error: `The sum of split payments (₦${splitSum}) must equal the total expense amount (₦${data.amount ?? 0}).` });
        }
      }

      const linkedProductIds: string[] | undefined = Array.isArray(req.body.linkedProductIds)
        ? req.body.linkedProductIds.filter((id: any) => typeof id === "string" && id.length > 0)
        : undefined;
      const allocationDriver: string | undefined = req.body.allocationDriver ?? undefined;

      const expense = await storage.createExpense({
        ...data,
        inventoryId: data.inventoryId === "none" ? null : (data.inventoryId || null),
        paymentMethod: data.paymentMethod || "cash",
        splitPayments: data.paymentMethod === "split" ? data.splitPayments : null,
        linkedProductIds,
        allocationDriver,
      });
      const ctx = await getAuditContext(req, { storeId: data.storeId });
      auditLogger.logEvent(ctx, "EXPENSE_CREATE", "expense", expense.id, "success", { newValues: expense });
      broadcastChange(req, "expense", data.storeId, "created");
      res.status(201).json(expense);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      console.error("POST /api/expenses error:", error);
      res.status(500).json({ error: "Could not create expense." });
    }
  });

  app.patch("/api/expenses/:id", withExpenseId, requireManagerOrOwner, async (req, res) => {
    try {
      const sanitizedBody = {
        ...req.body,
        amount: req.body.amount !== undefined ? Number(req.body.amount) : undefined,
      };
      // Omit storeId on PATCH to prevent changing store branches
      delete sanitizedBody.storeId;
      const data = insertExpenseSchema.partial().parse(sanitizedBody);

      const [existing] = await db.select().from(expenses).where(eq(expenses.id, req.params.id));
      if (!existing) {
        return res.status(404).json({ error: "Expense not found." });
      }

      // Verify user has access to this store branch
      if (!await verifyRecordStoreAccess(req, existing.storeId)) {
        return res.status(403).json({ error: "You don't have access to this expense." });
      }

      const targetPaymentMethod = data.paymentMethod !== undefined ? data.paymentMethod : existing.paymentMethod;
      const targetSplitPayments = data.splitPayments !== undefined ? data.splitPayments : existing.splitPayments;
      
      if (targetPaymentMethod === "split") {
        const targetAmount = data.amount !== undefined ? data.amount : existing.amount;
        if (!targetSplitPayments || !Array.isArray(targetSplitPayments) || targetSplitPayments.length === 0) {
          return res.status(400).json({ error: "Split payments details are required for split expenses." });
        }
        const splitSum = targetSplitPayments.reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0);
        if (Math.abs(splitSum - targetAmount) > 0.01) {
          return res.status(400).json({ error: `The sum of split payments (₦${splitSum}) must equal the total expense amount (₦${targetAmount}).` });
        }
      }

      const linkedProductIds: string[] | undefined = Array.isArray(req.body.linkedProductIds)
        ? req.body.linkedProductIds.filter((id: any) => typeof id === "string" && id.length > 0)
        : undefined;
      const allocationDriver: string | undefined = req.body.allocationDriver ?? undefined;

      const expense = await storage.updateExpense(req.params.id, {
        ...data,
        inventoryId: data.inventoryId === "none" ? null : (data.inventoryId || undefined),
        splitPayments: targetPaymentMethod === "split" ? targetSplitPayments : (data.paymentMethod && data.paymentMethod !== "split" ? null : undefined),
        linkedProductIds,
        allocationDriver,
      });
      const changedFields = Object.keys(data).filter((key) => JSON.stringify((existing as any)[key]) !== JSON.stringify((expense as any)[key]));
      if (changedFields.length > 0) {
        const ctx = await getAuditContext(req, { storeId: existing.storeId });
        auditLogger.logEvent(ctx, "EXPENSE_UPDATE", "expense", req.params.id, "success", {
          previousValues: existing,
          newValues: expense,
          changedFields,
        });
      }
      broadcastChange(req, "expense", existing.storeId, "updated");
      res.json(expense);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      res.status(500).json({ error: "Could not update expense." });
    }
  });

  app.delete("/api/expenses/:id", withExpenseId, requireRole("owner"), async (req, res) => {
    try {
      const [existing] = await db.select().from(expenses).where(eq(expenses.id, req.params.id));
      await storage.deleteExpense(req.params.id);
      const ctx = await getAuditContext(req, { storeId: existing?.storeId });
      auditLogger.logEvent(ctx, "EXPENSE_DELETE", "expense", req.params.id, "success", { previousValues: existing });
      broadcastChange(req, "expense", undefined, "deleted");
      res.status(204).end();
    } catch (error) {
      res.status(500).json({ error: "Could not delete expense." });
    }
  });

  // ── Payslip document registration (generates a verifiable UUID) ──────────────
  app.post("/api/payroll/payslips/register", requireManagerOrOwner, async (req, res) => {
    try {
      const user = (req as any).user;
      const { storeId, periodId, staffId, grossPay, netPay } = req.body;
      if (!storeId || !periodId || !staffId) {
        return res.status(400).json({ error: "storeId, periodId, and staffId are required" });
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;
      const record = await storage.registerPayslip({
        storeId,
        periodId,
        staffId,
        generatedByUserId: user?.id,
        grossPay: Number(grossPay) || 0,
        netPay: Number(netPay) || 0,
      });
      auditLogger.log({ action: "PAYSLIP_REGISTER", resource: "payslip", resourceId: record.id, userId: user?.id, ip: getClientIp(req), status: "success", details: { storeId, periodId, staffId, grossPay, netPay } });
      res.json(record);
    } catch (error) {
      res.status(500).json({ error: "Could not register payslip." });
    }
  });

  // ── Public payslip verification (no auth required) ────────────────────────
  app.get("/api/verify/payslip/:id", async (req, res) => {
    try {
      const record = await storage.getPayslipRecord(req.params.id);
      if (!record) return res.status(404).json({ error: "Payslip record not found." });
      res.json(record);
    } catch (error) {
      res.status(500).json({ error: "Verification failed." });
    }
  });

  // ==========================================
  // V2/V3/V4 SME GAPS INTEGRATION ENDPOINTS
  // ==========================================

  // Coverage gap detection — service transactions not covered by any payroll period
  app.get("/api/payroll/coverage-gaps", requireManagerOrOwner, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) return res.status(400).json({ error: "storeId required." });
      if (!(await checkStoreAccess(storeId, req, res))) return;

      // Find service checkouts with no covering payroll period
      const rows = await db.execute(
        sql`
          SELECT
            c.lead_staff_id   AS staff_id,
            s.name            AS staff_name,
            MIN(c.created_at::date)::text  AS earliest_date,
            MAX(c.created_at::date)::text  AS latest_date,
            COUNT(DISTINCT c.id)           AS service_count,
            SUM(c.total_price)             AS uncovered_revenue
          FROM checkouts c
          JOIN orders o ON c.order_id = o.id
          JOIN inventory i ON o.inventory_id = i.id
          LEFT JOIN staff s ON s.id = c.lead_staff_id
          WHERE c.store_id     = ${storeId}
            AND c.is_voided    = false
            AND i.type         = 'service'
            AND c.lead_staff_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM payroll_periods pp
              WHERE pp.store_id = c.store_id
                AND c.created_at::date BETWEEN pp.start_date::date AND pp.end_date::date
            )
          GROUP BY c.lead_staff_id, s.name
          ORDER BY earliest_date
        `
      );

      res.json(rows.rows ?? rows);
    } catch (e) {
      console.error("Coverage gaps error:", e);
      res.status(500).json({ error: "Could not compute coverage gaps." });
    }
  });

}
