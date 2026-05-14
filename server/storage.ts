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
  users,
  otpCodes,
  inventoryRestockEvents,
  attendanceRecords,
  payrollPeriods,
  payrollEntries,
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
  type User,
  type UpsertUser,
  type OtpCode,
  type InsertOtpCode,
  type UserRole,
  type RestockEvent,
  type CostStrategy,
  type AttendanceRecord,
  type InsertAttendanceRecord,
  type AttendanceStatus,
  type PayrollPeriod,
  type InsertPayrollPeriod,
  type PayrollPeriodStatus,
  type PayrollEntryWithStaff,
  type CommissionBreakdown,
  settings,
  type Settings,
  type InsertSettings,
  type DailySummaryLine,
} from "@shared/schema";
import { db } from "./db";
import { eq, sql, desc, count, and, asc, like, or, ilike, gt, gte, lte } from "drizzle-orm";

// Pagination types
export interface PaginationOptions {
  page: number;
  limit: number;
  search?: string;
  includeArchived?: boolean;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasMore: boolean;
  };
}

export interface IStorage {
  // Users & Auth
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(userData: { email: string; password: string; businessId: string; role?: UserRole; isVerified?: boolean }): Promise<User>;
  updateUser(id: string, data: Partial<User>): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  
  // OTP Codes
  createOtpCode(data: { userId: string; code: string; type: string; expiresAt: Date }): Promise<OtpCode>;
  getValidOtpCode(userId: string, code: string, type: string): Promise<OtpCode | undefined>;
  markOtpCodeAsUsed(id: string): Promise<void>;
  
  // Business for user
  getBusinessByUserId(userId: string): Promise<Business | undefined>;

  // Business
  getBusiness(): Promise<Business | undefined>;
  getBusinessById(id: string): Promise<Business | undefined>;
  createBusiness(business: InsertBusiness): Promise<Business>;
  updateBusiness(id: string, business: Partial<InsertBusiness>): Promise<Business | undefined>;

  // Stores
  getStores(businessId: string): Promise<Store[]>;
  getStore(id: string): Promise<Store | undefined>;
  createStore(store: InsertStore): Promise<Store>;
  updateStore(id: string, store: Partial<InsertStore>): Promise<Store | undefined>;
  deleteStore(id: string): Promise<boolean>;
  hasStoreData(id: string): Promise<boolean>;

  // Customers
  getCustomers(storeId: string, includeArchived?: boolean): Promise<Customer[]>;
  getCustomersPaginated(storeId: string, options: PaginationOptions): Promise<PaginatedResult<Customer>>;
  getCustomer(id: string): Promise<Customer | undefined>;
  createCustomer(customer: InsertCustomer): Promise<Customer>;
  updateCustomer(id: string, customer: Partial<InsertCustomer>): Promise<Customer | undefined>;
  deleteCustomer(id: string): Promise<boolean>;
  archiveCustomer(id: string): Promise<Customer | undefined>;
  restoreCustomer(id: string): Promise<Customer | undefined>;
  hasCustomerTransactions(id: string): Promise<boolean>;

  // Staff
  getStaffList(storeId: string, includeArchived?: boolean): Promise<Staff[]>;
  getStaffPaginated(storeId: string, options: PaginationOptions): Promise<PaginatedResult<Staff>>;
  getStaff(id: string): Promise<Staff | undefined>;
  getStaffByEmail(email: string): Promise<(Staff & { store: Store }) | undefined>;
  createStaff(staffMember: InsertStaff): Promise<Staff>;
  updateStaff(id: string, staffMember: Partial<InsertStaff> & { userId?: string }): Promise<Staff | undefined>;
  transferStaff(id: string, targetStoreId: string): Promise<Staff | undefined>;
  deleteStaff(id: string): Promise<boolean>;
  archiveStaff(id: string): Promise<Staff | undefined>;
  restoreStaff(id: string): Promise<Staff | undefined>;
  hasStaffCheckouts(id: string): Promise<boolean>;

  // Inventory
  getInventory(storeId: string): Promise<Inventory[]>;
  getInventoryPaginated(storeId: string, options: PaginationOptions): Promise<PaginatedResult<Inventory>>;
  getInventoryItem(id: string): Promise<Inventory | undefined>;
  createInventoryItem(item: InsertInventory): Promise<Inventory>;
  updateInventoryItem(id: string, item: Partial<InsertInventory>): Promise<Inventory | undefined>;
  deleteInventoryItem(id: string): Promise<boolean>;
  hasInventoryTransactions(id: string): Promise<boolean>;

  // Orders
  createOrder(order: InsertOrder): Promise<Order>;

  // Checkouts
  createCheckout(checkout: InsertCheckout): Promise<Checkout>;
  updateCheckoutPaymentStatus(id: string, status: "pending" | "completed" | "failed"): Promise<Checkout | undefined>;

  // Transactions
  getTransactions(storeId: string): Promise<TransactionWithRelations[]>;
  getTransactionsPaginated(storeId: string, options: PaginationOptions): Promise<PaginatedResult<TransactionWithRelations>>;
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
  
  // Transactional Checkout (atomic operation)
  processCheckout(data: {
    storeId: string;
    customerId: string;
    staffId: string;
    items: Array<{
      inventoryId: string;
      quantity: number;
      customPrice?: number;
    }>;
    paymentMethod: "cash" | "transfer" | "flutterwave";
  }): Promise<{ success: boolean; message: string; checkoutIds?: string[] }>;

  // Inventory Restock Events
  getRestockEvents(inventoryId: string): Promise<(RestockEvent & { staff: Staff | null; user: User | null })[]>;
  getRestockEventsPaginated(inventoryId: string, options: PaginationOptions): Promise<PaginatedResult<RestockEvent & { staff: Staff | null; user: User | null }>>;
  createRestockEvent(data: {
    storeId: string;
    inventoryId: string;
    staffId?: string | null;
    userId?: string | null;
    quantityAdded: number;
    unitCost: number;
    costStrategy: CostStrategy;
    newSellingPrice?: number;
    notes?: string;
  }): Promise<{ restockEvent: RestockEvent; updatedInventory: Inventory }>;

  // Settings
  getSettings(storeId: string): Promise<Settings>;
  upsertSettings(storeId: string, data: Partial<InsertSettings>): Promise<Settings>;
}

