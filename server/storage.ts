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
  bookings,
  bookingItems,
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
  type Booking,
  type InsertBooking,
  type BookingItem,
  type InsertBookingItem,
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
  payrollDeductions,
  type PayrollDeduction,
  type InsertPayrollDeduction,
  payrollDisbursements,
  type PayrollDisbursement,
  type InsertPayrollDisbursement,
  salaryAdvances,
  type SalaryAdvance,
  type InsertSalaryAdvance,
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
  creditEntries,
  repayments,
  returnLogs,
  cashRegisterSessions,
  cashDrops,
  bundleComponents,
  vendors,
  vendorBills,
  stockAudits,
  stockAuditItems,
  taxRates,
  inventoryBatches,
  quotes,
  storeCreditTransactions,
  type Product,
  type InsertProduct,
} from "@shared/schema";
import { db } from "./db";
import { eq, sql, desc, count, and, asc, or, inArray, ilike, gt, gte, lte } from "drizzle-orm";
import { payrollService } from "./services/PayrollService";
import { CommissionSplitCalculator as OOPCommissionSplitCalculator } from "./services/CommissionService";
import { UserRepository } from "./repositories/UserRepository";
import { InventoryRepository } from "./repositories/InventoryRepository";
import { ProductRepository } from "./repositories/ProductRepository";
import { ExpenseRepository } from "./repositories/ExpenseRepository";
import { CreditRepository } from "./repositories/CreditRepository";
import { VendorRepository } from "./repositories/VendorRepository";
import { CashRegisterRepository } from "./repositories/CashRegisterRepository";
import { StockAuditRepository } from "./repositories/StockAuditRepository";
import { QuoteRepository } from "./repositories/QuoteRepository";
import { normalizePhoneNumber } from "./sanitize";
import { PurchaseOrderRepository } from "./repositories/PurchaseOrderRepository";
import { StockTransferRepository } from "./repositories/StockTransferRepository";
import { TaxRateRepository } from "./repositories/TaxRateRepository";
import { BusinessRepository } from "./repositories/BusinessRepository";
import { CustomerRepository } from "./repositories/CustomerRepository";
import { StaffRepository } from "./repositories/StaffRepository";
import { BookingRepository } from "./repositories/BookingRepository";
import { TransactionRepository, type TransactionFilters } from "./repositories/TransactionRepository";
import { SalesRepository } from "./repositories/SalesRepository";
import { AnalyticsRepository } from "./repositories/AnalyticsRepository";
import { RestockRepository } from "./repositories/RestockRepository";
import { AttendanceRepository } from "./repositories/AttendanceRepository";
import { PayrollRepository } from "./repositories/PayrollRepository";
import { NotificationRepository } from "./repositories/NotificationRepository";

