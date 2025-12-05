import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import {
  insertCustomerSchema,
  insertStaffSchema,
  insertInventorySchema,
} from "@shared/schema";
import { z } from "zod";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // ========== CUSTOMERS ==========
  app.get("/api/customers", async (req, res) => {
    try {
      const customers = await storage.getCustomers();
      res.json(customers);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch customers" });
    }
  });

  app.get("/api/customers/:id", async (req, res) => {
    try {
      const customer = await storage.getCustomer(req.params.id);
      if (!customer) {
        return res.status(404).json({ error: "Customer not found" });
      }
      res.json(customer);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch customer" });
    }
  });

  app.post("/api/customers", async (req, res) => {
    try {
      const data = insertCustomerSchema.parse(req.body);
      const customer = await storage.createCustomer(data);
      res.status(201).json(customer);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create customer" });
    }
  });

  app.patch("/api/customers/:id", async (req, res) => {
    try {
      const data = insertCustomerSchema.partial().parse(req.body);
      const customer = await storage.updateCustomer(req.params.id, data);
      if (!customer) {
        return res.status(404).json({ error: "Customer not found" });
      }
      res.json(customer);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to update customer" });
    }
  });

  app.delete("/api/customers/:id", async (req, res) => {
    try {
      const customer = await storage.getCustomer(req.params.id);
      if (!customer) {
        return res.status(404).json({ error: "Customer not found" });
      }
      
      const hasTransactions = await storage.hasCustomerTransactions(req.params.id);
      if (hasTransactions) {
        return res.status(400).json({ 
          error: "Cannot delete customer with existing transactions. This customer has purchase history that must be preserved for your records." 
        });
      }
      
      const deleted = await storage.deleteCustomer(req.params.id);
      if (!deleted) {
        return res.status(500).json({ error: "Failed to delete customer" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete customer" });
    }
  });

  // ========== STAFF ==========
  app.get("/api/staff", async (req, res) => {
    try {
      const staffList = await storage.getStaffList();
      res.json(staffList);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch staff" });
    }
  });

  app.get("/api/staff/:id", async (req, res) => {
    try {
      const staffMember = await storage.getStaff(req.params.id);
      if (!staffMember) {
        return res.status(404).json({ error: "Staff member not found" });
      }
      res.json(staffMember);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch staff member" });
    }
  });

  app.post("/api/staff", async (req, res) => {
    try {
      const data = insertStaffSchema.parse(req.body);
      const staffMember = await storage.createStaff(data);
      res.status(201).json(staffMember);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create staff member" });
    }
  });

  app.patch("/api/staff/:id", async (req, res) => {
    try {
      const data = insertStaffSchema.partial().parse(req.body);
      const staffMember = await storage.updateStaff(req.params.id, data);
      if (!staffMember) {
        return res.status(404).json({ error: "Staff member not found" });
      }
      res.json(staffMember);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to update staff member" });
    }
  });

  app.delete("/api/staff/:id", async (req, res) => {
    try {
      const staffMember = await storage.getStaff(req.params.id);
      if (!staffMember) {
        return res.status(404).json({ error: "Staff member not found" });
      }
      
      const hasCheckouts = await storage.hasStaffCheckouts(req.params.id);
      if (hasCheckouts) {
        return res.status(400).json({ 
          error: "Cannot delete staff member with existing sales records. This staff member has processed sales that must be preserved for your records." 
        });
      }
      
      const deleted = await storage.deleteStaff(req.params.id);
      if (!deleted) {
        return res.status(500).json({ error: "Failed to delete staff member" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete staff member" });
    }
  });

  // ========== INVENTORY ==========
  app.get("/api/inventory", async (req, res) => {
    try {
      const items = await storage.getInventory();
      res.json(items);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch inventory" });
    }
  });

  app.get("/api/inventory/:id", async (req, res) => {
    try {
      const item = await storage.getInventoryItem(req.params.id);
      if (!item) {
        return res.status(404).json({ error: "Inventory item not found" });
      }
      res.json(item);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch inventory item" });
    }
  });

  app.post("/api/inventory", async (req, res) => {
    try {
      const data = insertInventorySchema.parse(req.body);
      const item = await storage.createInventoryItem(data);
      res.status(201).json(item);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create inventory item" });
    }
  });

  app.patch("/api/inventory/:id", async (req, res) => {
    try {
      const data = insertInventorySchema.partial().parse(req.body);
      const item = await storage.updateInventoryItem(req.params.id, data);
      if (!item) {
        return res.status(404).json({ error: "Inventory item not found" });
      }
      res.json(item);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to update inventory item" });
    }
  });

  app.delete("/api/inventory/:id", async (req, res) => {
    try {
      const item = await storage.getInventoryItem(req.params.id);
      if (!item) {
        return res.status(404).json({ error: "Inventory item not found" });
      }
      
      const hasTransactions = await storage.hasInventoryTransactions(req.params.id);
      if (hasTransactions) {
        return res.status(400).json({ 
          error: "Cannot delete inventory item with existing sales records. This item has sales history that must be preserved for your records." 
        });
      }
      
      const deleted = await storage.deleteInventoryItem(req.params.id);
      if (!deleted) {
        return res.status(500).json({ error: "Failed to delete inventory item" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete inventory item" });
    }
  });

  // ========== TRANSACTIONS ==========
  app.get("/api/transactions", async (req, res) => {
    try {
      const txs = await storage.getTransactions();
      res.json(txs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch transactions" });
    }
  });

  // ========== PROFIT & LOSS ==========
  app.get("/api/profit-loss", async (req, res) => {
    try {
      const plData = await storage.getProfitLoss();
      res.json(plData);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch profit/loss data" });
    }
  });

  // ========== DASHBOARD STATS ==========
  app.get("/api/dashboard/stats", async (req, res) => {
    try {
      const stats = await storage.getDashboardStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch dashboard stats" });
    }
  });

  // ========== CHART DATA ==========
  app.get("/api/charts/sales-trends", async (req, res) => {
    try {
      const data = await storage.getSalesTrends();
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch sales trends" });
    }
  });

  app.get("/api/charts/revenue-by-type", async (req, res) => {
    try {
      const data = await storage.getRevenueByType();
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch revenue by type" });
    }
  });

  // ========== SALES CHECKOUT ==========
  const checkoutSchema = z.object({
    customerId: z.string(),
    staffId: z.string(),
    items: z.array(
      z.object({
        inventoryId: z.string(),
        quantity: z.number().min(1),
      })
    ),
  });

  app.post("/api/sales/checkout", async (req, res) => {
    try {
      const data = checkoutSchema.parse(req.body);

      // Validate customer exists
      const customer = await storage.getCustomer(data.customerId);
      if (!customer) {
        return res.status(400).json({ error: "Customer not found" });
      }

      // Validate staff exists
      const staffMember = await storage.getStaff(data.staffId);
      if (!staffMember) {
        return res.status(400).json({ error: "Staff member not found" });
      }

      // Process each item
      for (const item of data.items) {
        const inventoryItem = await storage.getInventoryItem(item.inventoryId);
        if (!inventoryItem) {
          return res.status(400).json({ error: `Inventory item ${item.inventoryId} not found` });
        }

        // Check stock for products
        if (inventoryItem.type === "product" && inventoryItem.quantity < item.quantity) {
          return res.status(400).json({ 
            error: `Insufficient stock for ${inventoryItem.name}. Available: ${inventoryItem.quantity}` 
          });
        }

        // Calculate total price
        const totalPrice = inventoryItem.sellingPrice * item.quantity;

        // Create order
        const order = await storage.createOrder({
          inventoryId: item.inventoryId,
          quantity: item.quantity,
          totalPrice,
        });

        // Create checkout
        const checkout = await storage.createCheckout({
          staffId: data.staffId,
          orderId: order.id,
          totalPrice,
        });

        // Create transaction
        await storage.createTransaction({
          customerId: data.customerId,
          inventoryId: item.inventoryId,
          checkoutId: checkout.id,
        });

        // Update inventory quantity for products
        if (inventoryItem.type === "product") {
          await storage.updateInventoryItem(item.inventoryId, {
            quantity: inventoryItem.quantity - item.quantity,
          });
        }

        // Update profit/loss
        await storage.updateProfitLoss(item.inventoryId);
      }

      res.status(201).json({ success: true, message: "Sale completed successfully" });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Checkout error:", error);
      res.status(500).json({ error: "Failed to process checkout" });
    }
  });

  return httpServer;
}