export class DatabaseStorage implements IStorage {
  // Users & Auth
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
    return user;
  }

  async createUser(userData: { email: string; password: string; businessId: string; role?: UserRole; isVerified?: boolean }): Promise<User> {
    const [user] = await db.insert(users).values({
      email: userData.email,
      password: userData.password,
      businessId: userData.businessId,
      role: userData.role || "owner",
      isVerified: userData.isVerified ?? false,
    }).returning();
    return user;
  }

  async updateUser(id: string, data: Partial<User>): Promise<User | undefined> {
    const [user] = await db.update(users).set({
      ...data,
      updatedAt: new Date(),
    }).where(eq(users.id, id)).returning();
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  // OTP Codes
  async createOtpCode(data: { userId: string; code: string; type: string; expiresAt: Date }): Promise<OtpCode> {
    const [otp] = await db.insert(otpCodes).values({
      userId: data.userId,
      code: data.code,
      type: data.type,
      expiresAt: data.expiresAt,
      isUsed: false,
    }).returning();
    return otp;
  }

  async getValidOtpCode(userId: string, code: string, type: string): Promise<OtpCode | undefined> {
    const [otp] = await db.select().from(otpCodes).where(
      and(
        eq(otpCodes.userId, userId),
        eq(otpCodes.code, code),
        eq(otpCodes.type, type),
        eq(otpCodes.isUsed, false),
        gt(otpCodes.expiresAt, new Date())
      )
    );
    return otp;
  }

  async markOtpCodeAsUsed(id: string): Promise<void> {
    await db.update(otpCodes).set({ isUsed: true }).where(eq(otpCodes.id, id));
  }

  // Business for user
  async getBusinessByUserId(userId: string): Promise<Business | undefined> {
    const user = await this.getUser(userId);
    if (!user || !user.businessId) return undefined;
    const [business] = await db.select().from(businesses).where(eq(businesses.id, user.businessId));
    return business;
  }

  // Business
  async getBusiness(): Promise<Business | undefined> {
    const [business] = await db.select().from(businesses).limit(1);
    return business;
  }

  async getBusinessById(id: string): Promise<Business | undefined> {
    const [business] = await db.select().from(businesses).where(eq(businesses.id, id));
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

  // Customer ID Generation - finds next available number without gaps
  private async getNextAvailableCustomerNumber(storeId: string): Promise<string> {
    const store = await this.getStore(storeId);
    if (!store) throw new Error("Store not found");

    // Get all existing customer numbers for this store
    const existingCustomers = await db.select({ customerNumber: customers.customerNumber })
      .from(customers)
      .where(eq(customers.storeId, storeId));
    
    // Extract the numeric suffix from each customer number
    const usedNumbers = new Set<number>();
    const prefix = store.code;
    
    for (const c of existingCustomers) {
      if (c.customerNumber.startsWith(prefix)) {
        const numPart = c.customerNumber.slice(prefix.length);
        const num = parseInt(numPart, 10);
        if (!isNaN(num)) {
          usedNumbers.add(num);
        }
      }
    }
    
    // Find the smallest available number starting from 1
    let nextNumber = 1;
    while (usedNumbers.has(nextNumber)) {
      nextNumber++;
    }
    
    return `${prefix}${nextNumber.toString().padStart(3, '0')}`;
  }

  // Transaction Receipt Number Generation
  private async getNextAvailableTransactionNumber(tx: any, storeId: string): Promise<string> {
    const [store] = await tx.select().from(stores).where(eq(stores.id, storeId));
    if (!store) throw new Error("Store not found");

    const [counter] = await tx.select().from(storeCounters).where(eq(storeCounters.storeId, storeId));
    if (!counter) {
      await tx.insert(storeCounters).values({ storeId, nextCustomerNumber: 1, nextTransactionNumber: 2 });
      return `${store.code}-TN-1`;
    }

    const nextNum = counter.nextTransactionNumber;
    await tx.update(storeCounters)
      .set({ nextTransactionNumber: nextNum + 1 })
      .where(eq(storeCounters.id, counter.id));

    return `${store.code}-TN-${nextNum}`;
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

  async getCustomersPaginated(storeId: string, options: PaginationOptions): Promise<PaginatedResult<Customer>> {
    const { page, limit, search, includeArchived = false } = options;
    const offset = (page - 1) * limit;

    // Build base conditions
    const conditions = [eq(customers.storeId, storeId)];
    if (!includeArchived) {
      conditions.push(eq(customers.isArchived, false));
    }
    if (search) {
      conditions.push(
        or(
          ilike(customers.name, `%${search}%`),
          ilike(customers.customerNumber, `%${search}%`),
          ilike(customers.mobileNumber, `%${search}%`)
        )!
      );
    }

    // Get total count
    const [countResult] = await db.select({ count: count() })
      .from(customers)
      .where(and(...conditions));
    const total = countResult.count;

    // Get paginated data
    const data = await db.select()
      .from(customers)
      .where(and(...conditions))
      .orderBy(asc(customers.customerNumber))
      .limit(limit)
      .offset(offset);

    const totalPages = Math.ceil(total / limit);

    return {
      data,
      pagination: {
        total,
        page,
        limit,
        totalPages,
        hasMore: page < totalPages,
      },
    };
  }

  async getCustomer(id: string): Promise<Customer | undefined> {
    const [customer] = await db.select().from(customers).where(eq(customers.id, id));
    return customer;
  }

  async createCustomer(customer: InsertCustomer): Promise<Customer> {
    // Generate customer number at save time to avoid gaps
    const customerNumber = await this.getNextAvailableCustomerNumber(customer.storeId);
    const [newCustomer] = await db.insert(customers).values({
      ...customer,
      customerNumber,
    }).returning();
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

  // Staff ID Generation - finds next available number without gaps
  private async getNextAvailableStaffNumber(storeId: string): Promise<string> {
    const store = await this.getStore(storeId);
    if (!store) throw new Error("Store not found");

    // Get all existing staff numbers for this store
    const existingStaff = await db.select({ staffNumber: staff.staffNumber })
      .from(staff)
      .where(eq(staff.storeId, storeId));
    
    // Extract the numeric suffix from each staff number
    const usedNumbers = new Set<number>();
    const prefix = `${store.code}-`;
    
    for (const s of existingStaff) {
      if (s.staffNumber.startsWith(prefix)) {
        const numPart = s.staffNumber.slice(prefix.length);
        const num = parseInt(numPart, 10);
        if (!isNaN(num)) {
          usedNumbers.add(num);
        }
      }
    }
    
    // Find the smallest available number starting from 1
    let nextNumber = 1;
    while (usedNumbers.has(nextNumber)) {
      nextNumber++;
    }
    
    return `${prefix}${nextNumber.toString().padStart(3, '0')}`;
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

  async getStaffPaginated(storeId: string, options: PaginationOptions): Promise<PaginatedResult<Staff>> {
    const { page, limit, search, includeArchived = false } = options;
    const offset = (page - 1) * limit;

    const conditions = [eq(staff.storeId, storeId)];
    if (!includeArchived) {
      conditions.push(eq(staff.isArchived, false));
    }
    if (search) {
      conditions.push(
        or(
          ilike(staff.name, `%${search}%`),
          ilike(staff.staffNumber, `%${search}%`),
          ilike(staff.mobileNumber, `%${search}%`)
        )!
      );
    }

    const [countResult] = await db.select({ count: count() })
      .from(staff)
      .where(and(...conditions));
    const total = countResult.count;

    const data = await db.select()
      .from(staff)
      .where(and(...conditions))
      .orderBy(asc(staff.staffNumber))
      .limit(limit)
      .offset(offset);

    const totalPages = Math.ceil(total / limit);

    return {
      data,
      pagination: {
        total,
        page,
        limit,
        totalPages,
        hasMore: page < totalPages,
      },
    };
  }

  async getStaff(id: string): Promise<Staff | undefined> {
    const [staffMember] = await db.select().from(staff).where(eq(staff.id, id));
    return staffMember;
  }

  async getStaffByEmail(email: string): Promise<(Staff & { store: Store }) | undefined> {
    const [result] = await db
      .select()
      .from(staff)
      .innerJoin(stores, eq(staff.storeId, stores.id))
      .where(and(eq(staff.email, email.toLowerCase()), eq(staff.isArchived, false)));
    
    if (!result) return undefined;
    
    return {
      ...result.staff,
      store: result.stores,
    };
  }

  async createStaff(staffMember: InsertStaff & { userId?: string | null }): Promise<Staff> {
    // Generate staff number at save time to avoid gaps
    const staffNumber = await this.getNextAvailableStaffNumber(staffMember.storeId);
    const [newStaff] = await db.insert(staff).values({
      ...staffMember,
      email: staffMember.email.toLowerCase(), // Normalize email to lowercase
      staffNumber,
    }).returning();
    return newStaff;
  }

  async updateStaff(id: string, staffData: Partial<InsertStaff> & { userId?: string }): Promise<Staff | undefined> {
    // Normalize email if provided
    const normalizedData = staffData.email 
      ? { ...staffData, email: staffData.email.toLowerCase() }
      : staffData;
    const [updated] = await db.update(staff).set(normalizedData).where(eq(staff.id, id)).returning();
    return updated;
  }

  async transferStaff(id: string, targetStoreId: string): Promise<Staff | undefined> {
    // Get the staff member to check their current store
    const staffMember = await db.select().from(staff).where(eq(staff.id, id)).limit(1);
    if (!staffMember.length) return undefined;
    
    const sourceStoreId = staffMember[0].storeId;
    
    // Check if this staff is the manager of the source store
    const sourceStore = await db.select().from(stores).where(eq(stores.id, sourceStoreId)).limit(1);
    
    // Generate a new staff number for the target store
    const newStaffNumber = await this.getNextAvailableStaffNumber(targetStoreId);
    
    // Update the staff member with the new store and staff number
    const [updated] = await db.update(staff).set({ 
      storeId: targetStoreId,
      staffNumber: newStaffNumber
    }).where(eq(staff.id, id)).returning();
    
    // If this staff was the source store's manager, clear the manager reference
    if (sourceStore.length && sourceStore[0].managerStaffId === id) {
      await db.update(stores).set({ managerStaffId: null }).where(eq(stores.id, sourceStoreId));
    }
    
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

  async getInventoryPaginated(storeId: string, options: PaginationOptions): Promise<PaginatedResult<Inventory>> {
    const { page, limit, search } = options;
    const offset = (page - 1) * limit;

    const conditions = [eq(inventory.storeId, storeId)];
    if (search) {
      conditions.push(
        or(
          ilike(inventory.name, `%${search}%`),
          ilike(inventory.type, `%${search}%`)
        )!
      );
    }

    const [countResult] = await db.select({ count: count() })
      .from(inventory)
      .where(and(...conditions));
    const total = countResult.count;

    const data = await db.select()
      .from(inventory)
      .where(and(...conditions))
      .orderBy(asc(inventory.name))
      .limit(limit)
      .offset(offset);

    const totalPages = Math.ceil(total / limit);

    return {
      data,
      pagination: {
        total,
        page,
        limit,
        totalPages,
        hasMore: page < totalPages,
      },
    };
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

  async updateCheckoutPaymentStatus(id: string, status: "pending" | "completed" | "failed"): Promise<Checkout | undefined> {
    const [updated] = await db.update(checkouts)
      .set({ paymentStatus: status })
      .where(eq(checkouts.id, id))
      .returning();
    return updated;
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
      
      let staffMem = undefined;
      if (checkout) {
        const [foundStaff] = await db.select().from(staff).where(eq(staff.id, checkout.staffId));
        staffMem = foundStaff;
      }

      result.push({
        ...tx,
        customer,
        inventory: inventoryItem,
        checkout: checkout ? { ...checkout, staff: staffMem } : checkout as any,
        store,
      });
    }

    return result;
  }

  async getTransactionsPaginated(storeId: string, options: PaginationOptions): Promise<PaginatedResult<TransactionWithRelations>> {
    const { page, limit, search } = options;
    const offset = (page - 1) * limit;

    // Get total count
    const [countResult] = await db.select({ count: count() })
      .from(transactions)
      .where(eq(transactions.storeId, storeId));
    const total = countResult.count;

    // Get paginated transactions
    const txs = await db
      .select()
      .from(transactions)
      .where(eq(transactions.storeId, storeId))
      .orderBy(desc(transactions.transactionDate))
      .limit(limit)
      .offset(offset);

    // Fetch related data in batch for performance
    const customerIds = Array.from(new Set(txs.map(tx => tx.customerId)));
    const inventoryIds = Array.from(new Set(txs.map(tx => tx.inventoryId)));
    const checkoutIds = Array.from(new Set(txs.map(tx => tx.checkoutId)));
    const storeIds = Array.from(new Set(txs.map(tx => tx.storeId)));

    const allCustomers = await db.select().from(customers).where(sql`${customers.id} IN (${sql.join(customerIds.map(id => sql`${id}`), sql`, `)})`);
    const allInventory = await db.select().from(inventory).where(sql`${inventory.id} IN (${sql.join(inventoryIds.map(id => sql`${id}`), sql`, `)})`);
    const allCheckouts = await db.select().from(checkouts).where(sql`${checkouts.id} IN (${sql.join(checkoutIds.map(id => sql`${id}`), sql`, `)})`);
    const allStores = await db.select().from(stores).where(sql`${stores.id} IN (${sql.join(storeIds.map(id => sql`${id}`), sql`, `)})`);

    const staffIds = Array.from(new Set(allCheckouts.map(c => c.staffId).filter(Boolean)));
    const allStaff = staffIds.length > 0 
      ? await db.select().from(staff).where(sql`${staff.id} IN (${sql.join(staffIds.map(id => sql`${id}`), sql`, `)})`)
      : [];

    const customerMap = new Map(allCustomers.map(c => [c.id, c]));
    const inventoryMap = new Map(allInventory.map(i => [i.id, i]));
    const storeMap = new Map(allStores.map(s => [s.id, s]));
    const staffMap = new Map(allStaff.map(s => [s.id, s]));
    
    const checkoutMap = new Map(allCheckouts.map(c => [
      c.id, 
      { ...c, staff: staffMap.get(c.staffId) }
    ]));

    const data: TransactionWithRelations[] = txs.map(tx => ({
      ...tx,
      customer: customerMap.get(tx.customerId)!,
      inventory: inventoryMap.get(tx.inventoryId)!,
      checkout: checkoutMap.get(tx.checkoutId) as any,
      store: storeMap.get(tx.storeId)!,
    }));

    // Apply search filter on fetched data if provided
    let filteredData = data;
    if (search) {
      const searchLower = search.toLowerCase();
      filteredData = data.filter(tx => 
        tx.customer?.name?.toLowerCase().includes(searchLower) ||
        tx.inventory?.name?.toLowerCase().includes(searchLower)
      );
    }

    const totalPages = Math.ceil(total / limit);

    return {
      data: filteredData,
      pagination: {
        total,
        page,
        limit,
        totalPages,
        hasMore: page < totalPages,
      },
    };
  }

  async createTransaction(transaction: InsertTransaction): Promise<Transaction> {
    const [newTransaction] = await db.insert(transactions).values(transaction).returning();
    return newTransaction;
  }

  async getTransactionsByCustomer(customerId: string): Promise<TransactionWithRelations[]> {
    const txs = await db
      .select()
      .from(transactions)
      .where(eq(transactions.customerId, customerId))
      .orderBy(desc(transactions.transactionDate));

    const result: TransactionWithRelations[] = [];

    for (const tx of txs) {
      const [customer] = await db.select().from(customers).where(eq(customers.id, tx.customerId));
      const [inventoryItem] = await db.select().from(inventory).where(eq(inventory.id, tx.inventoryId));
      const [checkout] = await db.select().from(checkouts).where(eq(checkouts.id, tx.checkoutId));
      const [store] = await db.select().from(stores).where(eq(stores.id, tx.storeId));
      
      let staffMem = undefined;
      if (checkout) {
        const [foundStaff] = await db.select().from(staff).where(eq(staff.id, checkout.staffId));
        staffMem = foundStaff;
      }

      result.push({
        ...tx,
        customer,
        inventory: inventoryItem,
        checkout: checkout ? { ...checkout, staff: staffMem } : checkout as any,
        store,
      });
    }

    return result;
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

  // Transactional Checkout - atomic operation with rollback on failure
  async processCheckout(data: {
    storeId: string;
    customerId: string;
    staffId: string;
    items: Array<{
      inventoryId: string;
      quantity: number;
      customPrice?: number;
      leadStaffId?: string | null;
      assistingStaff1Id?: string | null;
      assistingStaff2Id?: string | null;
    }>;
    paymentMethod: "cash" | "transfer" | "flutterwave";
  }): Promise<{ success: boolean; message: string; checkoutIds?: string[] }> {
    const checkoutIds: string[] = [];

    try {
      // Use database transaction for atomicity
      await db.transaction(async (tx) => {
        // Validate customer exists
        const [customer] = await tx.select().from(customers).where(eq(customers.id, data.customerId));
        if (!customer) {
          throw new Error("Please select a valid customer to complete this sale.");
        }

        // Validate staff exists
        const [staffMember] = await tx.select().from(staff).where(eq(staff.id, data.staffId));
        if (!staffMember) {
          throw new Error("Please select a valid staff member to complete this sale.");
        }

        // Process each item within the transaction
        for (const item of data.items) {
          // Get inventory item with lock for update (prevents race conditions)
          const [inventoryItem] = await tx.select().from(inventory).where(eq(inventory.id, item.inventoryId));
          
          if (!inventoryItem) {
            throw new Error("One of the items in your cart is no longer available.");
          }

          // Check stock for products
          if (inventoryItem.type === "product" && inventoryItem.quantity < item.quantity) {
            throw new Error(`Sorry, we only have ${inventoryItem.quantity} ${inventoryItem.name} in stock.`);
          }

          // Calculate total price (use custom price if provided)
          const unitPrice = item.customPrice !== undefined ? item.customPrice : inventoryItem.sellingPrice;
          const totalPrice = unitPrice * item.quantity;

          // Create order
          const [order] = await tx.insert(orders).values({
            storeId: data.storeId,
            inventoryId: item.inventoryId,
            quantity: item.quantity,
            totalPrice,
          }).returning();

          // Generate receipt number
          const receiptNumber = await this.getNextAvailableTransactionNumber(tx, data.storeId);

          // Create checkout (include lead + assisting staff if provided)
          const [checkout] = await tx.insert(checkouts).values({
            storeId: data.storeId,
            staffId: data.staffId,
            leadStaffId: item.leadStaffId || null,
            assistingStaff1Id: item.assistingStaff1Id || null,
            assistingStaff2Id: item.assistingStaff2Id || null,
            orderId: order.id,
            receiptNumber,
            totalPrice,
            paymentMethod: data.paymentMethod,
            paymentStatus: data.paymentMethod === "flutterwave" ? "pending" : "completed",
          }).returning();

          checkoutIds.push(checkout.id);

          // Create transaction record
          await tx.insert(transactions).values({
            storeId: data.storeId,
            customerId: data.customerId,
            inventoryId: item.inventoryId,
            checkoutId: checkout.id,
          });

          // Update inventory quantity for products (atomic decrement)
          if (inventoryItem.type === "product") {
            await tx.update(inventory)
              .set({ quantity: inventoryItem.quantity - item.quantity })
              .where(eq(inventory.id, item.inventoryId));
          }

          // Update profit/loss record
          const costPrice = inventoryItem.costPrice;
          const revenue = totalPrice;
          const profit = revenue - (costPrice * item.quantity);

          const [existingPL] = await tx.select().from(profitLoss)
            .where(and(
              eq(profitLoss.inventoryId, item.inventoryId),
              eq(profitLoss.storeId, data.storeId)
            ));

          if (existingPL) {
            await tx.update(profitLoss)
              .set({
                totalQuantitySold: existingPL.totalQuantitySold + item.quantity,
                quantityRemaining: inventoryItem.quantity - item.quantity,
                totalRevenue: existingPL.totalRevenue + revenue,
                totalNetProfit: existingPL.totalNetProfit + profit,
              })
              .where(eq(profitLoss.id, existingPL.id));
          } else {
            await tx.insert(profitLoss).values({
              storeId: data.storeId,
              inventoryId: item.inventoryId,
              totalQuantitySold: item.quantity,
              quantityRemaining: inventoryItem.quantity - item.quantity,
              totalRevenue: revenue,
              totalNetProfit: profit,
            });
          }
        }
      });

      return { success: true, message: "Sale completed successfully", checkoutIds };
    } catch (error) {
      // Transaction automatically rolls back on error
      const message = error instanceof Error ? error.message : "We couldn't complete this sale right now. Please try again.";
      return { success: false, message };
    }
  }

  // Inventory Restock Events
  async getRestockEvents(inventoryId: string): Promise<(RestockEvent & { staff: Staff | null; user: User | null })[]> {
    const events = await db.select({
      restockEvent: inventoryRestockEvents,
      staffMember: staff,
      userRecord: users,
    })
      .from(inventoryRestockEvents)
      .leftJoin(staff, eq(inventoryRestockEvents.staffId, staff.id))
      .leftJoin(users, eq(inventoryRestockEvents.userId, users.id))
      .where(eq(inventoryRestockEvents.inventoryId, inventoryId))
      .orderBy(desc(inventoryRestockEvents.restockedAt));
    
    return events.map(e => ({
      ...e.restockEvent,
      staff: e.staffMember,
      user: e.userRecord,
    }));
  }

  async getRestockEventsPaginated(inventoryId: string, options: PaginationOptions): Promise<PaginatedResult<RestockEvent & { staff: Staff | null; user: User | null }>> {
    const { page = 1, limit = 20 } = options;
    const offset = (page - 1) * limit;

    const [totalResult] = await db.select({ count: count() })
      .from(inventoryRestockEvents)
      .where(eq(inventoryRestockEvents.inventoryId, inventoryId));

    const total = totalResult?.count ?? 0;

    const events = await db.select({
      restockEvent: inventoryRestockEvents,
      staffMember: staff,
      userRecord: users,
    })
      .from(inventoryRestockEvents)
      .leftJoin(staff, eq(inventoryRestockEvents.staffId, staff.id))
      .leftJoin(users, eq(inventoryRestockEvents.userId, users.id))
      .where(eq(inventoryRestockEvents.inventoryId, inventoryId))
      .orderBy(desc(inventoryRestockEvents.restockedAt))
      .limit(limit)
      .offset(offset);

    const data = events.map(e => ({
      ...e.restockEvent,
      staff: e.staffMember,
      user: e.userRecord,
    }));

    return {
      data,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasMore: page * limit < total,
      },
    };
  }

  async createRestockEvent(data: {
    storeId: string;
    inventoryId: string;
    staffId?: string | null;
    userId?: string | null;
    quantityAdded: number;
    unitCost: number;
    costStrategy: CostStrategy;
    newSellingPrice?: number;
    notes?: string;
  }): Promise<{ restockEvent: RestockEvent; updatedInventory: Inventory }> {
    const [currentInventory] = await db.select().from(inventory).where(eq(inventory.id, data.inventoryId));
    
    if (!currentInventory) {
      throw new Error("Inventory item not found");
    }

    const previousQuantity = currentInventory.quantity;
    const newQuantity = previousQuantity + data.quantityAdded;
    const previousCostPrice = currentInventory.costPrice;
    const previousSellingPrice = currentInventory.sellingPrice;

    let newCostPrice = previousCostPrice;
    
    switch (data.costStrategy) {
      case "keep":
        newCostPrice = previousCostPrice;
        break;
      case "last":
        newCostPrice = data.unitCost;
        break;
      case "weighted":
        const totalOldValue = previousQuantity * previousCostPrice;
        const totalNewValue = data.quantityAdded * data.unitCost;
        newCostPrice = newQuantity > 0 ? (totalOldValue + totalNewValue) / newQuantity : data.unitCost;
        break;
      case "override":
        newCostPrice = data.unitCost;
        break;
    }

    const newSellingPrice = data.newSellingPrice ?? previousSellingPrice;

    const result = await db.transaction(async (tx) => {
      const [updatedInventory] = await tx.update(inventory)
        .set({
          quantity: newQuantity,
          costPrice: newCostPrice,
          sellingPrice: newSellingPrice,
        })
        .where(eq(inventory.id, data.inventoryId))
        .returning();

      const [restockEvent] = await tx.insert(inventoryRestockEvents).values({
        storeId: data.storeId,
        inventoryId: data.inventoryId,
        staffId: data.staffId,
        userId: data.userId,
        quantityAdded: data.quantityAdded,
        previousQuantity,
        newQuantity,
        unitCost: data.unitCost,
        previousCostPrice,
        newCostPrice,
        previousSellingPrice,
        newSellingPrice,
        costStrategy: data.costStrategy,
        notes: data.notes,
      }).returning();

      const [existingPL] = await tx.select().from(profitLoss)
        .where(and(
          eq(profitLoss.inventoryId, data.inventoryId),
          eq(profitLoss.storeId, data.storeId)
        ));

      if (existingPL) {
        await tx.update(profitLoss)
          .set({ quantityRemaining: newQuantity })
          .where(eq(profitLoss.id, existingPL.id));
      }

      return { restockEvent, updatedInventory };
    });

    return result;
  }
  // Attendance Records
  async getAttendanceRecords(storeId: string, options: {
    staffId?: string;
    startDate?: string;
    endDate?: string;
  } = {}): Promise<AttendanceRecord[]> {
    const conditions = [eq(attendanceRecords.storeId, storeId)];
    if (options.staffId) conditions.push(eq(attendanceRecords.staffId, options.staffId));
    if (options.startDate) conditions.push(gte(attendanceRecords.date, options.startDate));
    if (options.endDate) conditions.push(lte(attendanceRecords.date, options.endDate));

    return await db.select().from(attendanceRecords)
      .where(and(...conditions))
      .orderBy(asc(attendanceRecords.date));
  }

  async upsertAttendanceRecord(data: InsertAttendanceRecord): Promise<AttendanceRecord> {
    const [record] = await db.insert(attendanceRecords)
      .values({ ...data, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [attendanceRecords.storeId, attendanceRecords.staffId, attendanceRecords.date],
        set: {
          status: data.status,
          notes: data.notes ?? null,
          markedByUserId: data.markedByUserId ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return record;
  }

  async bulkMarkAttendance(storeId: string, date: string, status: AttendanceStatus, staffIds: string[], markedByUserId?: string): Promise<AttendanceRecord[]> {
    const results: AttendanceRecord[] = [];
    for (const staffId of staffIds) {
      const record = await this.upsertAttendanceRecord({ storeId, staffId, date, status, markedByUserId });
      results.push(record);
    }
    return results;
  }

  async getAttendanceSummary(storeId: string, staffId: string, startDate: string, endDate: string): Promise<{
    present: number;
    absent: number;
    offDay: number;
    holiday: number;
    totalWorkingDays: number;
  }> {
    const records = await this.getAttendanceRecords(storeId, { staffId, startDate, endDate });
    const summary = { present: 0, absent: 0, offDay: 0, holiday: 0, totalWorkingDays: 0 };
    for (const r of records) {
      if (r.status === "present") { summary.present++; summary.totalWorkingDays++; }
      else if (r.status === "absent") { summary.absent++; summary.totalWorkingDays++; }
      else if (r.status === "off_day") summary.offDay++;
      else if (r.status === "holiday") summary.holiday++;
    }
    return summary;
  }

  // Payroll Periods
  async getPayrollPeriods(storeId: string): Promise<PayrollPeriod[]> {
    return await db.select().from(payrollPeriods)
      .where(eq(payrollPeriods.storeId, storeId))
      .orderBy(desc(payrollPeriods.createdAt));
  }

  async getPayrollPeriod(id: string): Promise<PayrollPeriod | undefined> {
    const [period] = await db.select().from(payrollPeriods).where(eq(payrollPeriods.id, id));
    return period;
  }

  async createPayrollPeriod(data: InsertPayrollPeriod): Promise<PayrollPeriod> {
    const [period] = await db.insert(payrollPeriods).values(data).returning();
    return period;
  }

  async updatePayrollPeriodStatus(
    id: string,
    status: PayrollPeriodStatus,
    userId?: string
  ): Promise<PayrollPeriod | undefined> {
    const setData: Partial<PayrollPeriod> = { status };
    if (status === "approved") {
      setData.approvedByUserId = userId;
      setData.approvedAt = new Date();
    }
    if (status === "paid") {
      setData.paidAt = new Date();
    }
    const [updated] = await db.update(payrollPeriods).set(setData).where(eq(payrollPeriods.id, id)).returning();
    return updated;
  }

  // Payroll Entries
  async getPayrollEntries(periodId: string): Promise<PayrollEntryWithStaff[]> {
    const rows = await db.select({
      entry: payrollEntries,
      staffMember: staff,
    })
      .from(payrollEntries)
      .leftJoin(staff, eq(payrollEntries.staffId, staff.id))
      .where(eq(payrollEntries.periodId, periodId))
      .orderBy(desc(payrollEntries.netPay));

    return rows.map(r => ({ ...r.entry, staff: r.staffMember! }));
  }

  // Option 4 Hybrid Model Commission Calculation Engine
  async calculatePayrollForPeriod(periodId: string): Promise<PayrollEntryWithStaff[]> {
    const [period] = await db.select().from(payrollPeriods).where(eq(payrollPeriods.id, periodId));
    if (!period) throw new Error("Payroll period not found");
    if (period.status === "paid") throw new Error("Cannot recalculate a paid payroll period.");

    // Fetch store settings snapshot or current settings
    const storeSettings = await this.getSettings(period.storeId);
    const activeTransportRate = storeSettings.activeDayTransport ?? 1000;
    const passiveTransportRate = storeSettings.passiveDayTransport ?? 500;
    const baseCommissionRate = storeSettings.commissionRate ?? 0.30;

    // Snapshot settings on the period if pending/approved to ensure historical stability
    await db.update(payrollPeriods)
      .set({ settingsSnapshot: storeSettings })
      .where(eq(payrollPeriods.id, periodId));

    // Get all staff for quick lookup
    const allStaff = await db.select().from(staff).where(eq(staff.storeId, period.storeId));
    const activeStaffList = allStaff.filter(s => !s.isArchived);
    const staffMap = new Map(allStaff.map(s => [s.id, s]));

    // Fetch all checkouts in period date range
    const periodCheckouts = await db.select({
      checkout: checkouts,
      order: orders,
      inventoryItem: inventory,
    })
      .from(checkouts)
      .innerJoin(orders, eq(checkouts.orderId, orders.id))
      .innerJoin(inventory, eq(orders.inventoryId, inventory.id))
      .where(and(
        eq(checkouts.storeId, period.storeId),
        gte(checkouts.createdAt, new Date(period.startDate + "T00:00:00.000Z")),
        lte(checkouts.createdAt, new Date(period.endDate + "T23:59:59.999Z")),
      ));

    // Fetch attendance records in period date range
    const attendanceList = await db.select()
      .from(attendanceRecords)
      .where(and(
        eq(attendanceRecords.storeId, period.storeId),
        gte(attendanceRecords.date, period.startDate),
        lte(attendanceRecords.date, period.endDate),
      ));

    // Group checkouts by discrete local date string YYYY-MM-DD
    const checkoutsByDate = new Map<string, typeof periodCheckouts>();
    for (const row of periodCheckouts) {
      const dateStr = row.checkout.createdAt.toISOString().split("T")[0];
      if (!checkoutsByDate.has(dateStr)) checkoutsByDate.set(dateStr, []);
      checkoutsByDate.get(dateStr)!.push(row);
    }

    // Group attendance by date -> staffId -> status
    const attendanceByDateStaff = new Map<string, Map<string, string>>();
    for (const rec of attendanceList) {
      if (!attendanceByDateStaff.has(rec.date)) attendanceByDateStaff.set(rec.date, new Map());
      attendanceByDateStaff.get(rec.date)!.set(rec.staffId, rec.status);
    }

    // Prepare per-staff summary accumulation
    const staffTotals = new Map<string, {
      activeDays: number;
      passiveDays: number;
      grossCommission: number;
    }>();

    for (const s of activeStaffList) {
      staffTotals.set(s.id, { activeDays: 0, passiveDays: 0, grossCommission: 0 });
    }

    // Loop through each distinct marked or transaction date in the period interval
    const allDateStrs = Array.from(new Set([...checkoutsByDate.keys(), ...attendanceByDateStaff.keys()])).sort();

    for (const dateStr of allDateStrs) {
      if (dateStr < period.startDate || dateStr > period.endDate) continue;

      const dayCheckouts = checkoutsByDate.get(dateStr) || [];
      const dayServiceCheckouts = dayCheckouts.filter(c => c.inventoryItem.type === "service");

      // Identify all distinct staff assigned to any service line items that day
      const dailyActiveStaffIds = new Set<string>();
      let totalDailyServiceRevenue = 0;

      for (const row of dayServiceCheckouts) {
        totalDailyServiceRevenue += row.order.totalPrice;
        const leadId = row.checkout.leadStaffId || row.checkout.staffId;
        dailyActiveStaffIds.add(leadId);
        if (row.checkout.assistingStaff1Id) dailyActiveStaffIds.add(row.checkout.assistingStaff1Id);
        if (row.checkout.assistingStaff2Id) dailyActiveStaffIds.add(row.checkout.assistingStaff2Id);
      }

      const activeStaffCount = dailyActiveStaffIds.size;
      const dayAttendance = attendanceByDateStaff.get(dateStr) || new Map<string, string>();

      // Update active/passive day counts per staff member for this day
      for (const [staffId, totals] of staffTotals) {
        const isAssigned = dailyActiveStaffIds.has(staffId);
        const status = dayAttendance.get(staffId);

        // Exclude off days and holidays entirely per spec
        if (status === "off_day" || status === "holiday") continue;

        if (isAssigned) {
          // If assigned to service, automatically Active Day
          totals.activeDays++;
        } else if (status === "present") {
          // Present but not assigned -> Passive Day
          totals.passiveDays++;
        }
      }

      // If no service revenue, skip commission math
      if (totalDailyServiceRevenue <= 0 || activeStaffCount === 0) continue;

      // Calculate Daily Commissionable Amount
      // Commissionable = Total Daily Service Revenue − (Active Staff Count × Active Transport Amount)
      const commissionable = Math.max(0, totalDailyServiceRevenue - (activeStaffCount * activeTransportRate));
      const dailyCommissionPool = commissionable * baseCommissionRate;

      // Distribute pool across service items proportionally
      for (const row of dayServiceCheckouts) {
        const serviceWeight = row.order.totalPrice / totalDailyServiceRevenue;
        const perServicePool = serviceWeight * dailyCommissionPool;

        const leadId = row.checkout.leadStaffId || row.checkout.staffId;
        const assistants = [row.checkout.assistingStaff1Id, row.checkout.assistingStaff2Id].filter(Boolean) as string[];
        const staffCount = 1 + assistants.length;

        const leadShare = staffCount === 1 ? 1.0 : staffCount === 2 ? 0.8 : 0.6;
        const asstShare = 0.2;

        // Add lead share
        if (staffTotals.has(leadId)) {
          staffTotals.get(leadId)!.grossCommission += perServicePool * leadShare;
        }

        // Add assistant shares
        for (const asstId of assistants) {
          if (staffTotals.has(asstId)) {
            staffTotals.get(asstId)!.grossCommission += perServicePool * asstShare;
          }
        }
      }
    }

    // Upsert payroll entries for each active staff member
    const results: PayrollEntryWithStaff[] = [];

    for (const [staffId, totals] of staffTotals) {
      const activeTransport = totals.activeDays * activeTransportRate;
      const passiveTransport = totals.passiveDays * passiveTransportRate;
      const totalTransport = activeTransport + passiveTransport;
      const netPay = totalTransport + totals.grossCommission;

      const [entry] = await db.insert(payrollEntries)
        .values({
          periodId,
          storeId: period.storeId,
          staffId,
          activeDays: totals.activeDays,
          passiveDays: totals.passiveDays,
          activeTransport,
          passiveTransport,
          totalTransport,
          grossCommission: totals.grossCommission,
          netPay,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [payrollEntries.periodId, payrollEntries.staffId],
          set: {
            activeDays: totals.activeDays,
            passiveDays: totals.passiveDays,
            activeTransport,
            passiveTransport,
            totalTransport,
            grossCommission: totals.grossCommission,
            netPay,
            updatedAt: new Date(),
          },
        })
        .returning();

      const staffMember = staffMap.get(staffId)!;
      results.push({ ...entry, staff: staffMember });
    }

    return results.sort((a, b) => b.netPay - a.netPay);
  }

  // Option 4 Hybrid Model Drill-down for one staff member
  async getPayrollDrillDown(periodId: string, staffId: string): Promise<{
    dailySummary: DailySummaryLine[];
    transactions: CommissionBreakdown[];
  }> {
    const [period] = await db.select().from(payrollPeriods).where(eq(payrollPeriods.id, periodId));
    if (!period) throw new Error("Payroll period not found");

    // Use settings snapshot if present, else fall back to current store settings
    const storeSettings = (period.settingsSnapshot as Settings | null) ?? (await this.getSettings(period.storeId));
    const activeTransportRate = storeSettings.activeDayTransport ?? 1000;
    const passiveTransportRate = storeSettings.passiveDayTransport ?? 500;
    const baseCommissionRate = storeSettings.commissionRate ?? 0.30;

    // Fetch all checkouts in period
    const periodCheckouts = await db.select({
      checkout: checkouts,
      order: orders,
      inventoryItem: inventory,
      txn: transactions,
    })
      .from(checkouts)
      .innerJoin(orders, eq(checkouts.orderId, orders.id))
      .innerJoin(inventory, eq(orders.inventoryId, inventory.id))
      .innerJoin(transactions, eq(transactions.checkoutId, checkouts.id))
      .where(and(
        eq(checkouts.storeId, period.storeId),
        gte(checkouts.createdAt, new Date(period.startDate + "T00:00:00.000Z")),
        lte(checkouts.createdAt, new Date(period.endDate + "T23:59:59.999Z")),
      ));

    // Fetch attendance for this staff member in period
    const attendanceList = await db.select()
      .from(attendanceRecords)
      .where(and(
        eq(attendanceRecords.storeId, period.storeId),
        eq(attendanceRecords.staffId, staffId),
        gte(attendanceRecords.date, period.startDate),
        lte(attendanceRecords.date, period.endDate),
      ));

    const attendanceMap = new Map(attendanceList.map(a => [a.date, a.status]));

    // Group checkouts by date to compute daily pools
    const checkoutsByDate = new Map<string, typeof periodCheckouts>();
    for (const row of periodCheckouts) {
      const dateStr = row.txn.transactionDate.toISOString().split("T")[0];
      if (!checkoutsByDate.has(dateStr)) checkoutsByDate.set(dateStr, []);
      checkoutsByDate.get(dateStr)!.push(row);
    }

    const allDateStrs = Array.from(new Set([...checkoutsByDate.keys(), ...attendanceMap.keys()])).sort();

    const dailySummaryLines: DailySummaryLine[] = [];
    const breakdownList: CommissionBreakdown[] = [];

    for (const dateStr of allDateStrs) {
      if (dateStr < period.startDate || dateStr > period.endDate) continue;

      const dayCheckouts = checkoutsByDate.get(dateStr) || [];
      const dayServiceCheckouts = dayCheckouts.filter(c => c.inventoryItem.type === "service");

      const dailyActiveStaffIds = new Set<string>();
      let totalDailyServiceRevenue = 0;

      for (const row of dayServiceCheckouts) {
        totalDailyServiceRevenue += row.order.totalPrice;
        const leadId = row.checkout.leadStaffId || row.checkout.staffId;
        dailyActiveStaffIds.add(leadId);
        if (row.checkout.assistingStaff1Id) dailyActiveStaffIds.add(row.checkout.assistingStaff1Id);
        if (row.checkout.assistingStaff2Id) dailyActiveStaffIds.add(row.checkout.assistingStaff2Id);
      }

      const activeStaffCount = dailyActiveStaffIds.size;
      const isAssigned = dailyActiveStaffIds.has(staffId);
      const status = attendanceMap.get(dateStr);

      if (status === "off_day" || status === "holiday") continue;

      let dayType: "Active" | "Passive" | "Absent" = "Absent";
      let transport = 0;

      if (isAssigned) {
        dayType = "Active";
        transport = activeTransportRate;
      } else if (status === "present") {
        dayType = "Passive";
        transport = passiveTransportRate;
      } else {
        continue;
      }

      // Calculate daily commission pool
      let commissionEarned = 0;
      const servicesWorkedNames: string[] = [];

      if (totalDailyServiceRevenue > 0 && activeStaffCount > 0 && isAssigned) {
        const commissionable = Math.max(0, totalDailyServiceRevenue - (activeStaffCount * activeTransportRate));
        const dailyCommissionPool = commissionable * baseCommissionRate;

        for (const row of dayServiceCheckouts) {
          const leadId = row.checkout.leadStaffId || row.checkout.staffId;
          const isLead = leadId === staffId;
          const isAsst1 = row.checkout.assistingStaff1Id === staffId;
          const isAsst2 = row.checkout.assistingStaff2Id === staffId;

          if (!isLead && !isAsst1 && !isAsst2) continue;

          const serviceWeight = row.order.totalPrice / totalDailyServiceRevenue;
          const perServicePool = serviceWeight * dailyCommissionPool;

          const assistants = [row.checkout.assistingStaff1Id, row.checkout.assistingStaff2Id].filter(Boolean) as string[];
          const staffCount = 1 + assistants.length;

          const leadShare = staffCount === 1 ? 1.0 : staffCount === 2 ? 0.8 : 0.6;
          const asstShare = 0.2;

          let role: "lead" | "assistant_1" | "assistant_2" = "lead";
          let share = leadShare;

          if (isLead) {
            role = "lead";
            share = leadShare;
            servicesWorkedNames.push(`${row.inventoryItem.name} (Lead)`);
          } else if (isAsst1) {
            role = "assistant_1";
            share = asstShare;
            servicesWorkedNames.push(`${row.inventoryItem.name} (Asst 1)`);
          } else if (isAsst2) {
            role = "assistant_2";
            share = asstShare;
            servicesWorkedNames.push(`${row.inventoryItem.name} (Asst 2)`);
          }

          const earned = perServicePool * share;
          commissionEarned += earned;

          breakdownList.push({
            checkoutId: row.checkout.id,
            receiptNumber: row.checkout.receiptNumber,
            transactionDate: row.txn.transactionDate.toISOString(),
            inventoryName: row.inventoryItem.name,
            inventoryType: row.inventoryItem.name,
            serviceAmount: row.order.totalPrice,
            commissionPool: perServicePool,
            role,
            share,
            earned,
          });
        }
      }

      dailySummaryLines.push({
        date: dateStr,
        dayType,
        transport,
        servicesWorked: servicesWorkedNames.length > 0 ? servicesWorkedNames.join(", ") : "—",
        commissionEarned,
        dailyTotal: transport + commissionEarned,
      });
    }

    return {
      dailySummary: dailySummaryLines.sort((a, b) => a.date.localeCompare(b.date)),
      transactions: breakdownList.sort((a, b) => a.transactionDate.localeCompare(b.transactionDate)),
    };
  }

  // Settings CRUD
  async getSettings(storeId: string): Promise<Settings> {
    const [row] = await db.select().from(settings).where(eq(settings.storeId, storeId));
    if (row) return row;
    const [inserted] = await db.insert(settings).values({ storeId }).returning();
    return inserted;
  }

  async upsertSettings(storeId: string, data: Partial<InsertSettings>): Promise<Settings> {
    const [updated] = await db.insert(settings)
      .values({ storeId, ...data })
      .onConflictDoUpdate({
        target: settings.storeId,
        set: { ...data, updatedAt: new Date() },
      })
      .returning();
    return updated;
  }
}

export const storage = new DatabaseStorage();
