import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import rateLimit from "express-rate-limit";
import {
  insertBusinessSchema,
  insertStoreSchema,
  insertCustomerSchema,
  insertStaffSchema,
  insertInventorySchema,
} from "@shared/schema";
import { z } from "zod";
import { sanitizeString, sanitizeUUID } from "./sanitize";

// Rate limiting configuration for security
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: { error: "Too many requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 auth attempts per windowMs
  message: { error: "Too many login attempts, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

function formatZodErrors(errors: z.ZodIssue[]): string {
  const messages = errors.map((err) => {
    const field = err.path[0] || "field";
    const fieldName = String(field).charAt(0).toUpperCase() + String(field).slice(1).replace(/([A-Z])/g, " $1");
    return `${fieldName}: ${err.message}`;
  });
  return messages.join(". ");
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Apply rate limiting to all API routes
  app.use("/api/", apiLimiter);

  // Setup authentication
  await setupAuth(app);

  // Auth routes
  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });
  // ========== BUSINESS ==========
  app.get("/api/business", async (req, res) => {
    try {
      const business = await storage.getBusiness();
      res.json(business || null);
    } catch (error) {
      res.status(500).json({ error: "We couldn't load business information. Please try again." });
    }
  });

  app.post("/api/business", async (req, res) => {
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

  app.patch("/api/business/:id", async (req, res) => {
    try {
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
  app.get("/api/stores", async (req, res) => {
    try {
      const businessId = req.query.businessId as string;
      if (!businessId) {
        return res.status(400).json({ error: "Please select a business first." });
      }
      const storeList = await storage.getStores(businessId);
      res.json(storeList);
    } catch (error) {
      res.status(500).json({ error: "We couldn't load your stores. Please try again." });
    }
  });

  app.get("/api/stores/:id", async (req, res) => {
    try {
      const store = await storage.getStore(req.params.id);
      if (!store) {
        return res.status(404).json({ error: "Store not found." });
      }
      res.json(store);
    } catch (error) {
      res.status(500).json({ error: "We couldn't load store information. Please try again." });
    }
  });

  app.post("/api/stores", async (req, res) => {
    try {
      const data = insertStoreSchema.parse(req.body);
      const store = await storage.createStore(data);
      res.status(201).json(store);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      res.status(500).json({ error: "We couldn't create the store. Please try again." });
    }
  });

  app.patch("/api/stores/:id", async (req, res) => {
    try {
      const data = insertStoreSchema.partial().parse(req.body);
      const store = await storage.updateStore(req.params.id, data);
      if (!store) {
        return res.status(404).json({ error: "Store not found." });
      }
      res.json(store);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      res.status(500).json({ error: "We couldn't update the store. Please try again." });
    }
  });

  app.delete("/api/stores/:id", async (req, res) => {
    try {
      const store = await storage.getStore(req.params.id);
      if (!store) {
        return res.status(404).json({ error: "Store not found." });
      }
      
      const hasData = await storage.hasStoreData(req.params.id);
      if (hasData) {
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

  // ========== CUSTOMERS ==========
  app.get("/api/customers", async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) {
        return res.status(400).json({ error: "Please select a store first." });
      }
      
      // Support both paginated and non-paginated queries
      const page = parseInt(req.query.page as string) || 0;
      const limit = parseInt(req.query.limit as string) || 0;
      
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
      res.json(customer);
    } catch (error) {
      res.status(500).json({ error: "We couldn't load customer information. Please try again." });
    }
  });

  app.post("/api/customers", async (req, res) => {
    try {
      const data = insertCustomerSchema.parse(req.body);
      const customer = await storage.createCustomer(data);
      res.status(201).json(customer);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      res.status(500).json({ error: "We couldn't add this customer right now. Please try again." });
    }
  });

  app.patch("/api/customers/:id", async (req, res) => {
    try {
      const data = insertCustomerSchema.partial().parse(req.body);
      const customer = await storage.updateCustomer(req.params.id, data);
      if (!customer) {
        return res.status(404).json({ error: "This customer no longer exists. It may have been deleted." });
      }
      res.json(customer);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      res.status(500).json({ error: "We couldn't update this customer right now. Please try again." });
    }
  });

  app.delete("/api/customers/:id", async (req, res) => {
    try {
      const customer = await storage.getCustomer(req.params.id);
      if (!customer) {
        return res.status(404).json({ error: "Customer not found." });
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
  app.post("/api/customers/:id/restore", async (req, res) => {
    try {
      const customer = await storage.getCustomer(req.params.id);
      if (!customer) {
        return res.status(404).json({ error: "Customer not found." });
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
  app.delete("/api/customers/:id/permanent", async (req, res) => {
    try {
      const customer = await storage.getCustomer(req.params.id);
      if (!customer) {
        return res.status(404).json({ error: "Customer not found." });
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
  app.post("/api/customers/bulk", async (req, res) => {
    try {
      const { data, storeId } = req.body;
      if (!Array.isArray(data) || !storeId) {
        return res.status(400).json({ error: "Invalid data format or missing store." });
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

  // ========== STAFF ==========
  app.get("/api/staff", async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) {
        return res.status(400).json({ error: "Please select a store first." });
      }
      
      // Support both paginated and non-paginated queries
      const page = parseInt(req.query.page as string) || 0;
      const limit = parseInt(req.query.limit as string) || 0;
      
      if (page > 0 && limit > 0) {
        const search = req.query.search as string;
        const includeArchived = req.query.includeArchived === 'true';
        const result = await storage.getStaffPaginated(storeId, { page, limit, search, includeArchived });
        return res.json(result);
      }
      
      const staffList = await storage.getStaffList(storeId);
      res.json(staffList);
    } catch (error) {
      res.status(500).json({ error: "We couldn't load your staff members. Please try again." });
    }
  });

  app.get("/api/staff/:id", async (req, res) => {
    try {
      const staffMember = await storage.getStaff(req.params.id);
      if (!staffMember) {
        return res.status(404).json({ error: "Staff member not found." });
      }
      res.json(staffMember);
    } catch (error) {
      res.status(500).json({ error: "We couldn't load staff information. Please try again." });
    }
  });

  app.post("/api/staff", async (req, res) => {
    try {
      const data = insertStaffSchema.parse(req.body);
      const staffMember = await storage.createStaff(data);
      res.status(201).json(staffMember);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      res.status(500).json({ error: "We couldn't add this staff member right now. Please try again." });
    }
  });

  app.patch("/api/staff/:id", async (req, res) => {
    try {
      const data = insertStaffSchema.partial().parse(req.body);
      const staffMember = await storage.updateStaff(req.params.id, data);
      if (!staffMember) {
        return res.status(404).json({ error: "This staff member no longer exists. They may have been removed." });
      }
      res.json(staffMember);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      res.status(500).json({ error: "We couldn't update this staff member right now. Please try again." });
    }
  });

  app.delete("/api/staff/:id", async (req, res) => {
    try {
      const staffMember = await storage.getStaff(req.params.id);
      if (!staffMember) {
        return res.status(404).json({ error: "Staff member not found." });
      }
      
      // Archive instead of delete (soft delete)
      const archived = await storage.archiveStaff(req.params.id);
      if (!archived) {
        return res.status(500).json({ error: "We couldn't archive this staff member. Please try again." });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "We couldn't archive this staff member. Please try again." });
    }
  });

  // Restore archived staff
  app.post("/api/staff/:id/restore", async (req, res) => {
    try {
      const staffMember = await storage.getStaff(req.params.id);
      if (!staffMember) {
        return res.status(404).json({ error: "Staff member not found." });
      }
      
      const restored = await storage.restoreStaff(req.params.id);
      if (!restored) {
        return res.status(500).json({ error: "We couldn't restore this staff member. Please try again." });
      }
      res.json(restored);
    } catch (error) {
      res.status(500).json({ error: "We couldn't restore this staff member. Please try again." });
    }
  });

  // Permanently delete archived staff
  app.delete("/api/staff/:id/permanent", async (req, res) => {
    try {
      const staffMember = await storage.getStaff(req.params.id);
      if (!staffMember) {
        return res.status(404).json({ error: "Staff member not found." });
      }
      
      if (!staffMember.isArchived) {
        return res.status(400).json({ error: "Only archived staff can be permanently deleted." });
      }
      
      const hasCheckouts = await storage.hasStaffCheckouts(req.params.id);
      if (hasCheckouts) {
        return res.status(400).json({ 
          error: "Cannot permanently delete staff member with existing sales records. This staff member has processed sales that must be preserved for your records." 
        });
      }
      
      const deleted = await storage.deleteStaff(req.params.id);
      if (!deleted) {
        return res.status(500).json({ error: "We couldn't delete this staff member. Please try again." });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "We couldn't delete this staff member. Please try again." });
    }
  });

  // Bulk import staff
  app.post("/api/staff/bulk", async (req, res) => {
    try {
      const { data, storeId } = req.body;
      if (!Array.isArray(data) || !storeId) {
        return res.status(400).json({ error: "Invalid data format or missing store." });
      }

      const result = { success: 0, failed: 0, errors: [] as { row: number; message: string }[] };

      for (let i = 0; i < data.length; i++) {
        try {
          const row = data[i];
          const parsed = insertStaffSchema.parse({
            storeId,
            name: row.name,
            staffNumber: row.staffNumber,
            mobileNumber: row.mobileNumber,
            payPerMonth: parseFloat(row.payPerMonth) || 0,
            signedContract: row.signedContract === "true" || row.signedContract === true,
          });
          await storage.createStaff(parsed);
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
      res.status(500).json({ error: "We couldn't import your staff. Please try again." });
    }
  });

  // ========== INVENTORY ==========
  app.get("/api/inventory", async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) {
        return res.status(400).json({ error: "Please select a store first." });
      }
      
      // Support both paginated and non-paginated queries
      const page = parseInt(req.query.page as string) || 0;
      const limit = parseInt(req.query.limit as string) || 0;
      
      if (page > 0 && limit > 0) {
        const search = req.query.search as string;
        const result = await storage.getInventoryPaginated(storeId, { page, limit, search });
        return res.json(result);
      }
      
      const items = await storage.getInventory(storeId);
      res.json(items);
    } catch (error) {
      res.status(500).json({ error: "We couldn't load your inventory. Please try again." });
    }
  });

  app.get("/api/inventory/:id", async (req, res) => {
    try {
      const item = await storage.getInventoryItem(req.params.id);
      if (!item) {
        return res.status(404).json({ error: "Inventory item not found." });
      }
      res.json(item);
    } catch (error) {
      res.status(500).json({ error: "We couldn't load item information. Please try again." });
    }
  });

  app.post("/api/inventory", async (req, res) => {
    try {
      const data = insertInventorySchema.parse(req.body);
      const item = await storage.createInventoryItem(data);
      res.status(201).json(item);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      res.status(500).json({ error: "We couldn't add this item right now. Please try again." });
    }
  });

  app.patch("/api/inventory/:id", async (req, res) => {
    try {
      const data = insertInventorySchema.partial().parse(req.body);
      const item = await storage.updateInventoryItem(req.params.id, data);
      if (!item) {
        return res.status(404).json({ error: "This item no longer exists. It may have been deleted." });
      }
      res.json(item);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      res.status(500).json({ error: "We couldn't update this item right now. Please try again." });
    }
  });

  app.delete("/api/inventory/:id", async (req, res) => {
    try {
      const item = await storage.getInventoryItem(req.params.id);
      if (!item) {
        return res.status(404).json({ error: "Inventory item not found." });
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
  app.post("/api/inventory/bulk", async (req, res) => {
    try {
      const { data, storeId } = req.body;
      if (!Array.isArray(data) || !storeId) {
        return res.status(400).json({ error: "Invalid data format or missing store." });
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

  // ========== TRANSACTIONS ==========
  app.get("/api/transactions", async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) {
        return res.status(400).json({ error: "Please select a store first." });
      }
      
      // Support both paginated and non-paginated queries
      const page = parseInt(req.query.page as string) || 0;
      const limit = parseInt(req.query.limit as string) || 0;
      
      if (page > 0 && limit > 0) {
        const search = req.query.search as string;
        const result = await storage.getTransactionsPaginated(storeId, { page, limit, search });
        return res.json(result);
      }
      
      const txs = await storage.getTransactions(storeId);
      res.json(txs);
    } catch (error) {
      res.status(500).json({ error: "We couldn't load your transactions. Please try again." });
    }
  });

  app.get("/api/customers/:id/transactions", async (req, res) => {
    try {
      const txs = await storage.getTransactionsByCustomer(req.params.id);
      res.json(txs);
    } catch (error) {
      res.status(500).json({ error: "We couldn't load customer transactions. Please try again." });
    }
  });

  // ========== PROFIT & LOSS ==========
  app.get("/api/profit-loss", async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) {
        return res.status(400).json({ error: "Please select a store first." });
      }
      const plData = await storage.getProfitLoss(storeId);
      res.json(plData);
    } catch (error) {
      res.status(500).json({ error: "We couldn't load profit/loss data. Please try again." });
    }
  });

  // ========== DASHBOARD STATS ==========
  app.get("/api/dashboard/stats", async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) {
        return res.status(400).json({ error: "Please select a store first." });
      }
      const stats = await storage.getDashboardStats(storeId);
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "We couldn't load dashboard statistics. Please try again." });
    }
  });

  // ========== CHART DATA ==========
  app.get("/api/charts/sales-trends", async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) {
        return res.status(400).json({ error: "Please select a store first." });
      }
      const data = await storage.getSalesTrends(storeId);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "We couldn't load sales trends. Please try again." });
    }
  });

  app.get("/api/charts/revenue-by-type", async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) {
        return res.status(400).json({ error: "Please select a store first." });
      }
      const data = await storage.getRevenueByType(storeId);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "We couldn't load revenue data. Please try again." });
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
        quantity: z.number().min(1),
        customPrice: z.number().min(0).optional(),
      })
    ),
    paymentMethod: z.enum(["cash", "transfer", "flutterwave"]).default("cash"),
  });

  app.post("/api/sales/checkout", async (req, res) => {
    try {
      const data = checkoutSchema.parse(req.body);

      // Use transactional checkout for atomicity (all-or-nothing)
      const result = await storage.processCheckout({
        storeId: data.storeId,
        customerId: data.customerId,
        staffId: data.staffId,
        items: data.items,
        paymentMethod: data.paymentMethod,
      });

      if (!result.success) {
        return res.status(400).json({ error: result.message });
      }

      res.status(201).json({ 
        success: true, 
        message: result.message,
        checkoutIds: result.checkoutIds 
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      console.error("Checkout error:", error);
      res.status(500).json({ error: "We couldn't complete this sale right now. Please try again." });
    }
  });

  // ========== FLUTTERWAVE PAYMENT LINK ==========
  const paymentLinkSchema = z.object({
    amount: z.number().positive(),
    currency: z.string().default("NGN"),
    customerName: z.string(),
    customerEmail: z.string().email(),
    customerPhone: z.string().optional(),
    description: z.string(),
    redirectUrl: z.string().url().optional(),
  });

  app.post("/api/payments/flutterwave/link", async (req, res) => {
    try {
      const data = paymentLinkSchema.parse(req.body);
      
      const flutterwaveSecretKey = process.env.FLUTTERWAVE_SECRET_KEY;
      if (!flutterwaveSecretKey) {
        return res.status(500).json({ 
          error: "Flutterwave is not configured. Please add your Flutterwave secret key in settings." 
        });
      }

      const txRef = `tx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      const response = await fetch("https://api.flutterwave.com/v3/payments", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${flutterwaveSecretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tx_ref: txRef,
          amount: data.amount,
          currency: data.currency,
          redirect_url: data.redirectUrl || `${req.protocol}://${req.get('host')}/payment-complete`,
          customer: {
            email: data.customerEmail,
            name: data.customerName,
            phonenumber: data.customerPhone,
          },
          customizations: {
            title: "Business Payment",
            description: data.description,
          },
        }),
      });

      const result = await response.json();
      
      if (result.status === "success") {
        res.json({ 
          success: true, 
          paymentLink: result.data.link,
          txRef,
        });
      } else {
        res.status(400).json({ 
          error: result.message || "Failed to generate payment link" 
        });
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      console.error("Flutterwave error:", error);
      res.status(500).json({ error: "Failed to generate payment link. Please try again." });
    }
  });

  // Flutterwave webhook for payment verification
  app.post("/api/payments/flutterwave/webhook", async (req, res) => {
    try {
      const secretHash = process.env.FLUTTERWAVE_SECRET_HASH;
      const signature = req.headers["verif-hash"];
      
      if (!secretHash || signature !== secretHash) {
        return res.status(401).json({ error: "Invalid signature" });
      }

      const { event, data } = req.body;
      
      if (event === "charge.completed" && data.status === "successful") {
        // Update checkout payment status based on tx_ref if needed
        console.log("Payment successful:", data.tx_ref);
      }
      
      res.status(200).json({ received: true });
    } catch (error) {
      console.error("Webhook error:", error);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  });

  return httpServer;
}
