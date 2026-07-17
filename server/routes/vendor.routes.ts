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
import { sanitizeString, sanitizeUUID, sanitizeNumber, sanitizeBoolean, sanitizePhoneNumber, sanitizeStoreCode, sanitizeEmail, validateEmailFormat } from "../sanitize";
import { auditLogger } from "../audit";
import { bulkUploadService } from "../services/BulkUploadService";
import { analyticsService } from "../services/AnalyticsService";
import { getUserId, getClientIp, getAuditContext, formatZodErrors, checkBusinessAccess, getUserStores, verifyStoreAccess, verifyRecordStoreAccess, triggerAutoRecalculate, broadcastChange } from './helpers';
import { withVendorId, withVendorBillId } from '../utils/slug-resolver';

export type RouteMiddlewares = {
  isAuthenticated: any;
  requireRole: (...roles: any[]) => any;
  requireManagerOrOwner: any;
  checkStoreAccess: (storeId: string, req: Request, res: Response) => Promise<boolean>;
};

export function registerVendorRoutes(app: Express, { isAuthenticated, requireRole, requireManagerOrOwner, checkStoreAccess }: RouteMiddlewares): void {
  // ---------- 3. ACCOUNTS PAYABLE (VENDORS & BILLS) ----------
  // Get Vendors
  app.get("/api/vendors", isAuthenticated, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) return res.status(400).json({ error: "Store ID is required." });
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const includeArchived = req.query.includeArchived === "true";
      const result = await storage.vendorRepo.getVendors(storeId, includeArchived);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Could not fetch vendors." });
    }
  });

  // Create Vendor
  app.post("/api/vendors", requireManagerOrOwner, async (req, res) => {
    try {
      const { storeId, name, contactName, email, phone, address, notes } = req.body;
      if (!storeId || !name) return res.status(400).json({ error: "Store ID and name are required." });
      if (email && !validateEmailFormat(email)) return res.status(400).json({ error: "Enter a valid email address." });
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const result = await storage.vendorRepo.createVendor({
        storeId,
        name,
        contactName,
        email: email ? sanitizeEmail(email) : undefined,
        phone,
        address,
        notes,
      });
      const ctx = await getAuditContext(req, { storeId });
      auditLogger.logEvent(ctx, "VENDOR_CREATE", "vendor", result.id, "success", { newValues: result });
      broadcastChange(req, "vendor", storeId, "created");
      res.status(201).json(result);
    } catch (error) {
      res.status(500).json({ error: "Could not create vendor." });
    }
  });

  // Bulk import vendors
  app.post("/api/vendors/bulk", requireManagerOrOwner, async (req, res) => {
    try {
      const { data, storeId } = req.body;
      if (!storeId || !Array.isArray(data)) {
        return res.status(400).json({ error: "storeId and a data array are required." });
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const userId = (req as any).user?.id;
      const result = await bulkUploadService.importVendors(data, storeId, userId);
      broadcastChange(req, "vendor", storeId, "created");
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Could not import vendors." });
    }
  });

  // ---- Bills sub-resource — must be registered BEFORE /api/vendors/:id ----

  // Get Vendor Bills
  app.get("/api/vendors/bills", isAuthenticated, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) return res.status(400).json({ error: "Store ID is required." });
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const result = await storage.vendorRepo.getVendorBills(storeId);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Could not fetch vendor bills." });
    }
  });

  // Create Vendor Bill
  app.post("/api/vendors/bills", requireManagerOrOwner, async (req, res) => {
    try {
      const { storeId, vendorId, amount, amountPaid, status, dueDate, billDate, notes, linkedRestockEventId } = req.body;
      if (!storeId || !vendorId || amount === undefined) {
        return res.status(400).json({ error: "Store ID, Vendor ID and amount are required." });
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const userId = (req as any).user?.id;
      const result = await storage.vendorRepo.createVendorBill({
        storeId,
        vendorId,
        amount: Number(amount),
        amountPaid: Number(amountPaid || 0),
        status: status || "unpaid",
        dueDate: dueDate ? new Date(dueDate) : null,
        billDate: billDate ? new Date(billDate) : new Date(),
        notes,
        linkedRestockEventId: linkedRestockEventId || null,
      });
      auditLogger.log({ action: "VENDOR_BILL_CREATE", resource: "vendor_bill", resourceId: result.id, userId, ip: getClientIp(req), status: "success", details: { storeId, vendorId, amount } });
      broadcastChange(req, "vendor-bill", storeId, "created");
      res.status(201).json(result);
    } catch (error) {
      res.status(500).json({ error: "Could not create vendor bill." });
    }
  });

  // Get Single Vendor Bill
  app.get("/api/vendors/bills/:id", isAuthenticated, withVendorBillId, async (req, res) => {
    try {
      const bill = await storage.vendorRepo.getVendorBill(req.params.id);
      if (!bill) return res.status(404).json({ error: "Bill not found." });
      if (!(await checkStoreAccess(bill.storeId, req, res))) return;
      res.json(bill);
    } catch {
      res.status(500).json({ error: "Could not fetch bill." });
    }
  });

  // Update Vendor Bill
  app.patch("/api/vendors/bills/:id", withVendorBillId, requireManagerOrOwner, async (req, res) => {
    try {
      const bill = await storage.vendorRepo.getVendorBill(req.params.id);
      if (!bill) return res.status(404).json({ error: "Vendor bill not found." });
      if (!(await checkStoreAccess(bill.storeId, req, res))) return;

      const { amountPaid, status, notes } = req.body;
      const userId = (req as any).user?.id;
      const updated = await storage.vendorRepo.updateVendorBill(req.params.id, {
        amountPaid: amountPaid !== undefined ? Number(amountPaid) : undefined,
        status,
        notes,
      });
      auditLogger.log({ action: "VENDOR_BILL_UPDATE", resource: "vendor_bill", resourceId: req.params.id, userId, ip: getClientIp(req), status: "success", details: { billId: req.params.id, amountPaid, status } });
      broadcastChange(req, "vendor-bill", bill.storeId, "updated");
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Could not update vendor bill." });
    }
  });

  // Delete Vendor Bill
  app.delete("/api/vendors/bills/:id", withVendorBillId, requireRole("owner"), async (req, res) => {
    try {
      const bill = await storage.vendorRepo.getVendorBill(req.params.id);
      if (!bill) return res.status(404).json({ error: "Vendor bill not found." });
      if (!(await checkStoreAccess(bill.storeId, req, res))) return;

      const userId = (req as any).user?.id;
      await storage.vendorRepo.deleteVendorBill(req.params.id);
      auditLogger.log({ action: "VENDOR_BILL_DELETE", resource: "vendor_bill", resourceId: req.params.id, userId, ip: getClientIp(req), status: "success", details: { billId: req.params.id } });
      broadcastChange(req, "vendor-bill", bill.storeId, "deleted");
      res.status(204).end();
    } catch (error) {
      res.status(500).json({ error: "Could not delete vendor bill." });
    }
  });

  // ---- Single vendor by ID ----

  // Get Single Vendor
  app.get("/api/vendors/:id", isAuthenticated, withVendorId, async (req, res) => {
    try {
      const vendor = await storage.vendorRepo.findById(req.params.id);
      if (!vendor) return res.status(404).json({ error: "Vendor not found." });
      if (!(await checkStoreAccess(vendor.storeId, req, res))) return;
      res.json(vendor);
    } catch {
      res.status(500).json({ error: "Could not fetch vendor." });
    }
  });

  // Update Vendor
  app.patch("/api/vendors/:id", withVendorId, requireManagerOrOwner, async (req, res) => {
    try {
      const vendor = await storage.vendorRepo.findById(req.params.id);
      if (!vendor) return res.status(404).json({ error: "Vendor not found." });
      if (!(await checkStoreAccess(vendor.storeId, req, res))) return;

      const { name, contactName, email, phone, address, notes } = req.body;
      if (email && !validateEmailFormat(email)) return res.status(400).json({ error: "Enter a valid email address." });

      const updated = await storage.vendorRepo.updateVendor(req.params.id, {
        name,
        contactName,
        email: email !== undefined ? (email ? sanitizeEmail(email) : "") : undefined,
        phone,
        address,
        notes,
      });
      const changedFields = Object.keys(req.body).filter((key) => key in vendor && JSON.stringify((vendor as any)[key]) !== JSON.stringify((updated as any)[key]));
      if (changedFields.length > 0) {
        const ctx = await getAuditContext(req, { storeId: vendor.storeId });
        auditLogger.logEvent(ctx, "VENDOR_UPDATE", "vendor", req.params.id, "success", {
          previousValues: vendor,
          newValues: updated,
          changedFields,
        });
      }
      broadcastChange(req, "vendor", vendor.storeId, "updated");
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Could not update vendor." });
    }
  });

  // Archive Vendor
  app.patch("/api/vendors/:id/archive", withVendorId, requireManagerOrOwner, async (req, res) => {
    try {
      const vendor = await storage.vendorRepo.findById(req.params.id);
      if (!vendor) return res.status(404).json({ error: "Vendor not found." });
      if (!(await checkStoreAccess(vendor.storeId, req, res))) return;
      const updated = await storage.vendorRepo.archiveVendor(req.params.id);
      const ctx = await getAuditContext(req, { storeId: vendor.storeId });
      auditLogger.logEvent(ctx, "VENDOR_ARCHIVE", "vendor", req.params.id, "success", { previousValues: vendor, newValues: updated });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Could not archive vendor." });
    }
  });

  // Restore Vendor
  app.patch("/api/vendors/:id/restore", withVendorId, requireManagerOrOwner, async (req, res) => {
    try {
      const vendor = await storage.vendorRepo.findById(req.params.id);
      if (!vendor) return res.status(404).json({ error: "Vendor not found." });
      if (!(await checkStoreAccess(vendor.storeId, req, res))) return;
      const updated = await storage.vendorRepo.restoreVendor(req.params.id);
      const ctx = await getAuditContext(req, { storeId: vendor.storeId });
      auditLogger.logEvent(ctx, "VENDOR_RESTORE", "vendor", req.params.id, "success", { previousValues: vendor, newValues: updated });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Could not restore vendor." });
    }
  });

  // Delete Vendor
  app.delete("/api/vendors/:id", withVendorId, requireRole("owner"), async (req, res) => {
    try {
      const vendor = await storage.vendorRepo.findById(req.params.id);
      if (!vendor) return res.status(404).json({ error: "Vendor not found." });
      if (!(await checkStoreAccess(vendor.storeId, req, res))) return;

      // Check for linked records that would block deletion
      const conflict = await storage.vendorRepo.getVendorDeletionConflicts(req.params.id);
      if (conflict) {
        return res.status(409).json({ error: conflict });
      }

      await storage.vendorRepo.deleteVendor(req.params.id);
      const ctx = await getAuditContext(req, { storeId: vendor.storeId });
      auditLogger.logEvent(ctx, "VENDOR_DELETE", "vendor", req.params.id, "success", { previousValues: vendor });
      broadcastChange(req, "vendor", vendor.storeId, "deleted");
      res.status(204).end();
    } catch (error) {
      console.error("Delete vendor error:", error);
      res.status(500).json({ error: "Could not delete vendor." });
    }
  });

  // ---------- 4. STOCK AUDITING (PHYSICAL VS. SYSTEM) ----------
  // Get Stock Audits
  app.get("/api/stock-audits", isAuthenticated, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) return res.status(400).json({ error: "Store ID is required." });
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const result = await storage.stockAuditRepo.getAudits(storeId);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Could not fetch stock audits." });
    }
  });

  // Get Stock Audit Details
  app.get("/api/stock-audits/:id", isAuthenticated, async (req, res) => {
    try {
      const result = await storage.stockAuditRepo.getAudit(req.params.id);
      if (!result) return res.status(404).json({ error: "Stock audit not found." });
      if (!(await checkStoreAccess(result.storeId, req, res))) return;

      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Could not fetch stock audit details." });
    }
  });

  // Create Stock Audit
  app.post("/api/stock-audits", requireManagerOrOwner, async (req, res) => {
    try {
      const { storeId, conductedByStaffId, notes, items } = req.body;
      if (!storeId || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "Store ID and at least one item are required." });
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const userId = (req as any).user?.id;
      const result = await storage.stockAuditRepo.createAudit({
        storeId,
        conductedByStaffId,
        notes,
        items: items.map((i: any) => ({
          inventoryId: i.inventoryId,
          systemQuantity: Number(i.systemQuantity),
          physicalQuantity: Number(i.physicalQuantity),
          reason: i.reason,
        })),
      });
      auditLogger.log({ action: "STOCK_AUDIT_CREATE", resource: "stock_audit", resourceId: result.id, userId, ip: getClientIp(req), status: "success", details: { storeId, itemCount: items.length } });
      broadcastChange(req, "stock-audit", storeId, "created");
      res.status(201).json(result);
    } catch (error) {
      res.status(500).json({ error: "Could not create stock audit." });
    }
  });

  // Approve Stock Audit
  app.post("/api/stock-audits/:id/approve", requireRole("owner", "manager"), async (req: any, res) => {
    try {
      const audit = await storage.stockAuditRepo.findById(req.params.id);
      if (!audit) return res.status(404).json({ error: "Stock audit not found." });
      if (!(await checkStoreAccess(audit.storeId, req, res))) return;

      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized." });

      const approved = await storage.stockAuditRepo.approveAudit(req.params.id, userId);
      auditLogger.log({ action: "STOCK_AUDIT_APPROVE", resource: "stock_audit", resourceId: req.params.id, userId, ip: getClientIp(req), status: "success", details: { auditId: req.params.id } });
      broadcastChange(req, "inventory", audit.storeId, "audited");
      res.json(approved);
    } catch (error) {
      const err = error as Error;
      if (err.message.startsWith("not_found:")) {
        return res.status(404).json({ error: err.message.substring(10) });
      }
      if (err.message.startsWith("bad_request:")) {
         return res.status(400).json({ error: err.message.substring(12) });
      }
      res.status(500).json({ error: err.message || "Could not approve stock audit." });
    }
  });

  // ========== V3 & V4 SME SUITE ROUTING ENDPOINTS ==========

  // ---------- 6. QUOTES & ESTIMATES ----------
  // Get all quotes for a store
  app.get("/api/quotes", isAuthenticated, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) return res.status(400).json({ error: "Store ID is required." });

      if (storeId === "all") {
        const stores = await getUserStores(req);
        if (stores.length === 0) return res.json([]);
        const list = await Promise.all(
          stores.map(async (s) => {
            const quotes = await storage.quoteRepo.getQuotes(s.id);
            return quotes.map(q => ({ ...q, storeName: s.name }));
          })
        );
        return res.json(list.flat().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      }

      if (!(await checkStoreAccess(storeId, req, res))) return;

      const list = await storage.quoteRepo.getQuotes(storeId);
      res.json(list);
    } catch (error) {
      res.status(500).json({ error: "Could not fetch quotes." });
    }
  });

  // Get a single quote
  app.get("/api/quotes/:id", isAuthenticated, async (req, res) => {
    try {
      const quote = await storage.quoteRepo.getQuote(req.params.id);
      if (!quote) return res.status(404).json({ error: "Quote not found." });
      if (!(await checkStoreAccess(quote.storeId, req, res))) return;

      res.json(quote);
    } catch (error) {
      res.status(500).json({ error: "Could not fetch quote." });
    }
  });

  // Create a quote
  app.post("/api/quotes", isAuthenticated, async (req, res) => {
    try {
      const { storeId, customerId, quoteRef, validUntil, notes, items } = req.body;
      if (!storeId || !quoteRef || !Array.isArray(items)) {
        return res.status(400).json({ error: "storeId, quoteRef, and items array are required." });
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const userId = (req as any).user?.id;
      const created = await storage.quoteRepo.createQuote({
        storeId,
        customerId: customerId || null,
        quoteRef,
        notes: notes || null,
        validUntil: validUntil ? new Date(validUntil) : null,
        status: "draft",
        items: items.map((i: any) => ({
          inventoryId: i.inventoryId,
          quantity: Number(i.quantity),
          unitPrice: Number(i.unitPrice),
        })),
      });
      auditLogger.log({ action: "QUOTE_CREATE", resource: "quote", resourceId: created.id, userId, ip: getClientIp(req), status: "success", details: { storeId, quoteRef, itemCount: items.length } });
      broadcastChange(req, "quote", storeId, "created");
      res.status(201).json(created);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message || "Could not create quote." });
    }
  });

  // Bulk import quotes (grouped CSV rows: rows sharing a quoteRef become one quote)
  app.post("/api/quotes/bulk", isAuthenticated, async (req, res) => {
    try {
      const { data, storeId } = req.body;
      if (!storeId || !Array.isArray(data)) {
        return res.status(400).json({ error: "storeId and a data array are required." });
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const userId = (req as any).user?.id;
      const result = await bulkUploadService.importQuotes(data, storeId, userId);
      broadcastChange(req, "quote", storeId, "created");
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Could not import quotes." });
    }
  });

  // Update quote status
  app.patch("/api/quotes/:id/status", isAuthenticated, async (req, res) => {
    try {
      const quote = await storage.quoteRepo.getQuote(req.params.id);
      if (!quote) return res.status(404).json({ error: "Quote not found." });
      if (!(await checkStoreAccess(quote.storeId, req, res))) return;

      const { status } = req.body;
      if (!status) return res.status(400).json({ error: "Status is required." });

      const userId = (req as any).user?.id;
      const updated = await storage.quoteRepo.updateQuoteStatus(req.params.id, status);
      auditLogger.log({ action: "QUOTE_STATUS_UPDATE", resource: "quote", resourceId: req.params.id, userId, ip: getClientIp(req), status: "success", details: { quoteId: req.params.id, status } });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Could not update quote status." });
    }
  });

  // Delete quote
  app.delete("/api/quotes/:id", requireManagerOrOwner, async (req, res) => {
    try {
      const quote = await storage.quoteRepo.getQuote(req.params.id);
      if (!quote) return res.status(404).json({ error: "Quote not found." });
      if (!(await checkStoreAccess(quote.storeId, req, res))) return;

      const userId = (req as any).user?.id;
      await storage.quoteRepo.deleteQuote(req.params.id);
      auditLogger.log({ action: "QUOTE_DELETE", resource: "quote", resourceId: req.params.id, userId, ip: getClientIp(req), status: "success", details: { quoteId: req.params.id } });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Could not delete quote." });
    }
  });

  // ---------- 7. PURCHASE ORDERS ----------
  // Get all POs
  app.get("/api/purchase-orders", isAuthenticated, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) return res.status(400).json({ error: "Store ID is required." });
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const list = await storage.purchaseOrderRepo.getPurchaseOrders(storeId);
      res.json(list);
    } catch (error) {
      res.status(500).json({ error: "Could not fetch purchase orders." });
    }
  });

  // Get single PO
  app.get("/api/purchase-orders/:id", isAuthenticated, async (req, res) => {
    try {
      const po = await storage.purchaseOrderRepo.getPurchaseOrder(req.params.id);
      if (!po) return res.status(404).json({ error: "Purchase order not found." });
      if (!(await checkStoreAccess(po.storeId, req, res))) return;

      res.json(po);
    } catch (error) {
      res.status(500).json({ error: "Could not fetch purchase order." });
    }
  });

  // Create PO
  app.post("/api/purchase-orders", requireManagerOrOwner, async (req, res) => {
    try {
      const { storeId, vendorId, poNumber, expectedDelivery, items } = req.body;
      if (!storeId || !vendorId || !poNumber || !Array.isArray(items)) {
        return res.status(400).json({ error: "storeId, vendorId, poNumber, and items array are required." });
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const userId = (req as any).user?.id;
      const created = await storage.purchaseOrderRepo.createPurchaseOrder({
        storeId,
        vendorId,
        poNumber,
        expectedDelivery: expectedDelivery ? new Date(expectedDelivery) : null,
        status: "draft",
        items: items.map((i: any) => ({
          inventoryId: i.inventoryId,
          quantity: Number(i.quantity),
          unitCost: Number(i.unitCost),
        })),
      });
      auditLogger.log({ action: "PURCHASE_ORDER_CREATE", resource: "purchase_order", resourceId: created.id, userId, ip: getClientIp(req), status: "success", details: { storeId, vendorId, poNumber, itemCount: items.length } });
      broadcastChange(req, "purchase-order", storeId, "created");
      res.status(201).json(created);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message || "Could not create purchase order." });
    }
  });

  // Bulk import purchase orders (grouped CSV rows: rows sharing a poRef become one PO)
  app.post("/api/purchase-orders/bulk", requireManagerOrOwner, async (req, res) => {
    try {
      const { data, storeId } = req.body;
      if (!storeId || !Array.isArray(data)) {
        return res.status(400).json({ error: "storeId and a data array are required." });
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const userId = (req as any).user?.id;
      const result = await bulkUploadService.importPurchaseOrders(data, storeId, userId);
      broadcastChange(req, "purchase-order", storeId, "created");
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Could not import purchase orders." });
    }
  });

  // Update PO Status
  app.patch("/api/purchase-orders/:id/status", requireManagerOrOwner, async (req, res) => {
    try {
      const po = await storage.purchaseOrderRepo.getPurchaseOrder(req.params.id);
      if (!po) return res.status(404).json({ error: "Purchase order not found." });
      if (!(await checkStoreAccess(po.storeId, req, res))) return;

      const { status } = req.body;
      if (!status) return res.status(400).json({ error: "Status is required." });

      const userId = (req as any).user?.id;
      const updated = await storage.purchaseOrderRepo.updatePurchaseOrderStatus(req.params.id, status);
      auditLogger.log({ action: "PURCHASE_ORDER_STATUS_UPDATE", resource: "purchase_order", resourceId: req.params.id, userId, ip: getClientIp(req), status: "success", details: { poId: req.params.id, status } });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Could not update purchase order status." });
    }
  });

  // Receive PO items
  app.post("/api/purchase-orders/:id/receive", requireManagerOrOwner, async (req, res) => {
    try {
      const po = await storage.purchaseOrderRepo.getPurchaseOrder(req.params.id);
      if (!po) return res.status(404).json({ error: "Purchase order not found." });
      if (!(await checkStoreAccess(po.storeId, req, res))) return;

      const { itemsToReceive, staffId } = req.body;
      if (!Array.isArray(itemsToReceive)) {
        return res.status(400).json({ error: "itemsToReceive array is required." });
      }

      const userId = getUserId(req) || null;
      const result = await storage.purchaseOrderRepo.receivePOItems(
        req.params.id,
        itemsToReceive.map((i: any) => ({
          inventoryId: i.inventoryId,
          quantity: Number(i.quantity),
        })),
        staffId || null,
        userId
      );

      if (!result.success) {
        return res.status(400).json({ error: result.message });
      }
      auditLogger.log({ action: "PURCHASE_ORDER_RECEIVE", resource: "purchase_order", resourceId: req.params.id, userId: getUserId(req), ip: getClientIp(req), status: "success", details: { poId: req.params.id, itemCount: itemsToReceive.length } });
      broadcastChange(req, "purchase-order", po.storeId, "received");
      broadcastChange(req, "inventory", po.storeId, "restocked");
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message || "Could not fulfill purchase order items." });
    }
  });

  // Delete PO
  app.delete("/api/purchase-orders/:id", requireManagerOrOwner, async (req, res) => {
    try {
      const po = await storage.purchaseOrderRepo.getPurchaseOrder(req.params.id);
      if (!po) return res.status(404).json({ error: "Purchase order not found." });
      if (!(await checkStoreAccess(po.storeId, req, res))) return;

      const userId = (req as any).user?.id;
      await storage.purchaseOrderRepo.deletePurchaseOrder(req.params.id);
      auditLogger.log({ action: "PURCHASE_ORDER_DELETE", resource: "purchase_order", resourceId: req.params.id, userId, ip: getClientIp(req), status: "success", details: { poId: req.params.id } });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Could not delete purchase order." });
    }
  });

  // ---------- 8. STOCK TRANSFERS ----------
  // Get transfers
  app.get("/api/stock-transfers", isAuthenticated, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) return res.status(400).json({ error: "Store ID is required." });
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const list = await storage.stockTransferRepo.getStockTransfers(storeId);
      res.json(list);
    } catch (error) {
      res.status(500).json({ error: "Could not fetch stock transfers." });
    }
  });

  // Get single transfer
  app.get("/api/stock-transfers/:id", isAuthenticated, async (req, res) => {
    try {
      const transfer = await storage.stockTransferRepo.getStockTransfer(req.params.id);
      if (!transfer) return res.status(404).json({ error: "Transfer not found." });
      if (!(await checkStoreAccess(transfer.fromStoreId, req, res)) && !(await checkStoreAccess(transfer.toStoreId, req, res))) {
        return res.status(403).json({ error: "Unauthorized access to this transfer." });
      }

      res.json(transfer);
    } catch (error) {
      res.status(500).json({ error: "Could not fetch stock transfer." });
    }
  });

  // Create stock transfer
  app.post("/api/stock-transfers", requireManagerOrOwner, async (req, res) => {
    try {
      const { fromStoreId, toStoreId, notes, items } = req.body;
      if (!fromStoreId || !toStoreId || !Array.isArray(items)) {
        return res.status(400).json({ error: "fromStoreId, toStoreId, and items are required." });
      }
      if (!(await checkStoreAccess(fromStoreId, req, res))) return;

      const userId = (req as any).user?.id;
      const created = await storage.stockTransferRepo.createStockTransfer({
        fromStoreId,
        toStoreId,
        notes: notes || null,
        status: "pending",
        items: items.map((i: any) => ({
          inventoryId: i.inventoryId,
          quantity: Number(i.quantity),
        })),
      });
      auditLogger.log({ action: "STOCK_TRANSFER_CREATE", resource: "stock_transfer", resourceId: created.id, userId, ip: getClientIp(req), status: "success", details: { fromStoreId, toStoreId, itemCount: items.length } });
      broadcastChange(req, "stock-transfer", fromStoreId, "created");
      res.status(201).json(created);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message || "Could not create stock transfer." });
    }
  });

  // Bulk import stock transfers (grouped CSV rows: rows sharing a transferRef become one transfer)
  app.post("/api/stock-transfers/bulk", requireManagerOrOwner, async (req, res) => {
    try {
      const { data, storeId } = req.body;
      if (!storeId || !Array.isArray(data)) {
        return res.status(400).json({ error: "storeId and a data array are required." });
      }
      // fromStoreId is always the caller's authorized storeId — never trust a CSV column for it.
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const userId = (req as any).user?.id;
      const result = await bulkUploadService.importStockTransfers(data, storeId, userId);
      broadcastChange(req, "stock-transfer", storeId, "created");
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Could not import stock transfers." });
    }
  });

  // Update status (approvals / completion)
  app.patch("/api/stock-transfers/:id/status", requireManagerOrOwner, async (req, res) => {
    try {
      const transfer = await storage.stockTransferRepo.getStockTransfer(req.params.id);
      if (!transfer) return res.status(404).json({ error: "Stock transfer not found." });
      
      // Source store authorization required to approve transfer out
      if (!(await checkStoreAccess(transfer.fromStoreId, req, res))) return;

      const { status } = req.body;
      if (!status) return res.status(400).json({ error: "Status is required." });

      const userId = getUserId(req) || null;
      const result = await storage.stockTransferRepo.updateStockTransferStatus(req.params.id, status, userId);
      
      if (!result.success) {
        return res.status(400).json({ error: result.message });
      }
      auditLogger.log({ action: "STOCK_TRANSFER_STATUS_UPDATE", resource: "stock_transfer", resourceId: req.params.id, userId: getUserId(req), ip: getClientIp(req), status: "success", details: { transferId: req.params.id, status } });
      broadcastChange(req, "stock-transfer", transfer.fromStoreId, "updated");
      if (status === "completed") broadcastChange(req, "inventory", transfer.toStoreId, "restocked");
      res.json(result.transfer);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message || "Could not update stock transfer status." });
    }
  });

  // Delete stock transfer
  app.delete("/api/stock-transfers/:id", requireManagerOrOwner, async (req, res) => {
    try {
      const transfer = await storage.stockTransferRepo.getStockTransfer(req.params.id);
      if (!transfer) return res.status(404).json({ error: "Stock transfer not found." });
      if (!(await checkStoreAccess(transfer.fromStoreId, req, res))) return;

      const userId = (req as any).user?.id;
      await storage.stockTransferRepo.deleteStockTransfer(req.params.id);
      auditLogger.log({ action: "STOCK_TRANSFER_DELETE", resource: "stock_transfer", resourceId: req.params.id, userId, ip: getClientIp(req), status: "success", details: { transferId: req.params.id } });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Could not delete stock transfer." });
    }
  });

  // ---------- 9. TAX RATES ----------
  // Get tax rates
  app.get("/api/tax-rates", isAuthenticated, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) return res.status(400).json({ error: "Store ID is required." });

      if (storeId === "all") {
        const stores = await getUserStores(req);
        if (stores.length === 0) return res.json([]);
        const rates = await Promise.all(
          stores.map(s => storage.taxRateRepo.getTaxRates(s.id))
        );
        return res.json(rates.flat());
      }

      if (!(await checkStoreAccess(storeId, req, res))) return;

      const rates = await storage.taxRateRepo.getTaxRates(storeId);
      res.json(rates);
    } catch (error) {
      res.status(500).json({ error: "Could not fetch tax rates." });
    }
  });

  // Create tax rate
  app.post("/api/tax-rates", requireManagerOrOwner, async (req, res) => {
    try {
      const { storeId, name, rate, isDefault } = req.body;
      if (!storeId || !name || rate === undefined) {
        return res.status(400).json({ error: "storeId, name, and rate are required." });
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const userId = (req as any).user?.id;
      const created = await storage.taxRateRepo.createTaxRate({
        storeId,
        name,
        rate: Number(rate),
        isDefault: !!isDefault,
      });
      auditLogger.log({ action: "TAX_RATE_CREATE", resource: "tax_rate", resourceId: created.id, userId, ip: getClientIp(req), status: "success", details: { storeId, name, rate } });
      res.status(201).json(created);
    } catch (error) {
      res.status(500).json({ error: "Could not create tax rate." });
    }
  });

  // Bulk import tax rates
  app.post("/api/tax-rates/bulk", requireManagerOrOwner, async (req, res) => {
    try {
      const { data, storeId } = req.body;
      if (!storeId || !Array.isArray(data)) {
        return res.status(400).json({ error: "storeId and a data array are required." });
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const userId = (req as any).user?.id;
      const result = await bulkUploadService.importTaxRates(data, storeId, userId);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Could not import tax rates." });
    }
  });

  // Update tax rate
  app.patch("/api/tax-rates/:id", requireManagerOrOwner, async (req, res) => {
    try {
      const [rate] = await db.select().from(taxRates).where(eq(taxRates.id, req.params.id));
      if (!rate) return res.status(404).json({ error: "Tax rate not found." });
      if (!(await checkStoreAccess(rate.storeId, req, res))) return;

      const { name, rate: rateValue, isDefault } = req.body;
      const userId = (req as any).user?.id;
      const updated = await storage.taxRateRepo.updateTaxRate(req.params.id, { name, rate: rateValue, isDefault });
      auditLogger.log({ action: "TAX_RATE_UPDATE", resource: "tax_rate", resourceId: req.params.id, userId, ip: getClientIp(req), status: "success", details: { taxRateId: req.params.id, name, rate: rateValue } });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Could not update tax rate." });
    }
  });

  // Delete tax rate
  app.delete("/api/tax-rates/:id", requireManagerOrOwner, async (req, res) => {
    try {
      const [rate] = await db.select().from(taxRates).where(eq(taxRates.id, req.params.id));
      if (!rate) return res.status(404).json({ error: "Tax rate not found." });
      if (!(await checkStoreAccess(rate.storeId, req, res))) return;

      const userId = (req as any).user?.id;
      await storage.taxRateRepo.deleteTaxRate(req.params.id);
      auditLogger.log({ action: "TAX_RATE_DELETE", resource: "tax_rate", resourceId: req.params.id, userId, ip: getClientIp(req), status: "success", details: { taxRateId: req.params.id } });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Could not delete tax rate." });
    }
  });

}