export function serializeUser(user: any) {
  if (!user) return null;
  const {
    password,
    passwordHash,
    otpCode,
    otpExpiry,
    activationCode,
    activationCodeExpiry,
    loginAttempts,
    lockedUntil,
    ...cleanUser
  } = user;
  return cleanUser;
}

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
  getBusinessesByIds(ids: string[]): Promise<Business[]>;
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
  findCustomerByPhone(storeId: string, phone: string): Promise<Customer | undefined>;
  dismissDuplicate(targetId: string, duplicateId: string): Promise<void>;
  mergeCustomers(targetId: string, duplicateId: string, customFields?: Partial<InsertCustomer>): Promise<Customer>;
  linkGlobalCustomerIds(customerId: string): Promise<void>;
  getBusinessCustomerCount(businessId: string, startDate?: string, endDate?: string): Promise<number>;
  searchGlobalCustomers(businessId: string, currentStoreId: string, query: string): Promise<any[]>;
  profileGlobalCustomer(customerId: string, targetStoreId: string): Promise<Customer>;

  // Staff
  getStaffList(storeId: string, includeArchived?: boolean): Promise<Staff[]>;
  getStaffPaginated(storeId: string, options: PaginationOptions): Promise<PaginatedResult<Staff>>;
  getStaff(id: string): Promise<Staff | undefined>;
  getStaffByUserId(userId: string): Promise<Staff | undefined>;
  getStaffByEmail(email: string): Promise<(Staff & { store: Store }) | undefined>;
  createStaff(staffMember: InsertStaff & { userId?: string | null }): Promise<Staff>;
  updateStaff(id: string, staffMember: Partial<InsertStaff> & { userId?: string }): Promise<Staff | undefined>;
  transferStaff(id: string, targetStoreId: string): Promise<Staff | undefined>;
  deleteStaff(id: string): Promise<boolean>;
  archiveStaff(id: string): Promise<Staff | undefined>;
  restoreStaff(id: string): Promise<Staff | undefined>;
  hasStaffCheckouts(id: string): Promise<boolean>;

  // Products
  getProducts(storeId: string): Promise<any[]>;
  getProductsPaginated(storeId: string, options: PaginationOptions): Promise<PaginatedResult<any>>;
  getProduct(id: string): Promise<any>;
  getProductByName(storeId: string, name: string): Promise<Product | undefined>;
  createProduct(product: InsertProduct): Promise<Product>;
  updateProduct(id: string, product: Partial<InsertProduct>): Promise<Product | undefined>;
  deleteProduct(id: string): Promise<boolean>;
  getArchivedProducts(storeId: string): Promise<any[]>;
  restoreProduct(id: string): Promise<boolean>;
  getProductByIdRaw(id: string): Promise<any>;

  // Inventory
  getInventory(storeId: string): Promise<Inventory[]>;
  getInventoryPaginated(storeId: string, options: PaginationOptions): Promise<PaginatedResult<Inventory>>;
  getInventoryForStores(storeIds: string[], options: PaginationOptions): Promise<PaginatedResult<Inventory>>;
  getInventoryItem(id: string): Promise<Inventory | undefined>;
  getInventoryItemByName(storeId: string, name: string): Promise<Inventory | undefined>;
  createInventoryItem(item: InsertInventory): Promise<Inventory>;
  updateInventoryItem(id: string, item: Partial<InsertInventory>): Promise<Inventory | undefined>;
  deleteInventoryItem(id: string): Promise<boolean>;
  hasInventoryTransactions(id: string): Promise<boolean>;
  getBundleComponents(parentInventoryId: string): Promise<any[]>;
  setBundleComponents(parentInventoryId: string, components: { componentInventoryId: string; quantity: number }[]): Promise<void>;

  // Orders
  createOrder(order: InsertOrder): Promise<Order>;

  // Checkouts
  createCheckout(checkout: InsertCheckout): Promise<Checkout>;
  updateCheckoutPaymentStatus(id: string, status: "pending" | "completed" | "failed"): Promise<Checkout | undefined>;

  // Transactions
  getTransactions(storeId: string, filters?: TransactionFilters): Promise<TransactionWithRelations[]>;
  getTransactionById(id: string): Promise<TransactionWithRelations | null>;
  createTransaction(transaction: InsertTransaction): Promise<Transaction>;

  // Bookings
  getBookings(storeId: string): Promise<Booking[]>;
  getBookingsPaginated(storeId: string, options: PaginationOptions, filters?: {
    status?: string[];
    type?: string[];
    staffId?: string;
    customerId?: string;
    startDate?: string;
    endDate?: string;
    search?: string;
  }): Promise<PaginatedResult<Booking>>;
  getBooking(id: string): Promise<Booking | undefined>;
  getBookingItems(bookingId: string): Promise<BookingItem[]>;
  createBooking(data: InsertBooking & { bookingItems: InsertBookingItem[] }): Promise<Booking>;
  updateBooking(id: string, data: Partial<InsertBooking> & { bookingItems?: InsertBookingItem[] }): Promise<Booking | undefined>;
  updateBookingStatus(id: string, status: string): Promise<Booking | undefined>;
  rescheduleBooking(id: string, scheduledAt: Date, reason: string): Promise<Booking | undefined>;

  // Profit & Loss
  getProfitLoss(storeId: string): Promise<ProfitLossWithInventory[]>;
  updateProfitLoss(inventoryId: string, storeId: string): Promise<void>;

  // Dashboard Stats
  getDashboardStats(storeId: string, startDate?: string, endDate?: string): Promise<{
    totalCustomers: number;
    totalStaff: number;
    totalInventory: number;
    totalProducts: number;
    totalServices: number;
    totalTransactions: number;
    totalRevenue: number;
    grossRevenue: number;
    returnedRevenue: number;
    totalProfit: number;
    lowStockItems: Inventory[];
  }>;

  // Chart Data
  getSalesTrends(storeId: string, startDate?: string, endDate?: string): Promise<{ date: string; revenue: number; transactions: number }[]>;
  getRevenueByType(storeId: string, startDate?: string, endDate?: string): Promise<{ name: string; value: number; type: string }[]>;
  
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
    paymentMethod: "cash" | "transfer" | "flutterwave" | "credit" | "split" | "deposit" | "store_credit";
    splitPayments?: Array<{method: "cash" | "transfer" | "flutterwave" | "credit" | "store_credit", amount: number}>;
    discountAmount?: number;
    discountPercent?: number;
    discountReason?: string;
    discountApprovedBy?: string;
    effectiveDate?: string;
    creditUpfrontPaid?: number;
    creditDueDate?: string;
    bookingId?: string;
    bookingDepositAmount?: number;
    bookingDepositMethod?: string;
    balanceCollectedToday?: number;
    pointsRedeemed?: number;
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
  updateExpenseCategory(id: string, name: string): Promise<ExpenseCategory>;
  deleteExpenseCategory(id: string): Promise<void>;

  getExpenses(
    storeId: string,
    startDate?: string,
    endDate?: string,
    type?: "all" | "general" | "linked" | "service" | "product",
    inventoryId?: string
  ): Promise<ExpenseWithCategory[]>;
  getExpenseById(id: string): Promise<ExpenseWithCategory | null>;
  createExpense(data: InsertExpense): Promise<Expense>;
  updateExpense(id: string, data: Partial<InsertExpense>): Promise<Expense>;
  deleteExpense(id: string): Promise<void>;

  getProfitLossSummary(storeId: string, startDate?: string, endDate?: string): Promise<{
    serviceRevenue: number;
    productRevenue: number;
    grossRevenue: number;
    returnedRevenue: number;
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
  voidCheckout(checkoutId: string, reason: string, voidedByUserId: string): Promise<{ success: boolean; message: string; payrollWarning?: string }>;

  // Returns & Store Credits
  processReturn(data: {
    storeId: string;
    checkoutId: string;
    items: Array<{ orderId: string; quantity: number; restock: boolean }>;
    refundMethod: string;
    refundAmount: number;
    reason: string;
    userId: string;
    staffId: string;
  }): Promise<{ success: boolean; message: string; returnLogIds?: string[] }>;

  getStoreCreditTransactions(customerId: string): Promise<any[]>;

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
  
  // Credit & Debt
  creditRepo: CreditRepository;
  vendorRepo: VendorRepository;
  cashRegisterRepo: CashRegisterRepository;
  stockAuditRepo: StockAuditRepository;
  inventoryRepo: InventoryRepository;
  quoteRepo: QuoteRepository;
  purchaseOrderRepo: PurchaseOrderRepository;
  stockTransferRepo: StockTransferRepository;
  taxRateRepo: TaxRateRepository;
  productRepo: ProductRepository;
}

