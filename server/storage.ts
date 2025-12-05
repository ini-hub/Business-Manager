import {
  customers,
  staff,
  inventory,
  orders,
  checkouts,
  transactions,
  profitLoss,
  type Customer,
  type InsertCustomer,
  type Staff,
  type InsertStaff,
  type Inventory,
  type InsertInventory,
  type Order,
  type InsertOrder,
  type Checkout,
  type InsertCheckout,
  type Transaction,
  type InsertTransaction,
  type ProfitLoss,
  type InsertProfitLoss,
  type TransactionWithRelations,
  type ProfitLossWithInventory,
} from "@shared/schema";
import { db } from "./db";
import { eq, sql, desc, count } from "drizzle-orm";

export interface IStorage {
  // Customers
  getCustomers(): Promise<Customer[]>;
  getCustomer(id: string): Promise<Customer | undefined>;
  createCustomer(customer: InsertCustomer): Promise<Customer>;
  updateCustomer(id: string, customer: Partial<InsertCustomer>): Promise<Customer | undefined>;
  deleteCustomer(id: string): Promise<boolean>;
  hasCustomerTransactions(id: string): Promise<boolean>;

  // Staff
  getStaffList(): Promise<Staff[]>;
  getStaff(id: string): Promise<Staff | undefined>;
  createStaff(staffMember: InsertStaff): Promise<Staff>;
  updateStaff(id: string, staffMember: Partial<InsertStaff>): Promise<Staff | undefined>;
  deleteStaff(id: string): Promise<boolean>;
  hasStaffCheckouts(id: string): Promise<boolean>;

  // Inventory
  getInventory(): Promise<Inventory[]>;
  getInventoryItem(id: string): Promise<Inventory | undefined>;
  createInventoryItem(item: InsertInventory): Promise<Inventory>;
  updateInventoryItem(id: string, item: Partial<InsertInventory>): Promise<Inventory | undefined>;
  deleteInventoryItem(id: string): Promise<boolean>;
  hasInventoryTransactions(id: string): Promise<boolean>;

  // Orders
  createOrder(order: InsertOrder): Promise<Order>;

  // Checkouts
  createCheckout(checkout: InsertCheckout): Promise<Checkout>;

  // Transactions
  getTransactions(): Promise<TransactionWithRelations[]>;
  createTransaction(transaction: InsertTransaction): Promise<Transaction>;

  // Profit & Loss
  getProfitLoss(): Promise<ProfitLossWithInventory[]>;
  updateProfitLoss(inventoryId: string): Promise<void>;

  // Dashboard Stats
  getDashboardStats(): Promise<{
    totalCustomers: number;
    totalStaff: number;
    totalInventory: number;
    totalProducts: number;
    totalServices: number;
    totalTransactions: number;
    totalRevenue: number;
    totalProfit: number;
    lowStockItems: Inventory[];
  }>;

  // Chart Data
  getSalesTrends(): Promise<{ date: string; revenue: number; transactions: number }[]>;
  getRevenueByType(): Promise<{ name: string; value: number; type: string }[]>;
}

export class DatabaseStorage implements IStorage {
  // Customers
  async getCustomers(): Promise<Customer[]> {
    return await db.select().from(customers);
  }

  async getCustomer(id: string): Promise<Customer | undefined> {
    const [customer] = await db.select().from(customers).where(eq(customers.id, id));
    return customer;
  }

  async createCustomer(customer: InsertCustomer): Promise<Customer> {
    const [newCustomer] = await db.insert(customers).values(customer).returning();
    return newCustomer;
  }

  async updateCustomer(id: string, customerData: Partial<InsertCustomer>): Promise<Customer | undefined> {
    const [updated] = await db.update(customers).set(customerData).where(eq(customers.id, id)).returning();
    return updated;
  }

  async deleteCustomer(id: string): Promise<boolean> {
    const result = await db.delete(customers).where(eq(customers.id, id)).returning();
    return result.length > 0;
  }

