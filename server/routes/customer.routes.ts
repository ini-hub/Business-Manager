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

export function registerCustomerRoutes(app: Express, { isAuthenticated: _isAuth, requireRole, requireManagerOrOwner, checkStoreAccess }: RouteMiddlewares): void {
  // ========== CUSTOMERS ==========
  app.get("/api/customers/check-duplicate", async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      const phone = req.query.phone as string;
      if (!storeId || !phone) {
        return res.status(400).json({ error: "Store ID and Phone are required." });
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const normalizedPhone = sanitizePhoneNumber(phone);
      if (!normalizedPhone) return res.status(200).json({ duplicate: false });

      const existing = await storage.findCustomerByPhone(storeId, normalizedPhone);
      if (existing && !existing.isConfirmedDistinct) {
        let lastTransactionDate: Date | null = null;
        const [lastTx] = await db
          .select({ transactionDate: transactions.transactionDate })
          .from(transactions)
          .where(eq(transactions.customerId, existing.id))
          .orderBy(desc(transactions.transactionDate))
          .limit(1);
        if (lastTx) lastTransactionDate = lastTx.transactionDate;

        return res.status(409).json({
          duplicate: true,
          existingCustomer: {
            id: existing.id,
            name: existing.name,
            customerNumber: existing.customerNumber,
            mobileNumber: existing.mobileNumber,
            createdAt: existing.createdAt,
            lastTransactionDate,
          }
        });
      }
      res.json({ duplicate: false });
    } catch (error) {
      res.status(500).json({ error: "Could not check duplicate." });
    }
  });

  app.get("/api/customers/search-global", async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      const query = req.query.query as string;
      if (!storeId) {
        return res.status(400).json({ error: "Please select a store first." });
      }
      if (!query || query.trim().length < 2) {
        return res.json([]);
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const store = await storage.getStore(storeId);
      if (!store) {
        return res.status(404).json({ error: "Store not found." });
      }

      const results = await storage.searchGlobalCustomers(store.businessId, storeId, query);
      res.json(results);
    } catch (error) {
      console.error("Global Customer Search Error:", error);
      res.status(500).json({ error: "Could not execute global customer search." });
    }
  });

  app.post("/api/customers/profile-global", async (req, res) => {
    try {
      const { customerId, storeId } = req.body;
      if (!customerId || !storeId) {
        return res.status(400).json({ error: "Customer ID and Target Store ID are required." });
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const customer = await storage.profileGlobalCustomer(customerId, storeId);
      auditLogger.logDataModification("customer", customer.id, getUserId(req), "CREATE_GLOBAL_PROFILE", true);
      res.json(customer);
    } catch (error: any) {
      console.error("Global Profile Creation Error:", error);
      res.status(500).json({ error: error.message || "Could not profile customer from another branch." });
    }
  });

  app.get("/api/customers", async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) {
        return res.status(400).json({ error: "Please select a store first." });
      }

      const page = parseInt(req.query.page as string) || 0;
      const limit = parseInt(req.query.limit as string) || 0;

      if (storeId === "all") {
        const stores = await getUserStores(req);
        if (stores.length === 0) return res.json(page > 0 && limit > 0 ? { customers: [], total: 0, pages: 0 } : []);

        const responses = await Promise.all(
          stores.map(async (s) => {
            const list = await storage.getCustomers(s.id);
            return list.map(item => ({ ...item, storeName: s.name }));
          })
        );

        const mergedMap = new Map<string, any>();
        for (const list of responses) {
          for (const item of list) {
            const key = item.mobileNumber || item.id;
            const existing = mergedMap.get(key);
            if (existing) {
              if (item.storeName && !existing.storeName?.includes(item.storeName)) {
                existing.storeName = `${existing.storeName}, ${item.storeName}`;
              }
            } else {
              mergedMap.set(key, { ...item });
            }
          }
        }
        let merged = Array.from(mergedMap.values());

        if (page > 0 && limit > 0) {
          const search = req.query.search as string;
          if (search) {
            const sLower = search.toLowerCase();
            merged = merged.filter(item => 
              String(item.name || "").toLowerCase().includes(sLower) || 
              String(item.mobileNumber || "").toLowerCase().includes(sLower)
            );
          }
          const start = (page - 1) * limit;
          const paginated = merged.slice(start, start + limit);
          return res.json({
            customers: paginated,
            total: merged.length,
            pages: Math.ceil(merged.length / limit),
          });
        }
        return res.json(merged);
      }

      if (!(await checkStoreAccess(storeId, req, res))) return;

      if (page > 0 && limit > 0) {
        const search = req.query.search as string;
        const includeArchived = req.query.includeArchived === 'true';
        const result = await storage.getCustomersPaginated(storeId, { page, limit, search, includeArchived });
        return res.json(result);
      }

      const customerList = await storage.getCustomers(storeId);
      res.json(customerList);
    } catch (error) {
      res.status(500).json({ error: "We couldn't load your customers. Please try again." });
    }
  });

  app.get("/api/customers/:id", async (req, res) => {
    try {
      const customer = await storage.getCustomer(req.params.id);
      if (!customer) {
        return res.status(404).json({ error: "Customer not found." });
      }

      // Verify user has access to this customer's store
      if (!await verifyRecordStoreAccess(req, customer.storeId)) {
        return res.status(403).json({ error: "You don't have access to this customer." });
      }

      res.json(customer);
    } catch (error) {
      res.status(500).json({ error: "We couldn't load customer information. Please try again." });
    }
  });

  app.post("/api/customers", async (req, res) => {
    try {
      const sanitizedBody = {
        ...req.body,
        name: sanitizeString(req.body.name),
        mobileNumber: sanitizePhoneNumber(req.body.mobileNumber),
        address: sanitizeString(req.body.address),
      };
      const data = insertCustomerSchema.parse(sanitizedBody);
      if (data.storeId && !(await checkStoreAccess(data.storeId, req, res))) return;

      // Proactive Phone Collision Intercept
      const normalizedPhone = sanitizedBody.mobileNumber;
      if (normalizedPhone && !req.body.allowDuplicatePhone) {
        const existing = await storage.findCustomerByPhone(data.storeId, normalizedPhone);
        if (existing && !existing.isConfirmedDistinct) {
          let lastTransactionDate: Date | null = null;
          const [lastTx] = await db
            .select({ transactionDate: transactions.transactionDate })
            .from(transactions)
            .where(eq(transactions.customerId, existing.id))
            .orderBy(desc(transactions.transactionDate))
            .limit(1);
          if (lastTx) lastTransactionDate = lastTx.transactionDate;

          return res.status(409).json({
            error: "possible_duplicate",
            message: "A customer with this phone number already exists in this store.",
            existingCustomer: {
              id: existing.id,
              name: existing.name,
              customerNumber: existing.customerNumber,
              mobileNumber: existing.mobileNumber,
              createdAt: existing.createdAt,
              lastTransactionDate,
            }
          });
        }
      }

      // If allowDuplicatePhone is true, link both profiles
      let duplicateOfId: string | undefined;
      if (normalizedPhone && req.body.allowDuplicatePhone) {
        const existing = await storage.findCustomerByPhone(data.storeId, normalizedPhone);
        if (existing) {
          duplicateOfId = existing.id;
        }
      }

      const customer = await storage.createCustomer({
        ...data,
        duplicateOfId,
      });

      if (duplicateOfId) {
        await storage.updateCustomer(duplicateOfId, { duplicateOfId: customer.id } as any);
      }

      auditLogger.logDataModification("customer", customer.id, getUserId(req), "CREATE", true);
      res.status(201).json(customer);
    } catch (error) {
      auditLogger.logDataModification("customer", undefined, getUserId(req), "CREATE", false, (error as Error).message);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      res.status(500).json({ error: "We couldn't add this customer right now. Please try again." });
    }
  });

  // Merge Customer Profiles
  app.post("/api/customers/merge", requireRole("owner", "manager"), async (req, res) => {
    try {
      const { targetId, duplicateId, customFields } = req.body;
      if (!targetId || !duplicateId) {
        return res.status(400).json({ error: "Target ID and Duplicate ID are required." });
      }

      const target = await storage.getCustomer(targetId);
      const duplicate = await storage.getCustomer(duplicateId);

      if (!target || !duplicate) {
        return res.status(404).json({ error: "Customer not found." });
      }

      if (!(await checkStoreAccess(target.storeId, req, res))) return;
      if (!(await checkStoreAccess(duplicate.storeId, req, res))) return;

      const mergedCustomer = await storage.mergeCustomers(targetId, duplicateId, customFields);
      auditLogger.logDataModification("customer", targetId, getUserId(req), "MERGE", true, `Merged duplicate ${duplicateId}`);
      res.json(mergedCustomer);
    } catch (error) {
      auditLogger.logDataModification("customer", req.body.targetId, getUserId(req), "MERGE", false, (error as Error).message);
      res.status(500).json({ error: error instanceof Error ? error.message : "Could not merge customer profiles." });
    }
  });

  // Dismiss Duplicate Flag
  app.post("/api/customers/dismiss-duplicate", requireRole("owner", "manager"), async (req, res) => {
    try {
      const { targetId, duplicateId } = req.body;
      if (!targetId || !duplicateId) {
        return res.status(400).json({ error: "Target ID and Duplicate ID are required." });
      }

      const target = await storage.getCustomer(targetId);
      const duplicate = await storage.getCustomer(duplicateId);

      if (!target || !duplicate) {
        return res.status(404).json({ error: "Customer not found." });
      }

      if (!(await checkStoreAccess(target.storeId, req, res))) return;
      if (!(await checkStoreAccess(duplicate.storeId, req, res))) return;

      await storage.dismissDuplicate(targetId, duplicateId);
      auditLogger.logDataModification("customer", targetId, getUserId(req), "DISMISS_DUPLICATE", true, `Dismissed duplicate with ${duplicateId}`);
      res.status(204).end();
    } catch (error) {
      auditLogger.logDataModification("customer", req.body.targetId, getUserId(req), "DISMISS_DUPLICATE", false, (error as Error).message);
      res.status(500).json({ error: error instanceof Error ? error.message : "Could not dismiss duplicate warning." });
    }
  });

  app.patch("/api/customers/:id", requireRole("owner", "manager"), async (req, res) => {
    try {
      const customer = await storage.getCustomer(req.params.id);
      if (!customer) {
        return res.status(404).json({ error: "Customer not found." });
      }

      // Verify user has access to this customer's store
      if (!await verifyRecordStoreAccess(req, customer.storeId)) {
        return res.status(403).json({ error: "You don't have access to this customer." });
      }

      const sanitizedBody = {
        ...req.body,
        name: req.body.name ? sanitizeString(req.body.name) : undefined,
        mobileNumber: req.body.mobileNumber ? sanitizePhoneNumber(req.body.mobileNumber) : undefined,
        address: req.body.address ? sanitizeString(req.body.address) : undefined,
      };
      // Remove storeId to prevent cross-store migration via PATCH
      delete sanitizedBody.storeId;
      const data = insertCustomerSchema.partial().parse(sanitizedBody);
      const updatedCustomer = await storage.updateCustomer(req.params.id, data);
      if (!updatedCustomer) {
        return res.status(404).json({ error: "This customer no longer exists. It may have been deleted." });
      }
      auditLogger.logDataModification("customer", req.params.id, getUserId(req), "UPDATE", true);
      res.json(updatedCustomer);
    } catch (error) {
      auditLogger.logDataModification("customer", req.params.id, getUserId(req), "UPDATE", false, (error as Error).message);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      res.status(500).json({ error: "We couldn't update this customer right now. Please try again." });
    }
  });

  app.delete("/api/customers/:id", requireRole("owner", "manager"), async (req, res) => {
    try {
      const customer = await storage.getCustomer(req.params.id);
      if (!customer) {
        return res.status(404).json({ error: "Customer not found." });
      }

      // Verify user has access to this customer's store
      if (!await verifyRecordStoreAccess(req, customer.storeId)) {
        return res.status(403).json({ error: "You don't have access to this customer." });
      }

      // Archive instead of delete (soft delete)
      const archived = await storage.archiveCustomer(req.params.id);
      if (!archived) {
        return res.status(500).json({ error: "We couldn't archive this customer. Please try again." });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "We couldn't archive this customer. Please try again." });
    }
  });

  // Restore archived customer
  app.post("/api/customers/:id/restore", requireRole("owner", "manager"), async (req, res) => {
    try {
      const customer = await storage.getCustomer(req.params.id);
      if (!customer) {
        return res.status(404).json({ error: "Customer not found." });
      }

      // Verify user has access to this customer's store
      if (!await verifyRecordStoreAccess(req, customer.storeId)) {
        return res.status(403).json({ error: "You don't have access to this customer." });
      }

      const restored = await storage.restoreCustomer(req.params.id);
      if (!restored) {
        return res.status(500).json({ error: "We couldn't restore this customer. Please try again." });
      }
      res.json(restored);
    } catch (error) {
      res.status(500).json({ error: "We couldn't restore this customer. Please try again." });
    }
  });

  // Permanently delete archived customer
  app.delete("/api/customers/:id/permanent", requireRole("owner", "manager"), async (req, res) => {
    try {
      const customer = await storage.getCustomer(req.params.id);
      if (!customer) {
        return res.status(404).json({ error: "Customer not found." });
      }

      // Verify user has access to this customer's store
      if (!await verifyRecordStoreAccess(req, customer.storeId)) {
        return res.status(403).json({ error: "You don't have access to this customer." });
      }

      if (!customer.isArchived) {
        return res.status(400).json({ error: "Only archived customers can be permanently deleted." });
      }

      const hasTransactions = await storage.hasCustomerTransactions(req.params.id);
      if (hasTransactions) {
        return res.status(400).json({
          error: "Cannot permanently delete customer with existing transactions. This customer has purchase history that must be preserved for your records."
        });
      }

      const deleted = await storage.deleteCustomer(req.params.id);
      if (!deleted) {
        return res.status(500).json({ error: "We couldn't delete this customer. Please try again." });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "We couldn't delete this customer. Please try again." });
    }
  });

  // Bulk import customers
  app.post("/api/customers/bulk", requireManagerOrOwner, async (req, res) => {
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
          const parsed = insertCustomerSchema.parse({
            storeId,
            name: row.name,
            customerNumber: "",
            mobileNumber: row.mobileNumber,
            address: row.address,
          });
          if (parsed.storeId && !(await checkStoreAccess(parsed.storeId, req, res))) { throw new Error("Unauthorized store"); }
          await storage.createCustomer(parsed);
          result.success++;
        } catch (error) {
          result.failed++;
          const message = error instanceof z.ZodError
            ? error.errors.map(e => e.message).join(", ")
            : "Invalid data";
          result.errors.push({ row: i + 2, message });
        }
      }

      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "We couldn't import your customers. Please try again." });
    }
  });

}