export class DatabaseStorage implements IStorage {
  private userRepo = new UserRepository();
  public readonly inventoryRepo = new InventoryRepository();
  public readonly productRepo = new ProductRepository();
  private expenseRepo = new ExpenseRepository();
  public readonly creditRepo = new CreditRepository();
  public readonly vendorRepo = new VendorRepository();
  public readonly cashRegisterRepo = new CashRegisterRepository();
  public readonly stockAuditRepo = new StockAuditRepository();
  public readonly quoteRepo = new QuoteRepository();
  public readonly purchaseOrderRepo = new PurchaseOrderRepository();
  public readonly stockTransferRepo = new StockTransferRepository();
  public readonly taxRateRepo = new TaxRateRepository();
  private businessRepo = new BusinessRepository();
  private customerRepo = new CustomerRepository();
  private staffRepo = new StaffRepository();
  private bookingRepo = new BookingRepository();
  private transactionRepo = new TransactionRepository();
  private salesRepo = new SalesRepository();
  private analyticsRepo: AnalyticsRepository;
  private restockRepo = new RestockRepository();
  private attendanceRepo = new AttendanceRepository();
  private payrollRepo = new PayrollRepository();
  private notificationRepo = new NotificationRepository();

  constructor() {
    this.analyticsRepo = new AnalyticsRepository(this.salesRepo);
    this.salesRepo.setNotificationRepo(this.notificationRepo);
  }

  // Users & Auth
  async getUser(id: string): Promise<User | undefined> {
    return this.userRepo.getUser(id);
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return this.userRepo.getUserByEmail(email);
  }

  async getUserByIdentifier(emailOrPhone: string): Promise<User | undefined> {
    return this.userRepo.getUserByIdentifier(emailOrPhone);
  }

  async getUserByActivationCode(code: string): Promise<User | undefined> {
    return this.userRepo.getUserByActivationCode(code);
  }

  async getOrganisationsByUserId(userId: string): Promise<any[]> {
    return this.businessRepo.getOrganisationsByUserId(userId);
  }


  // ─── Business Repo Delegation ──────────────────────────────────────────────
  async getOrganisationMember(userId: string, organisationId: string): Promise<OrganisationMember | undefined> {
    return this.businessRepo.getOrganisationMember(userId, organisationId);
  }

  async createOrganisation(data: InsertOrganisation): Promise<Organisation> {
    return this.businessRepo.createOrganisation(data);
  }

  async createOrganisationMember(data: InsertOrganisationMember): Promise<OrganisationMember> {
    return this.businessRepo.createOrganisationMember(data);
  }

  async updateOrganisationMemberStatus(id: string, status: string, activatedAt?: Date): Promise<OrganisationMember> {
    return this.businessRepo.updateOrganisationMemberStatus(id, status, activatedAt);
  }

  async getOrganisationMembers(organisationId: string): Promise<(OrganisationMember & { user: User })[]> {
    return this.businessRepo.getOrganisationMembers(organisationId);
  }

  async getOrganisationMemberById(id: string): Promise<OrganisationMember | undefined> {
    return this.businessRepo.getOrganisationMemberById(id);
  }

  async getOrganisationBySlug(slug: string): Promise<Organisation | undefined> {
    return this.businessRepo.getOrganisationBySlug(slug);
  }

  async deleteOrganisationMember(id: string): Promise<void> {
    return this.businessRepo.deleteOrganisationMember(id);
  }

  async updateOrganisationMember(id: string, data: Partial<OrganisationMember>): Promise<OrganisationMember> {
    return this.businessRepo.updateOrganisationMember(id, data);
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
    return this.userRepo.createUser(userData);
  }

  async updateUser(id: string, data: Partial<User>): Promise<User | undefined> {
    return this.userRepo.updateUser(id, data);
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    return this.userRepo.upsertUser(userData);
  }

  // OTP Codes
  async createOtpCode(data: { userId: string; code: string; type: string; expiresAt: Date }): Promise<OtpCode> {
    return this.businessRepo.createOtpCode(data);
  }

  async getValidOtpCode(userId: string, code: string, type: string): Promise<OtpCode | undefined> {
    return this.businessRepo.getValidOtpCode(userId, code, type);
  }

  async markOtpCodeAsUsed(id: string): Promise<void> {
    return this.businessRepo.markOtpCodeAsUsed(id);
  }

  // Business for user
  async getBusinessByUserId(userId: string): Promise<Business | undefined> {
    return this.businessRepo.getBusinessByUserId(userId, (id) => this.userRepo.getUser(id));
  }

  // Business
  async getBusiness(): Promise<Business | undefined> {
    return this.businessRepo.getBusiness();
  }

  async getBusinessById(id: string): Promise<Business | undefined> {
    return this.businessRepo.getBusinessById(id);
  }

  async getBusinessesByIds(ids: string[]): Promise<Business[]> {
    if (!ids.length) return [];
    return db.select().from(businesses).where(inArray(businesses.id, ids));
  }

  async createBusiness(business: InsertBusiness): Promise<Business> {
    return this.businessRepo.createBusiness(business);
  }

  async updateBusiness(id: string, businessData: Partial<InsertBusiness>): Promise<Business | undefined> {
    return this.businessRepo.updateBusiness(id, businessData);
  }

  // Stores
  async getStores(businessId: string): Promise<Store[]> {
    return this.businessRepo.getStores(businessId);
  }

  async getStore(id: string): Promise<Store | undefined> {
    return this.businessRepo.getStore(id);
  }

