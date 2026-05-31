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

export function registerInventoryRoutes(app: Express, { isAuthenticated: _isAuth, requireRole, requireManagerOrOwner, checkStoreAccess }: RouteMiddlewares): void {
  // ========== INVENTORY ==========
  app.post("/api/inventory", requireManagerOrOwner, async (req, res) => {
    try {
      const sanitizedBody = {
        ...req.body,
        name: sanitizeString(req.body.name),
        type: sanitizeString(req.body.type),
        costPrice: sanitizeNumber(req.body.costPrice),
        sellingPrice: sanitizeNumber(req.body.sellingPrice),
        quantity: sanitizeNumber(req.body.quantity),
      };

      const type = sanitizedBody.type;
      const quantity = sanitizedBody.quantity;
      const costPrice = sanitizedBody.costPrice;
      const sellingPrice = sanitizedBody.sellingPrice;
      if (type === "product") {
        if (quantity === undefined || quantity === null || isNaN(quantity) || quantity < 1) {
          return res.status(400).json({ error: "Stock quantity must be at least 1. If this item is out of stock, do not add it until stock is available." });
        }
      } else if (type === "service") {
        sanitizedBody.quantity = 0; // Services do not have stock
      }

      if (costPrice <= 0) {
        return res.status(400).json({ error: "Unit cost must be greater than zero." });
      }

      if (sellingPrice <= 0) {
        return res.status(400).json({ error: "Selling price must be greater than zero." });
      }

      if (sellingPrice < costPrice) {
        return res.status(400).json({ error: `Selling price cannot be less than unit cost (₦${costPrice.toLocaleString()}).` });
      }

      const data = insertInventorySchema.parse(sanitizedBody);
      if (data.storeId && !(await checkStoreAccess(data.storeId, req, res))) return;
      
      const existingItem = await storage.getInventoryItemByName(data.storeId, data.name);
      if (existingItem) {
        return res.status(409).json({
          error: "duplicate_name",
          message: `Product name "${data.name}" already exists.`,
          existingItem,
        });
      }

      const item = await storage.createInventoryItem(data);
      auditLogger.logDataModification("inventory", item.id, getUserId(req), "CREATE", true);
      res.status(201).json(item);
    } catch (error) {
      auditLogger.logDataModification("inventory", undefined, getUserId(req), "CREATE", false, (error as Error).message);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      res.status(500).json({ error: "We couldn't add this item right now. Please try again." });
    }
  });

  app.post("/api/inventory/bulk-import", requireManagerOrOwner, async (req, res) => {
    try {
      const { storeId, items } = req.body;
      if (!storeId) return res.status(400).json({ error: "Store ID is required." });
      if (!Array.isArray(items)) return res.status(400).json({ error: "Items must be an array." });
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const results = { success: 0, failed: 0, errors: [] as string[] };

      const bulkItemSchema = z.object({
        name: z.string().transform(s => s.trim()).pipe(z.string().min(1, "Item name is required")),
        type: z.enum(["product", "service"], { errorMap: () => ({ message: "Type must be product or service" }) }),
        quantity: z.preprocess((val) => (val === "" || val === undefined || val === null ? 0 : Number(val)), z.number().min(0).default(0)),
        costPrice: z.preprocess((val) => (val === "" || val === undefined || val === null ? 0 : Number(val)), z.number().min(0).default(0)),
        sellingPrice: z.preprocess((val) => (val === "" || val === undefined || val === null ? 0 : Number(val)), z.number().min(0).default(0)),
      });

      for (const item of items) {
        try {
          const data = bulkItemSchema.parse(item);

          await storage.createInventoryItem({
            storeId,
            name: data.name,
            type: data.type,
            quantity: data.quantity,
            costPrice: data.costPrice,
            sellingPrice: data.sellingPrice,
          });
          results.success++;
        } catch (err: any) {
          results.failed++;
          const nameLabel = item.name || "Unnamed Item";
          const errMsg = err instanceof z.ZodError ? formatZodErrors(err.errors) : err.message;
          results.errors.push(`${nameLabel}: ${errMsg}`);
        }
      }

      res.json(results);
    } catch (error) {
      res.status(500).json({ error: "Bulk import failed." });
    }
  });

  app.patch("/api/inventory/:id", requireManagerOrOwner, async (req, res) => {
    try {
      const item = await storage.getInventoryItem(req.params.id);
      if (!item) {
        return res.status(404).json({ error: "Inventory item not found." });
      }

      // Verify user has access to this item's store
      if (!await verifyRecordStoreAccess(req, item.storeId)) {
        return res.status(403).json({ error: "You don't have access to this inventory item." });
      }

      // Remove storeId to prevent cross-store migration via PATCH
      const updateBody = { ...req.body };
      delete updateBody.storeId;
      const data = insertInventorySchema.partial().parse(updateBody);

      const finalType = data.type || item.type;
      const finalQuantity = data.quantity !== undefined ? data.quantity : item.quantity;
      const finalCostPrice = data.costPrice !== undefined ? data.costPrice : item.costPrice;
      const finalSellingPrice = data.sellingPrice !== undefined ? data.sellingPrice : item.sellingPrice;

      if (finalType === "product") {
        if (finalQuantity === undefined || finalQuantity === null || isNaN(finalQuantity) || finalQuantity < 1) {
          return res.status(400).json({ error: "Stock quantity must be at least 1. If this item is out of stock, do not add it until stock is available." });
        }
      }

      if (finalCostPrice <= 0) {
        return res.status(400).json({ error: "Unit cost must be greater than zero." });
      }

      if (finalSellingPrice <= 0) {
        return res.status(400).json({ error: "Selling price must be greater than zero." });
      }

      if (finalSellingPrice < finalCostPrice) {
        return res.status(400).json({ error: `Selling price cannot be less than unit cost (₦${finalCostPrice.toLocaleString()}).` });
      }

      const updatedItem = await storage.updateInventoryItem(req.params.id, data);
      if (!updatedItem) {
        return res.status(404).json({ error: "This item no longer exists. It may have been deleted." });
      }
      res.json(updatedItem);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      res.status(500).json({ error: "We couldn't update this item right now. Please try again." });
    }
  });

  app.delete("/api/inventory/:id", requireManagerOrOwner, async (req, res) => {
    try {
      const item = await storage.getInventoryItem(req.params.id);
      if (!item) {
        return res.status(404).json({ error: "Inventory item not found." });
      }

      // Verify user has access to this item's store
      if (!await verifyRecordStoreAccess(req, item.storeId)) {
        return res.status(403).json({ error: "You don't have access to this inventory item." });
      }

      const hasTransactions = await storage.hasInventoryTransactions(req.params.id);
      if (hasTransactions) {
        return res.status(400).json({
          error: "Cannot delete inventory item with existing sales records. This item has sales history that must be preserved for your records."
        });
      }

      const deleted = await storage.deleteInventoryItem(req.params.id);
      if (!deleted) {
        return res.status(500).json({ error: "We couldn't delete this item. Please try again." });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "We couldn't delete this item. Please try again." });
    }
  });

  // Bulk import inventory
  app.post("/api/inventory/bulk", requireManagerOrOwner, async (req, res) => {
    try {
      const { data, storeId } = req.body;
      if (!Array.isArray(data) || !storeId) {
        return res.status(400).json({ error: "Invalid data format or missing store." });
      }

      // Verify user has access to this store
      if (!await verifyStoreAccess(req, storeId)) {
        return res.status(403).json({ error: "You don't have access to this store." });
      }

      const result = { success: 0, failed: 0, errors: [] as { row: number; message: string }[] };

      for (let i = 0; i < data.length; i++) {
        try {
          const row = data[i];
          const itemType = row.type?.toLowerCase();
          if (itemType !== "product" && itemType !== "service") {
            throw new Error("Type must be 'product' or 'service'");
          }
          const parsed = insertInventorySchema.parse({
            storeId,
            name: row.name,
            type: itemType,
            costPrice: parseFloat(row.costPrice) || 0,
            sellingPrice: parseFloat(row.sellingPrice) || 0,
            quantity: itemType === "product" ? (parseInt(row.quantity) || 0) : 0,
          });
          await storage.createInventoryItem(parsed);
          result.success++;
        } catch (error) {
          result.failed++;
          const message = error instanceof z.ZodError
            ? error.errors.map(e => e.message).join(", ")
            : error instanceof Error ? error.message : "Invalid data";
          result.errors.push({ row: i + 2, message });
        }
      }

      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "We couldn't import your inventory. Please try again." });
    }
  });
  // ========== INVENTORY RESTOCK ==========
  app.get("/api/inventory/:id/restock-history", async (req, res) => {
    try {
      const page = parseInt(req.query.page as string) || 0;
      const limit = parseInt(req.query.limit as string) || 0;

      if (page > 0 && limit > 0) {
        const result = await storage.getRestockEventsPaginated(req.params.id, { page, limit });
        return res.json(result);
      }

      const events = await storage.getRestockEvents(req.params.id);
      res.json(events);
    } catch (error) {
      res.status(500).json({ error: "We couldn't load restock history. Please try again." });
    }
  });

  app.get("/api/inventory/:id/sustaining-costs", async (req, res) => {
    try {
      const inventoryId = req.params.id;
      const item = await storage.getInventoryItem(inventoryId);
      if (!item) {
        return res.status(404).json({ error: "Inventory item not found." });
      }

      // Verify user has access to this item's store
      if (!await verifyRecordStoreAccess(req, item.storeId)) {
        return res.status(403).json({ error: "You don't have access to this inventory item." });
      }

      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;

      // Calculate Sales / Revenue for this specific item in the range
      const checkoutConditions: any[] = [
        eq(checkouts.storeId, item.storeId),
        eq(checkouts.paymentStatus, "completed"),
        eq(checkouts.isVoided, false),
      ];
      if (startDate) checkoutConditions.push(gte(checkouts.createdAt, new Date(startDate + "T00:00:00.000Z")));
      if (endDate) checkoutConditions.push(lte(checkouts.createdAt, new Date(endDate + "T23:59:59.999Z")));

      const sales = await db.select({
        quantity: orders.quantity,
        returnedQuantity: orders.returnedQuantity,
        refundedAmount: orders.refundedAmount,
        totalPrice: orders.totalPrice,
      })
        .from(orders)
        .innerJoin(checkouts, eq(orders.id, checkouts.orderId))
        .where(and(eq(orders.inventoryId, inventoryId), ...checkoutConditions));

      const totalRevenue = sales.reduce((sum, s) => sum + Math.max(0, s.totalPrice - (s.refundedAmount || 0)), 0);
      const totalQuantitySold = sales.reduce((sum, s) => sum + Math.max(0, s.quantity - (s.returnedQuantity || 0)), 0);
      const totalCogs = totalQuantitySold * (item.costPrice ?? 0);
      const grossProfit = totalRevenue - totalCogs;
      const grossProfitMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

      // Fetch sustaining costs (expenses linked to this item in this period)
      const sustainingExpenses = await storage.getExpenses(item.storeId, startDate, endDate, "linked", inventoryId);
      const totalSustainingCosts = sustainingExpenses.reduce((sum, e) => sum + e.amount, 0);
      const netProfit = grossProfit - totalSustainingCosts;
      const netProfitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

      const status = netProfit > 0 ? "profit" : netProfit < 0 ? "loss" : "breakeven";

      res.json({
        totalRevenue,
        totalCogs,
        grossProfit,
        grossProfitMargin,
        totalSustainingCosts,
        netProfit,
        netProfitMargin,
        status,
        expenses: sustainingExpenses
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Could not calculate sustaining costs." });
    }
  });

  app.get("/api/reports/service-profitability", requireRole("owner"), async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) {
        return res.status(400).json({ error: "Please select a store first." });
      }

      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;

      if (storeId === "all") {
        const stores = await getUserStores(req);
        if (stores.length === 0) {
          return res.json({
            period: "Custom Range",
            totalRevenue: 0,
            totalCogs: 0,
            totalSustainingCosts: 0,
            netProfit: 0,
            netProfitMargin: 0,
            status: "breakeven",
            items: []
          });
        }

        const summaries = await Promise.all(
          stores.map(s => analyticsService.getServiceProfitability(s.id, startDate, endDate))
        );

        const mergedItemsMap = new Map<string, any>();
        for (const summary of summaries) {
          const combined = [...(summary.services || []), ...(summary.products || [])];
          for (const item of combined) {
            const key = `${item.name}-${item.type}`;
            const existing = mergedItemsMap.get(key);
            if (existing) {
              existing.revenue += item.revenue || 0;
              existing.cogs += item.cogs || 0;
              existing.grossProfit += item.grossProfit || 0;
              existing.sustainingCosts += item.sustainingCosts || 0;
              existing.netProfit += item.netProfit || 0;
            } else {
              mergedItemsMap.set(key, { ...item });
            }
          }
        }

        const items = Array.from(mergedItemsMap.values()).map(item => {
          const netProfitMargin = item.revenue > 0 ? (item.netProfit / item.revenue) * 100 : 0;
          const status = item.netProfit > 0 ? "profit" : item.netProfit < 0 ? "loss" : "breakeven";
          return {
            id: item.id,
            name: item.name,
            type: item.type,
            totalRevenue: item.revenue,
            totalCogs: item.cogs,
            grossProfit: item.grossProfit,
            totalSustainingCosts: item.sustainingCosts,
            netProfit: item.netProfit,
            netProfitMargin,
            status,
          };
        });

        const totalRevenue = items.reduce((sum, item) => sum + item.totalRevenue, 0);
        const totalCogs = items.reduce((sum, item) => sum + item.totalCogs, 0);
        const totalSustainingCosts = items.reduce((sum, item) => sum + item.totalSustainingCosts, 0);
        const netProfit = totalRevenue - totalCogs - totalSustainingCosts;
        const netProfitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;
        const status = netProfit > 0 ? "profit" : netProfit < 0 ? "loss" : "breakeven";

        return res.json({
          period: "Custom Range",
          startDate,
          endDate: endDate || new Date().toISOString(),
          totalRevenue,
          totalCogs,
          totalSustainingCosts,
          netProfit,
          netProfitMargin,
          status,
          items,
        });
      }

      if (!(await checkStoreAccess(storeId, req, res))) return;

      const summary = await analyticsService.getServiceProfitability(storeId, startDate, endDate);

      // Map to frontend expected ServiceProfitabilityReport format
      const items = [...(summary.services || []), ...(summary.products || [])].map(item => ({
        id: item.id,
        name: item.name,
        type: item.type,
        totalRevenue: item.revenue || 0,
        totalCogs: item.cogs || 0,
        grossProfit: item.grossProfit || 0,
        totalSustainingCosts: item.sustainingCosts || 0,
        netProfit: item.netProfit || 0,
        netProfitMargin: item.netProfitMargin || 0,
        status: item.status,
      }));

      const totalRevenue = items.reduce((sum, item) => sum + item.totalRevenue, 0);
      const totalCogs = items.reduce((sum, item) => sum + item.totalCogs, 0);
      const totalSustainingCosts = items.reduce((sum, item) => sum + item.totalSustainingCosts, 0);
      const netProfit = totalRevenue - totalCogs - totalSustainingCosts;
      const netProfitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;
      const status = netProfit > 0 ? "profit" : netProfit < 0 ? "loss" : "breakeven";

      res.json({
        period: "Custom Range",
        startDate,
        endDate: endDate || new Date().toISOString(),
        totalRevenue,
        totalCogs,
        totalSustainingCosts,
        netProfit,
        netProfitMargin,
        status,
        items,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Could not calculate service profitability report." });
    }
  });

  app.post("/api/inventory/:id/restock", requireManagerOrOwner, async (req, res) => {
    try {
      const inventoryId = req.params.id;
      const item = await storage.getInventoryItem(inventoryId);
      if (!item) {
        return res.status(404).json({ error: "Inventory item not found." });
      }

      // Verify user has access to this item's store
      if (!await verifyRecordStoreAccess(req, item.storeId)) {
        return res.status(403).json({ error: "You don't have access to this inventory item." });
      }

      if (item.type !== "product") {
        return res.status(400).json({ error: "Only products can be restocked. Services don't have inventory quantities." });
      }

      const { quantityAdded, unitCost, costStrategy, newSellingPrice, notes, staffId } = req.body;

      if (!quantityAdded || quantityAdded < 1) {
        return res.status(400).json({ error: "Please enter a valid quantity (at least 1)." });
      }
      if (unitCost === undefined || unitCost < 0) {
        return res.status(400).json({ error: "Please enter a valid unit cost." });
      }
      if (!["keep", "last", "weighted", "override"].includes(costStrategy)) {
        return res.status(400).json({ error: "Invalid cost strategy selected." });
      }

      const userId = (req as any).user?.id || (req as any).user?.claims?.sub || null;

      const result = await storage.createRestockEvent({
        storeId: item.storeId,
        inventoryId,
        staffId: staffId || null,
        userId,
        quantityAdded: Number(quantityAdded),
        unitCost: Number(unitCost),
        costStrategy,
        newSellingPrice: newSellingPrice !== undefined ? Number(newSellingPrice) : undefined,
        notes: notes || undefined,
      });

      auditLogger.logDataModification(
        'inventory_restock',
        inventoryId,
        userId || 'system',
        'CREATE_RESTOCK',
        true
      );

      res.status(201).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "We couldn't complete the restock. Please try again.";
      res.status(500).json({ error: message });
    }
  });

  // Helper to group transactions by checkout.receiptNumber (FRD Section 3.3)
  function groupTransactions(txs: any[]): any[] {
    const groupedMap = new Map<string, any[]>();
    
    for (const tx of txs) {
      const key = tx.checkout?.receiptNumber || tx.checkoutId || tx.id;
      if (!groupedMap.has(key)) {
        groupedMap.set(key, []);
      }
      groupedMap.get(key)!.push(tx);
    }
    
    const result: any[] = [];
    
    for (const [key, group] of Array.from(groupedMap.entries())) {
      if (group.length === 0) continue;
      if (group.length === 1) {
        result.push(group[0]);
        continue;
      }
      
      const firstTx = group[0];
      
      let totalAmount = 0;
      let totalTotalPrice = 0;
      let totalTotalCharged = 0;
      let totalQuantity = 0;
      let totalReturnedQuantity = 0;
      let totalRefundedAmount = 0;
      let totalSubtotal = 0;
      let totalDiscountAmount = 0;
      
      for (const item of group) {
        totalAmount += Number(item.amount) || 0;
        totalTotalPrice += Number(item.checkout?.totalPrice) || 0;
        totalTotalCharged += Number(item.checkout?.totalCharged) || 0;
        totalQuantity += Number(item.checkout?.quantity) || 0;
        totalReturnedQuantity += Number(item.checkout?.returnedQuantity) || 0;
        totalRefundedAmount += Number(item.checkout?.refundedAmount) || 0;
        totalSubtotal += Number(item.checkout?.subtotal) || 0;
        totalDiscountAmount += Number(item.checkout?.discountAmount) || 0;
      }
      
      const uniqueNames = Array.from(new Set(group.map((t: any) => t.inventory?.name).filter(Boolean)));
      const joinedNames = uniqueNames.join(", ");
      
      const hasService = group.some((t: any) => t.inventory?.type === "service");
      const type = hasService ? "service" : "product";
      
      result.push({
        ...firstTx,
        amount: totalAmount,
        inventory: {
          ...firstTx.inventory,
          name: joinedNames,
          type: type,
        },
        checkout: {
          ...firstTx.checkout,
          totalPrice: totalTotalPrice,
          subtotal: totalSubtotal,
          discountAmount: totalDiscountAmount,
          quantity: totalQuantity,
          returnedQuantity: totalReturnedQuantity,
          refundedAmount: totalRefundedAmount,
          totalCharged: totalTotalCharged,
        }
      });
    }
    
    return result;
  }
  // ---------- 5. COMPOSITE / BUNDLED ITEMS ----------
  // Get Bundle Components
  app.get("/api/inventory/:id/bundle-components", async (req, res) => {
    try {
      const item = await storage.inventoryRepo.findById(req.params.id);
      if (!item) return res.status(404).json({ error: "Inventory item not found." });
      if (!(await checkStoreAccess(item.storeId, req, res))) return;

      const components = await storage.inventoryRepo.getBundleComponents(req.params.id);
      res.json(components);
    } catch (error) {
      res.status(500).json({ error: "Could not fetch bundle components." });
    }
  });

  // Set Bundle Components
  app.post("/api/inventory/:id/bundle-components", requireManagerOrOwner, async (req, res) => {
    try {
      const item = await storage.inventoryRepo.findById(req.params.id);
      if (!item) return res.status(404).json({ error: "Inventory item not found." });
      if (!(await checkStoreAccess(item.storeId, req, res))) return;

      const { components } = req.body;
      if (!Array.isArray(components)) {
        return res.status(400).json({ error: "Components array is required." });
      }

      await storage.inventoryRepo.setBundleComponents(
        req.params.id,
        components.map((c: any) => ({
          componentInventoryId: c.componentInventoryId,
          quantity: Number(c.quantity),
        }))
      );
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Could not update bundle components." });
    }
  });

  // ---------- 10. EXPIRY BATCHES ----------
  // Get batches for an inventory item
  app.get("/api/inventory/:id/batches", async (req, res) => {
    try {
      const item = await storage.inventoryRepo.findById(req.params.id);
      if (!item) return res.status(404).json({ error: "Inventory item not found." });
      if (!(await checkStoreAccess(item.storeId, req, res))) return;

      const list = await storage.inventoryRepo.getBatches(req.params.id);
      res.json(list);
    } catch (error) {
      res.status(500).json({ error: "Could not fetch batches." });
    }
  });

  // Add batch to inventory item
  app.post("/api/inventory/:id/batches", requireManagerOrOwner, async (req, res) => {
    try {
      const item = await storage.inventoryRepo.findById(req.params.id);
      if (!item) return res.status(404).json({ error: "Inventory item not found." });
      if (!(await checkStoreAccess(item.storeId, req, res))) return;

      const { batchNumber, expiryDate, quantity } = req.body;
      if (!batchNumber || !expiryDate || quantity === undefined) {
        return res.status(400).json({ error: "batchNumber, expiryDate, and quantity are required." });
      }

      const created = await storage.inventoryRepo.createBatch({
        storeId: item.storeId,
        inventoryId: req.params.id,
        batchNumber,
        expiryDate: new Date(expiryDate),
        quantity: Number(quantity),
      });

      res.status(201).json(created);
    } catch (error) {
      res.status(500).json({ error: "Could not create batch." });
    }
  });

  // ---------- 10b. VARIANTS ----------
  // Get variants for an inventory item
  app.get("/api/inventory/:id/variants", async (req, res) => {
    try {
      const item = await storage.inventoryRepo.findById(req.params.id);
      if (!item) return res.status(404).json({ error: "Inventory item not found." });
      if (!(await checkStoreAccess(item.storeId, req, res))) return;

      const variants = await storage.inventoryRepo.getVariants(req.params.id);
      res.json(variants);
    } catch (error) {
      res.status(500).json({ error: "Could not fetch variants." });
    }
  });

  // Create a variant for an inventory item
  app.post("/api/inventory/:id/variants", requireManagerOrOwner, async (req, res) => {
    try {
      const parentItem = await storage.inventoryRepo.findById(req.params.id);
      if (!parentItem) return res.status(404).json({ error: "Parent inventory item not found." });
      if (!(await checkStoreAccess(parentItem.storeId, req, res))) return;

      const { name, costPrice, sellingPrice, quantity, variantDimensions } = req.body;
      
      const sanitizedBody = {
        storeId: parentItem.storeId,
        name: sanitizeString(name),
        type: parentItem.type,
        costPrice: sanitizeNumber(costPrice),
        sellingPrice: sanitizeNumber(sellingPrice),
        quantity: parentItem.type === "product" ? sanitizeNumber(quantity) : 0,
        parentInventoryId: parentItem.id,
        variantDimensions: variantDimensions || {},
      };

      if (sanitizedBody.type === "product") {
        if (sanitizedBody.quantity === undefined || sanitizedBody.quantity === null || isNaN(sanitizedBody.quantity) || sanitizedBody.quantity < 0) {
          return res.status(400).json({ error: "Stock quantity must be a non-negative number." });
        }
      }

      if (sanitizedBody.costPrice <= 0) {
        return res.status(400).json({ error: "Unit cost must be greater than zero." });
      }

      if (sanitizedBody.sellingPrice <= 0) {
        return res.status(400).json({ error: "Selling price must be greater than zero." });
      }

      if (sanitizedBody.sellingPrice < sanitizedBody.costPrice) {
        return res.status(400).json({ error: `Selling price cannot be less than unit cost (₦${sanitizedBody.costPrice.toLocaleString()}).` });
      }

      const existingItem = await storage.getInventoryItemByName(sanitizedBody.storeId, sanitizedBody.name);
      if (existingItem) {
        return res.status(409).json({
          error: "duplicate_name",
          message: `Variant name "${sanitizedBody.name}" already exists.`,
          existingItem,
        });
      }

      const item = await storage.createInventoryItem(sanitizedBody);
      auditLogger.logDataModification("inventory", item.id, getUserId(req), "CREATE", true);
      res.status(201).json(item);
    } catch (error) {
      auditLogger.logDataModification("inventory", undefined, getUserId(req), "CREATE", false, (error as Error).message);
      res.status(500).json({ error: "Could not create variant." });
    }
  });

}
