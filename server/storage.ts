import {
  businesses,
  stores,
  storeCounters,
  customers,
  staff,
  inventory,
  orders,
  checkouts,
  transactions,
  profitLoss,
  type Business,
  type InsertBusiness,
  type Store,
  type InsertStore,
  type StoreCounter,
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
import { eq, sql, desc, count, and } from "drizzle-orm";

export interface IStorage {
  // Business
  getBusiness(): Promise<Business | undefined>;
  createBusiness(business: InsertBusiness): Promise<Business>;
  updateBusiness(id: string, business: Partial<InsertBusiness>): Promise<Business | undefined>;

  // Stores
  getStores(businessId: string): Promise<Store[]>;
  getStore(id: string): Promise<Store | undefined>;
  createStore(store: InsertStore): Promise<Store>;
  updateStore(id: string, store: Partial<InsertStore>): Promise<Store | undefined>;
  deleteStore(id: string): Promise<boolean>;
  hasStoreData(id: string): Promise<boolean>;

  // Customer ID Generation
  generateCustomerNumber(storeId: string): Promise<string>;

  // Customers
  getCustomers(storeId: string, includeArchived?: boolean): Promise<Customer[]>;
  getCustomer(id: string): Promise<Customer | undefined>;
  createCustomer(customer: InsertCustomer): Promise<Customer>;
  updateCustomer(id: string, customer: Partial<InsertCustomer>): Promise<Customer | undefined>;
  deleteCustomer(id: string): Promise<boolean>;
  archiveCustomer(id: string): Promise<Customer | undefined>;
  restoreCustomer(id: string): Promise<Customer | undefined>;
  hasCustomerTransactions(id: string): Promise<boolean>;

  // Staff
  getStaffList(storeId: string, includeArchived?: boolean): Promise<Staff[]>;
  getStaff(id: string): Promise<Staff | undefined>;
  createStaff(staffMember: InsertStaff): Promise<Staff>;
  updateStaff(id: string, staffMember: Partial<InsertStaff>): Promise<Staff | undefined>;
  deleteStaff(id: string): Promise<boolean>;
  archiveStaff(id: string): Promise<Staff | undefined>;
  restoreStaff(id: string): Promise<Staff | undefined>;
  hasStaffCheckouts(id: string): Promise<boolean>;

  // Inventory
  getInventory(storeId: string): Promise<Inventory[]>;
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
  getTransactions(storeId: string): Promise<TransactionWithRelations[]>;
  createTransaction(transaction: InsertTransaction): Promise<Transaction>;

  // Profit & Loss
  getProfitLoss(storeId: string): Promise<ProfitLossWithInventory[]>;
  updateProfitLoss(inventoryId: string, storeId: string): Promise<void>;

  // Dashboard Stats
  getDashboardStats(storeId: string): Promise<{
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
  getSalesTrends(storeId: string): Promise<{ date: string; revenue: number; transactions: number }[]>;
  getRevenueByType(storeId: string): Promise<{ name: string; value: number; type: string }[]>;
}

export class DatabaseStorage implements IStorage {
  // Business
  async getBusiness(): Promise<Business | undefined> {
    const [business] = await db.select().from(businesses).limit(1);
    return business;
  }

  async createBusiness(business: InsertBusiness): Promise<Business> {
    const [newBusiness] = await db.insert(businesses).values(business).returning();
    return newBusiness;
  }

  async updateBusiness(id: string, businessData: Partial<InsertBusiness>): Promise<Business | undefined> {
    const [updated] = await db.update(businesses).set(businessData).where(eq(businesses.id, id)).returning();
    return updated;
  }

  // Stores
  async getStores(businessId: string): Promise<Store[]> {
    return await db.select().from(stores).where(eq(stores.businessId, businessId));
  }

  async getStore(id: string): Promise<Store | undefined> {
    const [store] = await db.select().from(stores).where(eq(stores.id, id));
    return store;
  }

  async createStore(store: InsertStore): Promise<Store> {
    const [newStore] = await db.insert(stores).values(store).returning();
    await db.insert(storeCounters).values({ storeId: newStore.id, nextCustomerNumber: 1 });
    return newStore;
  }

  async updateStore(id: string, storeData: Partial<InsertStore>): Promise<Store | undefined> {
    const [updated] = await db.update(stores).set(storeData).where(eq(stores.id, id)).returning();
    return updated;
  }

  async deleteStore(id: string): Promise<boolean> {
    await db.delete(storeCounters).where(eq(storeCounters.storeId, id));
    const result = await db.delete(stores).where(eq(stores.id, id)).returning();
    return result.length > 0;
  }

  async hasStoreData(id: string): Promise<boolean> {
    const customerCount = await db.select({ count: count() }).from(customers).where(eq(customers.storeId, id));
    const staffCount = await db.select({ count: count() }).from(staff).where(eq(staff.storeId, id));
    const inventoryCount = await db.select({ count: count() }).from(inventory).where(eq(inventory.storeId, id));
    return customerCount[0].count > 0 || staffCount[0].count > 0 || inventoryCount[0].count > 0;
  }

  // Customer ID Generation
  async generateCustomerNumber(storeId: string): Promise<string> {
    const store = await this.getStore(storeId);
    if (!store) throw new Error("Store not found");

    let [counter] = await db.select().from(storeCounters).where(eq(storeCounters.storeId, storeId));
    
    if (!counter) {
      [counter] = await db.insert(storeCounters).values({ storeId, nextCustomerNumber: 1 }).returning();
    }

    const customerNumber = `${store.code}${counter.nextCustomerNumber.toString().padStart(3, '0')}`;
    
    await db.update(storeCounters)
      .set({ nextCustomerNumber: counter.nextCustomerNumber + 1 })
      .where(eq(storeCounters.storeId, storeId));

    return customerNumber;
  }

  // Customers
  async getCustomers(storeId: string, includeArchived: boolean = true): Promise<Customer[]> {
    if (includeArchived) {
      return await db.select().from(customers).where(eq(customers.storeId, storeId));
    }
    return await db.select().from(customers).where(
      and(eq(customers.storeId, storeId), eq(customers.isArchived, false))
    );
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

  async archiveCustomer(id: string): Promise<Customer | undefined> {
    const [updated] = await db.update(customers).set({ isArchived: true }).where(eq(customers.id, id)).returning();
    return updated;
  }

  async restoreCustomer(id: string): Promise<Customer | undefined> {
    const [updated] = await db.update(customers).set({ isArchived: false }).where(eq(customers.id, id)).returning();
    return updated;
  }

  async hasCustomerTransactions(id: string): Promise<boolean> {
    const result = await db.select({ count: count() }).from(transactions).where(eq(transactions.customerId, id));
    return result[0].count > 0;
  }

  // Staff
  async getStaffList(storeId: string, includeArchived: boolean = true): Promise<Staff[]> {
    if (includeArchived) {
      return await db.select().from(staff).where(eq(staff.storeId, storeId));
    }
    return await db.select().from(staff).where(
      and(eq(staff.storeId, storeId), eq(staff.isArchived, false))
    );
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

  async archiveStaff(id: string): Promise<Staff | undefined> {
    const [updated] = await db.update(staff).set({ isArchived: true }).where(eq(staff.id, id)).returning();
    return updated;
  }

  async restoreStaff(id: string): Promise<Staff | undefined> {
    const [updated] = await db.update(staff).set({ isArchived: false }).where(eq(staff.id, id)).returning();
    return updated;
  }

  async hasStaffCheckouts(id: string): Promise<boolean> {
    const result = await db.select({ count: count() }).from(checkouts).where(eq(checkouts.staffId, id));
    return result[0].count > 0;
  }

  // Inventory
  async getInventory(storeId: string): Promise<Inventory[]> {
    return await db.select().from(inventory).where(eq(inventory.storeId, storeId));
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
  async getTransactions(storeId: string): Promise<TransactionWithRelations[]> {
    const txs = await db
      .select()
      .from(transactions)
      .where(eq(transactions.storeId, storeId))
      .orderBy(desc(transactions.transactionDate));

    const result: TransactionWithRelations[] = [];

    for (const tx of txs) {
      const [customer] = await db.select().from(customers).where(eq(customers.id, tx.customerId));
      const [inventoryItem] = await db.select().from(inventory).where(eq(inventory.id, tx.inventoryId));
      const [checkout] = await db.select().from(checkouts).where(eq(checkouts.id, tx.checkoutId));
      const [store] = await db.select().from(stores).where(eq(stores.id, tx.storeId));

      result.push({
        ...tx,
        customer,
        inventory: inventoryItem,
        checkout,
        store,
      });
    }

    return result;
  }

  async createTransaction(transaction: InsertTransaction): Promise<Transaction> {
    const [newTransaction] = await db.insert(transactions).values(transaction).returning();
    return newTransaction;
  }

  // Profit & Loss
  async getProfitLoss(storeId: string): Promise<ProfitLossWithInventory[]> {
    const plRecords = await db.select().from(profitLoss).where(eq(profitLoss.storeId, storeId));
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

  async updateProfitLoss(inventoryId: string, storeId: string): Promise<void> {
    const [inventoryItem] = await db.select().from(inventory).where(eq(inventory.id, inventoryId));
    if (!inventoryItem) return;

    const allOrders = await db.select().from(orders).where(
      and(eq(orders.inventoryId, inventoryId), eq(orders.storeId, storeId))
    );

    const totalQuantitySold = allOrders.reduce((sum, order) => sum + order.quantity, 0);
    const totalRevenue = allOrders.reduce((sum, order) => sum + order.totalPrice, 0);
    const totalNetProfit = totalRevenue - (totalQuantitySold * inventoryItem.costPrice);
    const quantityRemaining = inventoryItem.type === "product"
      ? inventoryItem.quantity
      : 0;

    const [existingPL] = await db.select().from(profitLoss).where(
      and(eq(profitLoss.inventoryId, inventoryId), eq(profitLoss.storeId, storeId))
    );

    if (existingPL) {
      await db.update(profitLoss)
        .set({
          totalQuantitySold,
          quantityRemaining,
          totalRevenue,
          totalNetProfit,
        })
        .where(and(eq(profitLoss.inventoryId, inventoryId), eq(profitLoss.storeId, storeId)));
    } else {
      await db.insert(profitLoss).values({
        storeId,
        inventoryId,
        totalQuantitySold,
        quantityRemaining,
        totalRevenue,
        totalNetProfit,
      });
    }
  }

  // Dashboard Stats
  async getDashboardStats(storeId: string) {
    const allCustomers = await db.select().from(customers).where(eq(customers.storeId, storeId));
    const allStaff = await db.select().from(staff).where(eq(staff.storeId, storeId));
    const allInventory = await db.select().from(inventory).where(eq(inventory.storeId, storeId));
    const allTransactions = await db.select().from(transactions).where(eq(transactions.storeId, storeId));
    const plData = await db.select().from(profitLoss).where(eq(profitLoss.storeId, storeId));

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
  async getSalesTrends(storeId: string): Promise<{ date: string; revenue: number; transactions: number }[]> {
    const allTransactions = await db
      .select()
      .from(transactions)
      .where(eq(transactions.storeId, storeId))
      .orderBy(transactions.transactionDate);

    const allCheckouts = await db.select().from(checkouts).where(eq(checkouts.storeId, storeId));
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
  async getRevenueByType(storeId: string): Promise<{ name: string; value: number; type: string }[]> {
    const plData = await this.getProfitLoss(storeId);

    const result = plData.map(pl => ({
      name: pl.inventory?.name ?? "Unknown",
      value: pl.totalRevenue,
      type: pl.inventory?.type ?? "unknown",
    }));

    return result.sort((a, b) => b.value - a.value).slice(0, 10);
  }
}

export const storage = new DatabaseStorage();