  async getStoreByName(businessId: string, name: string): Promise<Store | undefined> {
    return this.businessRepo.getStoreByName(businessId, name);
  }

  async getStoreByCode(businessId: string, code: string): Promise<Store | undefined> {
    return this.businessRepo.getStoreByCode(businessId, code);
  }

  async createStore(store: InsertStore): Promise<Store> {
    return this.businessRepo.createStore(store);
  }

  async updateStore(id: string, storeData: Partial<InsertStore>): Promise<Store | undefined> {
    return this.businessRepo.updateStore(id, storeData);
  }

  async deleteStore(id: string): Promise<boolean> {
    return this.businessRepo.deleteStore(id);
  }

  async hasStoreData(id: string): Promise<boolean> {
    return this.businessRepo.hasStoreData(id);
  }

  // ─── Customer Repo Delegation ──────────────────────────────────────────────
  async getCustomers(storeId: string, includeArchived: boolean = true): Promise<Customer[]> {
    return this.customerRepo.getCustomers(storeId, includeArchived);
  }

  async getCustomersPaginated(storeId: string, options: PaginationOptions): Promise<PaginatedResult<Customer>> {
    return this.customerRepo.getCustomersPaginated(storeId, options);
  }

  async getCustomer(id: string): Promise<Customer | undefined> {
    return this.customerRepo.getCustomer(id);
  }

  async createCustomer(customer: InsertCustomer): Promise<Customer> {
    return this.customerRepo.createCustomer(customer);
  }

  async updateCustomer(id: string, customerData: Partial<InsertCustomer>): Promise<Customer | undefined> {
    return this.customerRepo.updateCustomer(id, customerData);
  }

  async deleteCustomer(id: string): Promise<boolean> {
    return this.customerRepo.deleteCustomer(id);
  }

  async archiveCustomer(id: string): Promise<Customer | undefined> {
    return this.customerRepo.archiveCustomer(id);
  }

  async restoreCustomer(id: string): Promise<Customer | undefined> {
    return this.customerRepo.restoreCustomer(id);
  }

  async hasCustomerTransactions(id: string): Promise<boolean> {
    return this.customerRepo.hasCustomerTransactions(id);
  }

  async findCustomerByPhone(storeId: string, phone: string): Promise<Customer | undefined> {
    return this.customerRepo.findCustomerByPhone(storeId, phone);
  }

  async dismissDuplicate(targetId: string, duplicateId: string): Promise<void> {
    return this.customerRepo.dismissDuplicate(targetId, duplicateId);
  }

  async mergeCustomers(targetId: string, duplicateId: string, customFields?: Partial<InsertCustomer>): Promise<Customer> {
    return this.customerRepo.mergeCustomers(targetId, duplicateId, customFields);
  }

  async linkGlobalCustomerIds(customerId: string): Promise<void> {
    return this.customerRepo.linkGlobalCustomerIds(customerId);
  }

  async getBusinessCustomerCount(businessId: string, startDate?: string, endDate?: string): Promise<number> {
    return this.customerRepo.getBusinessCustomerCount(businessId, startDate, endDate);
  }

  async searchGlobalCustomers(businessId: string, currentStoreId: string, query: string): Promise<any[]> {
    return this.customerRepo.searchGlobalCustomers(businessId, currentStoreId, query);
  }

  async profileGlobalCustomer(customerId: string, targetStoreId: string): Promise<Customer> {
    return this.customerRepo.profileGlobalCustomer(customerId, targetStoreId);
  }

  // ─── Staff Repo Delegation ─────────────────────────────────────────────────
  async getStaffList(storeId: string, includeArchived: boolean = true): Promise<Staff[]> {
    return this.staffRepo.getStaffList(storeId, includeArchived);
  }

  async getStaffPaginated(storeId: string, options: PaginationOptions): Promise<PaginatedResult<Staff>> {
    return this.staffRepo.getStaffPaginated(storeId, options);
  }

  async getStaff(id: string): Promise<Staff | undefined> {
    return this.staffRepo.getStaff(id);
  }

  async getStaffByUserId(userId: string): Promise<Staff | undefined> {
    return this.staffRepo.getStaffByUserId(userId);
  }

  async getStaffByEmail(email: string): Promise<(Staff & { store: Store }) | undefined> {
    return this.staffRepo.getStaffByEmail(email);
  }

  async createStaff(staffMember: InsertStaff & { userId?: string | null }): Promise<Staff> {
    return this.staffRepo.createStaff(staffMember);
  }

  async updateStaff(id: string, staffMember: Partial<InsertStaff> & { userId?: string }): Promise<Staff | undefined> {
    return this.staffRepo.updateStaff(id, staffMember);
  }

  async transferStaff(id: string, targetStoreId: string): Promise<Staff | undefined> {
    return this.staffRepo.transferStaff(id, targetStoreId);
  }

  async deleteStaff(id: string): Promise<boolean> {
    return this.staffRepo.deleteStaff(id);
  }

  async archiveStaff(id: string): Promise<Staff | undefined> {
    return this.staffRepo.archiveStaff(id);
  }

  async restoreStaff(id: string): Promise<Staff | undefined> {
    return this.staffRepo.restoreStaff(id);
  }

  async hasStaffCheckouts(id: string): Promise<boolean> {
    return this.staffRepo.hasStaffCheckouts(id);
  }

  // ─── Product Repo Delegation ───────────────────────────────────────────────
  async getProducts(storeId: string): Promise<any[]> {
    return this.productRepo.getProducts(storeId);
  }

  async getProductsPaginated(storeId: string, options: PaginationOptions): Promise<PaginatedResult<any>> {
    return this.productRepo.getProductsPaginated(storeId, options);
  }

