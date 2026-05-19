import {
  businesses,
  organisations,
  organisationMembers,
  type InsertOrganisation,
  type Organisation,
  type InsertOrganisationMember,
  type OrganisationMember,
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
  notifications,
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
  type Notification,
  type InsertNotification,
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
  expenses,
  expenseCategories,
  type Expense,
  type InsertExpense,
  type ExpenseCategory,
  type InsertExpenseCategory,
  type ExpenseWithCategory,
  storeIntegrations,
  type StoreIntegration,
  type InsertStoreIntegration,
  promotions,
  type Promotion,
  type InsertPromotion,
  customRoles,
  type CustomRole,
  type InsertCustomRole,
} from "@shared/schema";
import { db } from "./db";
import { eq, sql, desc, count, and, asc, like, or, ilike, gt, gte, lte } from "drizzle-orm";
import { broadcastNotification } from "./websocket";

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
  getStoreByName(businessId: string, name: string): Promise<Store | undefined>;
  getStoreByCode(businessId: string, code: string): Promise<Store | undefined>;
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
  getStaffByUserId(userId: string): Promise<Staff | undefined>;
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
  getInventoryItemByName(storeId: string, name: string): Promise<Inventory | undefined>;
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
      leadStaffId?: string | null;
      assistingStaff1Id?: string | null;
      assistingStaff2Id?: string | null;
      commissionSplit?: "standard" | "equal";
    }>;
    paymentMethod: "cash" | "transfer" | "flutterwave";
    discountAmount?: number;
    discountPercent?: number;
    discountReason?: string;
    discountApprovedBy?: string;
    effectiveDate?: string;
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
    reason?: string;
    attachment?: string | null;
  }): Promise<{ restockEvent: RestockEvent; updatedInventory: Inventory }>;

  // Promotions
  getPromotions(storeId: string): Promise<Promotion[]>;
  createPromotion(data: InsertPromotion & { storeId: string }): Promise<Promotion>;
  updatePromotion(id: string, data: Partial<InsertPromotion>): Promise<Promotion | undefined>;
  deletePromotion(id: string): Promise<boolean>;

  // Custom Roles
  getCustomRoles(businessId: string): Promise<CustomRole[]>;
  createCustomRole(data: InsertCustomRole & { businessId: string }): Promise<CustomRole>;
  updateCustomRole(id: string, data: Partial<InsertCustomRole>): Promise<CustomRole | undefined>;
  deleteCustomRole(id: string): Promise<boolean>;

  // Settings
  getSettings(storeId: string): Promise<Settings>;
  upsertSettings(storeId: string, data: Partial<InsertSettings>): Promise<Settings>;

  // Expenses
  getExpenseCategories(storeId: string): Promise<ExpenseCategory[]>;
  createExpenseCategory(data: InsertExpenseCategory): Promise<ExpenseCategory>;
  deleteExpenseCategory(id: string): Promise<void>;

  getExpenses(
    storeId: string,
    startDate?: string,
    endDate?: string,
    type?: "all" | "general" | "linked" | "service" | "product",
    inventoryId?: string
  ): Promise<ExpenseWithCategory[]>;
  createExpense(data: InsertExpense): Promise<Expense>;
  updateExpense(id: string, data: Partial<InsertExpense>): Promise<Expense>;
  deleteExpense(id: string): Promise<void>;

  getProfitLossSummary(storeId: string, startDate?: string, endDate?: string): Promise<{
    serviceRevenue: number;
    productRevenue: number;
    totalRevenue: number;
    costOfGoodsSold: number;
    grossProfit: number;
    discountsGiven: number;
    discountsList: Array<{
      receiptNumber: string;
      discountAmount: number;
      discountPercent: number;
      discountReason: string | null;
      discountApprovedBy: string | null;
      createdAt: Date;
    }>;
  }>;

  // Void
  voidCheckout(checkoutId: string, reason: string, voidedByUserId: string): Promise<{ success: boolean; message: string }>;

  // Receipt
  getReceiptPayload(checkoutId: string): Promise<{
    business: { name: string } | null;
    store: { name: string; currency: string; phone?: string | null; address?: string | null } | null;
    settings: { receiptPrefix: string; receiptThankYouMessage?: string | null } | null;
    checkout: any;
    order: any;
    inventory: any;
    customer: any;
    staff: any;
    leadStaff: any;
  } | null>;

  // Update payment method/status post-checkout
  updateCheckoutPaymentMethod(checkoutId: string, paymentMethod: string, paymentStatus: string): Promise<boolean>;

  // Payroll Expenses
  getPaidPayrollExpenses(storeId: string, startDate?: string, endDate?: string): Promise<{ label: string; amount: number }[]>;

  // Staff Performance
  getStaffPerformance(storeId: string, startDate?: string, endDate?: string): Promise<any[]>;

  // Search
  searchCustomers(storeId: string, query: string): Promise<Customer[]>;
  searchInventory(storeId: string, query: string): Promise<Inventory[]>;
  searchTransactions(storeId: string, query: string): Promise<any[]>;

  getNotifications(userId: string): Promise<Notification[]>;
  markNotificationAsRead(id: string): Promise<void>;
  markAllNotificationsAsRead(userId: string): Promise<void>;
  createNotification(data: InsertNotification): Promise<Notification>;
  getTopCustomers(storeId: string): Promise<any[]>;

  // Platform & Organisations
  getUserByIdentifier(emailOrPhone: string): Promise<User | undefined>;
  getUserByActivationCode(code: string): Promise<User | undefined>;
  getOrganisationsByUserId(userId: string): Promise<any[]>;
  getOrganisationMember(userId: string, organisationId: string): Promise<OrganisationMember | undefined>;
  createOrganisation(data: InsertOrganisation): Promise<Organisation>;
  createOrganisationMember(data: InsertOrganisationMember): Promise<OrganisationMember>;
  updateOrganisationMemberStatus(id: string, status: string, activatedAt?: Date): Promise<OrganisationMember>;
  getOrganisationMembers(organisationId: string): Promise<(OrganisationMember & { user: User })[]>;
  getOrganisationMemberById(id: string): Promise<OrganisationMember | undefined>;
  getOrganisationBySlug(slug: string): Promise<Organisation | undefined>;
  deleteOrganisationMember(id: string): Promise<void>;
  updateOrganisationMember(id: string, data: Partial<OrganisationMember>): Promise<OrganisationMember>;

  // Store Integrations
  getStoreIntegrations(storeId: string): Promise<StoreIntegration[]>;
  getStoreIntegrationByProvider(storeId: string, provider: string): Promise<StoreIntegration | undefined>;
  upsertStoreIntegration(data: InsertStoreIntegration & { storeId: string; provider: string }): Promise<StoreIntegration>;
  deleteStoreIntegration(id: string): Promise<void>;
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

  async getUserByIdentifier(emailOrPhone: string): Promise<User | undefined> {
    const clean = emailOrPhone.trim().toLowerCase();
    const [user] = await db
      .select()
      .from(users)
      .where(or(eq(users.email, clean), eq(users.phone, clean)));
    return user;
  }

  async getUserByActivationCode(code: string): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.activationCode, code),
          eq(users.activationCodeUsed, false),
          gt(users.activationCodeExpiry, new Date())
        )
      );
    return user;
  }

  async getOrganisationsByUserId(userId: string): Promise<any[]> {
    const rows = await db
      .select({
        id: organisations.id,
        organisationId: organisations.id,
        name: organisations.name,
        slug: organisations.slug,
        role: organisationMembers.role,
        status: organisationMembers.status,
        memberId: organisationMembers.id,
      })
      .from(organisationMembers)
      .innerJoin(organisations, eq(organisationMembers.organisationId, organisations.id))
      .where(eq(organisationMembers.userId, userId));
    return rows;
  }

  async getOrganisationMember(userId: string, organisationId: string): Promise<OrganisationMember | undefined> {
    const [member] = await db
      .select()
      .from(organisationMembers)
      .where(and(eq(organisationMembers.userId, userId), eq(organisationMembers.organisationId, organisationId)));
    return member;
  }

  async createOrganisation(data: InsertOrganisation): Promise<Organisation> {
    const [org] = await db.insert(organisations).values(data).returning();
    return org;
  }

  async createOrganisationMember(data: InsertOrganisationMember): Promise<OrganisationMember> {
    const [member] = await db.insert(organisationMembers).values(data).returning();
    return member;
  }

  async updateOrganisationMemberStatus(id: string, status: string, activatedAt?: Date): Promise<OrganisationMember> {
    const updateData: Partial<OrganisationMember> = { status };
    if (activatedAt) {
      updateData.activatedAt = activatedAt;
    }
    const [member] = await db
      .update(organisationMembers)
      .set(updateData)
      .where(eq(organisationMembers.id, id))
      .returning();
    if (!member) throw new Error("Organisation member not found.");
    return member;
  }

  async getOrganisationMembers(organisationId: string): Promise<(OrganisationMember & { user: User })[]> {
    const rows = await db
      .select({
        member: organisationMembers,
        user: users,
      })
      .from(organisationMembers)
      .innerJoin(users, eq(users.id, organisationMembers.userId))
      .where(eq(organisationMembers.organisationId, organisationId));
    
    return rows.map(r => ({
      ...r.member,
      user: r.user,
    }));
  }

  async getOrganisationMemberById(id: string): Promise<OrganisationMember | undefined> {
    const [member] = await db.select().from(organisationMembers).where(eq(organisationMembers.id, id));
    return member;
  }

  async getOrganisationBySlug(slug: string): Promise<Organisation | undefined> {
    const [org] = await db.select().from(organisations).where(eq(organisations.slug, slug.trim().toLowerCase()));
    return org;
  }

  async deleteOrganisationMember(id: string): Promise<void> {
    await db.delete(organisationMembers).where(eq(organisationMembers.id, id));
  }

  async updateOrganisationMember(id: string, data: Partial<OrganisationMember>): Promise<OrganisationMember> {
    const [member] = await db
      .update(organisationMembers)
      .set(data)
      .where(eq(organisationMembers.id, id))
      .returning();
    if (!member) throw new Error("Organisation member not found.");
    return member;
  }

  async createUser(userData: { 
    email: string; 
    password: string; 
    businessId: string; 
    role?: UserRole; 
    isVerified?: boolean;
    activationCode?: string;
    activationCodeExpiry?: Date;
    activationCodeUsed?: boolean;
    createdByInvitation?: boolean;
  }): Promise<User> {
    const [user] = await db.insert(users).values({
      email: userData.email,
      password: userData.password,
      businessId: userData.businessId,
      role: userData.role || "owner",
      isVerified: userData.isVerified ?? false,
      activationCode: userData.activationCode,
      activationCodeExpiry: userData.activationCodeExpiry,
      activationCodeUsed: userData.activationCodeUsed ?? false,
      createdByInvitation: userData.createdByInvitation ?? false,
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

  async getStoreByName(businessId: string, name: string): Promise<Store | undefined> {
    const [store] = await db
      .select()
      .from(stores)
      .where(and(eq(stores.businessId, businessId), ilike(stores.name, name)))
      .limit(1);
    return store;
  }

  async getStoreByCode(businessId: string, code: string): Promise<Store | undefined> {
    const [store] = await db
      .select()
      .from(stores)
      .where(and(eq(stores.businessId, businessId), eq(stores.code, code.trim().toUpperCase())))
      .limit(1);
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
    return await db.transaction(async (tx) => {
      // 1. Delete all staff records associated with this store
      await tx.delete(staff).where(eq(staff.storeId, id));

      // 2. Clear storeCounters
      await tx.delete(storeCounters).where(eq(storeCounters.storeId, id));

      // 3. Set managerStaffId to null in the store to avoid cyclic dependency before deleting
      await tx.update(stores).set({ managerStaffId: null }).where(eq(stores.id, id));

      // 4. Delete the store
      const result = await tx.delete(stores).where(eq(stores.id, id)).returning();
      return result.length > 0;
    });
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
    const { birthday, ...rest } = customer;
    const [newCustomer] = await db.insert(customers).values({
      ...rest,
      customerNumber,
      birthday: birthday ? new Date(birthday) : null,
    }).returning();
    return newCustomer;
  }

  async updateCustomer(id: string, customerData: Partial<InsertCustomer>): Promise<Customer | undefined> {
    const { birthday, ...rest } = customerData;
    const updateData: any = { ...rest };
    if (birthday !== undefined) {
      updateData.birthday = birthday ? new Date(birthday) : null;
    }
    const [updated] = await db.update(customers).set(updateData).where(eq(customers.id, id)).returning();
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

  async getStaffByUserId(userId: string): Promise<Staff | undefined> {
    const [result] = await db.select().from(staff).where(eq(staff.userId, userId));
    return result;
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
    return await db.transaction(async (tx) => {
      // 1. Clear manager staff reference in stores
      await tx.update(stores).set({ managerStaffId: null }).where(eq(stores.managerStaffId, id));

      // 2. Clear staff references in inventoryRestockEvents
      await tx.update(inventoryRestockEvents).set({ staffId: null }).where(eq(inventoryRestockEvents.staffId, id));

      // 3. Delete attendance records for this staff member
      await tx.delete(attendanceRecords).where(eq(attendanceRecords.staffId, id));

      // 4. Delete payroll entries for this staff member
      await tx.delete(payrollEntries).where(eq(payrollEntries.staffId, id));

      // 5. Finally delete the staff record itself
      const result = await tx.delete(staff).where(eq(staff.id, id)).returning();
      return result.length > 0;
    });
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
    const result = await db.select({ count: count() })
      .from(checkouts)
      .where(
        or(
          eq(checkouts.staffId, id),
          eq(checkouts.leadStaffId, id),
          eq(checkouts.assistingStaff1Id, id),
          eq(checkouts.assistingStaff2Id, id)
        )
      );
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

  async getInventoryItemByName(storeId: string, name: string): Promise<Inventory | undefined> {
    const [item] = await db
      .select()
      .from(inventory)
      .where(and(
        eq(inventory.storeId, storeId),
        sql`lower(${inventory.name}) = ${name.toLowerCase().trim()}`
      ));
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
    const seenReceipts = new Set<string>();

    for (const tx of txs) {
      const [checkout] = await db.select().from(checkouts).where(eq(checkouts.id, tx.checkoutId));
      if (!checkout) continue;

      const receiptNum = checkout.receiptNumber;
      if (seenReceipts.has(receiptNum)) continue; // Already grouped!
      seenReceipts.add(receiptNum);

      // Get all checkout line items for this transaction
      const matchedCheckouts = await db.select().from(checkouts)
        .where(eq(checkouts.receiptNumber, receiptNum));

      // Get all inventory items for this transaction
      const matchedInventoryItems: Inventory[] = [];
      for (const ch of matchedCheckouts) {
        const [order] = await db.select().from(orders).where(eq(orders.id, ch.orderId));
        if (order) {
          const [invItem] = await db.select().from(inventory).where(eq(inventory.id, order.inventoryId));
          if (invItem) {
            matchedInventoryItems.push(invItem);
          }
        }
      }

      // Create a virtual inventory item representing all items
      const virtualInventoryName = matchedInventoryItems.map(item => item.name).join(", ");
      const virtualInventoryType = matchedInventoryItems.some(item => item.type === "service") ? "service" : "product";

      const [customer] = await db.select().from(customers).where(eq(customers.id, tx.customerId));
      const [store] = await db.select().from(stores).where(eq(stores.id, tx.storeId));
      const [foundStaff] = await db.select().from(staff).where(eq(staff.id, checkout.staffId));

      result.push({
        ...tx,
        customer,
        inventory: {
          id: matchedInventoryItems[0]?.id || tx.inventoryId,
          storeId: tx.storeId,
          name: virtualInventoryName || "Unknown Item",
          type: virtualInventoryType,
          quantity: matchedInventoryItems[0]?.quantity || 0,
          costPrice: matchedInventoryItems[0]?.costPrice || 0,
          sellingPrice: checkout.totalCharged, // Standalone total charged
        },
        checkout: {
          ...checkout,
          totalPrice: checkout.totalCharged, // Represent transaction amount as totalCharged
          staff: foundStaff,
        },
        store,
      });
    }
    result.sort((a, b) => b.checkout.receiptNumber.localeCompare(a.checkout.receiptNumber));
    return result;
  }

  async getTransactionsPaginated(storeId: string, options: PaginationOptions): Promise<PaginatedResult<TransactionWithRelations>> {
    const { page, limit, search } = options;
    const offset = (page - 1) * limit;

    // Get all checkouts for counting unique transactions
    const uniqueReceiptsQuery = await db
      .select({ receiptNumber: checkouts.receiptNumber })
      .from(checkouts)
      .where(eq(checkouts.storeId, storeId))
      .groupBy(checkouts.receiptNumber);
    const total = uniqueReceiptsQuery.length;

    // Select the unique receipt numbers for this page
    const paginatedReceipts = await db
      .select({ 
        receiptNumber: checkouts.receiptNumber,
        maxDate: sql<Date>`max(${checkouts.createdAt})`
      })
      .from(checkouts)
      .where(eq(checkouts.storeId, storeId))
      .groupBy(checkouts.receiptNumber)
      .orderBy(desc(checkouts.receiptNumber))
      .limit(limit)
      .offset(offset);

    const data: TransactionWithRelations[] = [];

    for (const r of paginatedReceipts) {
      // Find one checkout with this receiptNumber to get customer & transaction link
      const matchedCheckouts = await db.select().from(checkouts)
        .where(eq(checkouts.receiptNumber, r.receiptNumber));
      if (matchedCheckouts.length === 0) continue;

      const primaryCheckout = matchedCheckouts[0];
      const [tx] = await db.select().from(transactions).where(eq(transactions.checkoutId, primaryCheckout.id));
      if (!tx) continue;

      // Get all inventory items
      const matchedInventoryItems: Inventory[] = [];
      for (const ch of matchedCheckouts) {
        const [order] = await db.select().from(orders).where(eq(orders.id, ch.orderId));
        if (order) {
          const [invItem] = await db.select().from(inventory).where(eq(inventory.id, order.inventoryId));
          if (invItem) {
            matchedInventoryItems.push(invItem);
          }
        }
      }

      const virtualInventoryName = matchedInventoryItems.map(item => item.name).join(", ");
      const virtualInventoryType = matchedInventoryItems.some(item => item.type === "service") ? "service" : "product";

      const [customer] = await db.select().from(customers).where(eq(customers.id, tx.customerId));
      const [store] = await db.select().from(stores).where(eq(stores.id, tx.storeId));
      const [foundStaff] = await db.select().from(staff).where(eq(staff.id, primaryCheckout.staffId));

      data.push({
        ...tx,
        customer,
        inventory: {
          id: matchedInventoryItems[0]?.id || tx.inventoryId,
          storeId: tx.storeId,
          name: virtualInventoryName || "Unknown Item",
          type: virtualInventoryType,
          quantity: matchedInventoryItems[0]?.quantity || 0,
          costPrice: matchedInventoryItems[0]?.costPrice || 0,
          sellingPrice: primaryCheckout.totalCharged,
        },
        checkout: {
          ...primaryCheckout,
          totalPrice: primaryCheckout.totalCharged,
          staff: foundStaff,
        },
        store,
      });
    }

    // Apply search filter if provided
    let filteredData = data;
    if (search) {
      const searchLower = search.toLowerCase();
      filteredData = data.filter(tx => 
        tx.customer?.name?.toLowerCase().includes(searchLower) ||
        tx.inventory?.name?.toLowerCase().includes(searchLower) ||
        tx.checkout?.receiptNumber?.toLowerCase().includes(searchLower)
      );
    }

    const totalPages = Math.max(1, Math.ceil(total / limit));

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
    const seenReceipts = new Set<string>();

    for (const tx of txs) {
      const [checkout] = await db.select().from(checkouts).where(eq(checkouts.id, tx.checkoutId));
      if (!checkout) continue;

      const receiptNum = checkout.receiptNumber;
      if (seenReceipts.has(receiptNum)) continue;
      seenReceipts.add(receiptNum);

      // Get all checkout line items for this transaction
      const matchedCheckouts = await db.select().from(checkouts)
        .where(eq(checkouts.receiptNumber, receiptNum));

      // Get all inventory items
      const matchedInventoryItems: Inventory[] = [];
      for (const ch of matchedCheckouts) {
        const [order] = await db.select().from(orders).where(eq(orders.id, ch.orderId));
        if (order) {
          const [invItem] = await db.select().from(inventory).where(eq(inventory.id, order.inventoryId));
          if (invItem) {
            matchedInventoryItems.push(invItem);
          }
        }
      }

      const virtualInventoryName = matchedInventoryItems.map(item => item.name).join(", ");
      const virtualInventoryType = matchedInventoryItems.some(item => item.type === "service") ? "service" : "product";

      const [customer] = await db.select().from(customers).where(eq(customers.id, tx.customerId));
      const [store] = await db.select().from(stores).where(eq(stores.id, tx.storeId));
      const [foundStaff] = await db.select().from(staff).where(eq(staff.id, checkout.staffId));

      result.push({
        ...tx,
        customer,
        inventory: {
          id: matchedInventoryItems[0]?.id || tx.inventoryId,
          storeId: tx.storeId,
          name: virtualInventoryName || "Unknown Item",
          type: virtualInventoryType,
          quantity: matchedInventoryItems[0]?.quantity || 0,
          costPrice: matchedInventoryItems[0]?.costPrice || 0,
          sellingPrice: checkout.totalCharged,
        },
        checkout: {
          ...checkout,
          totalPrice: checkout.totalCharged,
          staff: foundStaff,
        },
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
    const totalGrossProfit = totalRevenue - (totalQuantitySold * inventoryItem.costPrice);
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
          totalGrossProfit,
        })
        .where(and(eq(profitLoss.inventoryId, inventoryId), eq(profitLoss.storeId, storeId)));
    } else {
      await db.insert(profitLoss).values({
        storeId,
        inventoryId,
        totalQuantitySold,
        quantityRemaining,
        totalRevenue,
        totalGrossProfit,
      });
    }
  }

  // Dashboard Stats
  async getDashboardStats(storeId: string, startDate?: string, endDate?: string) {
    const storeEq = eq(customers.storeId, storeId);
    
    // Customers (filtered by date)
    let customerConditions: any[] = [storeEq];
    if (startDate) customerConditions.push(gte(customers.createdAt, new Date(startDate + "T00:00:00.000Z")));
    if (endDate) customerConditions.push(lte(customers.createdAt, new Date(endDate + "T23:59:59.999Z")));
    const matchedCustomers = await db.select().from(customers).where(and(...customerConditions));

    // Staff and Inventory (totals)
    const allStaff = await db.select().from(staff).where(eq(staff.storeId, storeId));
    const allInventory = await db.select().from(inventory).where(eq(inventory.storeId, storeId));
    const products = allInventory.filter((i) => i.type === "product");
    const services = allInventory.filter((i) => i.type === "service");

    // Low stock items
    const lowStockThresholdResult = await db.select().from(settings).where(eq(settings.storeId, storeId));
    const lowStockThreshold = lowStockThresholdResult[0]?.lowStockThreshold || 5;
    const lowStockItems = products.filter((p) => p.quantity <= lowStockThreshold);

    // Transactions (filtered by date and excluding voided)
    let txConditions: any[] = [
      eq(checkouts.storeId, storeId),
      eq(checkouts.isVoided, false),
      eq(checkouts.paymentStatus, "completed")
    ];
    if (startDate) txConditions.push(gte(checkouts.createdAt, new Date(startDate + "T00:00:00.000Z")));
    if (endDate) txConditions.push(lte(checkouts.createdAt, new Date(endDate + "T23:59:59.999Z")));
    const matchedCheckouts = await db.select().from(checkouts).where(and(...txConditions));

    // Revenue and Profit (filtered by date using getProfitLossSummary)
    const plSummary = await this.getProfitLossSummary(storeId, startDate, endDate);

    return {
      totalCustomers: matchedCustomers.length,
      totalStaff: allStaff.length,
      totalInventory: allInventory.length,
      totalProducts: products.length,
      totalServices: services.length,
      totalTransactions: matchedCheckouts.length,
      totalRevenue: plSummary.totalRevenue,
      totalProfit: plSummary.grossProfit,
      lowStockItems,
    };
  }

  // Chart Data - Sales Trends
  async getSalesTrends(storeId: string, startDate?: string, endDate?: string): Promise<{ date: string; revenue: number; transactions: number }[]> {
    const conditions: any[] = [eq(transactions.storeId, storeId)];
    if (startDate) conditions.push(gte(transactions.transactionDate, new Date(startDate + "T00:00:00.000Z")));
    if (endDate) conditions.push(lte(transactions.transactionDate, new Date(endDate + "T23:59:59.999Z")));

    const allTransactions = await db
      .select()
      .from(transactions)
      .where(and(...conditions))
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
  async getRevenueByType(storeId: string, startDate?: string, endDate?: string): Promise<{ name: string; value: number; type: string }[]> {
    const conditions: any[] = [
      eq(checkouts.storeId, storeId),
      eq(checkouts.paymentStatus, "completed"),
      eq(checkouts.isVoided, false),
    ];
    if (startDate) conditions.push(gte(checkouts.createdAt, new Date(startDate + "T00:00:00.000Z")));
    if (endDate) conditions.push(lte(checkouts.createdAt, new Date(endDate + "T23:59:59.999Z")));

    const rows = await db
      .select({
        inventoryName: inventory.name,
        inventoryType: inventory.type,
        revenue: orders.totalPrice,
      })
      .from(orders)
      .innerJoin(checkouts, eq(orders.id, checkouts.orderId))
      .innerJoin(inventory, eq(orders.inventoryId, inventory.id))
      .where(and(...conditions));

    const grouped = new Map<string, { name: string; value: number; type: string }>();
    
    for (const row of rows) {
      const existing = grouped.get(row.inventoryName) || { name: row.inventoryName, value: 0, type: row.inventoryType };
      existing.value += row.revenue;
      grouped.set(row.inventoryName, existing);
    }

    const result = Array.from(grouped.values());
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
      commissionSplit?: "standard" | "equal";
    }>;
    paymentMethod: "cash" | "transfer" | "flutterwave";
    discountAmount?: number;
    discountPercent?: number;
    discountReason?: string;
    discountApprovedBy?: string;
    effectiveDate?: string;
  }): Promise<{ success: boolean; message: string; checkoutIds?: string[] }> {
    const checkoutIds: string[] = [];
    const lowStockItems: Array<{ name: string; quantity: number }> = [];

    try {
      // Use database transaction for atomicity
      await db.transaction(async (tx) => {
        let txDate: Date;
        if (data.effectiveDate) {
          const parts = data.effectiveDate.split("-");
          if (parts.length === 3) {
            const year = parseInt(parts[0], 10);
            const month = parseInt(parts[1], 10) - 1; // 0-indexed
            const day = parseInt(parts[2], 10);
            txDate = new Date(year, month, day, 0, 0, 0, 0); // Strictly midnight local time
          } else {
            txDate = new Date(data.effectiveDate);
            txDate.setHours(0, 0, 0, 0);
          }
        } else {
          txDate = new Date(); // Carry now time when unchanged
        }
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

        // Get store settings for low stock threshold
        const storeSettings = await this.getSettings(data.storeId);
        const lowStockThreshold = storeSettings?.lowStockThreshold ?? 5;

        // Fetch active promotions for this store
        const storePromotions = await tx.select().from(promotions).where(
          and(eq(promotions.storeId, data.storeId), eq(promotions.isActive, true))
        );

        // Pre-process items list and apply promotions
        const processedItems: Array<{
          inventoryId: string;
          quantity: number;
          customPrice?: number;
          unitPrice: number;
          leadStaffId?: string | null;
          assistingStaff1Id?: string | null;
          assistingStaff2Id?: string | null;
          commissionSplit?: "standard" | "equal";
          isPromoLine?: boolean;
          promoName?: string;
        }> = [];

        for (const item of data.items) {
          const [inventoryItem] = await tx.select().from(inventory).where(eq(inventory.id, item.inventoryId));
          if (!inventoryItem) {
            throw new Error("One of the items in your cart is no longer available.");
          }
          const unitPrice = item.customPrice !== undefined ? item.customPrice : inventoryItem.sellingPrice;
          
          if (unitPrice <= 0) {
            throw new Error(`Item ${inventoryItem.name} cannot be sold for ₦0. Only active promotions can apply ₦0 items.`);
          }

          processedItems.push({
            ...item,
            unitPrice,
            isPromoLine: false,
          });
        }

        // Apply Buy X Get Y (Same Item) first
        for (const promo of storePromotions) {
          if (promo.type === "buy_x_get_y" && promo.buyItemId === promo.getItemId && promo.buyItemId) {
            const buyQty = promo.buyQuantity || 1;
            const getQty = promo.getQuantity || 1;
            const cycle = buyQty + getQty;

            const itemIdx = processedItems.findIndex(i => i.inventoryId === promo.buyItemId && !i.isPromoLine);
            if (itemIdx !== -1) {
              const item = processedItems[itemIdx];
              const qty = item.quantity;
              if (qty >= cycle) {
                const times = Math.floor(qty / cycle);
                const freeQty = times * getQty;
                const paidQty = qty - freeQty;

                processedItems.splice(itemIdx, 1);
                if (paidQty > 0) {
                  processedItems.push({
                    ...item,
                    quantity: paidQty,
                  });
                }
                processedItems.push({
                  ...item,
                  quantity: freeQty,
                  unitPrice: 0,
                  customPrice: 0,
                  isPromoLine: true,
                  promoName: promo.name,
                });
              }
            }
          }
        }

        // Apply Buy X Get Y (Different Item)
        for (const promo of storePromotions) {
          if (promo.type === "buy_x_get_y" && promo.buyItemId !== promo.getItemId && promo.buyItemId && promo.getItemId) {
            const buyQty = promo.buyQuantity || 1;
            const getQty = promo.getQuantity || 1;

            const buyItemPaidQty = processedItems
              .filter(i => i.inventoryId === promo.buyItemId && !i.isPromoLine)
              .reduce((sum, i) => sum + i.quantity, 0);

            if (buyItemPaidQty >= buyQty) {
              const times = Math.floor(buyItemPaidQty / buyQty);
              const freeQty = times * getQty;

              processedItems.push({
                inventoryId: promo.getItemId,
                quantity: freeQty,
                unitPrice: 0,
                customPrice: 0,
                isPromoLine: true,
                promoName: promo.name,
                leadStaffId: data.staffId,
                commissionSplit: "standard",
              });
            }
          }
        }

        // Apply Spend X Get Y Free
        for (const promo of storePromotions) {
          if (promo.type === "spend_x_get_y" && promo.spendAmount && promo.getItemId) {
            const spendReq = promo.spendAmount;
            const getQty = promo.getQuantity || 1;

            const paidSubtotal = processedItems
              .filter(i => !i.isPromoLine)
              .reduce((sum, i) => sum + (i.unitPrice * i.quantity), 0);

            if (paidSubtotal >= spendReq) {
              processedItems.push({
                inventoryId: promo.getItemId,
                quantity: getQty,
                unitPrice: 0,
                customPrice: 0,
                isPromoLine: true,
                promoName: promo.name,
                leadStaffId: data.staffId,
                commissionSplit: "standard",
              });
            }
          }
        }

        // 1. Calculate Gross Cart Total
        let grossCartTotal = 0;
        for (const item of processedItems) {
          grossCartTotal += item.unitPrice * item.quantity;
        }

        // 2. Generate a single transaction receipt number
        const receiptNumber = await this.getNextAvailableTransactionNumber(tx, data.storeId);

        // 3. Define transaction-level discount variables
        const totalDiscount = data.discountAmount || 0;
        const discountPct = data.discountPercent || (grossCartTotal > 0 ? (totalDiscount / grossCartTotal) * 100 : 0);
        const totalCharged = Math.max(0, grossCartTotal - totalDiscount);

        // 4. Process each item
        for (const item of processedItems) {
          const [inventoryItem] = await tx.select().from(inventory).where(eq(inventory.id, item.inventoryId));
          if (!inventoryItem) {
            throw new Error("One of the items in your cart is no longer available.");
          }

          // Check stock for products
          if (inventoryItem.type === "product" && inventoryItem.quantity < item.quantity) {
            throw new Error(`Sorry, we only have ${inventoryItem.quantity} ${inventoryItem.name} in stock.`);
          }

          const totalPrice = item.unitPrice * item.quantity;

          // Create order
          const [order] = await tx.insert(orders).values({
            storeId: data.storeId,
            inventoryId: item.inventoryId,
            quantity: item.quantity,
            totalPrice,
          }).returning();

          // Create checkout
          const [checkout] = await tx.insert(checkouts).values({
            storeId: data.storeId,
            staffId: data.staffId,
            leadStaffId: item.leadStaffId || null,
            assistingStaff1Id: item.assistingStaff1Id || null,
            assistingStaff2Id: item.assistingStaff2Id || null,
            commissionSplit: item.commissionSplit || "standard",
            orderId: order.id,
            receiptNumber,
            totalPrice,
            paymentMethod: data.paymentMethod,
            paymentStatus: data.paymentMethod === "flutterwave" ? "pending" : "completed",
            subtotal: grossCartTotal,
            discountAmount: item.isPromoLine ? 0 : totalDiscount,
            discountPercent: item.isPromoLine ? 0 : discountPct,
            discountReason: item.isPromoLine ? `Promo - ${item.promoName}` : (data.discountReason || null),
            discountApprovedBy: data.discountApprovedBy || null,
            totalCharged: totalCharged,
            createdAt: txDate,
          }).returning();

          checkoutIds.push(checkout.id);

          // Create transaction record
          await tx.insert(transactions).values({
            storeId: data.storeId,
            customerId: data.customerId,
            inventoryId: item.inventoryId,
            checkoutId: checkout.id,
            transactionDate: txDate,
          });

          // Update inventory quantity
          if (inventoryItem.type === "product") {
            const newQuantity = inventoryItem.quantity - item.quantity;
            await tx.update(inventory)
              .set({ quantity: newQuantity })
              .where(eq(inventory.id, item.inventoryId));
            
            if (newQuantity <= lowStockThreshold) {
              lowStockItems.push({ name: inventoryItem.name, quantity: newQuantity });
            }
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
                totalGrossProfit: existingPL.totalGrossProfit + profit,
              })
              .where(eq(profitLoss.id, existingPL.id));
          } else {
            await tx.insert(profitLoss).values({
              storeId: data.storeId,
              inventoryId: item.inventoryId,
              totalQuantitySold: item.quantity,
              quantityRemaining: inventoryItem.quantity - item.quantity,
              totalRevenue: revenue,
              totalGrossProfit: profit,
            });
          }
        }
      });

      // Notify managers about low stock items
      for (const item of lowStockItems) {
        await this.notifyManagers(data.storeId, "low_stock", `Low stock alert: ${item.name} has only ${item.quantity} units left.`);
      }

      return { success: true, message: "Sale completed successfully", checkoutIds };
    } catch (error) {
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
    reason?: string;
    attachment?: string | null;
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
        reason: data.reason || "Regular Restock",
        attachment: data.attachment || null,
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
      
      // Validation: Ensure no overlapping paid periods for any staff in this store
      const period = await this.getPayrollPeriod(id);
      if (!period) throw new Error("Period not found");

      const overlaps = await db.select()
        .from(payrollPeriods)
        .where(and(
          eq(payrollPeriods.storeId, period.storeId),
          eq(payrollPeriods.status, "paid"),
          sql`${payrollPeriods.id} != ${id}`,
          sql`(${payrollPeriods.startDate}::DATE, ${payrollPeriods.endDate}::DATE) OVERLAPS (${period.startDate}::DATE, ${period.endDate}::DATE)`
        ));
      
      if (overlaps.length > 0) {
        throw new Error(`This period overlaps with an existing Paid period: ${overlaps[0].startDate} to ${overlaps[0].endDate}`);
      }
    }
    const [updated] = await db.update(payrollPeriods).set(setData).where(eq(payrollPeriods.id, id)).returning();
    return updated;
  }

  async deletePayrollPeriod(id: string): Promise<boolean> {
    const period = await this.getPayrollPeriod(id);
    if (!period) return false;
    
    // Only allow deletion of pending or approved periods
    if (period.status === "paid") {
      throw new Error("You cannot delete a payroll period that has already been marked as Paid.");
    }

    await db.transaction(async (tx) => {
      // Delete entries first
      await tx.delete(payrollEntries).where(eq(payrollEntries.periodId, id));
      // Delete the period
      await tx.delete(payrollPeriods).where(eq(payrollPeriods.id, id));
    });

    return true;
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

  // CommissionSplitCalculator class implementing clean OOP design pattern
  // Follows strict override priority: Service -> Store -> Business -> Fallback.
  CommissionSplitCalculator = class {
    private businessStaffShare: number;
    private storeStaffShare: number;
    private storeOverride: boolean;

    constructor(business: any, store: any) {
      this.businessStaffShare = business?.commissionSplitStaffShare ?? 20;
      this.storeStaffShare = store?.commissionSplitStaffShare ?? 20;
      this.storeOverride = store?.commissionSplitOverride ?? false;
    }

    public getStaffRate(item: any): number {
      if (item?.commissionSplitOverride) {
        return (item.commissionSplitStaffShare ?? 20) / 100;
      }
      if (this.storeOverride) {
        return this.storeStaffShare / 100;
      }
      return this.businessStaffShare / 100;
    }
  }

  // Option 4 Hybrid Model Commission Calculation Engine
  async calculatePayrollForPeriod(periodId: string): Promise<PayrollEntryWithStaff[]> {
    const [period] = await db.select().from(payrollPeriods).where(eq(payrollPeriods.id, periodId));
    if (!period) throw new Error("Payroll period not found");
    if (period.status === "paid") throw new Error("Cannot recalculate a paid payroll period.");

    const store = await this.getStore(period.storeId);
    if (!store) throw new Error("Store not found");
    const business = await this.getBusinessById(store.businessId);
    const splitCalculator = new this.CommissionSplitCalculator(business, store);

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
    const allDateStrs = Array.from(new Set([
      ...Array.from(checkoutsByDate.keys()), 
      ...Array.from(attendanceByDateStaff.keys())
    ])).sort();

    for (const dateStr of allDateStrs) {
      if (dateStr < period.startDate || dateStr > period.endDate) continue;

      const dayCheckouts = checkoutsByDate.get(dateStr) || [];
      
      // Group dayCheckouts by receiptNumber to allocate pro-rata discounts with rounding correction
      const checkoutsByReceipt = new Map<string, typeof dayCheckouts>();
      for (const row of dayCheckouts) {
        if (!checkoutsByReceipt.has(row.checkout.receiptNumber)) {
          checkoutsByReceipt.set(row.checkout.receiptNumber, []);
        }
        checkoutsByReceipt.get(row.checkout.receiptNumber)!.push(row);
      }

      // Calculate effective prices for all checkouts
      const effectivePrices = new Map<string, number>(); // checkoutId -> effectivePrice

      for (const [receiptNo, rows] of Array.from(checkoutsByReceipt.entries())) {
        const firstRow = rows[0];
        const totalDiscount = firstRow.checkout.discountAmount || 0;
        const subtotal = firstRow.checkout.subtotal || 1;

        if (totalDiscount <= 0) {
          for (const row of rows) {
            effectivePrices.set(row.checkout.id, row.checkout.totalPrice);
          }
        } else {
          // Calculate initial pro-rata shares
          let sumShares = 0;
          const shares = new Map<string, number>();

          for (const row of rows) {
            // Round to 2 decimal places
            const share = Math.round((row.checkout.totalPrice / subtotal) * totalDiscount * 100) / 100;
            shares.set(row.checkout.id, share);
            sumShares += share;
          }

          // Remainder rounding correction
          const remainder = Math.round((totalDiscount - sumShares) * 100) / 100;
          if (remainder !== 0) {
            // Find row with highest totalPrice
            let maxRow = rows[0];
            for (const row of rows) {
              if (row.checkout.totalPrice > maxRow.checkout.totalPrice) {
                maxRow = row;
              }
            }
            const currentShare = shares.get(maxRow.checkout.id) || 0;
            shares.set(maxRow.checkout.id, Math.round((currentShare + remainder) * 100) / 100);
          }

          // Compute effective prices
          for (const row of rows) {
            const share = shares.get(row.checkout.id) || 0;
            effectivePrices.set(row.checkout.id, Math.max(0, row.checkout.totalPrice - share));
          }
        }
      }

      const dayServiceCheckouts = dayCheckouts.filter(c => c.inventoryItem.type === "service");

      // Identify all distinct staff assigned to any service line items that day
      const dailyActiveStaffIds = new Set<string>();
      let totalDailyServiceRevenue = 0;

      for (const row of dayServiceCheckouts) {
        const effectivePrice = effectivePrices.get(row.checkout.id) ?? row.checkout.totalPrice;
        totalDailyServiceRevenue += effectivePrice;
        const leadId = row.checkout.leadStaffId || row.checkout.staffId;
        dailyActiveStaffIds.add(leadId);
        if (row.checkout.assistingStaff1Id) dailyActiveStaffIds.add(row.checkout.assistingStaff1Id);
        if (row.checkout.assistingStaff2Id) dailyActiveStaffIds.add(row.checkout.assistingStaff2Id);
      }

      const activeStaffCount = dailyActiveStaffIds.size;
      const dayAttendance = attendanceByDateStaff.get(dateStr) || new Map<string, string>();

      // Update active/passive day counts per staff member for this day
      staffTotals.forEach((totals, staffId) => {
        const isAssigned = dailyActiveStaffIds.has(staffId);
        const status = dayAttendance.get(staffId);

        // Exclude off days and holidays entirely per spec
        if (status === "off_day" || status === "holiday") return;

        if (isAssigned) {
          // If assigned to service, automatically Active Day
          totals.activeDays++;
        } else if (status === "present") {
          // Present but not assigned -> Passive Day
          totals.passiveDays++;
        }
      });

      // If no service revenue, skip commission math
      if (totalDailyServiceRevenue <= 0 || activeStaffCount === 0) continue;

      // Distribute pool across service items proportionally with dynamic overrides
      const transportRatio = totalDailyServiceRevenue > 0 ? (activeStaffCount * activeTransportRate) / totalDailyServiceRevenue : 0;

      for (const row of dayServiceCheckouts) {
        const effectivePrice = effectivePrices.get(row.checkout.id) ?? row.checkout.totalPrice;
        const serviceCommissionable = Math.max(0, effectivePrice * (1 - transportRatio));
        const serviceRate = splitCalculator.getStaffRate(row.inventoryItem);
        const perServicePool = serviceCommissionable * serviceRate;

        const leadId = row.checkout.leadStaffId || row.checkout.staffId;
        const assistants = [row.checkout.assistingStaff1Id, row.checkout.assistingStaff2Id].filter(Boolean) as string[];
        const staffCount = 1 + assistants.length;

        let leadShare: number;
        let asstShare: number;

        if (row.checkout.commissionSplit === "equal") {
          leadShare = 1 / staffCount;
          asstShare = 1 / staffCount;
          console.log(`[Payroll] EQUAL split for service ${row.inventoryItem.name}: staffCount=${staffCount}, share=${leadShare.toFixed(3)}`);
        } else {
          leadShare = staffCount === 1 ? 1.0 : staffCount === 2 ? 0.8 : 0.6;
          asstShare = 0.2;
          console.log(`[Payroll] STANDARD split for service ${row.inventoryItem.name}: staffCount=${staffCount}, lead=${leadShare}, asst=${asstShare}`);
        }

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

    for (const [staffId, totals] of Array.from(staffTotals.entries())) {
      const activeTransport = totals.activeDays * activeTransportRate;
      const passiveTransport = totals.passiveDays * passiveTransportRate;
      const totalTransport = activeTransport + passiveTransport;
      const staffMember = staffMap.get(staffId)!;
      let netPay = totalTransport + totals.grossCommission;

      // Handle Fixed Payment Method
      if (staffMember.paymentMethod === "fixed") {
        netPay = staffMember.payPerMonth;
      }

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

    const allDateStrs = Array.from(new Set([
      ...Array.from(checkoutsByDate.keys()), 
      ...Array.from(attendanceMap.keys())
    ])).sort();

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

          let leadShare: number;
          let asstShare: number;

          if (row.checkout.commissionSplit === "equal") {
            leadShare = 1 / staffCount;
            asstShare = 1 / staffCount;
            console.log(`[Drilldown] EQUAL split for service ${row.inventoryItem.name}: staffCount=${staffCount}, share=${leadShare.toFixed(3)}`);
          } else {
            leadShare = staffCount === 1 ? 1.0 : staffCount === 2 ? 0.8 : 0.6;
            asstShare = 0.2;
            console.log(`[Drilldown] STANDARD split for service ${row.inventoryItem.name}: staffCount=${staffCount}, lead=${leadShare}, asst=${asstShare}`);
          }

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

  // Promotions CRUD
  async getPromotions(storeId: string): Promise<Promotion[]> {
    return await db.select().from(promotions).where(eq(promotions.storeId, storeId)).orderBy(asc(promotions.name));
  }

  async createPromotion(data: InsertPromotion & { storeId: string }): Promise<Promotion> {
    const [row] = await db.insert(promotions).values(data).returning();
    return row;
  }

  async updatePromotion(id: string, data: Partial<InsertPromotion>): Promise<Promotion | undefined> {
    const [row] = await db.update(promotions).set(data).where(eq(promotions.id, id)).returning();
    return row;
  }

  async deletePromotion(id: string): Promise<boolean> {
    const res = await db.delete(promotions).where(eq(promotions.id, id)).returning();
    return res.length > 0;
  }

  // Custom Roles CRUD
  async getCustomRoles(businessId: string): Promise<CustomRole[]> {
    return await db.select().from(customRoles).where(eq(customRoles.businessId, businessId)).orderBy(asc(customRoles.name));
  }

  async createCustomRole(data: InsertCustomRole & { businessId: string }): Promise<CustomRole> {
    const [row] = await db.insert(customRoles).values({
      businessId: data.businessId,
      name: data.name,
      description: data.description || null,
      permissions: data.permissions || [],
    }).returning();
    return row;
  }

  async updateCustomRole(id: string, data: Partial<InsertCustomRole>): Promise<CustomRole | undefined> {
    const [row] = await db.update(customRoles).set({
      ...data,
      updatedAt: new Date(),
    }).where(eq(customRoles.id, id)).returning();
    return row;
  }

  async deleteCustomRole(id: string): Promise<boolean> {
    const res = await db.delete(customRoles).where(eq(customRoles.id, id)).returning();
    return res.length > 0;
  }

  // Store Integrations
  async getStoreIntegrations(storeId: string): Promise<StoreIntegration[]> {
    return await db.select().from(storeIntegrations).where(eq(storeIntegrations.storeId, storeId));
  }

  async getStoreIntegrationByProvider(storeId: string, provider: string): Promise<StoreIntegration | undefined> {
    const [row] = await db
      .select()
      .from(storeIntegrations)
      .where(and(eq(storeIntegrations.storeId, storeId), eq(storeIntegrations.provider, provider)));
    return row;
  }

  async upsertStoreIntegration(data: InsertStoreIntegration & { storeId: string; provider: string }): Promise<StoreIntegration> {
    const existing = await this.getStoreIntegrationByProvider(data.storeId, data.provider);
    if (existing) {
      const [updated] = await db
        .update(storeIntegrations)
        .set({
          ...data,
          updatedAt: new Date(),
        })
        .where(eq(storeIntegrations.id, existing.id))
        .returning();
      return updated;
    }
    
    const [inserted] = await db.insert(storeIntegrations).values(data).returning();
    return inserted;
  }

  async deleteStoreIntegration(id: string): Promise<void> {
    await db.delete(storeIntegrations).where(eq(storeIntegrations.id, id));
  }

  // Expense Categories CRUD
  async getExpenseCategories(storeId: string): Promise<ExpenseCategory[]> {
    return db.select().from(expenseCategories).where(eq(expenseCategories.storeId, storeId)).orderBy(asc(expenseCategories.name));
  }

  async createExpenseCategory(data: InsertExpenseCategory): Promise<ExpenseCategory> {
    const [inserted] = await db.insert(expenseCategories).values(data).returning();
    return inserted;
  }

  async deleteExpenseCategory(id: string): Promise<void> {
    const associatedExpenses = await db.select()
      .from(expenses)
      .where(eq(expenses.categoryId, id))
      .limit(1);

    if (associatedExpenses.length > 0) {
      throw new Error("conflict:Cannot delete expense category. It may be in use.");
    }

    await db.delete(expenseCategories).where(eq(expenseCategories.id, id));
  }

  // Expenses CRUD
  async getExpenses(
    storeId: string,
    startDate?: string,
    endDate?: string,
    type?: "all" | "general" | "linked" | "service" | "product",
    inventoryId?: string
  ): Promise<ExpenseWithCategory[]> {
    let conditions = [eq(expenses.storeId, storeId)];
    if (startDate) conditions.push(gte(expenses.date, startDate));
    if (endDate) conditions.push(lte(expenses.date, endDate));
    if (inventoryId && inventoryId !== "none" && inventoryId !== "all") {
      conditions.push(eq(expenses.inventoryId, inventoryId));
    }

    const rows = await db.select({
      expense: expenses,
      category: expenseCategories,
      inventory: inventory,
    })
      .from(expenses)
      .leftJoin(expenseCategories, eq(expenses.categoryId, expenseCategories.id))
      .leftJoin(inventory, eq(expenses.inventoryId, inventory.id))
      .where(and(...conditions))
      .orderBy(desc(expenses.date));

    let mapped = rows.map(r => ({
      ...r.expense,
      category: r.category!,
      inventory: r.inventory || undefined,
    })) as ExpenseWithCategory[];

    if (type && type !== "all") {
      if (type === "general") {
        mapped = mapped.filter(e => !e.inventoryId);
      } else if (type === "linked") {
        mapped = mapped.filter(e => !!e.inventoryId);
      } else if (type === "service") {
        mapped = mapped.filter(e => e.inventory?.type === "service");
      } else if (type === "product") {
        mapped = mapped.filter(e => e.inventory?.type === "product");
      }
    }

    return mapped;
  }

  async updateExpense(id: string, data: Partial<InsertExpense>): Promise<Expense> {
    const [updated] = await db.update(expenses)
      .set(data)
      .where(eq(expenses.id, id))
      .returning();
    return updated;
  }

  async getPaidPayrollExpenses(storeId: string, startDate?: string, endDate?: string): Promise<{ label: string; amount: number }[]> {
    const conditions: any[] = [
      eq(payrollPeriods.storeId, storeId),
      eq(payrollPeriods.status, "paid")
    ];
    if (startDate) conditions.push(gte(payrollPeriods.endDate, startDate));
    if (endDate) conditions.push(lte(payrollPeriods.startDate, endDate));
    
    const paidPeriods = await db.select().from(payrollPeriods).where(and(...conditions));
    const payrollDetails = [];

    for (const period of paidPeriods) {
      const entries = await db.select().from(payrollEntries).where(eq(payrollEntries.periodId, period.id));
      const periodTotal = entries.reduce((sum, entry) => sum + entry.netPay, 0);
      
      payrollDetails.push({
        label: `Payroll — ${new Date(period.startDate).toLocaleDateString()} to ${new Date(period.endDate).toLocaleDateString()}`,
        amount: periodTotal
      });
    }
    return payrollDetails;
  }

  async createExpense(data: InsertExpense): Promise<Expense> {
    const [inserted] = await db.insert(expenses).values(data).returning();
    return inserted;
  }

  async deleteExpense(id: string): Promise<void> {
    await db.delete(expenses).where(eq(expenses.id, id));
  }

  async getProfitLossSummary(storeId: string, startDate?: string, endDate?: string): Promise<{
    serviceRevenue: number;
    productRevenue: number;
    totalRevenue: number;
    costOfGoodsSold: number;
    grossProfit: number;
    discountsGiven: number;
    discountsList: Array<{
      receiptNumber: string;
      discountAmount: number;
      discountPercent: number;
      discountReason: string | null;
      discountApprovedBy: string | null;
      createdAt: Date;
    }>;
  }> {
    // Build checkout date filter conditions
    const conditions: any[] = [
      eq(checkouts.storeId, storeId),
      eq(checkouts.paymentStatus, "completed"),
      eq(checkouts.isVoided, false),
    ];
    if (startDate) conditions.push(gte(checkouts.createdAt, new Date(startDate + "T00:00:00.000Z")));
    if (endDate) conditions.push(lte(checkouts.createdAt, new Date(endDate + "T23:59:59.999Z")));

    // Join orders → checkouts → inventory to get per-item revenue and cost
    const rows = await db
      .select({
        inventoryType: inventory.type,
        costPrice: inventory.costPrice,
        quantity: orders.quantity,
        totalPrice: orders.totalPrice,
      })
      .from(orders)
      .innerJoin(checkouts, eq(checkouts.orderId, orders.id))
      .innerJoin(inventory, eq(inventory.id, orders.inventoryId))
      .where(and(...conditions));

    let serviceRevenue = 0;
    let productRevenue = 0;
    let costOfGoodsSold = 0;

    for (const row of rows) {
      if (row.inventoryType === "service") {
        serviceRevenue += row.totalPrice;
      } else {
        productRevenue += row.totalPrice;
      }
      costOfGoodsSold += (row.costPrice ?? 0) * row.quantity;
    }

    const totalRevenue = serviceRevenue + productRevenue;
    const grossProfit = totalRevenue - costOfGoodsSold;

    // Fetch unique transaction discounts in the period
    const discountConditions: any[] = [
      eq(checkouts.storeId, storeId),
      eq(checkouts.paymentStatus, "completed"),
      eq(checkouts.isVoided, false),
      gt(checkouts.discountAmount, 0),
    ];
    if (startDate) discountConditions.push(gte(checkouts.createdAt, new Date(startDate + "T00:00:00.000Z")));
    if (endDate) discountConditions.push(lte(checkouts.createdAt, new Date(endDate + "T23:59:59.999Z")));

    const uniqueTxDiscounts = await db
      .select({
        receiptNumber: checkouts.receiptNumber,
        discountAmount: checkouts.discountAmount,
        discountPercent: checkouts.discountPercent,
        discountReason: checkouts.discountReason,
        discountApprovedBy: checkouts.discountApprovedBy,
        createdAt: checkouts.createdAt,
        subtotal: sql<number>`sum(${checkouts.totalPrice})`,
      })
      .from(checkouts)
      .where(and(...discountConditions))
      .groupBy(
        checkouts.receiptNumber,
        checkouts.discountAmount,
        checkouts.discountPercent,
        checkouts.discountReason,
        checkouts.discountApprovedBy,
        checkouts.createdAt
      );

    const discountsGiven = uniqueTxDiscounts.reduce((sum, d) => sum + (d.discountAmount || 0), 0);

    return { 
      serviceRevenue, 
      productRevenue, 
      totalRevenue, 
      costOfGoodsSold, 
      grossProfit, 
      discountsGiven,
      discountsList: uniqueTxDiscounts
    };
  }

  // ─── Void a checkout ───────────────────────────────────────────────────────
  async voidCheckout(checkoutId: string, reason: string, voidedByUserId: string): Promise<{ success: boolean; message: string }> {
    try {
      await db.transaction(async (tx) => {
        // Fetch the checkout
        const [primaryCheckout] = await tx.select().from(checkouts).where(eq(checkouts.id, checkoutId));
        if (!primaryCheckout) throw new Error("Transaction not found.");

        // Find all checkouts with the same receiptNumber
        const matchedCheckouts = await tx.select().from(checkouts)
          .where(eq(checkouts.receiptNumber, primaryCheckout.receiptNumber));

        for (const checkout of matchedCheckouts) {
          if (checkout.isVoided) continue; // Already voided

          // Mark as voided
          await tx.update(checkouts)
            .set({ isVoided: true, voidedAt: new Date(), voidedByUserId, voidReason: reason })
            .where(eq(checkouts.id, checkout.id));

          // Fetch the order
          const [order] = await tx.select().from(orders).where(eq(orders.id, checkout.orderId));
          if (!order) continue;

          // Fetch inventory item
          const [inventoryItem] = await tx.select().from(inventory).where(eq(inventory.id, order.inventoryId));
          if (!inventoryItem) continue;

          // Restore stock for product-type items
          if (inventoryItem.type === "product") {
            await tx.update(inventory)
              .set({ quantity: inventoryItem.quantity + order.quantity })
              .where(eq(inventory.id, inventoryItem.id));
          }

          // Reverse the P&L record
          const [existingPL] = await tx.select().from(profitLoss)
            .where(and(eq(profitLoss.inventoryId, inventoryItem.id), eq(profitLoss.storeId, checkout.storeId)));
          if (existingPL) {
            const revenue = order.totalPrice;
            const profit = revenue - inventoryItem.costPrice * order.quantity;
            await tx.update(profitLoss)
              .set({
                totalQuantitySold: Math.max(0, existingPL.totalQuantitySold - order.quantity),
                quantityRemaining: inventoryItem.quantity + order.quantity,
                totalRevenue: Math.max(0, existingPL.totalRevenue - revenue),
                totalGrossProfit: existingPL.totalGrossProfit - profit,
              })
              .where(eq(profitLoss.id, existingPL.id));
          }
        }
      });

      // Fetch checkout details for notification
      const [checkout] = await db.select().from(checkouts).where(eq(checkouts.id, checkoutId));
      if (checkout) {
        await this.notifyManagers(checkout.storeId, "void_transaction", `Transaction ${checkout.receiptNumber} was voided.`);
      }

      return { success: true, message: "Transaction voided successfully." };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not void transaction.";
      return { success: false, message };
    }
  }

  // ─── Get receipt payload ───────────────────────────────────────────────────
  async getReceiptPayload(checkoutId: string) {
    const [primaryCheckout] = await db.select().from(checkouts).where(eq(checkouts.id, checkoutId));
    if (!primaryCheckout) return null;

    // Get all checkouts in the same transaction
    const matchedCheckouts = await db.select().from(checkouts)
      .where(eq(checkouts.receiptNumber, primaryCheckout.receiptNumber));

    const items = [];
    for (const ch of matchedCheckouts) {
      const [order] = await db.select().from(orders).where(eq(orders.id, ch.orderId));
      const [inventoryItem] = order ? await db.select().from(inventory).where(eq(inventory.id, order.inventoryId)) : [null];
      const [leadStaffMember] = ch.leadStaffId
        ? await db.select().from(staff).where(eq(staff.id, ch.leadStaffId))
        : [null];
      items.push({
        checkout: ch,
        order,
        inventory: inventoryItem,
        leadStaff: leadStaffMember,
      });
    }

    const [store] = await db.select().from(stores).where(eq(stores.id, primaryCheckout.storeId));
    const [business] = store ? await db.select().from(businesses).where(eq(businesses.id, store.businessId)) : [null];
    const [storeSettings] = await db.select().from(settings).where(eq(settings.storeId, primaryCheckout.storeId));
    const [staffMember] = await db.select().from(staff).where(eq(staff.id, primaryCheckout.staffId));

    // Find transaction for customer
    const [tx] = await db.select().from(transactions).where(eq(transactions.checkoutId, checkoutId));
    const [customer] = tx ? await db.select().from(customers).where(eq(customers.id, tx.customerId)) : [null];

    return {
      business: business ? { name: business.name } : null,
      store: store ? { name: store.name, currency: store.currency, phone: store.phone, address: store.address } : null,
      settings: storeSettings ? { receiptPrefix: storeSettings.receiptPrefix || "RCP", receiptThankYouMessage: storeSettings.receiptThankYouMessage } : null,
      checkout: primaryCheckout,
      order: items[0]?.order || null,
      inventory: items[0]?.inventory || null,
      customer,
      staff: staffMember,
      leadStaff: items[0]?.leadStaff || null,
      items, // Group of all items in this transaction
    };
  }

  // ─── Update checkout payment method/status ─────────────────────────────────
  async updateCheckoutPaymentMethod(checkoutId: string, paymentMethod: string, paymentStatus: string): Promise<boolean> {
    const [primaryCheckout] = await db.select().from(checkouts).where(eq(checkouts.id, checkoutId));
    if (!primaryCheckout) return false;

    const result = await db.update(checkouts)
      .set({ paymentMethod, paymentStatus })
      .where(eq(checkouts.receiptNumber, primaryCheckout.receiptNumber))
      .returning();
    return result.length > 0;
  }

  async getStaffPerformance(storeId: string, startDate?: string, endDate?: string): Promise<any[]> {
    const activeStaff = await db.select().from(staff).where(and(eq(staff.storeId, storeId), eq(staff.isArchived, false)));
    
    // Checkouts in range
    const checkoutConditions = [
      eq(checkouts.storeId, storeId),
      eq(checkouts.paymentStatus, "completed"),
      eq(checkouts.isVoided, false),
    ];
    if (startDate) checkoutConditions.push(gte(checkouts.createdAt, new Date(startDate + "T00:00:00.000Z")));
    if (endDate) checkoutConditions.push(lte(checkouts.createdAt, new Date(endDate + "T23:59:59.999Z")));

    const rows = await db.select({
      checkout: checkouts,
      order: orders,
      inventoryItem: inventory,
    })
      .from(orders)
      .innerJoin(checkouts, eq(orders.id, checkouts.orderId))
      .innerJoin(inventory, eq(orders.inventoryId, inventory.id))
      .where(and(...checkoutConditions));

    // Attendance in range
    const attendanceConditions = [eq(attendanceRecords.storeId, storeId)];
    if (startDate) attendanceConditions.push(gte(attendanceRecords.date, startDate));
    if (endDate) attendanceConditions.push(lte(attendanceRecords.date, endDate));
    
    const attendanceList = await db.select().from(attendanceRecords).where(and(...attendanceConditions));

    return activeStaff.map(s => {
      const staffCheckouts = rows.filter(r => 
        r.checkout.leadStaffId === s.id || 
        r.checkout.staffId === s.id || 
        r.checkout.assistingStaff1Id === s.id || 
        r.checkout.assistingStaff2Id === s.id
      );

      const leadCheckouts = rows.filter(r => r.checkout.leadStaffId === s.id || (r.checkout.staffId === s.id && !r.checkout.leadStaffId));
      
      const totalRevenue = leadCheckouts.reduce((sum, r) => sum + r.order.totalPrice, 0);
      const servicesCount = leadCheckouts.filter(r => r.inventoryItem.type === "service").length;
      const productsCount = leadCheckouts.filter(r => r.inventoryItem.type === "product").length;

      const staffAttendance = attendanceList.filter(a => a.staffId === s.id);
      const presentDays = staffAttendance.filter(a => a.status === "present").length;
      const absentDays = staffAttendance.filter(a => a.status === "absent").length;

      return {
        id: s.id,
        name: s.name,
        role: s.role,
        totalRevenue,
        servicesCount,
        productsCount,
        presentDays,
        absentDays,
      };
    });
  }

  async searchCustomers(storeId: string, query: string): Promise<Customer[]> {
    return db.select()
      .from(customers)
      .where(and(eq(customers.storeId, storeId), ilike(customers.name, `%${query}%`)))
      .limit(10);
  }

  async searchInventory(storeId: string, query: string): Promise<Inventory[]> {
    return db.select()
      .from(inventory)
      .where(and(eq(inventory.storeId, storeId), ilike(inventory.name, `%${query}%`)))
      .limit(10);
  }

  async searchTransactions(storeId: string, query: string): Promise<any[]> {
    return db.select()
      .from(checkouts)
      .where(and(eq(checkouts.storeId, storeId), or(ilike(checkouts.receiptNumber, `%${query}%`), ilike(checkouts.paymentReference, `%${query}%`))))
      .limit(10);
  }

  async getNotifications(userId: string): Promise<Notification[]> {
    return db.select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(50);
  }

  async markNotificationAsRead(id: string): Promise<void> {
    await db.update(notifications)
      .set({ isRead: true })
      .where(eq(notifications.id, id));
  }

  async markAllNotificationsAsRead(userId: string): Promise<void> {
    await db.update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
  }

  async createNotification(data: InsertNotification): Promise<Notification> {
    const [notification] = await db.insert(notifications).values(data).returning();
    
    // Broadcast the notification in real-time to all active WebSocket connections
    try {
      broadcastNotification(notification);
    } catch (err) {
      console.error("Failed to broadcast notification over WebSocket:", err);
    }

    return notification;
  }

  async getTopCustomers(storeId: string): Promise<any[]> {
    return db.select({
      id: customers.id,
      name: customers.name,
      customerNumber: customers.customerNumber,
      totalSpent: sql<number>`sum(${checkouts.totalPrice})`,
      transactionCount: sql<number>`count(${checkouts.id})`,
    })
      .from(customers)
      .innerJoin(transactions, eq(customers.id, transactions.customerId))
      .innerJoin(checkouts, eq(transactions.checkoutId, checkouts.id))
      .where(and(eq(customers.storeId, storeId), eq(checkouts.isVoided, false)))
      .groupBy(customers.id, customers.name, customers.customerNumber)
      .orderBy(desc(sql`sum(${checkouts.totalPrice})`))
      .limit(10);
  }

  async notifyManagers(storeId: string, type: string, message: string): Promise<void> {
    // Get store to find businessId
    const [store] = await db.select().from(stores).where(eq(stores.id, storeId));
    if (!store) return;

    // Find all owners and managers for this business
    const managers = await db.select().from(users).where(
      and(
        eq(users.businessId, store.businessId),
        or(eq(users.role, "owner"), eq(users.role, "manager"))
      )
    );

    // Create notification for each
    for (const mgr of managers) {
      await this.createNotification({
        storeId,
        userId: mgr.id,
        type,
        message,
      });
    }
  }
}

export const storage = new DatabaseStorage();
