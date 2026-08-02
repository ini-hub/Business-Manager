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
import { getUserId, getClientIp, formatZodErrors, checkBusinessAccess, getUserStores, verifyStoreAccess, verifyRecordStoreAccess, triggerAutoRecalculate, broadcastChange } from './helpers';
import { isOrgTrialing } from "../lib/trial";
import { logFunnelEvent } from "../lib/funnel";

export type RouteMiddlewares = {
  isAuthenticated: any;
  requireRole: (...roles: any[]) => any;
  requireManagerOrOwner: any;
  checkStoreAccess: (storeId: string, req: Request, res: Response) => Promise<boolean>;
};

export function registerSalesRoutes(app: Express, { isAuthenticated, requireRole, requireManagerOrOwner, checkStoreAccess }: RouteMiddlewares): void {
  // ========== PROFIT & LOSS ==========

  app.get("/api/profit-loss", requireManagerOrOwner, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) {
        return res.status(400).json({ error: "Please select a store first." });
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;
      const plData = await storage.getProfitLoss(storeId, startDate, endDate);
      res.json(plData);
    } catch (error) {
      res.status(500).json({ error: "We couldn't load profit/loss data. Please try again." });
    }
  });

  app.get("/api/profit-loss/summary", requireRole("owner"), async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      const businessId = req.query.businessId as string;
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;

      if (!storeId && !businessId) {
        return res.status(400).json({ error: "Store ID or Business ID required." });
      }

      if (businessId) {
        if (!(await checkBusinessAccess(businessId, req, res))) return;

        // Fetch all stores of this business
        const stores = await storage.getStores(businessId);
        if (stores.length === 0) {
          return res.json({
            serviceRevenue: 0,
            productRevenue: 0,
            grossRevenue: 0,
            returnedRevenue: 0,
            totalRevenue: 0,
            costOfGoodsSold: 0,
            costOfProductsSold: 0,
            costOfServicesSold: 0,
            grossProfit: 0,
            discountsGiven: 0,
            discountsList: [],
            totalOperationalExpenses: 0,
            directSuppliesFromExpenses: 0,
            directSuppliesFromRecipes: 0,
            directSuppliesTotal: 0,
            directSuppliesGrouped: [],
            costOfDelivery: 0,
            totalPayrollExpenses: 0,
            totalExpenses: 0,
            operatingProfit: 0,
            expensesGrouped: [],
            payrollDetails: []
          });
        }

        // Fetch summaries for each store in parallel
        const summaries = await Promise.all(
          stores.map(async (store) => {
            try {
              return await analyticsService.getProfitLossSummary(store.id, startDate, endDate);
            } catch (err) {
              console.error(`Error calculating PL for store ${store.id}:`, err);
              return null;
            }
          })
        );

        // Aggregate summaries
        const validSummaries = summaries.filter(s => s !== null);
        const consolidated = {
          serviceRevenue: 0,
          productRevenue: 0,
          grossRevenue: 0,
          returnedRevenue: 0,
          totalRevenue: 0,
          costOfGoodsSold: 0,
          costOfProductsSold: 0,
          costOfServicesSold: 0,
          grossProfit: 0,
          discountsGiven: 0,
          discountsList: [] as any[],
          totalOperationalExpenses: 0,
          directSuppliesFromExpenses: 0,
          directSuppliesFromRecipes: 0,
          directSuppliesTotal: 0,
          directSuppliesGrouped: [] as { category: string; amount: number }[],
          costOfDelivery: 0,
          totalPayrollExpenses: 0,
          totalExpenses: 0,
          operatingProfit: 0,
          expensesGrouped: [] as { category: string; amount: number }[],
          payrollDetails: [] as any[]
        };

        const expensesMap: Record<string, number> = {};
        const directSuppliesMap: Record<string, number> = {};

        for (const s of validSummaries) {
          if (!s) continue;
          consolidated.serviceRevenue += s.serviceRevenue || 0;
          consolidated.productRevenue += s.productRevenue || 0;
          consolidated.grossRevenue += s.grossRevenue || 0;
          consolidated.returnedRevenue += s.returnedRevenue || 0;
          consolidated.totalRevenue += s.totalRevenue || 0;
          consolidated.costOfGoodsSold += s.costOfGoodsSold || 0;
          consolidated.costOfProductsSold += s.costOfProductsSold || 0;
          consolidated.costOfServicesSold += s.costOfServicesSold || 0;
          consolidated.grossProfit += s.grossProfit || 0;
          consolidated.discountsGiven += s.discountsGiven || 0;
          consolidated.totalOperationalExpenses += s.totalOperationalExpenses || 0;
          consolidated.directSuppliesFromExpenses += s.directSuppliesFromExpenses || 0;
          consolidated.directSuppliesFromRecipes += s.directSuppliesFromRecipes || 0;
          consolidated.directSuppliesTotal += s.directSuppliesTotal || 0;
          consolidated.costOfDelivery += s.costOfDelivery || 0;
          consolidated.totalPayrollExpenses += s.totalPayrollExpenses || 0;
          consolidated.totalExpenses += s.totalExpenses || 0;
          consolidated.operatingProfit += s.operatingProfit || 0;

          if (Array.isArray(s.discountsList)) {
            consolidated.discountsList.push(...s.discountsList);
          }
          if (Array.isArray(s.payrollDetails)) {
            consolidated.payrollDetails.push(...s.payrollDetails);
          }
          if (Array.isArray(s.expensesGrouped)) {
            s.expensesGrouped.forEach((eg: any) => {
              expensesMap[eg.category] = (expensesMap[eg.category] || 0) + (eg.amount || 0);
            });
          }
          if (Array.isArray(s.directSuppliesGrouped)) {
            s.directSuppliesGrouped.forEach((eg: any) => {
              directSuppliesMap[eg.category] = (directSuppliesMap[eg.category] || 0) + (eg.amount || 0);
            });
          }
        }

        consolidated.expensesGrouped = Object.entries(expensesMap).map(([category, amount]) => ({
          category,
          amount,
        }));
        consolidated.directSuppliesGrouped = Object.entries(directSuppliesMap).map(([category, amount]) => ({
          category,
          amount,
        }));

        return res.json(consolidated);
      } else {
        if (!(await checkStoreAccess(storeId, req, res))) return;
        const summary = await analyticsService.getProfitLossSummary(storeId, startDate, endDate);
        res.json(summary);
      }
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Could not calculate profit/loss summary." });
    }
  });

  // ========== STAFF SELF-SERVICE ==========  // ========== DASHBOARD STATS ==========
  app.get("/api/dashboard/stats", isAuthenticated, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      const businessId = req.query.businessId as string;
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;

      if (!storeId && !businessId) {
        return res.status(400).json({ error: "Please select a store or business first." });
      }

      if (businessId) {
        if (!(await checkBusinessAccess(businessId, req, res))) return;
        const stores = await storage.getStores(businessId);
        if (stores.length === 0) {
          return res.json({
            totalCustomers: 0,
            totalStaff: 0,
            totalInventory: 0,
            totalProducts: 0,
            totalServices: 0,
            totalTransactions: 0,
            totalRevenue: 0,
            grossRevenue: 0,
            returnedRevenue: 0,
            totalProfit: 0,
            lowStockItems: []
          });
        }

        const summaries = await Promise.all(
          stores.map(async (store) => {
            try {
              return await storage.getDashboardStats(store.id, from, to);
            } catch (err) {
              console.error(`Error calculating dashboard stats for store ${store.id}:`, err);
              return null;
            }
          })
        );

        const validSummaries = summaries.filter(s => s !== null);
        const consolidated = {
          totalCustomers: 0,
          totalStaff: 0,
          totalInventory: 0,
          totalProducts: 0,
          totalServices: 0,
          totalTransactions: 0,
          totalRevenue: 0,
          grossRevenue: 0,
          returnedRevenue: 0,
          totalProfit: 0,
          lowStockItems: [] as any[]
        };

        const lowStockIds = new Set<string>();
        for (const s of validSummaries) {
          if (!s) continue;
          consolidated.totalStaff += s.totalStaff || 0;
          consolidated.totalInventory += s.totalInventory || 0;
          consolidated.totalProducts += s.totalProducts || 0;
          consolidated.totalServices += s.totalServices || 0;
          consolidated.totalTransactions += s.totalTransactions || 0;
          consolidated.totalRevenue += s.totalRevenue || 0;
          consolidated.grossRevenue += s.grossRevenue || 0;
          consolidated.returnedRevenue += s.returnedRevenue || 0;
          consolidated.totalProfit += s.totalProfit || 0;
          if (s.lowStockItems) {
            for (const item of s.lowStockItems) {
              if (!lowStockIds.has(item.id)) {
                lowStockIds.add(item.id);
                consolidated.lowStockItems.push(item);
              }
            }
          }
        }

        // De-duplicate customer count across all stores under this business
        consolidated.totalCustomers = await storage.getBusinessCustomerCount(businessId, from, to);

        return res.json(consolidated);
      }

      if (!(await checkStoreAccess(storeId, req, res))) return;
      
      const stats = await storage.getDashboardStats(storeId, from, to);
      res.json(stats);
    } catch (error) {
      console.error("Dashboard Stats Error:", error);
      res.status(500).json({ error: "We couldn't load dashboard statistics. Please try again." });
    }
  });
  // ========== CHART DATA ==========
  app.get("/api/charts/sales-trends", isAuthenticated, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      const businessId = req.query.businessId as string;
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;

      if (!storeId && !businessId) {
        return res.status(400).json({ error: "Please select a store or business first." });
      }

      if (businessId) {
        if (!(await checkBusinessAccess(businessId, req, res))) return;
        const stores = await storage.getStores(businessId);
        if (stores.length === 0) return res.json([]);

        const storeTrends = await Promise.all(
          stores.map(async (s) => {
            try {
              return await storage.getSalesTrends(s.id, from, to);
            } catch (err) {
              return [];
            }
          })
        );

        const trendMap = new Map<string, { revenue: number; transactions: number }>();
        for (const trends of storeTrends) {
          for (const item of trends) {
            const existing = trendMap.get(item.date) ?? { revenue: 0, transactions: 0 };
            trendMap.set(item.date, {
              revenue: existing.revenue + item.revenue,
              transactions: existing.transactions + item.transactions
            });
          }
        }
        const result = Array.from(trendMap.entries())
          .map(([date, data]) => ({ date, ...data }))
          .sort((a, b) => a.date.localeCompare(b.date));
        return res.json(result.slice(-30));
      }

      if (!(await checkStoreAccess(storeId, req, res))) return;
      const data = await storage.getSalesTrends(storeId, from, to);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "We couldn't load sales trends. Please try again." });
    }
  });

  app.get("/api/charts/revenue-by-type", isAuthenticated, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      const businessId = req.query.businessId as string;
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;

      if (!storeId && !businessId) {
        return res.status(400).json({ error: "Please select a store or business first." });
      }

      if (businessId) {
        if (!(await checkBusinessAccess(businessId, req, res))) return;
        const stores = await storage.getStores(businessId);
        if (stores.length === 0) return res.json([]);

        const storeRevenues = await Promise.all(
          stores.map(async (s) => {
            try {
              return await storage.getRevenueByType(s.id, from, to);
            } catch (err) {
              return [];
            }
          })
        );

        const revMap = new Map<string, { value: number; type: string }>();
        for (const items of storeRevenues) {
          for (const item of items) {
            const existing = revMap.get(item.name) ?? { value: 0, type: item.type };
            revMap.set(item.name, {
              value: existing.value + item.value,
              type: item.type
            });
          }
        }
        const result = Array.from(revMap.entries())
          .map(([name, data]) => ({ name, value: data.value, type: data.type }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 10);
        return res.json(result);
      }

      if (!(await checkStoreAccess(storeId, req, res))) return;
      const data = await storage.getRevenueByType(storeId, from, to);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "We couldn't load revenue data. Please try again." });
    }
  });
  // ========== TRIAL CHECKOUT DEFAULTS ==========
  // Auto-provisions (idempotently) a real walk-in customer and a real default staff
  // record for organisations still inside their free trial, so a first-time trial
  // user can complete a sale without manually creating either first. Every sale
  // still carries genuine customerId/staffId - checkout validation is unchanged.
  // Organisations that aren't trialing (which is every org that existed before this
  // feature shipped) get a 403 here and see no change in behavior anywhere else.
  app.post("/api/sales/trial-defaults", isAuthenticated, async (req, res) => {
    try {
      const { storeId } = z.object({ storeId: z.string() }).parse(req.body);
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const user = (req as any).user;
      const businessId = user?.businessId;
      const business = businessId ? await storage.getBusinessById(businessId) : undefined;
      if (!business || !isOrgTrialing(business)) {
        return res.status(403).json({ error: "Trial defaults are only available during an active trial." });
      }

      let customerId = business.defaultWalkInCustomerId;
      if (customerId) {
        const [existing] = await db.select().from(customers).where(eq(customers.id, customerId));
        if (!existing || existing.storeId !== storeId) customerId = null;
      }
      if (!customerId) {
        const customer = await storage.createCustomer({
          storeId,
          name: "Walk-in Customer",
          customerNumber: "",
          address: "",
        } as any);
        customerId = customer.id;
        await storage.updateBusiness(business.id, { defaultWalkInCustomerId: customerId });
      }

      let staffId = business.defaultTrialStaffId;
      if (staffId) {
        const [existing] = await db.select().from(staff).where(eq(staff.id, staffId));
        if (!existing || existing.storeId !== storeId) staffId = null;
      }
      if (!staffId) {
        const fullUser = await storage.getUser(user.id);
        const staffMember = await storage.createStaff({
          storeId,
          userId: user.id,
          name: fullUser?.name || "Owner",
          email: fullUser?.email || `owner-${user.id}@trial.local`,
          mobileNumber: fullUser?.phone || "0000000000",
          payPerMonth: 0,
        } as any);
        staffId = staffMember.id;
        await storage.updateBusiness(business.id, { defaultTrialStaffId: staffId });
      }

      res.json({ customerId, staffId });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      console.error("POST /api/sales/trial-defaults error:", error);
      res.status(500).json({ error: "We couldn't set up your trial defaults. Please try again." });
    }
  });

  // ========== SALES CHECKOUT ==========
  const checkoutSchema = z.object({
    storeId: z.string(),
    customerId: z.string(),
    staffId: z.string(),
    items: z.array(
      z.object({
        inventoryId: z.string(),
        quantity: z.number().min(0.01, "Quantity must be greater than zero"),
        customPrice: z.number().min(0).optional(),
        leadStaffId: z.string().optional().nullable(),
        assistingStaff1Id: z.string().optional().nullable(),
        assistingStaff2Id: z.string().optional().nullable(),
        commissionSplit: z.enum(["standard", "equal"]).optional().default("standard"),
      })
    ),
    paymentMethod: z.enum(["cash", "transfer", "flutterwave", "credit", "split", "deposit", "store_credit"]).default("cash"),
    splitPayments: z.array(z.object({
      method: z.enum(["cash", "transfer", "flutterwave", "credit", "store_credit"]),
      amount: z.number().min(0.01)
    })).optional(),
    discountAmount: z.number().min(0).optional(),
    discountPercent: z.number().min(0).optional(),
    discountReason: z.string().optional(),
    discountApprovedBy: z.string().optional(),
    effectiveDate: z.string().optional(),
    creditUpfrontPaid: z.number().min(0).optional(),
    creditDueDate: z.string().optional(),
    bookingId: z.string().optional(),
    bookingDepositAmount: z.number().min(0).optional(),
    bookingDepositMethod: z.string().optional(),
    balanceCollectedToday: z.number().min(0).optional(),
    pointsRedeemed: z.number().min(0).optional(),
  });

  app.post("/api/sales/checkout", isAuthenticated, async (req, res) => {
    try {
      const data = checkoutSchema.parse(req.body);

      if (!(await checkStoreAccess(data.storeId, req, res))) return;

      // Staff with a linked profile can only ring up sales under their own name;
      // shared/unlinked staff logins fall back to the old free-pick behavior.
      if ((req as any).user?.role === "staff") {
        const ownStaffRecord = await storage.getStaffByUserId(getUserId(req)!);
        if (ownStaffRecord && ownStaffRecord.id !== data.staffId) {
          return res.status(403).json({ error: "You can only check out sales under your own staff profile." });
        }
      }

      if (data.paymentMethod === "flutterwave" && data.splitPayments && data.splitPayments.length > 0) {
        return res.status(400).json({ error: "Flutterwave cannot be combined with split payments. Choose either Flutterwave OR split payment." });
      }

      // Validate each item's quantity against its allowFractional flag
      for (const item of data.items) {
        const invItem = await storage.getInventoryItem(item.inventoryId);
        if (!invItem) {
          return res.status(400).json({ error: `Item not found: ${item.inventoryId}` });
        }
        if (!invItem.allowFractional && !Number.isInteger(item.quantity)) {
          return res.status(400).json({
            error: `"${invItem.name}" cannot be sold in fractional quantities. Please enter a whole number.`,
          });
        }
      }

      // Use transactional checkout for atomicity (all-or-nothing)
      const result = await storage.processCheckout({
        storeId: data.storeId,
        customerId: data.customerId,
        staffId: data.staffId,
        items: data.items,
        paymentMethod: data.paymentMethod,
        discountAmount: data.discountAmount,
        discountPercent: data.discountPercent,
        discountReason: data.discountReason,
        discountApprovedBy: data.discountApprovedBy,
        effectiveDate: data.effectiveDate,
        creditUpfrontPaid: data.creditUpfrontPaid,
        creditDueDate: data.creditDueDate,
        bookingId: data.bookingId,
        bookingDepositAmount: data.bookingDepositAmount,
        bookingDepositMethod: data.bookingDepositMethod,
        balanceCollectedToday: data.balanceCollectedToday,
        splitPayments: data.splitPayments,
        pointsRedeemed: data.pointsRedeemed,
      });

      if (!result.success) {
        auditLogger.logDataModification("checkout", undefined, getUserId(req), "CHECKOUT", false, result.message);
        return res.status(400).json({ error: result.message });
      }

      auditLogger.logDataModification("checkout", result.checkoutIds?.[0], getUserId(req), "CHECKOUT", true);

      // First-ever completed sale for this org - the activation signal that
      // future mid-trial nudges key off, independent of billing status.
      const businessId = (req as any).user?.businessId;
      if (businessId) {
        logFunnelEvent(businessId, "checkout_completed", { storeId: data.storeId });
        storage.getBusinessById(businessId).then((business) => {
          if (business && !business.activatedAt) {
            storage.updateBusiness(businessId, { activatedAt: new Date() }).catch(console.error);
          }
        }).catch(console.error);
      }

      // Auto-recalculate open payroll periods covering today's checkout date
      const todayStr = new Date().toISOString().split("T")[0];
      triggerAutoRecalculate(data.storeId, todayStr).catch(console.error);

      broadcastChange(req, "sales", data.storeId, "created");

      res.status(201).json({
        success: true,
        message: result.message,
        checkoutIds: result.checkoutIds
      });
    } catch (error) {
      auditLogger.logDataModification("checkout", undefined, getUserId(req), "CHECKOUT", false, (error as Error).message);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      console.error("Checkout error:", error);
      res.status(500).json({ error: "We couldn't complete this sale right now. Please try again." });
    }
  });

  // Helper to automatically recalculate any open pending payroll periods when source records are modified
  async function triggerAutoRecalculate(storeId: string, dateStr: string) {
    try {
      const periods = await storage.getPayrollPeriods(storeId);
      const pendingPeriod = periods.find(p => p.status === "pending" && p.startDate <= dateStr && p.endDate >= dateStr);
      if (pendingPeriod) {
        await storage.calculatePayrollForPeriod(pendingPeriod.id);
        console.log(`Auto-recalculated pending payroll period ${pendingPeriod.id} due to data change on ${dateStr}`);
      }
    } catch (err) {
      console.error("Auto-recalculate error:", err);
    }
  }

  app.get("/api/reports/top-customers", requireManagerOrOwner, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) return res.status(400).json({ error: "Store ID is required." });
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;
      const results = await storage.getTopCustomers(storeId, startDate, endDate);
      res.json(results);
    } catch (error) {
      res.status(500).json({ error: "Could not load top customers report." });
    }
  });

  // ========== SALE DRAFTS ==========

  app.get("/api/sales/drafts", isAuthenticated, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) return res.status(400).json({ error: "Store ID is required." });
      if (!(await checkStoreAccess(storeId, req, res))) return;
      const drafts = await storage.listDrafts(storeId);
      res.json(drafts);
    } catch (error) {
      res.status(500).json({ error: "Could not load drafts." });
    }
  });

  app.get("/api/sales/drafts/:id", isAuthenticated, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) return res.status(400).json({ error: "Store ID is required." });
      if (!(await checkStoreAccess(storeId, req, res))) return;
      const draft = await storage.getDraft(req.params.id, storeId);
      if (!draft) return res.status(404).json({ error: "Draft not found." });
      res.json(draft);
    } catch (error) {
      res.status(500).json({ error: "Could not load draft." });
    }
  });

  const draftSchema = z.object({
    storeId: z.string(),
    name: z.string().optional(),
    cartData: z.array(z.object({
      inventoryId: z.string(),
      name: z.string(),
      type: z.string(),
      quantity: z.number(),
      customPrice: z.number(),
      totalPrice: z.number(),
      leadStaffId: z.string().nullable().optional(),
      assistingStaff1Id: z.string().nullable().optional(),
      assistingStaff2Id: z.string().nullable().optional(),
      commissionSplit: z.string().optional(),
      unit: z.string().nullable().optional(),
      allowFractional: z.boolean().optional(),
    })),
    customerId: z.string().nullable().optional(),
    staffId: z.string().nullable().optional(),
    paymentMethod: z.string().optional(),
    discountAmount: z.number().optional(),
    discountPercent: z.number().optional(),
    discountReason: z.string().optional(),
    discountApprovedBy: z.string().optional(),
    redeemPoints: z.boolean().optional(),
    redeemStoreCredit: z.boolean().optional(),
    creditUpfrontPaid: z.number().optional(),
    creditDueDate: z.string().optional(),
    splitPayments: z.array(z.object({ method: z.string(), amount: z.number() })).optional(),
  });

  function normalizeDraftCartData(cartData: any[]): any[] {
    return cartData.map(item => ({
      ...item,
      leadStaffId: item.leadStaffId ?? null,
      assistingStaff1Id: item.assistingStaff1Id ?? null,
      assistingStaff2Id: item.assistingStaff2Id ?? null,
      commissionSplit: item.commissionSplit ?? "standard",
    }));
  }

  app.post("/api/sales/drafts", isAuthenticated, async (req, res) => {
    try {
      const data = draftSchema.parse(req.body);
      if (!(await checkStoreAccess(data.storeId, req, res))) return;
      const userId = getUserId(req);
      const draft = await storage.saveDraft({
        ...data,
        cartData: normalizeDraftCartData(data.cartData),
        createdByUserId: userId ?? undefined,
      });
      res.status(201).json(draft);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: formatZodErrors(error.errors) });
      res.status(500).json({ error: "Could not save draft." });
    }
  });

  app.put("/api/sales/drafts/:id", isAuthenticated, async (req, res) => {
    try {
      const body = draftSchema.parse(req.body);
      if (!(await checkStoreAccess(body.storeId, req, res))) return;
      const draft = await storage.updateDraft(req.params.id, body.storeId, {
        ...body,
        cartData: normalizeDraftCartData(body.cartData),
      } as any);
      if (!draft) return res.status(404).json({ error: "Draft not found." });
      res.json(draft);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: formatZodErrors(error.errors) });
      res.status(500).json({ error: "Could not update draft." });
    }
  });

  app.delete("/api/sales/drafts/:id", isAuthenticated, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) return res.status(400).json({ error: "Store ID is required." });
      if (!(await checkStoreAccess(storeId, req, res))) return;
      const deleted = await storage.deleteDraft(req.params.id, storeId);
      if (!deleted) return res.status(404).json({ error: "Draft not found." });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Could not delete draft." });
    }
  });

}