  async hasCustomerTransactions(id: string): Promise<boolean> {
    const result = await db.select({ count: count() }).from(transactions).where(eq(transactions.customerId, id));
    return result[0].count > 0;
  }

  // Staff
  async getStaffList(): Promise<Staff[]> {
    return await db.select().from(staff);
  }

  async getStaff(id: string): Promise<Staff | undefined> {
    const [staffMember] = await db.select().from(staff).where(eq(staff.id, id));
    return staffMember;
  }

  async createStaff(staffMember: InsertStaff): Promise<Staff> {
    const [newStaff] = await db.insert(staff).values(staffMember).returning();
    return newStaff;
  }

  async updateStaff(id: string, staffData: Partial<InsertStaff>): Promise<Staff | undefined> {
    const [updated] = await db.update(staff).set(staffData).where(eq(staff.id, id)).returning();
    return updated;
  }

  async deleteStaff(id: string): Promise<boolean> {
    const result = await db.delete(staff).where(eq(staff.id, id)).returning();
    return result.length > 0;
  }

  async hasStaffCheckouts(id: string): Promise<boolean> {
    const result = await db.select({ count: count() }).from(checkouts).where(eq(checkouts.staffId, id));
    return result[0].count > 0;
  }

  // Inventory
  async getInventory(): Promise<Inventory[]> {
    return await db.select().from(inventory);
  }

  async getInventoryItem(id: string): Promise<Inventory | undefined> {
    const [item] = await db.select().from(inventory).where(eq(inventory.id, id));
    return item;
  }

  async createInventoryItem(item: InsertInventory): Promise<Inventory> {
    const [newItem] = await db.insert(inventory).values(item).returning();
    return newItem;
  }

  async updateInventoryItem(id: string, itemData: Partial<InsertInventory>): Promise<Inventory | undefined> {
    const [updated] = await db.update(inventory).set(itemData).where(eq(inventory.id, id)).returning();
    return updated;
  }

  async deleteInventoryItem(id: string): Promise<boolean> {
    const result = await db.delete(inventory).where(eq(inventory.id, id)).returning();
    return result.length > 0;
  }

  async hasInventoryTransactions(id: string): Promise<boolean> {
    const result = await db.select({ count: count() }).from(transactions).where(eq(transactions.inventoryId, id));
    return result[0].count > 0;
  }

  // Orders
  async createOrder(order: InsertOrder): Promise<Order> {
    const [newOrder] = await db.insert(orders).values(order).returning();
    return newOrder;
  }

  // Checkouts
  async createCheckout(checkout: InsertCheckout): Promise<Checkout> {
    const [newCheckout] = await db.insert(checkouts).values(checkout).returning();
    return newCheckout;
  }

  // Transactions
  async getTransactions(): Promise<TransactionWithRelations[]> {
    const txs = await db
      .select()
      .from(transactions)
      .orderBy(desc(transactions.transactionDate));

    const result: TransactionWithRelations[] = [];

    for (const tx of txs) {
      const [customer] = await db.select().from(customers).where(eq(customers.id, tx.customerId));
      const [inventoryItem] = await db.select().from(inventory).where(eq(inventory.id, tx.inventoryId));
      const [checkout] = await db.select().from(checkouts).where(eq(checkouts.id, tx.checkoutId));

      result.push({
        ...tx,
        customer,
        inventory: inventoryItem,
        checkout,
      });
    }

    return result;
  }

  async createTransaction(transaction: InsertTransaction): Promise<Transaction> {
    const [newTransaction] = await db.insert(transactions).values(transaction).returning();
    return newTransaction;
  }

  // Profit & Loss
  async getProfitLoss(): Promise<ProfitLossWithInventory[]> {
    const plRecords = await db.select().from(profitLoss);
    const result: ProfitLossWithInventory[] = [];

    for (const pl of plRecords) {
      const [inventoryItem] = await db.select().from(inventory).where(eq(inventory.id, pl.inventoryId));
      result.push({
        ...pl,
        inventory: inventoryItem,
      });
    }

    return result;
  }

