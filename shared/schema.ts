import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, boolean, integer, real, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Helper for trimmed non-empty strings
const trimmedString = (minLength = 1, message = "This field is required") =>
  z.string().transform(s => s.trim()).pipe(z.string().min(minLength, message));

// Helper for optional trimmed strings (empty becomes undefined)
const optionalTrimmedString = () =>
  z.string().optional().transform(s => s?.trim() || undefined);

// Businesses table - top level organization
export const businesses = pgTable("businesses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const businessesRelations = relations(businesses, ({ many }) => ({
  stores: many(stores),
}));

export const insertBusinessSchema = createInsertSchema(businesses).omit({ id: true, createdAt: true }).extend({
  name: trimmedString(1, "Business name is required"),
  address: optionalTrimmedString(),
  phone: optionalTrimmedString(),
  email: optionalTrimmedString(),
});
export type InsertBusiness = z.infer<typeof insertBusinessSchema>;
export type Business = typeof businesses.$inferSelect;

// Stores table - individual store locations
export const stores = pgTable("stores", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessId: varchar("business_id").notNull().references(() => businesses.id),
  name: text("name").notNull(),
  code: text("code").notNull(), // Prefix for customer IDs (e.g., "STORE", "NYC", "LA")
  address: text("address"),
  phone: text("phone"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  unique("store_business_name_unique").on(table.businessId, table.name),
  unique("store_business_code_unique").on(table.businessId, table.code),
]);

export const storesRelations = relations(stores, ({ one, many }) => ({
  business: one(businesses, {
    fields: [stores.businessId],
    references: [businesses.id],
  }),
  customers: many(customers),
  staff: many(staff),
  inventory: many(inventory),
  storeCounters: many(storeCounters),
}));

export const insertStoreSchema = createInsertSchema(stores).omit({ id: true, createdAt: true }).extend({
  name: trimmedString(1, "Store name is required"),
  code: z.string().transform(s => s.trim().toUpperCase()).pipe(z.string().min(1, "Store code is required")),
  address: optionalTrimmedString(),
  phone: optionalTrimmedString(),
});
export type InsertStore = z.infer<typeof insertStoreSchema>;
export type Store = typeof stores.$inferSelect;

// Store counters for auto-incrementing customer IDs per store
export const storeCounters = pgTable("store_counters", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id).unique(),
  nextCustomerNumber: integer("next_customer_number").notNull().default(1),
});

export const storeCountersRelations = relations(storeCounters, ({ one }) => ({
  store: one(stores, {
    fields: [storeCounters.storeId],
    references: [stores.id],
  }),
}));

export const insertStoreCounterSchema = createInsertSchema(storeCounters).omit({ id: true });
export type InsertStoreCounter = z.infer<typeof insertStoreCounterSchema>;
export type StoreCounter = typeof storeCounters.$inferSelect;

// Customers table
export const customers = pgTable("customers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  name: text("name").notNull(),
  customerNumber: text("customer_number").notNull(),
  mobileNumber: text("mobile_number").notNull(),
  countryCode: text("country_code").notNull().default("+234"), // Default to Nigeria
  address: text("address").notNull(),
  isArchived: boolean("is_archived").notNull().default(false),
}, (table) => [
  unique("customer_store_number_unique").on(table.storeId, table.customerNumber),
]);

export const customersRelations = relations(customers, ({ one, many }) => ({
  store: one(stores, {
    fields: [customers.storeId],
    references: [stores.id],
  }),
  transactions: many(transactions),
}));

export const insertCustomerSchema = createInsertSchema(customers).omit({ id: true, isArchived: true }).extend({
  name: trimmedString(1, "Customer name is required"),
  customerNumber: trimmedString(1, "Customer ID is required"),
  countryCode: z.string().default("+234"),
  mobileNumber: trimmedString(1, "Mobile number is required"),
  address: z.string().transform(s => s.trim()).default(""),
});
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type Customer = typeof customers.$inferSelect;

// Staff table
export const staff = pgTable("staff", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  name: text("name").notNull(),
  staffNumber: text("staff_number").notNull(),
  mobileNumber: text("mobile_number").notNull(),
  countryCode: text("country_code").notNull().default("+234"), // Default to Nigeria
  payPerMonth: real("pay_per_month").notNull(),
  signedContract: boolean("signed_contract").notNull().default(false),
  isArchived: boolean("is_archived").notNull().default(false),
}, (table) => [
  unique("staff_store_number_unique").on(table.storeId, table.staffNumber),
]);

export const staffRelations = relations(staff, ({ one, many }) => ({
  store: one(stores, {
    fields: [staff.storeId],
    references: [stores.id],
  }),
  checkouts: many(checkouts),
}));

export const insertStaffSchema = createInsertSchema(staff).omit({ id: true, isArchived: true }).extend({
  name: trimmedString(1, "Staff name is required"),
  staffNumber: trimmedString(1, "Staff number is required"),
  countryCode: z.string().default("+234"),
  mobileNumber: trimmedString(1, "Mobile number is required"),
});
export type InsertStaff = z.infer<typeof insertStaffSchema>;
export type Staff = typeof staff.$inferSelect;

