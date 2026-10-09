import { parsePage, paginated } from "../lib/pagination";
import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { splitFullName } from "@shared/name-utils";
import { splitNormalizedPhone } from "@shared/phone-utils";
import {
  customers,
  inventory,
  staff
} from "@shared/schema";
import { z } from "zod";
import { db } from "../db";
import { eq, inArray } from "drizzle-orm";
import { auditLogger } from "../audit";
import { getCheckoutMoneyDetails } from "../lib/checkoutAuditDetails";
import { analyticsService } from "../services/AnalyticsService";
import { getUserId, formatZodErrors, checkBusinessAccess, broadcastChange, getAuditContext } from './helpers';
import { isOrgTrialing } from "../lib/trial";
import { logFunnelEvent } from "../lib/funnel";
import { getRequestEntitlements, featureNotPurchasedBody } from "../lib/entitlements";
import { cachedReport, storeTag, businessTag, businessAggregateTag } from "../lib/reportCache";
import { requirePermission } from "../lib/permissionGate";

export type RouteMiddlewares = {
  isAuthenticated: any;
  requireRole: (...roles: any[]) => any;
  requireManagerOrOwner: any;
  checkStoreAccess: (storeId: string, req: Request, res: Response) => Promise<boolean>;
};

/**
 * A per-store report, served from the short-lived report cache. Callers must have authorised the store first.
 * Entries are dropped as soon as anything in the store is written (see broadcastDataChange), and expire on
 * their own after 30s.
 */
function storeReport<T>(req: Request, name: string, storeId: string, params: unknown, load: () => Promise<T>): Promise<T> {
  const businessId = (req as any).user?.businessId as string | undefined;
  return cachedReport({ name, tags: businessId ? [storeTag(storeId), businessTag(businessId)] : [storeTag(storeId)], params }, load);
}

// Orgs this process has already seen with activated_at set (see the checkout handler).
const activatedOrgs = new Set<string>();