  async updateProfitLoss(inventoryId: string): Promise<void> {
    const [inventoryItem] = await db.select().from(inventory).where(eq(inventory.id, inventoryId));
    if (!inventoryItem) return;

    // Get all orders for this inventory item
    const allOrders = await db.select().from(orders).where(eq(orders.inventoryId, inventoryId));

    const totalQuantitySold = allOrders.reduce((sum, order) => sum + order.quantity, 0);
    const totalRevenue = allOrders.reduce((sum, order) => sum + order.totalPrice, 0);
    const totalNetProfit = totalRevenue - (totalQuantitySold * inventoryItem.costPrice);
    const quantityRemaining = inventoryItem.type === "product"
      ? inventoryItem.quantity
      : 0;

    // Check if P&L record exists for this inventory
    const [existingPL] = await db.select().from(profitLoss).where(eq(profitLoss.inventoryId, inventoryId));

    if (existingPL) {
      await db.update(profitLoss)
        .set({
          totalQuantitySold,
          quantityRemaining,
          totalRevenue,
          totalNetProfit,
        })
        .where(eq(profitLoss.inventoryId, inventoryId));
    } else {
      await db.insert(profitLoss).values({
        inventoryId,
        totalQuantitySold,
        quantityRemaining,
        totalRevenue,
        totalNetProfit,
      });
    }
  }

  // Dashboard Stats
  async getDashboardStats() {
    const allCustomers = await db.select().from(customers);
    const allStaff = await db.select().from(staff);
    const allInventory = await db.select().from(inventory);
    const allTransactions = await db.select().from(transactions);
    const plData = await db.select().from(profitLoss);

    const products = allInventory.filter((i) => i.type === "product");
    const services = allInventory.filter((i) => i.type === "service");
    const lowStockItems = products.filter((p) => p.quantity <= 5);

    const totalRevenue = plData.reduce((sum, pl) => sum + pl.totalRevenue, 0);
    const totalProfit = plData.reduce((sum, pl) => sum + pl.totalNetProfit, 0);

    return {
      totalCustomers: allCustomers.length,
      totalStaff: allStaff.length,
      totalInventory: allInventory.length,
      totalProducts: products.length,
      totalServices: services.length,
      totalTransactions: allTransactions.length,
      totalRevenue,
      totalProfit,
      lowStockItems,
    };
  }

  // Chart Data - Sales Trends (last 30 days)
  async getSalesTrends(): Promise<{ date: string; revenue: number; transactions: number }[]> {
    const allTransactions = await db
      .select()
      .from(transactions)
      .orderBy(transactions.transactionDate);

    const allCheckouts = await db.select().from(checkouts);
    const checkoutMap = new Map(allCheckouts.map(c => [c.id, c]));

    const trendMap = new Map<string, { revenue: number; transactions: number }>();

    for (const tx of allTransactions) {
      const dateStr = new Date(tx.transactionDate).toISOString().split('T')[0];
      const checkout = checkoutMap.get(tx.checkoutId);
      const revenue = checkout?.totalPrice ?? 0;

      const existing = trendMap.get(dateStr) ?? { revenue: 0, transactions: 0 };
      trendMap.set(dateStr, {
        revenue: existing.revenue + revenue,
        transactions: existing.transactions + 1,
      });
    }

    const result = Array.from(trendMap.entries())
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const last30 = result.slice(-30);
    return last30;
  }

  // Chart Data - Revenue by Type (Product vs Service)
  async getRevenueByType(): Promise<{ name: string; value: number; type: string }[]> {
    const plData = await this.getProfitLoss();

    const result = plData.map(pl => ({
      name: pl.inventory?.name ?? "Unknown",
      value: pl.totalRevenue,
      type: pl.inventory?.type ?? "unknown",
    }));

    return result.sort((a, b) => b.value - a.value).slice(0, 10);
  }
}

export const storage = new DatabaseStorage();
