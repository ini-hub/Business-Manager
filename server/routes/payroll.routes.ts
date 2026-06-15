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
import { getUserId, getClientIp, formatZodErrors, checkBusinessAccess, getUserStores, verifyStoreAccess, verifyRecordStoreAccess, triggerAutoRecalculate } from './helpers';
import { withExpenseId } from '../utils/slug-resolver';

export type RouteMiddlewares = {
  isAuthenticated: any;
  requireRole: (...roles: any[]) => any;
  requireManagerOrOwner: any;
  checkStoreAccess: (storeId: string, req: Request, res: Response) => Promise<boolean>;
};

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

      res.json({
        period: {
          ...activePeriod,
          label: `${activePeriod.startDate} to ${activePeriod.endDate} (${activePeriod.periodType})`
        },
        earnings: entry?.netPay || 0,
        transport: entry?.totalTransport || 0,
        commission: entry?.grossCommission || 0,
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
        return {
          id: p.id,
          label: `${p.startDate} to ${p.endDate} (${p.periodType})`,
          startDate: p.startDate,
          endDate: p.endDate,
          netPay: entry?.netPay || 0,
          paidAt: p.paidAt || p.createdAt
        };
      }));

      res.json(history.filter(h => h.netPay > 0));
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

      const period = await storage.createPayrollPeriod({ storeId, periodType: periodType || "monthly", startDate, endDate, status: "pending" });
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
      const entries = await storage.calculatePayrollForPeriod(req.params.id);
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
      const entries = await storage.getPayrollEntries(period.id);
      const userId = (req as any).user?.id;

      // Build per-staff deduction totals
      const allDeductions = await storage.getPayrollDeductions(period.id);
      const deductionsByStaff = new Map<string, number>();
      for (const d of allDeductions) {
        deductionsByStaff.set(d.staffId, (deductionsByStaff.get(d.staffId) ?? 0) + Number(d.amount));
      }

      // Actual cash outflow = sum of max(0, netPay - deductions) per staff
      const totalAmount = entries.reduce((sum, entry) => {
        const staffDeductions = deductionsByStaff.get(entry.staffId) ?? 0;
        return sum + Math.max(0, (entry.netPay || 0) - staffDeductions);
      }, 0);

      const updated = await storage.updatePayrollPeriodStatus(req.params.id, "paid", userId);

      // Save carry-forward amount on each entry where deductions exceed earnings
      for (const entry of entries) {
        const staffDeductions = deductionsByStaff.get(entry.staffId) ?? 0;
        const deficit = staffDeductions - (entry.netPay || 0);
        if (deficit > 0) {
          await db.update(payrollEntries)
            .set({ carryForwardAmount: deficit })
            .where(eq(payrollEntries.id, entry.id));
        }
      }

      // Auto-generate Expense for the paid payroll
      try {
        const categories = await storage.getExpenseCategories(period.storeId);
        let payrollCat = categories.find(c => c.isSystem && c.name === "Payroll");
        if (!payrollCat) {
          payrollCat = await storage.createExpenseCategory({ storeId: period.storeId, name: "Payroll", isSystem: true });
        }
        await storage.createExpense({
          storeId: period.storeId,
          categoryId: payrollCat.id,
          title: `Payroll — ${period.startDate} to ${period.endDate}`,
          amount: totalAmount,
          date: new Date().toISOString().split("T")[0],
        });
      } catch (e) {
        console.error("Failed to auto-generate payroll expense:", e);
      }

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
      const success = await storage.deletePayrollPeriod(id);
      if (!success) return res.status(404).json({ error: "Payroll period not found." });
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
      res.json(entries);
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
      const deductions = await storage.getPayrollDeductions(req.params.id, req.query.staffId as string | undefined);
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
      const deduction = await storage.createPayrollDeduction({ periodId: req.params.id, storeId: period.storeId, staffId, type, label, amount: Number(amount), createdByUserId: userId });
      res.status(201).json(deduction);
    } catch (e) { res.status(500).json({ error: "Could not create deduction." }); }
  });

  app.delete("/api/payroll/periods/:id/deductions/:deductionId", requireManagerOrOwner, async (req, res) => {
    try {
      const period = await storage.getPayrollPeriod(req.params.id);
      if (!period) return res.status(404).json({ error: "Period not found." });
      if (period.status === "paid") return res.status(400).json({ error: "Cannot delete deductions from a paid period." });
      if (!(await checkStoreAccess(period.storeId, req, res))) return;
      await storage.deletePayrollDeduction(req.params.deductionId);
      res.status(204).end();
    } catch (e) { res.status(500).json({ error: "Could not delete deduction." }); }
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
      res.status(201).json(advance);
    } catch (e) { res.status(500).json({ error: "Could not create salary advance." }); }
  });

  app.post("/api/payroll/advances/:id/recover", requireManagerOrOwner, async (req, res) => {
    try {
      const { periodId } = req.body;
      if (!periodId) return res.status(400).json({ error: "periodId is required." });
      const [adv] = await db.select().from(salaryAdvances).where(eq(salaryAdvances.id, req.params.id));
      if (!adv) return res.status(404).json({ error: "Advance not found." });
      if (!(await checkStoreAccess(adv.storeId, req, res))) return;
      const advance = await storage.markAdvanceRecovered(req.params.id, periodId);
      res.json(advance);
    } catch (e) { res.status(500).json({ error: "Could not mark advance as recovered." }); }
  });

  app.delete("/api/payroll/advances/:id", requireManagerOrOwner, async (req, res) => {
    try {
      const [adv] = await db.select().from(salaryAdvances).where(eq(salaryAdvances.id, req.params.id));
      if (!adv) return res.status(404).json({ error: "Advance not found." });
      if (!(await checkStoreAccess(adv.storeId, req, res))) return;
      await storage.deleteSalaryAdvance(req.params.id);
      res.status(204).end();
    } catch (e) { res.status(500).json({ error: "Could not delete advance." }); }
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
        const totalNet = entries.reduce((s, e) => s + (e.netPay || 0), 0);
        const deductions = await storage.getPayrollDeductions(p.id);
        const totalDeductions = deductions.reduce((s, d) => s + Number(d.amount), 0);
        return {
          id: p.id, periodType: p.periodType, startDate: p.startDate, endDate: p.endDate,
          status: p.status, staffCount: entries.length,
          totalGrossCommission: totalGross, totalTransport, totalDeductions,
          totalNetPay: totalNet, paidAt: p.paidAt,
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

      const category = await storage.createExpenseCategory({ storeId, name, isSystem: false });
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
      const updated = await storage.updateExpenseCategory(req.params.id, name);
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
      await storage.deleteExpenseCategory(req.params.id);
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
      await storage.deleteExpense(req.params.id);
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
