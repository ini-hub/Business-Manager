import type { Express, Request, Response, NextFunction } from "express";
import { getStoreTimezone, toUtcStart, toUtcEnd } from "../lib/dateUtils";
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
import { getUserId, getClientIp, formatZodErrors, checkBusinessAccess, getUserStores, verifyStoreAccess, verifyRecordStoreAccess, triggerAutoRecalculate, broadcastChange } from './helpers';

export type RouteMiddlewares = {
  isAuthenticated: any;
  requireRole: (...roles: any[]) => any;
  requireManagerOrOwner: any;
  checkStoreAccess: (storeId: string, req: Request, res: Response) => Promise<boolean>;
};

export function registerReportsRoutes(app: Express, { isAuthenticated, requireRole, requireManagerOrOwner, checkStoreAccess }: RouteMiddlewares): void {
  // ========== SEARCH ==========
  app.get("/api/search", isAuthenticated, async (req, res) => {
    try {
      const q = req.query.q as string;
      const storeId = req.query.storeId as string;
      if (!q || q.length < 2) return res.json({ results: [] });
      if (!storeId) return res.status(400).json({ error: "Store ID required." });
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const [customersRes, inventoryRes, transactionsRes] = await Promise.all([
        storage.searchCustomers(storeId, q),
        storage.searchInventory(storeId, q),
        storage.searchTransactions(storeId, q)
      ]);

      res.json({
        customers: customersRes,
        inventory: inventoryRes,
        transactions: transactionsRes,
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
      await storage.markNotificationAsRead(req.params.id);
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
  app.get("/api/reports/staff-performance", requireManagerOrOwner, async (req, res) => {
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
  app.get("/api/reports/staff-performance/:staffId/breakdown", requireManagerOrOwner, async (req, res) => {
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

  // Get attendance records
  app.get("/api/attendance", isAuthenticated, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) return res.status(400).json({ error: "Store ID required." });
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const records = await storage.getAttendanceRecords(storeId, {
        staffId: req.query.staffId as string | undefined,
        startDate: req.query.startDate as string | undefined,
        endDate: req.query.endDate as string | undefined,
      });
      res.json(records);
    } catch (error) {
      res.status(500).json({ error: "Could not load attendance records." });
    }
  });

  // Upsert a single attendance record
  app.post("/api/attendance", requireManagerOrOwner, async (req, res) => {
    try {
      const { storeId, staffId, date, status, notes } = req.body;
      if (!storeId || !staffId || !date || !status) {
        return res.status(400).json({ error: "storeId, staffId, date and status are required." });
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const userId = (req as any).user?.id;
      const record = await storage.upsertAttendanceRecord({ storeId, staffId, date, status, notes, markedByUserId: userId });

      triggerAutoRecalculate(storeId, date).catch(console.error);
      broadcastChange(req, "attendance", storeId, "updated");

      res.status(200).json(record);
    } catch (error) {
      res.status(500).json({ error: "Could not save attendance record." });
    }
  });

  // Bulk mark attendance for a day
  app.post("/api/attendance/bulk", requireManagerOrOwner, async (req, res) => {
    try {
      const { storeId, date, status, staffIds } = req.body;
      if (!storeId || !date || !status || !Array.isArray(staffIds)) {
        return res.status(400).json({ error: "storeId, date, status and staffIds array are required." });
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const userId = (req as any).user?.id;
      const records = await storage.bulkMarkAttendance(storeId, date, status, staffIds, userId);

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
      const summary = await storage.getAttendanceSummary(storeId, staffId, startDate, endDate);
      res.json(summary);
    } catch (error) {
      res.status(500).json({ error: "Could not load attendance summary." });
    }
  });

  app.post("/api/expenses/bulk", requireManagerOrOwner, async (req, res) => {
    try {
      const storeId = req.body.storeId;
      const rawExpenses = req.body.expenses || req.body.data;
      if (!storeId) return res.status(400).json({ error: "Store ID is required." });
      if (!Array.isArray(rawExpenses)) return res.status(400).json({ error: "Expenses must be an array." });

      // Verify user has access to this store
      if (!await verifyStoreAccess(req, storeId)) {
        return res.status(403).json({ error: "You don't have access to this store." });
      }

      const results = await bulkUploadService.importExpenses(rawExpenses, storeId);
      res.json(results);
    } catch (error) {
      res.status(500).json({ error: "Bulk expense import failed." });
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

      // Retrieve all checkouts for Operating inflow
      const storeCheckouts = await db
        .select()
        .from(checkouts)
        .where(
          and(
            eq(checkouts.storeId, storeId),
            gte(checkouts.createdAt, start),
            lte(checkouts.createdAt, end),
            eq(checkouts.isVoided, false)
          )
        );

      // Sum up cash receipts from sales (cash payments + cash split payments)
      let cashSales = 0;
      let nonCashSales = 0;

      for (const checkout of storeCheckouts) {
        if (checkout.paymentMethod === "cash") {
          cashSales += checkout.totalCharged;
        } else if (checkout.paymentMethod === "split" && checkout.splitPayments) {
          const cashPortion = checkout.splitPayments.find((p: any) => p.method === "cash")?.amount || 0;
          cashSales += cashPortion;
          nonCashSales += (checkout.totalCharged - cashPortion);
        } else {
          nonCashSales += checkout.totalCharged;
        }
      }

      // Customer repayments in cash
      const repaymentsList = await db
        .select({
          repayment: repayments,
          credit: creditEntries,
        })
        .from(repayments)
        .innerJoin(creditEntries, eq(repayments.creditEntryId, creditEntries.id))
        .where(
          and(
            eq(creditEntries.storeId, storeId),
            gte(repayments.createdAt, start),
            lte(repayments.createdAt, end)
          )
        );

      let cashRepayments = 0;
      for (const row of repaymentsList) {
        if (row.repayment.paymentMethod === "cash") {
          cashRepayments += row.repayment.amountReceived;
        }
      }

      // Paid expenses as Operating outflow
      const startStr = start.toISOString().split('T')[0];
      const endStr = end.toISOString().split('T')[0];

      const expensesList = await db
        .select()
        .from(expenses)
        .where(
          and(
            eq(expenses.storeId, storeId),
            gte(expenses.date, startStr),
            lte(expenses.date, endStr)
          )
        );

      let operatingExpensesCashOut = 0;
      let operatingExpensesNonCashOut = 0;

      for (const exp of expensesList) {
        if (exp.paymentMethod === "cash") {
          operatingExpensesCashOut += exp.amount;
        } else if (exp.paymentMethod === "split" && exp.splitPayments) {
          const cashPortion = exp.splitPayments.find((p: any) => p.method === "cash")?.amount || 0;
          operatingExpensesCashOut += cashPortion;
          operatingExpensesNonCashOut += (exp.amount - cashPortion);
        } else {
          operatingExpensesNonCashOut += exp.amount;
        }
      }

      // Cash Drawer Float discrepancy / Drops
      const sessionDrops = await db
        .select({
          drop: cashDrops
        })
        .from(cashDrops)
        .innerJoin(cashRegisterSessions, eq(cashDrops.sessionId, cashRegisterSessions.id))
        .where(
          and(
            eq(cashRegisterSessions.storeId, storeId),
            gte(cashDrops.droppedAt, start),
            lte(cashDrops.droppedAt, end)
          )
        );
      
      let cashDropsTotal = sessionDrops.reduce((sum, row) => sum + Number(row.drop.amount), 0);

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
