import { parsePage, paginated } from "../lib/pagination";
import express, { type Express, type Request, type Response } from "express";
import { storage } from "../storage";
import {
  taxRates
} from "@shared/schema";
import crypto from "crypto";
import { sendPurchaseOrderEmail } from "../email";
import { objectStorage } from "../lib/objectStorage";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { sanitizeEmail, validateEmailFormat } from "../sanitize";
import { auditLogger } from "../audit";
import { bulkUploadService } from "../services/BulkUploadService";
import { getUserId, getClientIp, getAuditContext, getUserStores, broadcastChange } from './helpers';
import { withVendorId, withVendorBillId } from '../utils/slug-resolver';
import { requirePermission } from "../lib/permissionGate";
import { getMaskPolicy, maskVendor, stripMaskedValues } from "../lib/dataMasking";

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
      res.json((await getMaskPolicy(req)).contact ? result.map(maskVendor) : result);
    } catch (error) {
      res.status(500).json({ error: "Could not fetch vendors." });
    }
  });

  // Create Vendor
  app.post("/api/vendors", requirePermission("/vendors"), async (req, res) => {
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
  app.post("/api/vendors/bulk", requirePermission("/vendors"), async (req, res) => {
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

      const page = parsePage(req.query);
      const { rows, total } = await storage.vendorRepo.getVendorBillsPage(storeId, page);
      res.json(paginated(rows, total, page));
    } catch (error) {
      res.status(500).json({ error: "Could not fetch vendor bills." });
    }
  });

  // Create Vendor Bill
  app.post("/api/vendors/bills", requirePermission("/vendors"), async (req, res) => {
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
  app.patch("/api/vendors/bills/:id", withVendorBillId, requirePermission("/vendors"), async (req, res) => {
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
      res.json((await getMaskPolicy(req)).contact ? maskVendor(vendor) : vendor);
    } catch {
      res.status(500).json({ error: "Could not fetch vendor." });
    }
  });

  // Update Vendor
  app.patch("/api/vendors/:id", withVendorId, requirePermission("/vendors"), async (req, res) => {
    try {
      const vendor = await storage.vendorRepo.findById(req.params.id);
      if (!vendor) return res.status(404).json({ error: "Vendor not found." });
      if (!(await checkStoreAccess(vendor.storeId, req, res))) return;

      const { name, contactName, email, phone, address, notes } = stripMaskedValues(req.body);
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
  app.patch("/api/vendors/:id/archive", withVendorId, requirePermission("/vendors"), async (req, res) => {
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
  app.patch("/api/vendors/:id/restore", withVendorId, requirePermission("/vendors"), async (req, res) => {
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

      const page = parsePage(req.query);
      const { rows, total } = await storage.stockAuditRepo.getAuditsPage(storeId, page);
      res.json(paginated(rows, total, page));
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
  app.post("/api/stock-audits", requirePermission("/inventory"), async (req, res) => {
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

  // What approving this count would charge to Direct Supplies, without approving it.
  app.get("/api/stock-audits/:id/variance-preview", requirePermission("/inventory"), async (req: any, res) => {
    try {
      const audit = await storage.stockAuditRepo.findById(req.params.id);
      if (!audit) return res.status(404).json({ error: "Stock audit not found." });
      if (!(await checkStoreAccess(audit.storeId, req, res))) return;
      res.json(await storage.stockAuditRepo.previewVariance(req.params.id));
    } catch {
      res.status(500).json({ error: "Could not preview the count's cost impact." });
    }
  });

  // Approve Stock Audit
  app.post("/api/stock-audits/:id/approve", requirePermission("/inventory"), async (req: any, res) => {
    try {
      const audit = await storage.stockAuditRepo.findById(req.params.id);
      if (!audit) return res.status(404).json({ error: "Stock audit not found." });
      if (!(await checkStoreAccess(audit.storeId, req, res))) return;

      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized." });

      const approved = await storage.stockAuditRepo.approveAudit(req.params.id, userId);
      auditLogger.log({ action: "STOCK_AUDIT_APPROVE", resource: "stock_audit", resourceId: req.params.id, userId, ip: getClientIp(req), status: "success", details: { auditId: req.params.id } });
      broadcastChange(req, "inventory", audit.storeId, "audited");
      // A count can move money now — settling metered supplies against what was
      // actually on the shelf — so the expense ledger needs refreshing too.
      if (approved.varianceTotal !== 0) broadcastChange(req, "expense", audit.storeId, "created");
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

      const page = parsePage(req.query);
      if (storeId === "all") {
        const stores = await getUserStores(req);
        if (stores.length === 0) return res.json(paginated([], 0, page));
        // One query across every store the user may see, paged as a whole and newest first.
        const { rows, total } = await storage.quoteRepo.getQuotesPage(stores.map((s) => s.id), page);
        const names = new Map(stores.map((s) => [s.id, s.name]));
        return res.json(paginated(rows.map((q) => ({ ...q, storeName: names.get(q.storeId) })), total, page));
      }

      if (!(await checkStoreAccess(storeId, req, res))) return;

      const { rows, total } = await storage.quoteRepo.getQuotesPage(storeId, page);
      res.json(paginated(rows, total, page));
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
      const { storeId, customerId, quoteRef, validUntil, notes, items, status } = req.body;
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
        status: status === "sent" ? "sent" : "draft",
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
      if (!["draft", "sent", "accepted", "declined"].includes(status)) {
        // "converted" is only reachable by checking the quote out or booking it, which link the sale/booking.
        return res.status(400).json({ error: status === "converted" ? "A quote is converted by booking it or checking it out." : "Invalid quote status." });
      }
      if (quote.status === "converted") return res.status(409).json({ error: "A converted quote can't change status." });
      const role = (req as any).user?.role;
      if ((status === "accepted" || status === "declined") && role !== "owner" && role !== "manager") {
        return res.status(403).json({ error: "Only managers and owners can accept or decline a quote." });
      }

      const userId = (req as any).user?.id;
      const updated = await storage.quoteRepo.updateQuoteStatus(req.params.id, status);
      auditLogger.log({ action: "QUOTE_STATUS_UPDATE", resource: "quote", resourceId: req.params.id, userId, ip: getClientIp(req), status: "success", details: { quoteId: req.params.id, status } });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Could not update quote status." });
    }
  });

  // Extend (or change) how long a quote stays valid. Body: { validUntil: ISO date } or { extendDays: n }.
  // extendDays counts from the later of the current expiry and now, so an override always lands in the future.
  app.patch("/api/quotes/:id/validity", requireManagerOrOwner, async (req, res) => {
    try {
      const quote = await storage.quoteRepo.getQuote(req.params.id);
      if (!quote) return res.status(404).json({ error: "Quote not found." });
      if (!(await checkStoreAccess(quote.storeId, req, res))) return;
      if (quote.status === "converted" || quote.status === "declined") {
        return res.status(409).json({ error: `A ${quote.status} quote's validity can't be changed.` });
      }

      const { validUntil, extendDays } = req.body ?? {};
      let next: Date;
      if (typeof extendDays === "number" && extendDays > 0 && extendDays <= 365) {
        const base = quote.validUntil && new Date(quote.validUntil).getTime() > Date.now() ? new Date(quote.validUntil) : new Date();
        next = new Date(base.getTime() + extendDays * 86_400_000);
      } else if (validUntil) {
        next = new Date(validUntil);
        if (isNaN(next.getTime())) return res.status(400).json({ error: "Invalid date." });
        // A date picker sends midnight; make the quote valid through the end of that day.
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(validUntil))) next.setUTCHours(23, 59, 59, 999);
        if (next.getTime() <= Date.now()) return res.status(400).json({ error: "Choose a date in the future." });
      } else {
        return res.status(400).json({ error: "validUntil or extendDays is required." });
      }

      const updated = await storage.quoteRepo.updateQuoteValidity(req.params.id, next);
      auditLogger.log({ action: "QUOTE_VALIDITY_UPDATE", resource: "quote", resourceId: req.params.id, userId: (req as any).user?.id, ip: getClientIp(req), status: "success", details: { quoteId: req.params.id, from: quote.validUntil, to: next } });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Could not update quote validity." });
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

      const page = parsePage(req.query);
      const { rows, total } = await storage.purchaseOrderRepo.getPurchaseOrdersPage(storeId, page);
      res.json(paginated(rows, total, page));
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

  // Emails the supplier when a PO is placed. Never throws: the order is already
  // saved, so a mail problem must not fail it - the caller reports the outcome.
  async function emailSupplierOfOrder(poId: string, replyTo?: string): Promise<"sent" | "no_email" | "failed"> {
    try {
      const po = await storage.purchaseOrderRepo.getPurchaseOrder(poId);
      if (!po) return "failed";
      if (!po.vendor.email) return "no_email";
      const store = await storage.getStore(po.storeId);
      const business = store ? await storage.getBusinessById(store.businessId) : undefined;
      await sendPurchaseOrderEmail({
        to: po.vendor.email,
        businessName: business?.name || store?.name || "Our business",
        vendorName: po.vendor.name,
        poNumber: po.poNumber,
        supplierRef: po.supplierRef,
        notes: po.notes,
        expectedDelivery: po.expectedDelivery,
        currency: store?.currency || "NGN",
        lines: po.items.map((i) => ({ name: i.inventory.name, quantity: i.quantity, unit: i.inventory.unit, unitCost: i.unitCost })),
        replyTo,
      });
      return "sent";
    } catch (error) {
      console.error(`[PurchaseOrder] Failed to email supplier for PO ${poId}:`, error);
      return "failed";
    }
  }

  // Create PO
  app.post("/api/purchase-orders", requirePermission("/purchase-orders"), async (req, res) => {
    try {
      const { storeId, vendorId, poNumber, supplierRef, notes, expectedDelivery, items, status } = req.body;
      if (!storeId || !vendorId || !Array.isArray(items)) {
        return res.status(400).json({ error: "storeId, vendorId and an items array are required." });
      }
      if (items.some((i: any) => !i?.inventoryId || !(Number(i.quantity) > 0) || !(Number(i.unitCost) >= 0))) {
        return res.status(400).json({ error: "Every line needs a product, a quantity above 0 and a valid cost." });
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const userId = (req as any).user?.id;
      // A typed PO number is used as given; otherwise the server numbers it
      // PO-<STORECODE>-<n>, retrying if a concurrent order took the same number.
      const typedNumber = typeof poNumber === "string" ? poNumber.trim() : "";
      const isUniqueViolation = (e: any) => (e?.code || e?.cause?.code) === "23505";
      let created;
      for (let attempt = 0; ; attempt++) {
        const finalNumber = typedNumber || (await storage.purchaseOrderRepo.nextPoNumber(storeId));
        try {
          created = await storage.purchaseOrderRepo.createPurchaseOrder({
            storeId,
            vendorId,
            poNumber: finalNumber,
            supplierRef: typeof supplierRef === "string" && supplierRef.trim() ? supplierRef.trim().slice(0, 100) : null,
            notes: typeof notes === "string" && notes.trim() ? notes.trim().slice(0, 1000) : null,
            expectedDelivery: expectedDelivery ? new Date(expectedDelivery) : null,
            // "Place order" creates it already-ordered in one call; anything else (or
            // omitted) falls back to draft.
            status: status === "ordered" ? "ordered" : "draft",
            items: items.map((i: any) => ({
              inventoryId: i.inventoryId,
              quantity: Number(i.quantity),
              unitCost: Number(i.unitCost),
            })),
          });
          break;
        } catch (e) {
          if (!typedNumber && isUniqueViolation(e) && attempt < 4) continue;
          throw e;
        }
      }
      auditLogger.log({ action: "PURCHASE_ORDER_CREATE", resource: "purchase_order", resourceId: created.id, userId, ip: getClientIp(req), status: "success", details: { storeId, vendorId, poNumber: created.poNumber, itemCount: items.length } });
      broadcastChange(req, "purchase-order", storeId, "created");
      const supplierEmail = created.status === "ordered" ? await emailSupplierOfOrder(created.id, (req as any).user?.email) : undefined;
      res.status(201).json({ ...created, supplierEmail });
    } catch (error) {
      const err = error as { code?: string; cause?: { code?: string }; message?: string };
      if ((err.code || err.cause?.code) === "23505") {
        return res.status(409).json({ error: "That PO number is already used in this store. Choose a different one." });
      }
      res.status(500).json({ error: err.message || "Could not create purchase order." });
    }
  });

  // Edit a draft PO
  app.put("/api/purchase-orders/:id", requirePermission("/purchase-orders"), async (req, res) => {
    try {
      const po = await storage.purchaseOrderRepo.getPurchaseOrder(req.params.id);
      if (!po) return res.status(404).json({ error: "Purchase order not found." });
      if (!(await checkStoreAccess(po.storeId, req, res))) return;

      const { vendorId, poNumber, supplierRef, notes, expectedDelivery, items } = req.body;
      if (!vendorId || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "A vendor and at least one item are required." });
      }
      if (items.some((i: any) => !i?.inventoryId || !(Number(i.quantity) > 0) || !(Number(i.unitCost) >= 0))) {
        return res.status(400).json({ error: "Every line needs a product, a quantity above 0 and a valid cost." });
      }
      const result = await storage.purchaseOrderRepo.updateDraftPurchaseOrder(po.id, {
        vendorId,
        poNumber: typeof poNumber === "string" && poNumber.trim() ? poNumber.trim() : undefined,
        supplierRef: typeof supplierRef === "string" && supplierRef.trim() ? supplierRef.trim().slice(0, 100) : null,
        notes: typeof notes === "string" && notes.trim() ? notes.trim().slice(0, 1000) : null,
        expectedDelivery: expectedDelivery ? new Date(expectedDelivery) : null,
        items: items.map((i: any) => ({ inventoryId: i.inventoryId, quantity: Number(i.quantity), unitCost: Number(i.unitCost) })),
      });
      if (!result.success) return res.status(400).json({ error: result.message });
      auditLogger.log({ action: "PURCHASE_ORDER_UPDATE", resource: "purchase_order", resourceId: po.id, userId: getUserId(req), ip: getClientIp(req), status: "success", details: { poId: po.id, itemCount: items.length } });
      broadcastChange(req, "purchase-order", po.storeId, "updated");
      res.json(result.po);
    } catch (error) {
      const err = error as { code?: string; cause?: { code?: string }; message?: string };
      if ((err.code || err.cause?.code) === "23505") {
        return res.status(409).json({ error: "That PO number is already used in this store. Choose a different one." });
      }
      res.status(500).json({ error: "Could not update the purchase order." });
    }
  });

  // Bulk import purchase orders (grouped CSV rows: rows sharing a poRef become one PO)
  app.post("/api/purchase-orders/bulk", requirePermission("/purchase-orders"), async (req, res) => {
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

  // Set / clear the supplier's own reference (their order or invoice number)
  app.patch("/api/purchase-orders/:id/supplier-ref", requirePermission("/purchase-orders"), async (req, res) => {
    try {
      const po = await storage.purchaseOrderRepo.getPurchaseOrder(req.params.id);
      if (!po) return res.status(404).json({ error: "Purchase order not found." });
      if (!(await checkStoreAccess(po.storeId, req, res))) return;

      const raw = req.body?.supplierRef;
      const supplierRef = typeof raw === "string" && raw.trim() ? raw.trim().slice(0, 100) : null;
      const updated = await storage.purchaseOrderRepo.setSupplierRef(po.id, supplierRef);
      auditLogger.log({ action: "PURCHASE_ORDER_SUPPLIER_REF_UPDATE", resource: "purchase_order", resourceId: po.id, userId: getUserId(req), ip: getClientIp(req), status: "success", details: { poId: po.id, supplierRef } });
      broadcastChange(req, "purchase-order", po.storeId, "updated");
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Could not update the supplier reference." });
    }
  });

  // Update PO Status
  app.patch("/api/purchase-orders/:id/status", requirePermission("/purchase-orders"), async (req, res) => {
    try {
      const po = await storage.purchaseOrderRepo.getPurchaseOrder(req.params.id);
      if (!po) return res.status(404).json({ error: "Purchase order not found." });
      if (!(await checkStoreAccess(po.storeId, req, res))) return;

      const { status } = req.body;
      if (!status) return res.status(400).json({ error: "Status is required." });

      const userId = (req as any).user?.id;
      const allowed: Record<string, string[]> = { draft: ["ordered", "cancelled"], ordered: ["cancelled"] };
      if (!(allowed[po.status] ?? []).includes(status)) {
        return res.status(400).json({ error: `A ${po.status.replace("_", " ")} order can't be changed to ${String(status).replace("_", " ")}.` });
      }
      const placingOrder = po.status === "draft" && status === "ordered";
      const updated = await storage.purchaseOrderRepo.updatePurchaseOrderStatus(req.params.id, status);
      auditLogger.log({ action: "PURCHASE_ORDER_STATUS_UPDATE", resource: "purchase_order", resourceId: req.params.id, userId, ip: getClientIp(req), status: "success", details: { poId: req.params.id, status } });
      const supplierEmail = placingOrder ? await emailSupplierOfOrder(req.params.id, (req as any).user?.email) : undefined;
      res.json({ ...updated, supplierEmail });
    } catch (error) {
      res.status(500).json({ error: "Could not update purchase order status." });
    }
  });

  // ---- PO receipt (supplier invoice / delivery note) ----
  const PO_RECEIPT_MIME_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
  const PO_RECEIPT_MAX_BYTES = 10 * 1024 * 1024;

  // Receipt bytes go through this server (not a browser -> bucket presigned PUT):
  // the app's global fetch adds an x-csrf-token header that a cross-origin bucket
  // rejects at preflight, and this also avoids needing bucket CORS at all.
  // Returns the staged key, which the attach / receive routes then verify.
  const receiptBody = express.raw({ type: PO_RECEIPT_MIME_TYPES, limit: PO_RECEIPT_MAX_BYTES });
  app.put("/api/purchase-orders/:id/receipt/file", requirePermission("/purchase-orders"), receiptBody, async (req, res) => {
    try {
      const po = await storage.purchaseOrderRepo.getPurchaseOrder(req.params.id);
      if (!po) return res.status(404).json({ error: "Purchase order not found." });
      if (!(await checkStoreAccess(po.storeId, req, res))) return;

      const mimeType = String(req.headers["content-type"] || "").split(";")[0].trim();
      if (!PO_RECEIPT_MIME_TYPES.includes(mimeType)) {
        return res.status(400).json({ error: "Receipts must be a PDF, PNG, JPEG or WebP file." });
      }
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) return res.status(400).json({ error: "No file received." });
      if (!matchesMagicBytes(body, mimeType)) {
        return res.status(400).json({ error: "That file doesn't look like a valid " + mimeType.split("/")[1].toUpperCase() + "." });
      }

      const rawName = String(req.query.fileName || "receipt");
      const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
      const storageKey = `po-receipts/${po.id}/${Date.now()}-${crypto.randomBytes(6).toString("hex")}-${safeName}`;
      await objectStorage.putObject(storageKey, body, mimeType);
      res.json({ storageKey });
    } catch (error) {
      res.status(500).json({ error: "Could not upload the receipt. Please try again." });
    }
  });

  function matchesMagicBytes(b: Buffer, mime: string): boolean {
    switch (mime) {
      case "application/pdf": return b.subarray(0, 5).toString("latin1") === "%PDF-";
      case "image/png": return b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      case "image/jpeg": return b[0] === 0xff && b[1] === 0xd8;
      case "image/webp": return b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP";
      default: return false;
    }
  }

  // Returns an error message, or null when the staged upload is a valid receipt for this PO.
  async function verifyPoReceiptUpload(poId: string, storageKey: unknown): Promise<string | null> {
    if (typeof storageKey !== "string" || !storageKey.startsWith(`po-receipts/${poId}/`)) {
      return "Invalid receipt upload.";
    }
    // Trust the bucket, not the browser, for size and type.
    let meta;
    try {
      meta = await objectStorage.headObject(storageKey);
    } catch {
      return "The file was not uploaded. Please try again.";
    }
    if ((meta.contentLength ?? 0) > PO_RECEIPT_MAX_BYTES) {
      await objectStorage.deleteObject(storageKey).catch(() => undefined);
      return "Receipt is too large (10 MB max).";
    }
    if (!meta.contentType || !PO_RECEIPT_MIME_TYPES.includes(meta.contentType)) {
      await objectStorage.deleteObject(storageKey).catch(() => undefined);
      return "Receipts must be a PDF, PNG, JPEG or WebP file.";
    }
    return null;
  }

  app.post("/api/purchase-orders/:id/receipt", requirePermission("/purchase-orders"), async (req, res) => {
    try {
      const po = await storage.purchaseOrderRepo.getPurchaseOrder(req.params.id);
      if (!po) return res.status(404).json({ error: "Purchase order not found." });
      if (!(await checkStoreAccess(po.storeId, req, res))) return;

      const { storageKey, fileName } = req.body;
      const receiptError = await verifyPoReceiptUpload(po.id, storageKey);
      if (receiptError) return res.status(400).json({ error: receiptError });

      const updated = await storage.purchaseOrderRepo.setReceipt(po.id, storageKey, String(fileName || "receipt").slice(0, 200));
      auditLogger.log({ action: "PURCHASE_ORDER_RECEIPT_ATTACH", resource: "purchase_order", resourceId: po.id, userId: getUserId(req), ip: getClientIp(req), status: "success", details: { poId: po.id } });
      broadcastChange(req, "purchase-order", po.storeId, "updated");
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Could not attach the receipt." });
    }
  });

  app.get("/api/purchase-orders/:id/receipt", isAuthenticated, async (req, res) => {
    try {
      const po = await storage.purchaseOrderRepo.getPurchaseOrder(req.params.id);
      if (!po) return res.status(404).json({ error: "Purchase order not found." });
      if (!(await checkStoreAccess(po.storeId, req, res))) return;
      if (!po.receiptKey) return res.status(404).json({ error: "No receipt attached." });
      res.redirect(302, await objectStorage.getSignedGetUrl(po.receiptKey, 300));
    } catch (error) {
      res.status(500).json({ error: "Could not open the receipt." });
    }
  });

  app.get("/api/purchase-orders/:id/receipts/:receiptId", isAuthenticated, async (req, res) => {
    try {
      const po = await storage.purchaseOrderRepo.getPurchaseOrder(req.params.id);
      if (!po) return res.status(404).json({ error: "Purchase order not found." });
      if (!(await checkStoreAccess(po.storeId, req, res))) return;
      const receipt = await storage.purchaseOrderRepo.getDeliveryReceipt(po.id, req.params.receiptId);
      if (!receipt) return res.status(404).json({ error: "Receipt not found." });
      res.redirect(302, await objectStorage.getSignedGetUrl(receipt.receiptKey, 300));
    } catch (error) {
      res.status(500).json({ error: "Could not open the receipt." });
    }
  });

  // Receive PO items
  app.post("/api/purchase-orders/:id/receive", requirePermission("/purchase-orders"), async (req, res) => {
    try {
      const po = await storage.purchaseOrderRepo.getPurchaseOrder(req.params.id);
      if (!po) return res.status(404).json({ error: "Purchase order not found." });
      if (!(await checkStoreAccess(po.storeId, req, res))) return;

      const { itemsToReceive, staffId, receiptKey, receiptName } = req.body;
      if (!Array.isArray(itemsToReceive)) {
        return res.status(400).json({ error: "itemsToReceive array is required." });
      }
      // Optional receipt for this delivery.
      let deliveryReceipt: { key: string; name: string } | null = null;
      if (receiptKey) {
        const receiptError = await verifyPoReceiptUpload(po.id, receiptKey);
        if (receiptError) return res.status(400).json({ error: receiptError });
        deliveryReceipt = { key: receiptKey, name: String(receiptName || "receipt").slice(0, 200) };
      }

      const userId = getUserId(req) || null;
      const result = await storage.purchaseOrderRepo.receivePOItems(
        req.params.id,
        itemsToReceive.map((i: any) => ({
          inventoryId: i.inventoryId,
          quantity: Number(i.quantity),
        })),
        staffId || null,
        userId,
        deliveryReceipt
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
  app.delete("/api/purchase-orders/:id", requirePermission("/purchase-orders"), async (req, res) => {
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
  app.get("/api/stock-transfers", requirePermission("/stock-transfers"), async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) return res.status(400).json({ error: "Store ID is required." });
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const page = parsePage(req.query);
      const { rows, total } = await storage.stockTransferRepo.getStockTransfersPage(storeId, page);
      res.json(paginated(rows, total, page));
    } catch (error) {
      res.status(500).json({ error: "Could not fetch stock transfers." });
    }
  });

  // Get single transfer
  app.get("/api/stock-transfers/:id", requirePermission("/stock-transfers"), async (req, res) => {
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
  app.post("/api/stock-transfers", requirePermission("/stock-transfers"), async (req, res) => {
    try {
      const { fromStoreId, toStoreId, notes, items } = req.body;
      const kind = req.body.kind === "request" ? "request" : "send";
      if (!fromStoreId || !toStoreId || !Array.isArray(items)) {
        return res.status(400).json({ error: "fromStoreId, toStoreId, and items are required." });
      }
      if (fromStoreId === toStoreId) {
        return res.status(400).json({ error: "Source and target stores must be different." });
      }
      // The caller acts for the branch that initiates: the sender pushes stock out, the
      // requester asks for it to come in.
      if (!(await checkStoreAccess(kind === "request" ? toStoreId : fromStoreId, req, res))) return;
      const [fromStore, toStore] = await Promise.all([storage.getStore(fromStoreId), storage.getStore(toStoreId)]);
      if (!fromStore || !toStore || fromStore.businessId !== toStore.businessId) {
        return res.status(400).json({ error: "Stock can only move between branches of the same business." });
      }

      const userId = (req as any).user?.id;
      const created = await storage.stockTransferRepo.createStockTransfer({
        fromStoreId,
        toStoreId,
        notes: notes || null,
        kind,
        status: kind === "request" ? "requested" : "pending",
        items: items.map((i: any) => ({
          inventoryId: i.inventoryId,
          quantity: Number(i.quantity),
        })),
      });

      if ("error" in created) {
        return res.status(400).json({ error: created.error });
      }

      auditLogger.log({ action: "STOCK_TRANSFER_CREATE", resource: "stock_transfer", resourceId: created.id, userId, ip: getClientIp(req), status: "success", details: { fromStoreId, toStoreId, kind, itemCount: items.length } });
      broadcastChange(req, "stock-transfer", fromStoreId, "created");
      broadcastChange(req, "stock-transfer", toStoreId, "created");
      // A request needs a decision from the branch that holds the stock: tell its staff.
      if (kind === "request") {
        await storage.notifyAllStaff(fromStoreId, "stock_transfer", `${toStore.name} has requested stock from ${fromStore.name}. Review it under Stock Transfers.`);
      }
      res.status(201).json(created);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message || "Could not create stock transfer." });
    }
  });

  // Bulk import stock transfers (grouped CSV rows: rows sharing a transferRef become one transfer)
  app.post("/api/stock-transfers/bulk", requirePermission("/stock-transfers"), async (req, res) => {
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
  app.patch("/api/stock-transfers/:id/status", requirePermission("/stock-transfers"), async (req, res) => {
    try {
      const transfer = await storage.stockTransferRepo.getStockTransfer(req.params.id);
      if (!transfer) return res.status(404).json({ error: "Stock transfer not found." });
      
      // Source store authorization required to approve transfer out; the requesting
      // branch acts on its own open request.
      const actingStoreId = transfer.kind === "request" && transfer.status === "requested" ? transfer.toStoreId : transfer.fromStoreId;
      if (!(await checkStoreAccess(actingStoreId, req, res))) return;

      const { status } = req.body;
      if (!status) return res.status(400).json({ error: "Status is required." });
      // A request has not been approved yet, so it can only be withdrawn here; moving it
      // forward goes through accept so the supplying branch's decision is never skipped.
      if (transfer.status === "requested" && status !== "cancelled") {
        return res.status(400).json({ error: "A stock request must be approved by the supplying branch." });
      }

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
  app.delete("/api/stock-transfers/:id", requirePermission("/stock-transfers"), async (req, res) => {
    try {
      const transfer = await storage.stockTransferRepo.getStockTransfer(req.params.id);
      if (!transfer) return res.status(404).json({ error: "Stock transfer not found." });
      if (!(await checkStoreAccess(transfer.fromStoreId, req, res))) return;

      const userId = (req as any).user?.id;
      const result = await storage.stockTransferRepo.deleteStockTransfer(req.params.id);

      if (!result.success) {
        return res.status(400).json({ error: result.message });
      }

      auditLogger.log({ action: "STOCK_TRANSFER_DELETE", resource: "stock_transfer", resourceId: req.params.id, userId, ip: getClientIp(req), status: "success", details: { transferId: req.params.id } });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Could not delete stock transfer." });
    }
  });

  // Stock transfer workflow transitions
  app.put("/api/stock-transfers/:id/accept", requirePermission("/stock-transfers"), async (req, res) => {
    try {
      const transfer = await storage.stockTransferRepo.getStockTransfer(req.params.id);
      if (!transfer) return res.status(404).json({ error: "Stock transfer not found." });
      // The branch that did not initiate decides: the destination for a send, the source for a request
      if (!(await checkStoreAccess(transfer.kind === "request" ? transfer.fromStoreId : transfer.toStoreId, req, res))) return;

      const userId = (req as any).user?.id;
      const result = await storage.stockTransferRepo.acceptTransfer(req.params.id, userId);

      if (!result.success) {
        return res.status(400).json({ error: result.message });
      }

      // Notify all staff at both stores
      const fromStore = transfer.fromStore.name || transfer.fromStoreId;
      const toStore = transfer.toStore.name || transfer.toStoreId;
      await storage.notifyAllStaff(transfer.fromStoreId, "stock_transfer", `Transfer to ${toStore} has been accepted.`);
      await storage.notifyAllStaff(transfer.toStoreId, "stock_transfer", `Transfer from ${fromStore} has been accepted. Next: source will schedule delivery.`);

      auditLogger.log({ action: "STOCK_TRANSFER_ACCEPT", resource: "stock_transfer", resourceId: req.params.id, userId, ip: getClientIp(req), status: "success" });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Could not accept stock transfer." });
    }
  });

  app.put("/api/stock-transfers/:id/reject", requirePermission("/stock-transfers"), async (req, res) => {
    try {
      const { reason } = req.body;
      if (!reason) return res.status(400).json({ error: "Rejection reason is required." });

      const transfer = await storage.stockTransferRepo.getStockTransfer(req.params.id);
      if (!transfer) return res.status(404).json({ error: "Stock transfer not found." });
      // The branch that did not initiate decides: the destination for a send, the source for a request
      if (!(await checkStoreAccess(transfer.kind === "request" ? transfer.fromStoreId : transfer.toStoreId, req, res))) return;

      const userId = (req as any).user?.id;
      const result = await storage.stockTransferRepo.rejectTransfer(req.params.id, userId, reason);

      if (!result.success) {
        return res.status(400).json({ error: result.message });
      }

      // Notify all staff at both stores
      const fromStore = transfer.fromStore.name || transfer.fromStoreId;
      const toStore = transfer.toStore.name || transfer.toStoreId;
      await storage.notifyAllStaff(transfer.fromStoreId, "stock_transfer", `Transfer to ${toStore} has been rejected. Reason: ${reason}`);
      await storage.notifyAllStaff(transfer.toStoreId, "stock_transfer", `Transfer from ${fromStore} has been rejected.`);

      auditLogger.log({ action: "STOCK_TRANSFER_REJECT", resource: "stock_transfer", resourceId: req.params.id, userId, ip: getClientIp(req), status: "success", details: { reason } });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Could not reject stock transfer." });
    }
  });

  app.put("/api/stock-transfers/:id/schedule", requirePermission("/stock-transfers"), async (req, res) => {
    try {
      const { deliveryDate, deliveryMethod, deliveryNotes } = req.body;
      if (!deliveryDate || !deliveryMethod) {
        return res.status(400).json({ error: "Delivery date and method are required." });
      }

      const transfer = await storage.stockTransferRepo.getStockTransfer(req.params.id);
      if (!transfer) return res.status(404).json({ error: "Stock transfer not found." });
      // Source store schedules delivery
      if (!(await checkStoreAccess(transfer.fromStoreId, req, res))) return;

      const userId = (req as any).user?.id;
      const result = await storage.stockTransferRepo.scheduleDelivery(req.params.id, userId, deliveryDate, deliveryMethod, deliveryNotes);

      if (!result.success) {
        return res.status(400).json({ error: result.message });
      }

      // Notify all staff at both stores
      const toStore = transfer.toStore.name || transfer.toStoreId;
      const fromStore = transfer.fromStore.name || transfer.fromStoreId;
      await storage.notifyAllStaff(transfer.fromStoreId, "stock_transfer", `Transfer to ${toStore} scheduled for ${deliveryDate} via ${deliveryMethod}.`);
      await storage.notifyAllStaff(transfer.toStoreId, "stock_transfer", `Transfer from ${fromStore} scheduled to arrive on ${deliveryDate}.`);

      auditLogger.log({ action: "STOCK_TRANSFER_SCHEDULE", resource: "stock_transfer", resourceId: req.params.id, userId, ip: getClientIp(req), status: "success", details: { deliveryDate, deliveryMethod } });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Could not schedule stock transfer." });
    }
  });

  app.put("/api/stock-transfers/:id/deliver", requirePermission("/stock-transfers"), async (req, res) => {
    try {
      const transfer = await storage.stockTransferRepo.getStockTransfer(req.params.id);
      if (!transfer) return res.status(404).json({ error: "Stock transfer not found." });
      // Source store marks as delivered
      if (!(await checkStoreAccess(transfer.fromStoreId, req, res))) return;

      const userId = (req as any).user?.id;
      const result = await storage.stockTransferRepo.markDelivered(req.params.id, userId);

      if (!result.success) {
        return res.status(400).json({ error: result.message });
      }

      // Notify all staff at both stores
      const toStore = transfer.toStore.name || transfer.toStoreId;
      await storage.notifyAllStaff(transfer.fromStoreId, "stock_transfer", `Transfer to ${toStore} has been dispatched.`);
      await storage.notifyAllStaff(transfer.toStoreId, "stock_transfer", `Transfer has been dispatched and is in transit. Confirm receipt when it arrives.`);

      auditLogger.log({ action: "STOCK_TRANSFER_DELIVER", resource: "stock_transfer", resourceId: req.params.id, userId, ip: getClientIp(req), status: "success" });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Could not mark stock transfer as delivered." });
    }
  });

  app.put("/api/stock-transfers/:id/confirm", requirePermission("/stock-transfers"), async (req, res) => {
    try {
      const { confirmedQuantities } = req.body;
      if (!confirmedQuantities || typeof confirmedQuantities !== "object") {
        return res.status(400).json({ error: "Confirmed quantities object is required." });
      }

      const transfer = await storage.stockTransferRepo.getStockTransfer(req.params.id);
      if (!transfer) return res.status(404).json({ error: "Stock transfer not found." });
      // Destination store confirms receipt
      if (!(await checkStoreAccess(transfer.toStoreId, req, res))) return;

      const userId = (req as any).user?.id;
      const result = await storage.stockTransferRepo.confirmReceipt(req.params.id, userId, confirmedQuantities);

      if (!result.success) {
        return res.status(400).json({ error: result.message });
      }

      // Notify all staff at both stores
      const fromStore = transfer.fromStore.name || transfer.fromStoreId;
      const toStore = transfer.toStore.name || transfer.toStoreId;
      await storage.notifyAllStaff(transfer.fromStoreId, "stock_transfer", `Transfer to ${toStore} has been received and confirmed.`);
      await storage.notifyAllStaff(transfer.toStoreId, "stock_transfer", `Transfer from ${fromStore} has been received and stock has been added to inventory.`);

      auditLogger.log({ action: "STOCK_TRANSFER_CONFIRM", resource: "stock_transfer", resourceId: req.params.id, userId, ip: getClientIp(req), status: "success", details: { confirmedQuantities } });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Could not confirm stock transfer receipt." });
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
  app.post("/api/tax-rates", requirePermission("/settings/taxes"), async (req, res) => {
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
  app.post("/api/tax-rates/bulk", requirePermission("/settings/taxes"), async (req, res) => {
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
  app.patch("/api/tax-rates/:id", requirePermission("/settings/taxes"), async (req, res) => {
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
  app.delete("/api/tax-rates/:id", requirePermission("/settings/taxes"), async (req, res) => {
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
