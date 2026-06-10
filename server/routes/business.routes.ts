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

export function registerBusinessRoutes(app: Express, { isAuthenticated, requireRole, requireManagerOrOwner, checkStoreAccess }: RouteMiddlewares): void {
  // ========== BUSINESS ==========
  app.get("/api/business", isAuthenticated, async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user?.id) {
        return res.status(401).json({ error: "Authentication required." });
      }

      // 1. Check active session businessId from claims
      let activeBusinessId = user.businessId;

      // 2. Fallback to database user record if not in active session
      if (!activeBusinessId) {
        const userRecord = await storage.getUser(user.id);
        activeBusinessId = userRecord?.businessId;
      }

      // 3. Fallback to first joined organization in database
      if (!activeBusinessId) {
        const userOrgs = await storage.getOrganisationsByUserId(user.id);
        if (userOrgs.length > 0) {
          activeBusinessId = userOrgs[0].id;
          // Sync default businessId in user profile
          await storage.updateUser(user.id, { businessId: activeBusinessId });
        }
      }

      if (activeBusinessId) {
        const business = await storage.getBusinessById(activeBusinessId);
        return res.json(business || null);
      }

      res.json(null);
    } catch (error) {
      console.error("GET /api/business error:", error);
      res.status(500).json({ error: "We couldn't load business information. Please try again." });
    }
  });

  app.post("/api/business", requireRole("owner"), async (req, res) => {
    try {
      const data = insertBusinessSchema.parse(req.body);
      const business = await storage.createBusiness(data);
      res.status(201).json(business);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      res.status(500).json({ error: "We couldn't create the business. Please try again." });
    }
  });

  app.patch("/api/business/:id", requireRole("owner"), async (req, res) => {
    try {
      if (req.params.id !== (req as any).user?.businessId) {
        return res.status(403).json({ error: "Unauthorized access to business data." });
      }
      const data = insertBusinessSchema.partial().parse(req.body);
      const business = await storage.updateBusiness(req.params.id, data);
      if (!business) {
        return res.status(404).json({ error: "Business not found." });
      }
      res.json(business);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      res.status(500).json({ error: "We couldn't update the business information. Please try again." });
    }
  });

  // ========== STORES ==========
  app.get("/api/stores", isAuthenticated, async (req, res) => {
    try {
      const userId = (req as any).user?.userId || (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ error: "Please log in to access stores." });
      }

      let businessId = req.query.businessId as string;
      const userBusinessId = (req as any).user?.businessId;

      // Fallback to active session businessId if not specified in query
      businessId = businessId || userBusinessId;

      if (!businessId) {
        return res.status(400).json({ error: "Please select a business first." });
      }

      // Verify user has direct membership access to the requested business
      const member = await storage.getOrganisationMember(userId, businessId);
      if (!member) {
        return res.status(403).json({ error: "Unauthorized access to business data." });
      }

      const storeList = await storage.getStores(businessId);
      res.json(storeList);
    } catch (error) {
      console.error("GET /api/stores error:", error);
      res.status(500).json({ error: "We couldn't load your stores. Please try again." });
    }
  });

  app.get("/api/stores/:id", isAuthenticated, async (req, res) => {
    try {
      const store = await storage.getStore(req.params.id);
      if (!store) {
        return res.status(404).json({ error: "Store not found." });
      }

      const userId = (req as any).user?.userId || (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ error: "Please log in to access store details." });
      }

      // Verify user has access to the business the store belongs to
      const member = await storage.getOrganisationMember(userId, store.businessId);
      if (!member) {
        return res.status(403).json({ error: "Unauthorized access to store data." });
      }

      res.json(store);
    } catch (error) {
      console.error("GET /api/stores/:id error:", error);
      res.status(500).json({ error: "We couldn't load store information. Please try again." });
    }
  });

  app.post("/api/stores", requireRole("owner"), async (req, res) => {
    try {
      const userBusinessId = (req as any).user?.businessId;
      if (!userBusinessId) {
        return res.status(401).json({ error: "Authentication required." });
      }

      // Force the businessId to be the user's business ID
      req.body.businessId = userBusinessId;
      const data = insertStoreSchema.parse(req.body);

      // Check for duplicate name or code within the business
      const existingByName = await storage.getStoreByName(userBusinessId, data.name);
      if (existingByName) {
        return res.status(400).json({ error: `Store Creation Failed: A store named "${data.name}" already exists.` });
      }

      const existingByCode = await storage.getStoreByCode(userBusinessId, data.code);
      if (existingByCode) {
        return res.status(400).json({ error: `Store Creation Failed: A store with code "${data.code}" already exists.` });
      }

      const store = await storage.createStore(data);

      // Automatically add the owner to the staff list of their new store
      try {
        const user = (req as any).user;
        if (user && user.id) {
          const activeBusinessId = user.businessId;
          const business = activeBusinessId ? await storage.getBusinessById(activeBusinessId) : undefined;
          await storage.createStaff({
            storeId: store.id,
            userId: user.id,
            name: business?.name ? `${business.name} Owner` : "Business Owner",
            email: user.email || "owner@example.com",
            mobileNumber: user.phone || "0000000000",
            countryCode: "+234",
            role: "manager", // Best role mapping for the owner until an explicit 'owner' role is needed
            payPerMonth: 0,
            signedContract: true,
            staffNumber: "",
            paymentMethod: "hybrid"
          });
        }
      } catch (err) {
        console.error("Failed to auto-create owner staff record:", err);
      }

      res.status(201).json(store);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      res.status(500).json({ error: "We couldn't create the store. Please try again." });
    }
  });

  app.patch("/api/stores/:id", requireRole("owner"), async (req, res) => {
    try {
      const existingStore = await storage.getStore(req.params.id);
      if (!existingStore || existingStore.businessId !== (req as any).user?.businessId) {
        return res.status(403).json({ error: "Unauthorized access to store data." });
      }
      // Remove businessId to prevent cross-business reassignment
      const updateBody = { ...req.body };
      delete updateBody.businessId;

      const data = insertStoreSchema.partial().parse(updateBody);

      // If updating name, check for duplicate within the business
      if (data.name && data.name.toLowerCase() !== existingStore.name.toLowerCase()) {
        const existingByName = await storage.getStoreByName(existingStore.businessId, data.name);
        if (existingByName && existingByName.id !== existingStore.id) {
          return res.status(400).json({ error: `Store Update Failed: A store named "${data.name}" already exists.` });
        }
      }

      // If updating code, check for duplicate within the business
      if (data.code && data.code.trim().toUpperCase() !== existingStore.code.toUpperCase()) {
        const existingByCode = await storage.getStoreByCode(existingStore.businessId, data.code);
        if (existingByCode && existingByCode.id !== existingStore.id) {
          return res.status(400).json({ error: `Store Update Failed: A store with code "${data.code}" already exists.` });
        }
      }

      const updatedStore = await storage.updateStore(req.params.id, data);

      if (!updatedStore) {
        return res.status(404).json({ error: "Store not found." });
      }
      res.json(updatedStore);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      res.status(500).json({ error: "We couldn't update the store. Please try again." });
    }
  });

  app.delete("/api/stores/:id", requireRole("owner"), async (req, res) => {
    try {
      const store = await storage.getStore(req.params.id);
      if (!store) {
        return res.status(404).json({ error: "Store not found." });
      }
      if (store.businessId !== (req as any).user?.businessId) {
        return res.status(403).json({ error: "Unauthorized access to store data." });
      }

      const customerCount = await db.select({ count: count() }).from(customers).where(eq(customers.storeId, req.params.id));
      const inventoryCount = await db.select({ count: count() }).from(inventory).where(eq(inventory.storeId, req.params.id));
      
      const staffList = await storage.getStaffList(req.params.id);
      const nonOwnerStaff = staffList.filter(s => s.userId !== (req as any).user?.id && s.email !== (req as any).user?.email);

      if (customerCount[0].count > 0 || inventoryCount[0].count > 0 || nonOwnerStaff.length > 0) {
        return res.status(400).json({
          error: "This store has customers, staff, or inventory. Please remove them first before deleting the store."
        });
      }

      const deleted = await storage.deleteStore(req.params.id);
      if (!deleted) {
        return res.status(500).json({ error: "We couldn't delete the store. Please try again." });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "We couldn't delete the store. Please try again." });
    }
  });

  // ========== STORE INTEGRATIONS ==========
  app.get("/api/stores/:storeId/integrations", isAuthenticated, async (req, res) => {
    try {
      const store = await storage.getStore(req.params.storeId);
      if (!store) {
        return res.status(404).json({ error: "Store not found." });
      }
      if (store.businessId !== (req as any).user?.businessId) {
        return res.status(403).json({ error: "Unauthorized access to store integrations." });
      }

      const integrations = await storage.getStoreIntegrations(req.params.storeId);
      const masked = integrations.map(int => ({
        ...int,
        secretKey: int.secretKey ? "••••••••••••••••" : null,
        webhookSecret: int.webhookSecret ? "••••••••••••••••" : null,
      }));
      res.json(masked);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch store integrations." });
    }
  });

  app.post("/api/stores/:storeId/integrations", requireManagerOrOwner, async (req, res) => {
    try {
      const store = await storage.getStore(req.params.storeId);
      if (!store) {
        return res.status(404).json({ error: "Store not found." });
      }
      if (store.businessId !== (req as any).user?.businessId) {
        return res.status(403).json({ error: "Unauthorized access to store integrations." });
      }

      req.body.storeId = req.params.storeId;
      const data = insertStoreIntegrationSchema.parse(req.body);

      // Handle masked passwords: if the UI sent the masked bullet value "••••••••••••••••", keep the existing stored value
      if (data.secretKey === "••••••••••••••••" || data.webhookSecret === "••••••••••••••••") {
        const existing = await storage.getStoreIntegrationByProvider(req.params.storeId, data.provider);
        if (existing) {
          if (data.secretKey === "••••••••••••••••") {
            data.secretKey = existing.secretKey;
          }
          if (data.webhookSecret === "••••••••••••••••") {
            data.webhookSecret = existing.webhookSecret;
          }
        }
      }

      const integration = await storage.upsertStoreIntegration(data);
      res.status(201).json({
        ...integration,
        secretKey: integration.secretKey ? "••••••••••••••••" : null,
        webhookSecret: integration.webhookSecret ? "••••••••••••••••" : null,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      res.status(500).json({ error: "Failed to save integration settings." });
    }
  });
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