  async getProduct(id: string): Promise<any> {
    return this.productRepo.getProduct(id);
  }

  async getProductByName(storeId: string, name: string): Promise<Product | undefined> {
    return this.productRepo.getProductByName(storeId, name);
  }

  async createProduct(product: InsertProduct): Promise<Product> {
    return this.productRepo.createProduct(product);
  }

  async updateProduct(id: string, productData: Partial<InsertProduct>): Promise<Product | undefined> {
    return this.productRepo.updateProduct(id, productData);
  }

  async deleteProduct(id: string): Promise<boolean> {
    return this.productRepo.deleteProduct(id);
  }

  async getArchivedProducts(storeId: string): Promise<any[]> {
    return this.productRepo.getArchivedProducts(storeId);
  }

  async restoreProduct(id: string): Promise<boolean> {
    return this.productRepo.restoreProduct(id);
  }

  async getProductByIdRaw(id: string): Promise<any> {
    return this.productRepo.getProductByIdRaw(id);
  }

  // ─── Inventory Repo Delegation ─────────────────────────────────────────────
  async getInventory(storeId: string): Promise<Inventory[]> {
    return this.inventoryRepo.getInventory(storeId);
  }

  async getInventoryPaginated(storeId: string, options: PaginationOptions): Promise<PaginatedResult<Inventory>> {
    return this.inventoryRepo.getInventoryPaginated(storeId, options);
  }

  async getInventoryForStores(storeIds: string[], options: PaginationOptions): Promise<PaginatedResult<Inventory>> {
    return this.inventoryRepo.getInventoryForStores(storeIds, options);
  }

  async getInventoryItem(id: string): Promise<Inventory | undefined> {
    return this.inventoryRepo.getInventoryItem(id);
  }

  async getInventoryItemByName(storeId: string, name: string): Promise<Inventory | undefined> {
    return this.inventoryRepo.getInventoryItemByName(storeId, name);
  }

  async createInventoryItem(item: InsertInventory): Promise<Inventory> {
    return this.inventoryRepo.createInventoryItem(item);
  }

  async updateInventoryItem(id: string, itemData: Partial<InsertInventory>): Promise<Inventory | undefined> {
    return this.inventoryRepo.updateInventoryItem(id, itemData);
  }

  async deleteInventoryItem(id: string): Promise<boolean> {
    return this.inventoryRepo.deleteInventoryItem(id);
  }

  async hasInventoryTransactions(id: string): Promise<boolean> {
    return this.inventoryRepo.hasInventoryTransactions(id);
  }

  async getBundleComponents(parentInventoryId: string): Promise<any[]> {
    return this.inventoryRepo.getBundleComponents(parentInventoryId);
  }

  async setBundleComponents(parentInventoryId: string, components: { componentInventoryId: string; quantity: number }[]): Promise<void> {
    return this.inventoryRepo.setBundleComponents(parentInventoryId, components);
  }

  // ─── Transaction Repo Delegation ───────────────────────────────────────────
  async createOrder(order: InsertOrder): Promise<Order> {
    return this.transactionRepo.createOrder(order);
  }

  async createCheckout(checkout: InsertCheckout): Promise<Checkout> {
    return this.transactionRepo.createCheckout(checkout);
  }

  async updateCheckoutPaymentStatus(id: string, status: "pending" | "completed" | "failed"): Promise<Checkout | undefined> {
    return this.transactionRepo.updateCheckoutPaymentStatus(id, status);
  }

  async getTransactions(storeId: string, filters?: TransactionFilters): Promise<TransactionWithRelations[]> {
    return this.transactionRepo.getTransactions(storeId, filters);
  }

  async getTransactionById(id: string): Promise<TransactionWithRelations | null> {
    return this.transactionRepo.getTransactionById(id);
  }

  async createTransaction(transaction: InsertTransaction): Promise<Transaction> {
    return this.transactionRepo.createTransaction(transaction);
  }

  async getTransactionsByCustomer(customerId: string): Promise<TransactionWithRelations[]> {
    return this.transactionRepo.getTransactionsByCustomer(customerId);
  }

  async getReceiptPayload(checkoutId: string) {
    return this.transactionRepo.getReceiptPayload(checkoutId);
  }

  async updateCheckoutPaymentMethod(checkoutId: string, paymentMethod: string, paymentStatus: string): Promise<boolean> {
    return this.transactionRepo.updateCheckoutPaymentMethod(checkoutId, paymentMethod, paymentStatus);
  }

  async searchTransactions(storeId: string, query: string): Promise<any[]> {
    return this.transactionRepo.searchTransactions(storeId, query);
  }

  // ─── Booking Repo Delegation ───────────────────────────────────────────────
  async getBookings(storeId: string): Promise<Booking[]> {
    return this.bookingRepo.getBookings(storeId);
  }

  async getBookingsPaginated(storeId: string, options: PaginationOptions, filters?: {
    status?: string[];
    type?: string[];
    staffId?: string;
    customerId?: string;
    startDate?: string;
    endDate?: string;
    search?: string;
  }): Promise<PaginatedResult<Booking>> {
    return this.bookingRepo.getBookingsPaginated(storeId, options, filters);
  }

  async getBooking(id: string): Promise<Booking | undefined> {
    return this.bookingRepo.getBooking(id);
  }

  async getBookingItems(bookingId: string): Promise<BookingItem[]> {
    return this.bookingRepo.getBookingItems(bookingId);
  }

  async createBooking(data: InsertBooking & { bookingItems: InsertBookingItem[] }): Promise<Booking> {
    return this.bookingRepo.createBooking(data);
  }