// Inventory table
export const inventory = pgTable("inventory", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  name: text("name").notNull(),
  type: text("type").notNull(), // 'product' or 'service'
  costPrice: real("cost_price").notNull(),
  sellingPrice: real("selling_price").notNull(),
  quantity: integer("quantity").notNull().default(0), // Only relevant for products
}, (table) => [
  unique("inventory_store_name_unique").on(table.storeId, table.name),
]);

export const inventoryRelations = relations(inventory, ({ one, many }) => ({
  store: one(stores, {
    fields: [inventory.storeId],
    references: [stores.id],
  }),
  orders: many(orders),
  transactions: many(transactions),
  profitLoss: many(profitLoss),
}));

export const insertInventorySchema = createInsertSchema(inventory).omit({ id: true }).extend({
  name: trimmedString(1, "Item name is required"),
  type: z.string().transform(s => s.trim()).pipe(z.enum(["product", "service"], { errorMap: () => ({ message: "Type must be product or service" }) })),
});
export type InsertInventory = z.infer<typeof insertInventorySchema>;
export type Inventory = typeof inventory.$inferSelect;

// Orders table (line items in a sale)
export const orders = pgTable("orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  inventoryId: varchar("inventory_id").notNull().references(() => inventory.id),
  quantity: integer("quantity").notNull(),
  totalPrice: real("total_price").notNull(),
});

export const ordersRelations = relations(orders, ({ one, many }) => ({
  store: one(stores, {
    fields: [orders.storeId],
    references: [stores.id],
  }),
  inventory: one(inventory, {
    fields: [orders.inventoryId],
    references: [inventory.id],
  }),
  checkouts: many(checkouts),
}));

export const insertOrderSchema = createInsertSchema(orders).omit({ id: true });
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof orders.$inferSelect;

// Checkouts table (final sale/receipt)
export const checkouts = pgTable("checkouts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  staffId: varchar("staff_id").notNull().references(() => staff.id),
  orderId: varchar("order_id").notNull().references(() => orders.id),
  totalPrice: real("total_price").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const checkoutsRelations = relations(checkouts, ({ one, many }) => ({
  store: one(stores, {
    fields: [checkouts.storeId],
    references: [stores.id],
  }),
  staff: one(staff, {
    fields: [checkouts.staffId],
    references: [staff.id],
  }),
  order: one(orders, {
    fields: [checkouts.orderId],
    references: [orders.id],
  }),
  transactions: many(transactions),
}));

export const insertCheckoutSchema = createInsertSchema(checkouts).omit({ id: true, createdAt: true });
export type InsertCheckout = z.infer<typeof insertCheckoutSchema>;
export type Checkout = typeof checkouts.$inferSelect;

// Transactions table
export const transactions = pgTable("transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  customerId: varchar("customer_id").notNull().references(() => customers.id),
  inventoryId: varchar("inventory_id").notNull().references(() => inventory.id),
  checkoutId: varchar("checkout_id").notNull().references(() => checkouts.id),
  transactionDate: timestamp("transaction_date").notNull().defaultNow(),
});

export const transactionsRelations = relations(transactions, ({ one }) => ({
  store: one(stores, {
    fields: [transactions.storeId],
    references: [stores.id],
  }),
  customer: one(customers, {
    fields: [transactions.customerId],
    references: [customers.id],
  }),
  inventory: one(inventory, {
    fields: [transactions.inventoryId],
    references: [inventory.id],
  }),
  checkout: one(checkouts, {
    fields: [transactions.checkoutId],
    references: [checkouts.id],
  }),
}));

export const insertTransactionSchema = createInsertSchema(transactions).omit({ id: true, transactionDate: true });
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactions.$inferSelect;

// Profit & Loss table
export const profitLoss = pgTable("profit_loss", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  inventoryId: varchar("inventory_id").notNull().references(() => inventory.id),
  totalQuantitySold: integer("total_quantity_sold").notNull().default(0),
  quantityRemaining: integer("quantity_remaining").notNull().default(0),
  totalRevenue: real("total_revenue").notNull().default(0),
  totalNetProfit: real("total_net_profit").notNull().default(0),
}, (table) => [
  unique("profit_loss_store_inventory_unique").on(table.storeId, table.inventoryId),
]);

export const profitLossRelations = relations(profitLoss, ({ one }) => ({
  store: one(stores, {
    fields: [profitLoss.storeId],
    references: [stores.id],
  }),
  inventory: one(inventory, {
    fields: [profitLoss.inventoryId],
    references: [inventory.id],
  }),
}));

export const insertProfitLossSchema = createInsertSchema(profitLoss).omit({ id: true });
export type InsertProfitLoss = z.infer<typeof insertProfitLossSchema>;
export type ProfitLoss = typeof profitLoss.$inferSelect;

// Extended types for frontend display with relations
export type StoreWithBusiness = Store & {
  business: Business;
};

export type TransactionWithRelations = Transaction & {
  customer: Customer;
  inventory: Inventory;
  checkout: Checkout;
  store: Store;
};

export type CheckoutWithRelations = Checkout & {
  staff: Staff;
  order: Order & { inventory: Inventory };
};

export type ProfitLossWithInventory = ProfitLoss & {
  inventory: Inventory;
};