export function registerSalesRoutes(app: Express, { isAuthenticated, requireRole, requireManagerOrOwner, checkStoreAccess }: RouteMiddlewares): void {
  // ========== PROFIT & LOSS ==========

  // The Financial Management bundle (FAC-7) - P&L, Expenses, and Hybrid/Commission
  // payroll ship together as one purchase - is gated centrally (shared/features.ts).
  app.get("/api/profit-loss", requirePermission("/profit-loss"), async (req, res) => {
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
            discountsCount: 0,
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
              return await storeReport(req, "profitLossSummary", store.id, { startDate, endDate }, () => analyticsService.getProfitLossSummary(store.id, startDate, endDate));
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
          discountsCount: 0,
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
          consolidated.discountsCount += s.discountsCount || 0;
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
        const summary = await storeReport(req, "profitLossSummary", storeId, { startDate, endDate }, () => analyticsService.getProfitLossSummary(storeId, startDate, endDate));
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
            uniqueCustomersInPeriod: 0,
            totalRevenue: 0,
            grossRevenue: 0,
            returnedRevenue: 0,
            totalProfit: 0,
            revenueMix: { services: 0, products: 0 },
            lowStockThreshold: 5,
            lowStockItems: [],
            outOfStockCount: 0,
            lowStockCount: 0,
            lossSales: { count: 0, amount: 0 },
          });
        }

        const summaries = await Promise.all(
          stores.map(async (store) => {
            try {
              return await storeReport(req, "dashboardStats", store.id, { from, to }, () => storage.getDashboardStats(store.id, from, to));
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
          uniqueCustomersInPeriod: 0,
          totalRevenue: 0,
          grossRevenue: 0,
          returnedRevenue: 0,
          totalProfit: 0,
          revenueMix: { services: 0, products: 0 },
          lowStockThreshold: 5,
          lowStockItems: [] as any[],
          outOfStockCount: 0,
          lowStockCount: 0,
          lossSales: { count: 0, amount: 0 },
        };

        const lowStockIds = new Set<string>();
        for (const s of validSummaries) {
          if (!s) continue;
          consolidated.totalStaff += s.totalStaff || 0;
          consolidated.totalInventory += s.totalInventory || 0;
          consolidated.totalProducts += s.totalProducts || 0;
          consolidated.totalServices += s.totalServices || 0;
          consolidated.totalTransactions += s.totalTransactions || 0;
          // Approximation: a customer transacting at two stores in the same
          // window is counted twice here, unlike the de-duplicated
          // totalCustomers below — acceptable for this secondary stat.
          consolidated.uniqueCustomersInPeriod += s.uniqueCustomersInPeriod || 0;
          consolidated.totalRevenue += s.totalRevenue || 0;
          consolidated.grossRevenue += s.grossRevenue || 0;
          consolidated.returnedRevenue += s.returnedRevenue || 0;
          consolidated.totalProfit += s.totalProfit || 0;
          consolidated.revenueMix.services += s.revenueMix?.services || 0;
          consolidated.revenueMix.products += s.revenueMix?.products || 0;
          consolidated.outOfStockCount += s.outOfStockCount || 0;
          consolidated.lowStockCount += s.lowStockCount || 0;
          consolidated.lossSales.count += s.lossSales?.count || 0;
          consolidated.lossSales.amount += s.lossSales?.amount || 0;
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
        consolidated.totalCustomers = await cachedReport({ name: "businessCustomerCount", tags: [businessAggregateTag(businessId)], params: { from, to } }, () => storage.getBusinessCustomerCount(businessId, from, to));

        return res.json(consolidated);
      }

      if (!(await checkStoreAccess(storeId, req, res))) return;
      
      const stats = await storeReport(req, "dashboardStats", storeId, { from, to }, () => storage.getDashboardStats(storeId, from, to));
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
              return await storeReport(req, "salesTrends", s.id, { from, to }, () => storage.getSalesTrends(s.id, from, to));
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
      const data = await storeReport(req, "salesTrends", storeId, { from, to }, () => storage.getSalesTrends(storeId, from, to));
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
              return await storeReport(req, "revenueByType", s.id, { from, to }, () => storage.getRevenueByType(s.id, from, to));
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
      const data = await storeReport(req, "revenueByType", storeId, { from, to }, () => storage.getRevenueByType(storeId, from, to));
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
        const { firstName, lastName } = splitFullName(fullUser?.name || "Owner");
        const trialPhone = fullUser?.phone ? splitNormalizedPhone(fullUser.phone) : undefined;
        const staffMember = await storage.createStaff({
          storeId,
          userId: user.id,
          name: "", // recomputed from firstName/lastName by StaffRepository.createStaff
          firstName,
          lastName,
          email: fullUser?.email || `owner-${user.id}@trial.local`,
          mobileNumber: trialPhone?.localNumber || "",
          countryCode: trialPhone?.countryCode || "+234",
          role: "owner",
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
  const paymentLegDetailSchema = z.object({
    accountId: z.string().optional(),
    reference: z.string().trim().max(120).optional(),
    senderName: z.string().trim().max(120).optional(),
    confirmed: z.boolean().optional(),
    cashTendered: z.number().min(0).optional(),
    changeOwed: z.number().min(0).optional(),
  });
  const paymentLegSchema = paymentLegDetailSchema.extend({
    method: z.enum(["cash", "transfer", "flutterwave", "credit", "store_credit"]),
    amount: z.number().min(0.01),
  });

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
    splitPayments: z.array(paymentLegSchema).optional(),
    // Detail for a single-method payment (a split carries it on each leg instead).
    paymentDetail: paymentLegDetailSchema.optional(),
    discountAmount: z.number().min(0).optional(),
    discountPercent: z.number().min(0).optional(),
    discountReason: z.string().optional(),
    discountApprovedBy: z.string().optional(),
    effectiveDate: z.string().optional(),
    creditUpfrontPaid: z.number().min(0).optional(),
    creditDueDate: z.string().optional(),
    bookingId: z.string().optional(),
    quoteId: z.string().optional(),
    bookingDepositAmount: z.number().min(0).optional(),
    bookingDepositMethod: z.string().optional(),
    balanceCollectedToday: z.number().min(0).optional(),
    pointsRedeemed: z.number().min(0).optional(),
    // Replay guard: the offline outbox (client/src/components/offline-sync-manager.tsx)
    // resends the same id on every retry of one queued sale.
    clientCheckoutId: z.string().optional(),
  });

  // Below-cost check for the cart. Allowed sales are never blocked; this only powers the warning.
  app.post("/api/sales/loss-check", isAuthenticated, async (req, res) => {
    try {
      const body = z.object({
        storeId: z.string(),
        items: z.array(z.object({
          inventoryId: z.string(),
          quantity: z.number().min(0.01),
          unitPrice: z.number().min(0),
        })).max(200),
      }).parse(req.body);
      if (!(await checkStoreAccess(body.storeId, req, res))) return;
      res.json({ lines: await storage.assessLoss(body.storeId, body.items) });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: "Invalid request." });
      res.status(500).json({ error: "Could not check item costs." });
    }
  });

  app.post("/api/sales/checkout", isAuthenticated, async (req, res) => {
    try {
      const data = checkoutSchema.parse(req.body);

      if (!(await checkStoreAccess(data.storeId, req, res))) return;

      // Selling on credit (alone or as one leg of a split) is the paid Credit Sale
      // add-on. Body-dependent, so it can't live in the central route table.
      const usesCredit = data.paymentMethod === "credit" || !!data.splitPayments?.some((p) => p.method === "credit");
      const orgId = (req as any).user?.businessId;
      if (usesCredit && orgId && !(await getRequestEntitlements(res, orgId)).has("credit_sale")) {
        return res.status(402).json(await featureNotPurchasedBody("credit_sale", orgId));
      }

      // Staff with a linked profile can only ring up sales under their own name;
      // shared/unlinked staff logins fall back to the old free-pick behavior.
      if ((req as any).user?.role === "staff") {
        const ownStaffRecord = await storage.getStaffByUserId(getUserId(req)!, data.storeId);
        if (ownStaffRecord && ownStaffRecord.id !== data.staffId) {
          return res.status(403).json({ error: "You can only check out sales under your own staff profile." });
        }
      }

      if (data.paymentMethod === "flutterwave" && data.splitPayments && data.splitPayments.length > 0) {
        return res.status(400).json({ error: "Flutterwave cannot be combined with split payments. Choose either Flutterwave OR split payment." });
      }

      // Batch-load all inventory items for validation instead of N queries
      const invItemIds = data.items.map(i => i.inventoryId);
      const invItems = invItemIds.length > 0
        ? await db.select({ id: inventory.id, name: inventory.name, allowFractional: inventory.allowFractional }).from(inventory).where(inArray(inventory.id, invItemIds))
        : [];
      const invItemMap = new Map(invItems.map(i => [i.id, i]));

      // Validate each item's quantity against its allowFractional flag
      for (const item of data.items) {
        const invItem = invItemMap.get(item.inventoryId);
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
        quoteId: data.quoteId,
        bookingDepositAmount: data.bookingDepositAmount,
        bookingDepositMethod: data.bookingDepositMethod,
        balanceCollectedToday: data.balanceCollectedToday,
        splitPayments: data.splitPayments,
        paymentDetail: data.paymentDetail,
        actorUserId: getUserId(req) ?? undefined,
        pointsRedeemed: data.pointsRedeemed,
        clientCheckoutId: data.clientCheckoutId,
      });

      if (!result.success) {
        auditLogger.logEvent(await getAuditContext(req, { storeId: data.storeId }), "CHECKOUT", "checkout", undefined, "failure", { errorMessage: result.message });
        return res.status(400).json({ error: result.message });
      }

      auditLogger.logEvent(await getAuditContext(req, { storeId: data.storeId }), "CHECKOUT", "checkout", result.checkoutIds?.[0], "success", {
        details: await getCheckoutMoneyDetails(result.checkoutIds ?? []).catch(() => ({})),
      });

      if (data.quoteId) {
        auditLogger.logEvent(await getAuditContext(req, { storeId: data.storeId }), "QUOTE_CONVERT", "quote", data.quoteId, "success", { details: { target: "sale", checkoutId: result.checkoutIds?.[0] } });
      }

      // First-ever completed sale for this org - the activation signal that
      // future mid-trial nudges key off, independent of billing status.
      // Once an org is known to be activated this process never looks again, so a normal sale costs nothing here.
      const businessId = (req as any).user?.businessId;
      if (businessId && !activatedOrgs.has(businessId)) {
        storage.getBusinessById(businessId).then((business) => {
          if (!business) return;
          activatedOrgs.add(businessId);
          if (!business.activatedAt) {
            logFunnelEvent(businessId, "checkout_completed", { storeId: data.storeId });
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
      const page = parsePage(req.query);
      const { rows, total } = await storage.listDraftsPage(storeId, page);
      res.json(paginated(rows, total, page));
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

  const draftLegDetail = z.object({
    accountId: z.string().optional(),
    reference: z.string().optional(),
    senderName: z.string().optional(),
    confirmed: z.boolean().optional(),
    cashTendered: z.number().optional(),
    changeOwed: z.number().optional(),
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
    splitPayments: z.array(z.object({ method: z.string(), amount: z.number() }).extend(draftLegDetail.shape)).optional(),
    paymentDetail: z.object(draftLegDetail.shape).optional(),
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