  async updateBooking(id: string, data: Partial<InsertBooking> & { bookingItems?: InsertBookingItem[] }): Promise<Booking | undefined> {
    return this.bookingRepo.updateBooking(id, data);
  }

  async updateBookingStatus(id: string, status: string): Promise<Booking | undefined> {
    return this.bookingRepo.updateBookingStatus(id, status);
  }

  async rescheduleBooking(id: string, scheduledAt: Date, reason: string): Promise<Booking | undefined> {
    return this.bookingRepo.rescheduleBooking(id, scheduledAt, reason);
  }

  // ─── Sales Repo Delegation ─────────────────────────────────────────────────
  async getProfitLoss(storeId: string): Promise<ProfitLossWithInventory[]> {
    return this.salesRepo.getProfitLoss(storeId);
  }

  async updateProfitLoss(inventoryId: string, storeId: string): Promise<void> {
    return this.salesRepo.updateProfitLoss(inventoryId, storeId);
  }

  async getProfitLossSummary(storeId: string, startDate?: string, endDate?: string): Promise<{
    serviceRevenue: number;
    productRevenue: number;
    grossRevenue: number;
    returnedRevenue: number;
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
    return this.salesRepo.getProfitLossSummary(storeId, startDate, endDate);
  }

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
    paymentMethod: "cash" | "transfer" | "flutterwave" | "credit" | "split" | "deposit" | "store_credit";
    splitPayments?: Array<{method: "cash" | "transfer" | "flutterwave" | "credit" | "store_credit", amount: number}>;
    discountAmount?: number;
    discountPercent?: number;
    discountReason?: string;
    discountApprovedBy?: string;
    effectiveDate?: string;
    creditUpfrontPaid?: number;
    creditDueDate?: string;
    bookingId?: string;
    bookingDepositAmount?: number;
    bookingDepositMethod?: string;
    balanceCollectedToday?: number;
    pointsRedeemed?: number;
  }): Promise<{ success: boolean; message: string; checkoutIds?: string[] }> {
    return this.salesRepo.processCheckout(data);
  }

  async voidCheckout(checkoutId: string, reason: string, voidedByUserId: string): Promise<{ success: boolean; message: string; payrollWarning?: string }> {
    return this.salesRepo.voidCheckout(checkoutId, reason, voidedByUserId);
  }

  async processReturn(data: {
    storeId: string;
    checkoutId: string;
    items: Array<{ orderId: string; quantity: number; restock: boolean }>;
    refundMethod: string;
    refundAmount: number;
    reason: string;
    userId: string;
    staffId: string;
  }): Promise<{ success: boolean; message: string; returnLogIds?: string[] }> {
    return this.salesRepo.processReturn(data);
  }

  async getStoreCreditTransactions(customerId: string): Promise<any[]> {
    return this.salesRepo.getStoreCreditTransactions(customerId);
  }

  // ─── Analytics Repo Delegation ─────────────────────────────────────────────
  async getDashboardStats(storeId: string, startDate?: string, endDate?: string): Promise<{
    totalCustomers: number;
    totalStaff: number;
    totalInventory: number;
    totalProducts: number;
    totalServices: number;
    totalTransactions: number;
    totalRevenue: number;
    grossRevenue: number;
    returnedRevenue: number;
    totalProfit: number;
    lowStockItems: Inventory[];
  }> {
    return this.analyticsRepo.getDashboardStats(storeId, startDate, endDate);
  }

  async getSalesTrends(storeId: string, startDate?: string, endDate?: string): Promise<{ date: string; revenue: number; transactions: number }[]> {
    return this.analyticsRepo.getSalesTrends(storeId, startDate, endDate);
  }

  async getRevenueByType(storeId: string, startDate?: string, endDate?: string): Promise<{ name: string; value: number; type: string }[]> {
    return this.analyticsRepo.getRevenueByType(storeId, startDate, endDate);
  }

  // ─── Restock Repo Delegation ───────────────────────────────────────────────
  async getRestockEvents(inventoryId: string): Promise<(RestockEvent & { staff: Staff | null; user: User | null })[]> {
    return this.restockRepo.getRestockEvents(inventoryId);
  }

  async getRestockEventsPaginated(inventoryId: string, options: PaginationOptions): Promise<PaginatedResult<RestockEvent & { staff: Staff | null; user: User | null }>> {
    return this.restockRepo.getRestockEventsPaginated(inventoryId, options);
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
    return this.restockRepo.createRestockEvent(data);
  }

  // ─── Attendance Repo Delegation ────────────────────────────────────────────
  async getAttendanceRecords(storeId: string, options: {
    staffId?: string;
    startDate?: string;
    endDate?: string;
  } = {}): Promise<AttendanceRecord[]> {
    return this.attendanceRepo.getAttendanceRecords(storeId, options);
  }

  async upsertAttendanceRecord(data: InsertAttendanceRecord): Promise<AttendanceRecord> {
    return this.attendanceRepo.upsertAttendanceRecord(data);
  }

  async bulkMarkAttendance(storeId: string, date: string, status: AttendanceStatus, staffIds: string[], markedByUserId?: string): Promise<AttendanceRecord[]> {
    return this.attendanceRepo.bulkMarkAttendance(storeId, date, status, staffIds, markedByUserId);
  }

  async getAttendanceSummary(storeId: string, staffId: string, startDate: string, endDate: string): Promise<{
    present: number;
    absent: number;
    offDay: number;
    holiday: number;
    totalWorkingDays: number;
  }> {
    return this.attendanceRepo.getAttendanceSummary(storeId, staffId, startDate, endDate);
  }

  // ─── Payroll Repo Delegation ───────────────────────────────────────────────
  async getPayrollPeriods(storeId: string): Promise<PayrollPeriod[]> {
    return this.payrollRepo.getPayrollPeriods(storeId);
  }

  async getPayrollPeriod(id: string): Promise<PayrollPeriod | undefined> {
    return this.payrollRepo.getPayrollPeriod(id);
  }

  async createPayrollPeriod(data: InsertPayrollPeriod): Promise<PayrollPeriod> {
    return this.payrollRepo.createPayrollPeriod(data);
  }

  async updatePayrollPeriodStatus(id: string, status: PayrollPeriodStatus, userId?: string): Promise<PayrollPeriod | undefined> {
    return this.payrollRepo.updatePayrollPeriodStatus(id, status, userId);
  }

  async deletePayrollPeriod(id: string): Promise<boolean> {
    return this.payrollRepo.deletePayrollPeriod(id);
  }

  async getPayrollEntries(periodId: string): Promise<PayrollEntryWithStaff[]> {
    return this.payrollRepo.getPayrollEntries(periodId);
  }

  CommissionSplitCalculator = OOPCommissionSplitCalculator;

  async calculatePayrollForPeriod(periodId: string): Promise<PayrollEntryWithStaff[]> {
    return this.payrollRepo.calculatePayrollForPeriod(periodId);
  }

  async getPayrollDrillDown(periodId: string, staffId: string): Promise<{
    dailySummary: DailySummaryLine[];
    transactions: CommissionBreakdown[];
  }> {
    return this.payrollRepo.getPayrollDrillDown(periodId, staffId);
  }

  // ─── Payroll Deductions ─────────────────────────────────────────────────────
  async getPayrollDeductions(periodId: string, staffId?: string): Promise<PayrollDeduction[]> {
    const conditions: any[] = [eq(payrollDeductions.periodId, periodId)];
    if (staffId) conditions.push(eq(payrollDeductions.staffId, staffId));
    return db.select().from(payrollDeductions).where(and(...conditions));
  }

  async createPayrollDeduction(data: InsertPayrollDeduction): Promise<PayrollDeduction> {
    const [row] = await db.insert(payrollDeductions).values(data).returning();
    return row;
  }

  async deletePayrollDeduction(id: string): Promise<void> {
    await db.delete(payrollDeductions).where(eq(payrollDeductions.id, id));
  }

  // ─── Payroll Disbursements ──────────────────────────────────────────────────
  async getPayrollDisbursements(periodId: string): Promise<PayrollDisbursement[]> {
    return db.select().from(payrollDisbursements).where(eq(payrollDisbursements.periodId, periodId));
  }

  async upsertPayrollDisbursement(data: InsertPayrollDisbursement): Promise<PayrollDisbursement> {
    const existing = await db.select().from(payrollDisbursements).where(
      and(eq(payrollDisbursements.periodId, data.periodId), eq(payrollDisbursements.staffId, data.staffId))
    );
    if (existing.length > 0) {
      const [updated] = await db.update(payrollDisbursements)
        .set({ amountPaid: data.amountPaid, method: data.method, reference: data.reference, notes: data.notes, paidByUserId: data.paidByUserId, paidAt: new Date() })
        .where(eq(payrollDisbursements.id, existing[0].id))
        .returning();
      return updated;
    }
    const [row] = await db.insert(payrollDisbursements).values(data).returning();
    return row;
  }

  // ─── Salary Advances ────────────────────────────────────────────────────────
  async getSalaryAdvances(storeId: string, staffId?: string): Promise<SalaryAdvance[]> {
    const conditions: any[] = [eq(salaryAdvances.storeId, storeId)];
    if (staffId) conditions.push(eq(salaryAdvances.staffId, staffId));
    return db.select().from(salaryAdvances).where(and(...conditions)).orderBy(desc(salaryAdvances.createdAt));
  }

  async createSalaryAdvance(data: InsertSalaryAdvance): Promise<SalaryAdvance> {
    const [row] = await db.insert(salaryAdvances).values(data).returning();
    return row;
  }

  async markAdvanceRecovered(advanceId: string, periodId: string): Promise<SalaryAdvance> {
    const [row] = await db.update(salaryAdvances)
      .set({ isRecovered: true, recoveredPeriodId: periodId })
      .where(eq(salaryAdvances.id, advanceId))
      .returning();
    return row;
  }

  async deleteSalaryAdvance(id: string): Promise<void> {
    await db.delete(salaryAdvances).where(eq(salaryAdvances.id, id));
  }

  // ─── Unrecorded attendance days check ───────────────────────────────────────
  async getUnrecordedAttendanceDays(storeId: string, startDate: string, endDate: string): Promise<{
    staffId: string; staffName: string; unrecordedDates: string[];
  }[]> {
    const allStaff = await db.select().from(staff).where(and(eq(staff.storeId, storeId), eq(staff.isArchived, false)));
    const records = await db.select().from(attendanceRecords).where(and(
      eq(attendanceRecords.storeId, storeId),
      gte(attendanceRecords.date, startDate),
      lte(attendanceRecords.date, endDate),
    ));
    const recordedSet = new Set(records.map(r => `${r.staffId}:${r.date}`));

    const getDates = (start: string, end: string) => {
      const dates: string[] = [];
      const curr = new Date(start);
      while (curr <= new Date(end)) {
        const d = curr.toISOString().split("T")[0];
        if (curr.getDay() !== 0) dates.push(d); // skip Sundays (auto off-day)
        curr.setDate(curr.getDate() + 1);
      }
      return dates;
    };

    const workingDates = getDates(startDate, endDate);
    return allStaff
      .map(s => ({
        staffId: s.id,
        staffName: s.name,
        unrecordedDates: workingDates.filter(d => !recordedSet.has(`${s.id}:${d}`)),
      }))
      .filter(r => r.unrecordedDates.length > 0);
  }

  // ─── Settings / Promotions / Custom Roles / Store Integrations Delegation ──
  async getSettings(storeId: string): Promise<Settings> {
    return this.businessRepo.getSettings(storeId);
  }

  async upsertSettings(storeId: string, data: Partial<InsertSettings>): Promise<Settings> {
    return this.businessRepo.upsertSettings(storeId, data);
  }

  async getPromotions(storeId: string): Promise<Promotion[]> {
    return this.businessRepo.getPromotions(storeId);
  }

  async createPromotion(data: InsertPromotion & { storeId: string }): Promise<Promotion> {
    return this.businessRepo.createPromotion(data);
  }

  async updatePromotion(id: string, data: Partial<InsertPromotion>): Promise<Promotion | undefined> {
    return this.businessRepo.updatePromotion(id, data);
  }

  async deletePromotion(id: string): Promise<boolean> {
    return this.businessRepo.deletePromotion(id);
  }

  async getCustomRoles(businessId: string): Promise<CustomRole[]> {
    return this.businessRepo.getCustomRoles(businessId);
  }

  async createCustomRole(data: InsertCustomRole & { businessId: string }): Promise<CustomRole> {
    return this.businessRepo.createCustomRole(data);
  }

  async updateCustomRole(id: string, data: Partial<InsertCustomRole>): Promise<CustomRole | undefined> {
    return this.businessRepo.updateCustomRole(id, data);
  }

  async deleteCustomRole(id: string): Promise<boolean> {
    return this.businessRepo.deleteCustomRole(id);
  }

  async getStoreIntegrations(storeId: string): Promise<StoreIntegration[]> {
    return this.businessRepo.getStoreIntegrations(storeId);
  }

  async getStoreIntegrationByProvider(storeId: string, provider: string): Promise<StoreIntegration | undefined> {
    return this.businessRepo.getStoreIntegrationByProvider(storeId, provider);
  }

  async upsertStoreIntegration(data: InsertStoreIntegration & { storeId: string; provider: string }): Promise<StoreIntegration> {
    return this.businessRepo.upsertStoreIntegration(data);
  }

  async deleteStoreIntegration(id: string): Promise<void> {
    return this.businessRepo.deleteStoreIntegration(id);
  }

  // ─── Expense Repo Delegation ───────────────────────────────────────────────
  async getExpenseCategories(storeId: string): Promise<ExpenseCategory[]> {
    return this.expenseRepo.getExpenseCategories(storeId);
  }

  async createExpenseCategory(data: InsertExpenseCategory): Promise<ExpenseCategory> {
    return this.expenseRepo.createExpenseCategory(data);
  }

  async updateExpenseCategory(id: string, name: string): Promise<ExpenseCategory> {
    return this.expenseRepo.updateExpenseCategory(id, name);
  }

  async deleteExpenseCategory(id: string): Promise<void> {
    return this.expenseRepo.deleteExpenseCategory(id);
  }

  async getExpenses(
    storeId: string,
    startDate?: string,
    endDate?: string,
    type?: "all" | "general" | "linked" | "service" | "product",
    inventoryId?: string
  ): Promise<ExpenseWithCategory[]> {
    return this.expenseRepo.getExpenses(storeId, startDate, endDate, type, inventoryId);
  }

  async getExpenseById(id: string): Promise<ExpenseWithCategory | null> {
    return this.expenseRepo.getExpenseById(id);
  }

  async createExpense(data: InsertExpense): Promise<Expense> {
    return this.expenseRepo.createExpense(data);
  }

  async updateExpense(id: string, data: Partial<InsertExpense>): Promise<Expense> {
    return this.expenseRepo.updateExpense(id, data);
  }

  async deleteExpense(id: string): Promise<void> {
    return this.expenseRepo.deleteExpense(id);
  }

  async getPaidPayrollExpenses(storeId: string, startDate?: string, endDate?: string): Promise<{ label: string; amount: number }[]> {
    return this.expenseRepo.getPaidPayrollExpenses(storeId, startDate, endDate);
  }

  // ─── Staff Performance / Search ────────────────────────────────────────────
  async getStaffPerformance(storeId: string, startDate?: string, endDate?: string): Promise<any[]> {
    return this.staffRepo.getStaffPerformance(storeId, startDate, endDate);
  }

  async searchCustomers(storeId: string, query: string): Promise<Customer[]> {
    return this.customerRepo.searchCustomers(storeId, query);
  }

  async searchInventory(storeId: string, query: string): Promise<Inventory[]> {
    return this.inventoryRepo.searchInventory(storeId, query);
  }

  // ─── Notification Repo Delegation ─────────────────────────────────────────
  async getNotifications(userId: string): Promise<Notification[]> {
    return this.notificationRepo.getNotifications(userId);
  }

  async markNotificationAsRead(id: string): Promise<void> {
    return this.notificationRepo.markNotificationAsRead(id);
  }

  async markAllNotificationsAsRead(userId: string): Promise<void> {
    return this.notificationRepo.markAllNotificationsAsRead(userId);
  }

  async createNotification(data: InsertNotification): Promise<Notification> {
    return this.notificationRepo.createNotification(data);
  }

  async getTopCustomers(storeId: string): Promise<any[]> {
    return this.customerRepo.getTopCustomers(storeId);
  }

  async notifyManagers(storeId: string, type: string, message: string): Promise<void> {
    return this.notificationRepo.notifyManagers(storeId, type, message);
  }

}


export const storage = new DatabaseStorage();
