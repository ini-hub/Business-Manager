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
} from "@shared/schema";
import { z } from "zod";
import { db } from "../db";
import { eq, and, gte, lte, gt, count, desc } from "drizzle-orm";
import { sanitizeString, sanitizeUUID, sanitizeNumber, sanitizeBoolean, sanitizePhoneNumber, sanitizeStoreCode } from "../sanitize";
import { auditLogger } from "../audit";
import { bulkUploadService } from "../services/BulkUploadService";
import { analyticsService } from "../services/AnalyticsService";
import { getUserId, getClientIp, formatZodErrors, checkBusinessAccess, getUserStores, verifyStoreAccess, verifyRecordStoreAccess, triggerAutoRecalculate } from './helpers';

export type RouteMiddlewares = {
  isAuthenticated: any;
  requireRole: (...roles: any[]) => any;
  requireManagerOrOwner: any;
  checkStoreAccess: (storeId: string, req: Request, res: Response) => Promise<boolean>;
};

export function registerPayrollRoutes(app: Express, { isAuthenticated: _isAuth, requireRole, requireManagerOrOwner, checkStoreAccess }: RouteMiddlewares): void {
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

      const present = attendance.filter(r => r.status === "active" || r.status === "passive").length;
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
      if (!(await checkStoreAccess(storeId, req, res))) return;
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
      const totalAmount = entries.reduce((sum, entry) => sum + (entry.netPay || 0), 0);
      const userId = (req as any).user?.id;

      const updated = await storage.updatePayrollPeriodStatus(req.params.id, "paid", userId);

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
      const updated = await storage.updateExpenseCategory(req.params.id, name);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Could not update expense category." });
    }
  });

  app.delete("/api/expense-categories/:id", requireRole("owner"), async (req, res) => {
    try {
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

      const expense = await storage.createExpense({
        ...data,
        inventoryId: data.inventoryId === "none" ? null : (data.inventoryId || null),
        paymentMethod: data.paymentMethod || "cash",
        splitPayments: data.paymentMethod === "split" ? data.splitPayments : null
      });
      res.status(201).json(expense);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      res.status(500).json({ error: "Could not create expense." });
    }
  });

  app.patch("/api/expenses/:id", requireManagerOrOwner, async (req, res) => {
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

      const expense = await storage.updateExpense(req.params.id, {
        ...data,
        inventoryId: data.inventoryId === "none" ? null : (data.inventoryId || undefined),
        splitPayments: targetPaymentMethod === "split" ? targetSplitPayments : (data.paymentMethod && data.paymentMethod !== "split" ? null : undefined)
      });
      res.json(expense);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      res.status(500).json({ error: "Could not update expense." });
    }
  });

  app.delete("/api/expenses/:id", requireRole("owner"), async (req, res) => {
    try {
      await storage.deleteExpense(req.params.id);
      res.status(204).end();
    } catch (error) {
      res.status(500).json({ error: "Could not delete expense." });
    }
  });

  // ==========================================
  // V2/V3/V4 SME GAPS INTEGRATION ENDPOINTS
  // ==========================================

}
