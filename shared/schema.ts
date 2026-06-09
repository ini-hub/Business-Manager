import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, boolean, integer, real, timestamp, unique, index, jsonb, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Helper for trimmed non-empty strings
const trimmedString = (minLength = 1, message = "This field is required") =>
  z.string().transform(s => s.trim()).pipe(z.string().min(minLength, message));

// Helper for optional trimmed strings (empty becomes undefined)
const optionalTrimmedString = () =>
  z.string().optional().transform(s => s?.trim() || undefined);

// Organisations / Businesses Table (top level organization)
export const organisations = pgTable("organisations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  slug: text("slug").unique(),
  logoUrl: text("logo_url"),
  receiptPrefix: text("receipt_prefix").default("EXB"),
  address: text("address"),
  phone: text("phone"),
  phoneCountryCode: text("phone_country_code").default("+234"),
  businessUrl: text("business_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  commissionSplitBusinessShare: integer("commission_split_business_share").notNull().default(80),
  commissionSplitStaffShare: integer("commission_split_staff_share").notNull().default(20),
  status: text("status").notNull().default("active"), // 'active', 'inactive', 'suspended'
  suspensionReason: text("suspension_reason"), // 'policy_violation', 'non_payment', 'fraudulent_activity', 'owner_request', 'inactivity', 'other'
  suspensionNote: text("suspension_note"),
  suspendedAt: timestamp("suspended_at"),
  deletedAt: timestamp("deleted_at"), // Soft-delete 30-day grace period
  deletionReason: text("deletion_reason"),
});

export const organisationsRelations = relations(organisations, ({ many }) => ({
  stores: many(stores),
  members: many(organisationMembers),
}));

export type InsertOrganisation = typeof organisations.$inferInsert;
export type Organisation = typeof organisations.$inferSelect;

// Keep businesses as backward-compatible alias to organisations
export const businesses = organisations;
export const businessesRelations = organisationsRelations;
export type InsertBusiness = InsertOrganisation;
export type Business = Organisation;

export const insertOrganisationSchema = createInsertSchema(organisations).omit({ id: true, createdAt: true, updatedAt: true }).extend({
  name: trimmedString(1, "Business name is required"),
  slug: optionalTrimmedString(),
  logoUrl: z.string().optional(),
  receiptPrefix: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().trim().refine(v => !v || v.replace(/\D/g, "").length >= 7, "Enter a valid phone number.").optional().or(z.literal("")),
  phoneCountryCode: z.string().default("+234"),
  businessUrl: z.string().optional(),
});
export const insertBusinessSchema = insertOrganisationSchema;

// Stores table - individual store locations
export const stores = pgTable("stores", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessId: varchar("business_id").notNull().references(() => businesses.id),
  name: text("name").notNull(),
  code: text("code").notNull(), // Prefix for customer IDs (e.g., "STORE", "NYC", "LA")
  address: text("address"),
  phone: text("phone"),
  phoneCountryCode: text("phone_country_code").default("+234"), // Default to Nigeria
  country: text("country").notNull().default("NG"), // ISO country code
  currency: text("currency").notNull().default("NGN"), // ISO currency code
  commissionRate: numeric("commission_rate", { precision: 5, scale: 4 }).$type<number>().notNull().default(0.3000), // Default 30% service commission
  managerStaffId: text("manager_staff_id"), // References staff.id - manager for this store
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  commissionSplitOverride: boolean("commission_split_override").notNull().default(false),
  commissionSplitBusinessShare: integer("commission_split_business_share").notNull().default(80),
  commissionSplitStaffShare: integer("commission_split_staff_share").notNull().default(20),
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
  products: many(products),
  storeCounters: many(storeCounters),
}));

export const insertStoreSchema = createInsertSchema(stores).omit({ id: true, createdAt: true }).extend({
  name: trimmedString(1, "Store name is required"),
  code: z.string().transform(s => s.trim().toUpperCase()).pipe(z.string().min(1, "Store code is required")),
  address: optionalTrimmedString(),
  phone: z.string().trim().refine(v => !v || v.replace(/\D/g, "").length >= 7, "Enter a valid phone number.").optional().or(z.literal("")),
  phoneCountryCode: z.string().default("+234"),
  country: z.string().default("NG"),
  currency: z.string().default("NGN"),
  commissionRate: z.number().optional(),
});
export type InsertStore = z.infer<typeof insertStoreSchema>;
export type Store = typeof stores.$inferSelect;

// Store counters for auto-incrementing customer IDs and transaction receipts per store
export const storeCounters = pgTable("store_counters", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id).unique(),
  nextCustomerNumber: integer("next_customer_number").notNull().default(1),
  nextTransactionNumber: integer("next_transaction_number").notNull().default(1),
  nextBookingNumber: integer("next_booking_number").notNull().default(1),
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
  mobileNumber: text("mobile_number"), // Optional
  countryCode: text("country_code").default("+234"), // Default to Nigeria
  address: text("address").notNull(),
  birthday: timestamp("birthday"),
  loyaltyPoints: integer("loyalty_points").notNull().default(0),
  storeCreditBalance: numeric("store_credit_balance", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  isArchived: boolean("is_archived").notNull().default(false),
  globalCustomerId: varchar("global_customer_id"), // Links local profiles sharing same phone
  isConfirmedDistinct: boolean("is_confirmed_distinct").notNull().default(false),
  duplicateOfId: varchar("duplicate_of_id"), // Links to other duplicate customer profile
  mergedIntoId: varchar("merged_into_id"), // Links to target profile if merged
  staffId: varchar("staff_id"), // Links to staff record if this customer is a staff member
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  unique("customer_store_number_unique").on(table.storeId, table.customerNumber),
  index("idx_customers_store").on(table.storeId),
]);

export const customersRelations = relations(customers, ({ one, many }) => ({
  store: one(stores, {
    fields: [customers.storeId],
    references: [stores.id],
  }),
  transactions: many(transactions),
  staffMember: one(staff, {
    fields: [customers.staffId],
    references: [staff.id],
  }),
}));

export const insertCustomerSchema = createInsertSchema(customers).omit({ id: true, isArchived: true }).extend({
  name: trimmedString(1, "Customer name is required"),
  customerNumber: z.string().optional().default(""),
  countryCode: z.string().default("NG"),
  mobileNumber: z.string().transform(s => s.trim()).refine(v => !v || v.replace(/\D/g, "").length >= 7, "Enter a valid phone number.").optional().default(""),
  address: z.string().transform(s => s.trim()).default(""),
  birthday: z.string().optional().nullable(),
  storeCreditBalance: z.number().optional(),
  staffId: z.string().optional().nullable(),
});
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type Customer = typeof customers.$inferSelect;

// Staff roles
export const staffRoleEnum = ["manager", "staff"] as const;
export type StaffRole = typeof staffRoleEnum[number];

// Staff table
export const staff = pgTable("staff", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  userId: varchar("user_id").references(() => users.id), // Link to user account for login
  name: text("name").notNull(),
  email: text("email").notNull(), // Required for login
  staffNumber: text("staff_number").notNull(),
  mobileNumber: text("mobile_number").notNull(),
  countryCode: text("country_code").notNull().default("+234"), // Default to Nigeria
  payPerMonth: numeric("pay_per_month", { precision: 12, scale: 2 }).$type<number>().notNull(),
  commissionRateOverride: numeric("commission_rate_override", { precision: 5, scale: 4 }).$type<number>(), // Nullable: overrides store commission rate
  signedContract: boolean("signed_contract").notNull().default(false),
  isArchived: boolean("is_archived").notNull().default(false),
  role: text("role").notNull().default("staff"), // manager or staff
  paymentMethod: text("payment_method").notNull().default("hybrid"), // fixed, commission, or hybrid
  overridePaymentMethod: boolean("override_payment_method").notNull().default(false),
  overrideCommission: boolean("override_commission").notNull().default(false),
  commissionTypeOverride: text("commission_type_override"), // percentage or fixed_per_service
  commissionFixedAmountOverride: numeric("commission_fixed_amount_override", { precision: 12, scale: 2 }).$type<number>(),
  overrideFormula: boolean("override_formula").notNull().default(false),
  commissionFormulaOverride: text("commission_formula_override"), // formula_a, formula_b, formula_c, formula_d, formula_f
  overrideAttendanceRates: boolean("override_attendance_rates").notNull().default(false),
  activeDayRateOverride: numeric("active_day_rate_override", { precision: 12, scale: 2 }).$type<number>(),
  passiveDayRateOverride: numeric("passive_day_rate_override", { precision: 12, scale: 2 }).$type<number>(),
  leaveDayRateOverride: numeric("leave_day_rate_override", { precision: 12, scale: 2 }).$type<number>(),
  payLeaveDaysOverride: boolean("pay_leave_days_override").notNull().default(false),
  holidayDayRateOverride: numeric("holiday_day_rate_override", { precision: 12, scale: 2 }).$type<number>(),
  payHolidayDaysOverride: boolean("pay_holiday_days_override").notNull().default(false),
  offDayRateOverride: numeric("off_day_rate_override", { precision: 12, scale: 2 }).$type<number>(),
  payOffDaysOverride: boolean("pay_off_days_override").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  unique("staff_store_number_unique").on(table.storeId, table.staffNumber),
  unique("staff_email_unique").on(table.storeId, table.email),
  index("idx_staff_store").on(table.storeId),
]);

export const staffRelations = relations(staff, ({ one, many }) => ({
  store: one(stores, {
    fields: [staff.storeId],
    references: [stores.id],
  }),
  user: one(users, {
    fields: [staff.userId],
    references: [users.id],
  }),
  checkouts: many(checkouts),
}));

export const insertStaffSchema = createInsertSchema(staff).omit({ id: true, isArchived: true, userId: true }).extend({
  name: trimmedString(1, "Staff name is required"),
  email: z.string().email("Valid email is required"),
  staffNumber: z.string().optional().default(""),
  countryCode: z.string().default("NG"),
  mobileNumber: trimmedString(1, "Mobile number is required"),
  role: z.string().default("staff"),
  paymentMethod: z.string().default("hybrid"),
  payPerMonth: z.number(),
  commissionRateOverride: z.number().nullable().optional(),
  commissionFixedAmountOverride: z.number().nullable().optional(),
  activeDayRateOverride: z.number().nullable().optional(),
  passiveDayRateOverride: z.number().nullable().optional(),
  leaveDayRateOverride: z.number().nullable().optional(),
  holidayDayRateOverride: z.number().nullable().optional(),
  offDayRateOverride: z.number().nullable().optional(),
});
export type InsertStaff = z.infer<typeof insertStaffSchema>;
export type Staff = typeof staff.$inferSelect;

// Products Table
export const products = pgTable("products", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  name: text("name").notNull(),
  type: text("type").notNull(), // 'product' or 'service'
  category: text("category"),
  brand: text("brand"),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  isDeleted: boolean("is_deleted").notNull().default(false),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  unique("products_store_name_unique").on(table.storeId, table.name),
]);

export const productsRelations = relations(products, ({ one, many }) => ({
  store: one(stores, {
    fields: [products.storeId],
    references: [stores.id],
  }),
  variants: many(inventory),
}));

// Inventory table
export const inventory = pgTable("inventory", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  name: text("name").notNull(),
  type: text("type").notNull(), // 'product' or 'service'
  costPrice: numeric("cost_price", { precision: 12, scale: 2 }).$type<number>().notNull(),
  sellingPrice: numeric("selling_price", { precision: 12, scale: 2 }).$type<number>().notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 2 }).$type<number>().notNull().default(0), // Supports fractional quantities (e.g. 1.5 kg)
  allowFractional: boolean("allow_fractional").notNull().default(false), // When true, quantity can be a decimal
  unit: text("unit"), // Optional unit label shown in UI and on receipts (e.g. 'kg', 'litre', 'm')
  reorderPoint: numeric("reorder_point", { precision: 12, scale: 2 }).$type<number>(), // Per-item low-stock threshold (null = use global setting)
  commissionSplitOverride: boolean("commission_split_override").default(false).notNull(),
  commissionSplitBusinessShare: integer("commission_split_business_share").default(80).notNull(),
  commissionSplitStaffShare: integer("commission_split_staff_share").default(20).notNull(),
  isBundle: boolean("is_bundle").default(false).notNull(),
  parentInventoryId: varchar("parent_inventory_id"), // Self-referencing foreign key later
  productId: varchar("product_id").notNull().references(() => products.id),
  sku: text("sku"),
  barcode: text("barcode"),
  variantDimensions: jsonb("variant_dimensions"),
  isDeleted: boolean("is_deleted").notNull().default(false),
  deletedAt: timestamp("deleted_at"),
}, (table) => [
  unique("inventory_store_name_unique").on(table.storeId, table.name),
  unique("inventory_store_sku_unique").on(table.storeId, table.sku),
  index("idx_inventory_store_qty").on(table.storeId, table.quantity),
]);

export const inventoryRelations = relations(inventory, ({ one, many }) => ({
  store: one(stores, {
    fields: [inventory.storeId],
    references: [stores.id],
  }),
  product: one(products, {
    fields: [inventory.productId],
    references: [products.id],
  }),
  orders: many(orders),
  transactions: many(transactions),
  profitLoss: many(profitLoss),
}));

export const bookingStatusEnum = ["pending", "confirmed", "in_progress", "completed", "cancelled", "no_show", "rescheduled"] as const;
export type BookingStatus = typeof bookingStatusEnum[number];

export const bookingTypeEnum = ["appointment", "order"] as const;
export type BookingType = typeof bookingTypeEnum[number];

export const reminderPreferenceEnum = ["whatsapp", "sms", "both", "none"] as const;
export type ReminderPreference = typeof reminderPreferenceEnum[number];

export const bookings = pgTable("bookings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  customerId: varchar("customer_id").notNull().references(() => customers.id),
  bookingRef: text("booking_ref").notNull().unique(),
  type: text("type").notNull(),
  status: text("status").notNull().default("pending"),
  scheduledAt: timestamp("scheduled_at").notNull(),
  expectedReadyAt: timestamp("expected_ready_at"),
  leadStaffId: varchar("lead_staff_id").references(() => staff.id),
  assistingStaffId: varchar("assisting_staff_id").references(() => staff.id),
  depositAmount: numeric("deposit_amount", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  depositPaymentMethod: text("deposit_payment_method"),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  discountAmount: numeric("discount_amount", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }).$type<number>().notNull().default(0),
  discountReason: text("discount_reason"),
  discountApprovedBy: text("discount_approved_by"),
  totalPrice: numeric("total_price", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  reminderPreference: text("reminder_preference").notNull().default("whatsapp"),
  reminderSentAt: timestamp("reminder_sent_at"),
  notes: text("notes"),
  rescheduleReason: text("reschedule_reason"),
  rescheduleHistory: jsonb("reschedule_history").notNull().default(sql`'[]'::jsonb`),
  isDeleted: boolean("is_deleted").notNull().default(false),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const bookingItems = pgTable("booking_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bookingId: varchar("booking_id").notNull().references(() => bookings.id),
  inventoryId: varchar("inventory_id").notNull().references(() => inventory.id),
  quantity: numeric("quantity", { precision: 12, scale: 2 }).$type<number>().notNull().default(1),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  totalPrice: numeric("total_price", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
});

export const bookingsRelations = relations(bookings, ({ one, many }) => ({
  store: one(stores, {
    fields: [bookings.storeId],
    references: [stores.id],
  }),
  customer: one(customers, {
    fields: [bookings.customerId],
    references: [customers.id],
  }),
  leadStaff: one(staff, {
    fields: [bookings.leadStaffId],
    references: [staff.id],
    relationName: "bookingLeadStaff",
  }),
  assistingStaff: one(staff, {
    fields: [bookings.assistingStaffId],
    references: [staff.id],
    relationName: "bookingAssistingStaff",
  }),
  items: many(bookingItems),
}));

export const bookingItemsRelations = relations(bookingItems, ({ one }) => ({
  booking: one(bookings, {
    fields: [bookingItems.bookingId],
    references: [bookings.id],
  }),
  inventory: one(inventory, {
    fields: [bookingItems.inventoryId],
    references: [inventory.id],
  }),
}));

export const insertBookingSchema = createInsertSchema(bookings).omit({ id: true, bookingRef: true, createdAt: true, updatedAt: true }).extend({
  depositAmount: z.number().optional(),
  subtotal: z.number().optional(),
  discountAmount: z.number().optional(),
  discountPercent: z.number().optional(),
  totalPrice: z.number().optional(),
});
export type InsertBooking = z.infer<typeof insertBookingSchema>;
export type Booking = typeof bookings.$inferSelect;

export const insertBookingItemSchema = createInsertSchema(bookingItems).omit({ id: true }).extend({
  unitPrice: z.number().optional(),
  totalPrice: z.number().optional(),
});
export type InsertBookingItem = z.infer<typeof insertBookingItemSchema>;
export type BookingItem = typeof bookingItems.$inferSelect;

export const insertProductSchema = createInsertSchema(products).omit({ id: true, createdAt: true, updatedAt: true, isDeleted: true, deletedAt: true }).extend({
  name: trimmedString(1, "Product name is required"),
  type: z.string().transform(s => s.trim()).pipe(z.enum(["product", "service"], { errorMap: () => ({ message: "Type must be product or service" }) })),
});
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof products.$inferSelect;

export const insertInventorySchema = createInsertSchema(inventory).omit({ id: true, isDeleted: true, deletedAt: true }).extend({
  name: trimmedString(1, "Item name is required"),
  type: z.string().transform(s => s.trim()).pipe(z.enum(["product", "service"], { errorMap: () => ({ message: "Type must be product or service" }) })),
  // numeric columns come back as strings from pg driver — coerce to number
  quantity: z.preprocess(v => (v === "" || v === null || v === undefined ? 0 : Number(v)), z.number().min(0)).default(0),
  costPrice: z.preprocess(v => (v === "" || v === null || v === undefined ? 0 : Number(v)), z.number()),
  sellingPrice: z.preprocess(v => (v === "" || v === null || v === undefined ? 0 : Number(v)), z.number()),
  productId: z.string().min(1, "Product group ID is required"),
  sku: z.string().optional().nullable(),
  barcode: z.string().optional().nullable(),
  allowFractional: z.boolean().optional().default(false),
  unit: z.string().optional().nullable(),
  reorderPoint: z.preprocess(v => (v === "" || v === null || v === undefined ? null : Number(v)), z.number().min(0).nullable()).optional(),
});
export type InsertInventory = z.infer<typeof insertInventorySchema>;
export type Inventory = typeof inventory.$inferSelect;

// Cost strategy for restock events
export const costStrategyEnum = ["keep", "last", "weighted", "override"] as const;
export type CostStrategy = typeof costStrategyEnum[number];

// Inventory Restock Events table - tracks all restock operations with audit trail
export const inventoryRestockEvents = pgTable("inventory_restock_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  inventoryId: varchar("inventory_id").notNull().references(() => inventory.id),
  staffId: varchar("staff_id").references(() => staff.id), // Who performed the restock
  userId: varchar("user_id").references(() => users.id), // Alternative: owner/manager without staff record
  quantityAdded: numeric("quantity_added", { precision: 12, scale: 2 }).$type<number>().notNull(),
  previousQuantity: numeric("previous_quantity", { precision: 12, scale: 2 }).$type<number>().notNull(),
  newQuantity: numeric("new_quantity", { precision: 12, scale: 2 }).$type<number>().notNull(),
  unitCost: numeric("unit_cost", { precision: 12, scale: 2 }).$type<number>().notNull(), // Cost per unit for this restock
  previousCostPrice: numeric("previous_cost_price", { precision: 12, scale: 2 }).$type<number>().notNull(),
  newCostPrice: numeric("new_cost_price", { precision: 12, scale: 2 }).$type<number>().notNull(),
  previousSellingPrice: numeric("previous_selling_price", { precision: 12, scale: 2 }).$type<number>().notNull(),
  newSellingPrice: numeric("new_selling_price", { precision: 12, scale: 2 }).$type<number>().notNull(),
  costStrategy: text("cost_strategy").notNull().default("keep"), // keep, last, weighted, override
  notes: text("notes"), // Optional notes for this restock
  reason: text("reason").notNull().default("Regular Restock"), // Regular Restock, Returned Stock, Correction, Opening Stock
  attachment: text("attachment"), // Optional receipt upload url
  restockedAt: timestamp("restocked_at").notNull().defaultNow(),
});

export const inventoryRestockEventsRelations = relations(inventoryRestockEvents, ({ one }) => ({
  store: one(stores, {
    fields: [inventoryRestockEvents.storeId],
    references: [stores.id],
  }),
  inventory: one(inventory, {
    fields: [inventoryRestockEvents.inventoryId],
    references: [inventory.id],
  }),
  staff: one(staff, {
    fields: [inventoryRestockEvents.staffId],
    references: [staff.id],
  }),
  user: one(users, {
    fields: [inventoryRestockEvents.userId],
    references: [users.id],
  }),
}));

export const insertRestockEventSchema = createInsertSchema(inventoryRestockEvents).omit({ 
  id: true, 
  restockedAt: true,
  previousQuantity: true,
  newQuantity: true,
  previousCostPrice: true,
  newCostPrice: true,
  previousSellingPrice: true,
  newSellingPrice: true,
}).extend({
  quantityAdded: z.number().min(1, "Quantity must be at least 1"),
  unitCost: z.number().min(0, "Unit cost cannot be negative"),
  costStrategy: z.enum(costStrategyEnum).default("keep"),
  newSellingPrice: z.number().min(0, "Selling price cannot be negative").optional(),
  notes: z.string().optional(),
  reason: z.enum(["Regular Restock", "Returned Stock", "Correction", "Opening Stock"]).default("Regular Restock"),
  attachment: z.string().optional().nullable(),
});
export type InsertRestockEvent = z.infer<typeof insertRestockEventSchema>;
export type RestockEvent = typeof inventoryRestockEvents.$inferSelect;

// Orders table (line items in a sale)
export const orders = pgTable("orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  inventoryId: varchar("inventory_id").notNull().references(() => inventory.id),
  quantity: numeric("quantity", { precision: 12, scale: 2 }).$type<number>().notNull(),
  returnedQuantity: numeric("returned_quantity", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  totalPrice: numeric("total_price", { precision: 12, scale: 2 }).$type<number>().notNull(),
  refundedAmount: numeric("refunded_amount", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  taxApplied: numeric("tax_applied", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
}, (table) => [
  index("idx_orders_inventory").on(table.inventoryId),
  index("idx_orders_store").on(table.storeId),
]);

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

export const insertOrderSchema = createInsertSchema(orders).omit({ id: true }).extend({
  totalPrice: z.number(),
  refundedAmount: z.number().optional(),
  taxApplied: z.number().optional(),
});
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof orders.$inferSelect;

// Checkouts table (final sale/receipt)
export const checkouts = pgTable("checkouts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  staffId: varchar("staff_id").notNull().references(() => staff.id), // Checkout processor (receipt-level)
  leadStaffId: varchar("lead_staff_id").references(() => staff.id), // Lead staff for this service item (commission)
  assistingStaff1Id: varchar("assisting_staff1_id").references(() => staff.id), // Optional assisting staff #1
  assistingStaff2Id: varchar("assisting_staff2_id").references(() => staff.id), // Optional assisting staff #2
  orderId: varchar("order_id").notNull().references(() => orders.id),
  bookingId: varchar("booking_id").references(() => bookings.id),
  bookingDepositAmount: numeric("booking_deposit_amount", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  bookingDepositMethod: text("booking_deposit_method"),
  balanceCollectedToday: numeric("balance_collected_today", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  receiptNumber: text("receipt_number").notNull().default("LEGACY-RECORD"), // Formatted e.g. "STORE-TXN-0001"
  totalPrice: numeric("total_price", { precision: 12, scale: 2 }).$type<number>().notNull(),
  paymentMethod: text("payment_method").notNull().default("cash"), // cash, transfer, flutterwave, credit, split
  splitPayments: jsonb("split_payments").$type<Array<{method: "cash" | "transfer" | "flutterwave" | "credit" | "store_credit", amount: number}>>(), // only populated if paymentMethod === "split"
  paymentStatus: text("payment_status").notNull().default("completed"), // completed, pending
  paymentReference: text("payment_reference"), // For Flutterwave transaction reference
  commissionSplit: text("commission_split").notNull().default("standard"), // standard or equal
  // Void fields
  isVoided: boolean("is_voided").notNull().default(false),
  voidedAt: timestamp("voided_at"),
  voidedByUserId: varchar("voided_by_user_id").references(() => users.id),
  voidReason: text("void_reason"),
  isPartiallyReturned: boolean("is_partially_returned").notNull().default(false),
  // New transaction-level Discount Option B columns
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  discountAmount: numeric("discount_amount", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }).$type<number>().notNull().default(0),
  discountReason: text("discount_reason"),
  discountApprovedBy: text("discount_approved_by"),
  pointsRedeemed: integer("points_redeemed").notNull().default(0),
  totalCharged: numeric("total_charged", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  taxTotal: numeric("tax_total", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("idx_checkouts_store_created").on(table.storeId, table.createdAt),
  index("idx_checkouts_receipt").on(table.receiptNumber),
  index("idx_checkouts_order").on(table.orderId),
]);

export const checkoutsRelations = relations(checkouts, ({ one, many }) => ({
  store: one(stores, {
    fields: [checkouts.storeId],
    references: [stores.id],
  }),
  staff: one(staff, {
    fields: [checkouts.staffId],
    references: [staff.id],
  }),
  leadStaff: one(staff, {
    fields: [checkouts.leadStaffId],
    references: [staff.id],
    relationName: "checkoutLeadStaff",
  }),
  assistingStaff1: one(staff, {
    fields: [checkouts.assistingStaff1Id],
    references: [staff.id],
    relationName: "checkoutAssistingStaff1",
  }),
  assistingStaff2: one(staff, {
    fields: [checkouts.assistingStaff2Id],
    references: [staff.id],
    relationName: "checkoutAssistingStaff2",
  }),
  order: one(orders, {
    fields: [checkouts.orderId],
    references: [orders.id],
  }),
  booking: one(bookings, {
    fields: [checkouts.bookingId],
    references: [bookings.id],
    relationName: "checkoutBooking",
  }),
  transactions: many(transactions),
}));

export const insertCheckoutSchema = createInsertSchema(checkouts).omit({ id: true, createdAt: true }).extend({
  bookingDepositAmount: z.number().optional(),
  balanceCollectedToday: z.number().optional(),
  totalPrice: z.number(),
  subtotal: z.number().optional(),
  discountAmount: z.number().optional(),
  discountPercent: z.number().optional(),
  totalCharged: z.number().optional(),
  taxTotal: z.number().optional(),
});
export type InsertCheckout = z.infer<typeof insertCheckoutSchema>;
export type Checkout = typeof checkouts.$inferSelect;

// Transactions table
export const transactions = pgTable("transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  customerId: varchar("customer_id").notNull().references(() => customers.id),
  inventoryId: varchar("inventory_id").notNull().references(() => inventory.id),
  amount: numeric("amount", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
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

export const insertTransactionSchema = createInsertSchema(transactions).omit({ id: true, transactionDate: true }).extend({
  amount: z.number().optional(),
});
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactions.$inferSelect;

// Profit & Loss table
export const profitLoss = pgTable("profit_loss", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  inventoryId: varchar("inventory_id").notNull().references(() => inventory.id),
  totalQuantitySold: numeric("total_quantity_sold", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  quantityRemaining: numeric("quantity_remaining", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  totalRevenue: numeric("total_revenue", { precision: 15, scale: 2 }).$type<number>().notNull().default(0),
  totalGrossProfit: numeric("total_gross_profit", { precision: 15, scale: 2 }).$type<number>().notNull().default(0),
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

export const insertProfitLossSchema = createInsertSchema(profitLoss).omit({ id: true }).extend({
  totalRevenue: z.number().optional(),
  totalGrossProfit: z.number().optional(),
});
export type InsertProfitLoss = z.infer<typeof insertProfitLossSchema>;
export type ProfitLoss = typeof profitLoss.$inferSelect;

// Extended types for frontend display with relations
export type StoreWithBusiness = Store & {
  business: Business;
};

export type TransactionWithRelations = Transaction & {
  customer: Customer;
  inventory: Inventory;
  checkout: Checkout & {
    staff?: Staff;
    voidedByUser?: User | null;
    quantity?: number;
    returnedQuantity?: number;
    refundedAmount?: number;
  };
  store: Store;
};

// Void reason presets
export const VOID_REASON_PRESETS = [
  "Error",
  "Duplicate Entry",
  "Customer Request",
  "Stock Correction",
  "Other",
] as const;
export type VoidReasonPreset = typeof VOID_REASON_PRESETS[number];

export type CheckoutWithRelations = Checkout & {
  staff: Staff;
  order: Order & { inventory: Inventory };
};

export type ProfitLossWithInventory = ProfitLoss & {
  inventory: Inventory;
};

// ========== AUTH TABLES ==========

// Session storage table
export const sessions = pgTable(
  "sessions",
  {
    sid: text("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User roles enum
export const userRoleEnum = ["owner", "manager", "staff"] as const;
export type UserRole = typeof userRoleEnum[number];

// User storage table with platform-level auth
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name"), // Display name
  email: text("email").unique(), // Nullable for phone-only users
  phone: text("phone").unique(), // Nullable for email-only users
  password: text("password"), // Legacy hashed password field
  passwordHash: text("password_hash"), // Specified hashed password field
  businessId: varchar("business_id"), // Legacy reference
  role: text("role").notNull().default("owner"), // Legacy role
  isVerified: boolean("is_verified").notNull().default(false), // Legacy isVerified
  isEmailVerified: boolean("is_email_verified").notNull().default(false),
  isPhoneVerified: boolean("is_phone_verified").notNull().default(false),
  profilePhotoUrl: text("profile_photo_url"),
  
  // Custom specifications fields
  activationCode: text("activation_code"),
  activationCodeExpiry: timestamp("activation_code_expiry"),
  activationCodeUsed: boolean("activation_code_used").notNull().default(false),
  createdByInvitation: boolean("created_by_invitation").notNull().default(false),
  otpCode: text("otp_code"),
  otpExpiry: timestamp("otp_expiry"),
  otpAttempts: integer("otp_attempts").notNull().default(0),
  loginAttempts: integer("login_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until"),
  lastLoginAt: timestamp("last_login_at"),

  // Resend activation code rate-limit (replaces in-memory resendLimitMap)
  resendAttempts: integer("resend_attempts").notNull().default(0),
  resendWindowStart: timestamp("resend_window_start"),

  // Supervisor override rate-limit (replaces in-memory supervisorLockoutMap)
  supervisorAttempts: integer("supervisor_attempts").notNull().default(0),
  supervisorLockedUntil: timestamp("supervisor_locked_until"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  status: text("status").notNull().default("active"), // 'active', 'pending', 'locked', 'deactivated'
  suspensionReason: text("suspension_reason"),
  suspendedAt: timestamp("suspended_at"),
});

export const usersRelations = relations(users, ({ one, many }) => ({
  business: one(businesses, {
    fields: [users.businessId],
    references: [businesses.id],
  }),
  notifications: many(notifications),
  organisationMembers: many(organisationMembers),
}));

// Organisation Members Table
export const organisationMembers = pgTable("organisation_members", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  organisationId: varchar("organisation_id").notNull().references(() => organisations.id),
  role: text("role").notNull().default("staff"), // 'owner', 'manager', 'staff'
  staffId: text("staff_id"), // e.g. "EXB-001" internal label
  status: text("status").notNull().default("pending"), // 'pending', 'partial', 'active', 'locked', 'deactivated'
  invitedByUserId: varchar("invited_by_user_id").references(() => users.id),
  activatedAt: timestamp("activated_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  unique("org_member_user_org_unique").on(table.userId, table.organisationId),
]);

export const organisationMembersRelations = relations(organisationMembers, ({ one }) => ({
  user: one(users, {
    fields: [organisationMembers.userId],
    references: [users.id],
  }),
  organisation: one(organisations, {
    fields: [organisationMembers.organisationId],
    references: [organisations.id],
  }),
  invitedBy: one(users, {
    fields: [organisationMembers.invitedByUserId],
    references: [users.id],
  }),
}));

export type InsertOrganisationMember = typeof organisationMembers.$inferInsert;
export type OrganisationMember = typeof organisationMembers.$inferSelect;

// Password complexity validation schema
export const passwordSchema = z.string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number")
  .regex(/[!@#$%^&*(),.?":{}|<>]/, "Password must contain at least one symbol")
  .regex(/^\S*$/, "Password must not contain spaces");

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, updatedAt: true }).extend({
  email: z.string().email("Invalid email address").optional(),
  password: passwordSchema.optional(),
  role: z.enum(userRoleEnum).default("owner"),
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// OTP codes table for verification
export const otpCodes = pgTable("otp_codes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  code: varchar("code", { length: 6 }).notNull(),
  type: text("type").notNull(), // signup, password_reset
  expiresAt: timestamp("expires_at").notNull(),
  isUsed: boolean("is_used").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const otpCodesRelations = relations(otpCodes, ({ one }) => ({
  user: one(users, {
    fields: [otpCodes.userId],
    references: [users.id],
  }),
}));

export const insertOtpCodeSchema = createInsertSchema(otpCodes).omit({ id: true, createdAt: true });
export type InsertOtpCode = z.infer<typeof insertOtpCodeSchema>;
export type OtpCode = typeof otpCodes.$inferSelect;

// Signup request schema (combines business + user info)
export const signupSchema = z.object({
  businessName: trimmedString(1, "Business name is required"),
  address: z.string().optional(),
  phoneCountryCode: z.string().default("+234"),
  phone: z.string().optional(),
  email: z.string().email("Invalid email address"),
  password: passwordSchema,
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});
export type SignupRequest = z.infer<typeof signupSchema>;

// Login schema
export const loginSchema = z.object({
  emailOrPhone: z.string().min(1, "Email or phone number is required"),
  password: z.string().min(1, "Password is required"),
  stayLoggedIn: z.boolean().optional(),
});
export type LoginRequest = z.infer<typeof loginSchema>;

// Forgot password schema
export const forgotPasswordSchema = z.object({
  emailOrPhone: z.string().min(1, "Email or phone number is required"),
});
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordSchema>;

// Reset password schema
export const resetPasswordSchema = z.object({
  emailOrPhone: z.string().min(1, "Email or phone number is required"),
  otp: z.string().length(6, "OTP must be 6 digits"),
  password: passwordSchema,
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});
export type ResetPasswordRequest = z.infer<typeof resetPasswordSchema>;

// OTP verification schema
export const verifyOtpSchema = z.object({
  emailOrPhone: z.string().min(1, "Email or phone number is required"),
  otp: z.string().length(6, "OTP must be 6 digits"),
});
export type VerifyOtpRequest = z.infer<typeof verifyOtpSchema>;

// User with business relation
export type UserWithBusiness = User & {
  business: Business | null;
};

// ========== SETTINGS TABLE ==========

export const settings = pgTable("settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id).unique(),
  activeDayTransport: numeric("active_day_transport", { precision: 12, scale: 2 }).$type<number>().notNull().default(1000),
  passiveDayTransport: numeric("passive_day_transport", { precision: 12, scale: 2 }).$type<number>().notNull().default(500),
  commissionRate: numeric("commission_rate", { precision: 5, scale: 4 }).$type<number>().notNull().default(0.3000),
  defaultPayrollPeriod: text("default_payroll_period").notNull().default("monthly"), // weekly, biweekly, monthly
  maxAssistingStaff: integer("max_assisting_staff").notNull().default(2),
  // Receipt settings
  receiptPrefix: text("receipt_prefix").notNull().default("RCP"),
  receiptThankYouMessage: text("receipt_thank_you_message"),
  // Low stock threshold
  lowStockThreshold: integer("low_stock_threshold").notNull().default(5),
  // Borrow Book Reminder Settings
  borrowBookReminderDaysBefore: integer("borrow_book_reminder_days_before").notNull().default(2),
  borrowBookReminderOnDueDate: boolean("borrow_book_reminder_on_due_date").notNull().default(true),
  borrowBookReminderDaysAfter: integer("borrow_book_reminder_days_after").notNull().default(3),
  borrowBookReminderRepeatDays: integer("borrow_book_reminder_repeat_days").notNull().default(7),
  borrowBookReminderStopDays: integer("borrow_book_reminder_stop_days").notNull().default(30),
  borrowBookReminderLanguage: text("borrow_book_reminder_language").notNull().default("both"), // pidgin, english, both
  whatsappGatewayConfigured: boolean("whatsapp_gateway_configured").notNull().default(false),
  smsGatewayConfigured: boolean("sms_gateway_configured").notNull().default(false),
  // Payroll Settings defaults
  defaultPaymentMethod: text("default_payment_method").notNull().default("hybrid"), // fixed, commission, hybrid
  commissionType: text("commission_type").notNull().default("percentage"), // percentage, fixed_per_service
  commissionFixedAmount: numeric("commission_fixed_amount", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  commissionFormula: text("commission_formula").notNull().default("formula_b"), // formula_a, formula_b, formula_c, formula_d, formula_f
  leaveDayRate: numeric("leave_day_rate", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  payLeaveDays: boolean("pay_leave_days").notNull().default(false),
  holidayDayRate: numeric("holiday_day_rate", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  payHolidayDays: boolean("pay_holiday_days").notNull().default(false),
  offDayRate: numeric("off_day_rate", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  payOffDays: boolean("pay_off_days").notNull().default(false),
  leadSplit2: integer("lead_split_2").notNull().default(80),
  asstSplit2: integer("asst_split_2").notNull().default(20),
  leadSplit3: integer("lead_split_3").notNull().default(60),
  asst1Split3: integer("asst1_split_3").notNull().default(20),
  asst2Split3: integer("asst2_split_3").notNull().default(20),
  fixedBaseAmount: numeric("fixed_base_amount", { precision: 12, scale: 2 }).$type<number>().notNull().default(30000),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const settingsRelations = relations(settings, ({ one }) => ({
  store: one(stores, {
    fields: [settings.storeId],
    references: [stores.id],
  }),
}));

export const insertSettingsSchema = createInsertSchema(settings).omit({ id: true, updatedAt: true }).extend({
  activeDayTransport: z.number().optional(),
  passiveDayTransport: z.number().optional(),
  commissionRate: z.number().optional(),
  commissionFixedAmount: z.number().optional(),
  leaveDayRate: z.number().optional(),
  holidayDayRate: z.number().optional(),
  offDayRate: z.number().optional(),
  fixedBaseAmount: z.number().optional(),
});
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Settings = typeof settings.$inferSelect;

// ========== BORROW BOOK (CREDIT & DEBT) TABLES ==========

export const creditEntries = pgTable("credit_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  customerId: varchar("customer_id").notNull().references(() => customers.id),
  amountOwed: numeric("amount_owed", { precision: 12, scale: 2 }).$type<number>().notNull(),
  amountPaidUpfront: numeric("amount_paid_upfront", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  outstandingBalance: numeric("outstanding_balance", { precision: 12, scale: 2 }).$type<number>().notNull(),
  dueDate: timestamp("due_date"),
  description: text("description"),
  linkedTransactionId: varchar("linked_transaction_id").references(() => checkouts.id),
  status: text("status").notNull().default("owing"), // owing, partial, overdue, settled, written_off, void
  notes: text("notes"),
  writeOffReason: text("write_off_reason"), // Bad Debt, Customer Unreachable, Goodwill, Error Correction, Other
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const repayments = pgTable("repayments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  creditEntryId: varchar("credit_entry_id").notNull().references(() => creditEntries.id),
  amountReceived: numeric("amount_received", { precision: 12, scale: 2 }).$type<number>().notNull(),
  paymentMethod: text("payment_method").notNull().default("cash"), // cash, transfer, pos
  notes: text("notes"),
  recordedByStaffId: varchar("recorded_by_staff_id").references(() => staff.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const reminderLogs = pgTable("reminder_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  creditEntryId: varchar("credit_entry_id").notNull().references(() => creditEntries.id),
  channel: text("channel").notNull(), // whatsapp, sms
  type: text("type").notNull(), // manual, auto
  status: text("status").notNull(), // sent, failed
  messageContent: text("message_content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Relationships
export const creditEntriesRelations = relations(creditEntries, ({ one, many }) => ({
  store: one(stores, {
    fields: [creditEntries.storeId],
    references: [stores.id],
  }),
  customer: one(customers, {
    fields: [creditEntries.customerId],
    references: [customers.id],
  }),
  checkout: one(checkouts, {
    fields: [creditEntries.linkedTransactionId],
    references: [checkouts.id],
  }),
  repayments: many(repayments),
  reminderLogs: many(reminderLogs),
}));

export const repaymentsRelations = relations(repayments, ({ one }) => ({
  creditEntry: one(creditEntries, {
    fields: [repayments.creditEntryId],
    references: [creditEntries.id],
  }),
  staff: one(staff, {
    fields: [repayments.recordedByStaffId],
    references: [staff.id],
  }),
}));

export const reminderLogsRelations = relations(reminderLogs, ({ one }) => ({
  creditEntry: one(creditEntries, {
    fields: [reminderLogs.creditEntryId],
    references: [creditEntries.id],
  }),
}));

// Schemas & Types
export const insertCreditEntrySchema = createInsertSchema(creditEntries).omit({ id: true, createdAt: true, updatedAt: true }).extend({
  amountOwed: z.number(),
  amountPaidUpfront: z.number().optional(),
  outstandingBalance: z.number(),
});
export type InsertCreditEntry = z.infer<typeof insertCreditEntrySchema>;
export type CreditEntry = typeof creditEntries.$inferSelect;

export const insertRepaymentSchema = createInsertSchema(repayments).omit({ id: true, createdAt: true }).extend({
  amountReceived: z.number(),
});
export type InsertRepayment = z.infer<typeof insertRepaymentSchema>;
export type Repayment = typeof repayments.$inferSelect;

export const insertReminderLogSchema = createInsertSchema(reminderLogs).omit({ id: true, createdAt: true });
export type InsertReminderLog = z.infer<typeof insertReminderLogSchema>;
export type ReminderLog = typeof reminderLogs.$inferSelect;

// ========== PAYROLL TABLES ==========

// Attendance status enum — 'leave' added to support paid/unpaid leave tracking
export const attendanceStatusEnum = ["present", "absent", "off_day", "holiday", "leave"] as const;
export type AttendanceStatus = typeof attendanceStatusEnum[number];

// Attendance records table - one record per staff per day
export const attendanceRecords = pgTable("attendance_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  staffId: varchar("staff_id").notNull().references(() => staff.id),
  date: text("date").notNull(), // ISO date string YYYY-MM-DD
  status: text("status").notNull(), // present, absent, off_day, holiday
  notes: text("notes"),
  markedByUserId: varchar("marked_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  unique("attendance_staff_date_unique").on(table.storeId, table.staffId, table.date),
  index("idx_attendance_staff_date").on(table.staffId, table.date),
]);

export const attendanceRecordsRelations = relations(attendanceRecords, ({ one }) => ({
  store: one(stores, {
    fields: [attendanceRecords.storeId],
    references: [stores.id],
  }),
  staff: one(staff, {
    fields: [attendanceRecords.staffId],
    references: [staff.id],
  }),
  markedByUser: one(users, {
    fields: [attendanceRecords.markedByUserId],
    references: [users.id],
  }),
}));

export const insertAttendanceRecordSchema = createInsertSchema(attendanceRecords).omit({ id: true, createdAt: true, updatedAt: true }).extend({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
  status: z.enum(attendanceStatusEnum),
  notes: z.string().optional(),
});
export type InsertAttendanceRecord = z.infer<typeof insertAttendanceRecordSchema>;
export type AttendanceRecord = typeof attendanceRecords.$inferSelect;

// Payroll period status
export const payrollPeriodStatusEnum = ["pending", "approved", "paid"] as const;
export type PayrollPeriodStatus = typeof payrollPeriodStatusEnum[number];

// Payroll period type
export const payrollPeriodTypeEnum = ["weekly", "biweekly", "monthly"] as const;
export type PayrollPeriodType = typeof payrollPeriodTypeEnum[number];

// Payroll periods table
export const payrollPeriods = pgTable("payroll_periods", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  periodType: text("period_type").notNull().default("monthly"), // weekly, biweekly, monthly
  startDate: text("start_date").notNull(), // ISO date YYYY-MM-DD
  endDate: text("end_date").notNull(),   // ISO date YYYY-MM-DD
  status: text("status").notNull().default("pending"), // pending, approved, paid
  settingsSnapshot: jsonb("settings_snapshot"), // Snapshot of rates used at calculation time
  approvedByUserId: varchar("approved_by_user_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const payrollPeriodsRelations = relations(payrollPeriods, ({ one, many }) => ({
  store: one(stores, {
    fields: [payrollPeriods.storeId],
    references: [stores.id],
  }),
  approvedByUser: one(users, {
    fields: [payrollPeriods.approvedByUserId],
    references: [users.id],
  }),
  entries: many(payrollEntries),
}));

export const insertPayrollPeriodSchema = createInsertSchema(payrollPeriods).omit({ id: true, createdAt: true, approvedAt: true, paidAt: true, settingsSnapshot: true }).extend({
  periodType: z.enum(payrollPeriodTypeEnum).default("monthly"),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Start date must be YYYY-MM-DD"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "End date must be YYYY-MM-DD"),
  status: z.enum(payrollPeriodStatusEnum).default("pending"),
});
export type InsertPayrollPeriod = z.infer<typeof insertPayrollPeriodSchema>;
export type PayrollPeriod = typeof payrollPeriods.$inferSelect;

// Payroll entries table — Option 4 Hybrid pay model per staff per period
export const payrollEntries = pgTable("payroll_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  periodId: varchar("period_id").notNull().references(() => payrollPeriods.id),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  staffId: varchar("staff_id").notNull().references(() => staff.id),
  activeDays: integer("active_days").notNull().default(0),
  passiveDays: integer("passive_days").notNull().default(0),
  activeTransport: numeric("active_transport", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  passiveTransport: numeric("passive_transport", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  totalTransport: numeric("total_transport", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  grossCommission: numeric("gross_commission", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  netPay: numeric("net_pay", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  leaveDays: integer("leave_days").notNull().default(0),
  holidayDays: integer("holiday_days").notNull().default(0),
  offDays: integer("off_days").notNull().default(0),
  absentDays: integer("absent_days").notNull().default(0),
  leavePay: numeric("leave_pay", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  holidayPay: numeric("holiday_pay", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  offDayPay: numeric("off_day_pay", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  calculationDetails: jsonb("calculation_details"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  unique("payroll_entry_period_staff_unique").on(table.periodId, table.staffId),
]);

export const payrollEntriesRelations = relations(payrollEntries, ({ one }) => ({
  period: one(payrollPeriods, {
    fields: [payrollEntries.periodId],
    references: [payrollPeriods.id],
  }),
  store: one(stores, {
    fields: [payrollEntries.storeId],
    references: [stores.id],
  }),
  staff: one(staff, {
    fields: [payrollEntries.staffId],
    references: [staff.id],
  }),
}));

export const insertPayrollEntrySchema = createInsertSchema(payrollEntries).omit({ id: true, createdAt: true, updatedAt: true }).extend({
  activeTransport: z.number().optional(),
  passiveTransport: z.number().optional(),
  totalTransport: z.number().optional(),
  grossCommission: z.number().optional(),
  netPay: z.number().optional(),
  leavePay: z.number().optional(),
  holidayPay: z.number().optional(),
  offDayPay: z.number().optional(),
});
export type InsertPayrollEntry = z.infer<typeof insertPayrollEntrySchema>;
export type PayrollEntry = typeof payrollEntries.$inferSelect;

// Extended payroll types for frontend
export type PayrollEntryWithStaff = PayrollEntry & {
  staff: Staff;
};

export type PayrollPeriodWithEntries = PayrollPeriod & {
  entries: PayrollEntryWithStaff[];
};

// Commission breakdown per checkout (computed, not stored)
export type CommissionBreakdown = {
  checkoutId: string;
  receiptNumber: string;
  transactionDate: string;
  inventoryName: string;
  inventoryType: string;
  serviceAmount: number;
  commissionPool: number;
  role: "lead" | "assistant_1" | "assistant_2";
  share: number;
  earned: number;
};

// Daily Summary Line for Option 4 drill-down
export type DailySummaryLine = {
  date: string;
  dayType: "Active" | "Passive" | "Absent";
  transport: number;
  servicesWorked: string;
  commissionEarned: number;
  dailyTotal: number;
};

// Expense Categories Table
export const expenseCategories = pgTable("expense_categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  name: text("name").notNull(),
  isSystem: boolean("is_system").notNull().default(false), // true for Payroll, Rent, etc.
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const expenseCategoriesRelations = relations(expenseCategories, ({ one, many }) => ({
  store: one(stores, {
    fields: [expenseCategories.storeId],
    references: [stores.id],
  }),
  expenses: many(expenses),
}));

export const insertExpenseCategorySchema = createInsertSchema(expenseCategories).omit({ id: true, createdAt: true });
export type InsertExpenseCategory = z.infer<typeof insertExpenseCategorySchema>;
export type ExpenseCategory = typeof expenseCategories.$inferSelect;

// Expenses Table
export const expenses = pgTable("expenses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  title: text("title").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  categoryId: varchar("category_id").notNull().references(() => expenseCategories.id),
  inventoryId: varchar("inventory_id").references(() => inventory.id),
  date: text("date").notNull(), // ISO Date YYYY-MM-DD
  notes: text("notes"),
  receiptUrl: text("receipt_url"),
  isAutoGenerated: boolean("is_auto_generated").notNull().default(false), // true if from Payroll module
  paymentMethod: text("payment_method").notNull().default("cash"), // cash, transfer, pos, split, credit
  splitPayments: jsonb("split_payments").$type<Array<{method: string, amount: number}>>(),
  isDeleted: boolean("is_deleted").notNull().default(false),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("idx_expenses_store_date").on(table.storeId, table.date),
]);

export const expensesRelations = relations(expenses, ({ one }) => ({
  store: one(stores, {
    fields: [expenses.storeId],
    references: [stores.id],
  }),
  category: one(expenseCategories, {
    fields: [expenses.categoryId],
    references: [expenseCategories.id],
  }),
  inventory: one(inventory, {
    fields: [expenses.inventoryId],
    references: [inventory.id],
  }),
}));

export const insertExpenseSchema = createInsertSchema(expenses).omit({ id: true, createdAt: true, updatedAt: true, isAutoGenerated: true }).extend({
  splitPayments: z.array(
    z.object({
      method: z.string(),
      amount: z.number(),
    })
  ).nullable().optional(),
  amount: z.number(),
});
export type InsertExpense = z.infer<typeof insertExpenseSchema>;
export type Expense = typeof expenses.$inferSelect;

export type ExpenseWithCategory = Expense & {
  category: ExpenseCategory;
  inventory?: Inventory | null;
};

// Notifications table
export const notifications = pgTable("notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").references(() => stores.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  type: text("type").notNull(), // 'low_stock', 'void_transaction', 'payroll_period', 'system'
  message: text("message").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  archivedAt: timestamp("archived_at"),
});

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
  store: one(stores, {
    fields: [notifications.storeId],
    references: [stores.id],
  }),
}));

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;

// Store Integrations table
export const storeIntegrations = pgTable("store_integrations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  provider: varchar("provider").notNull(), // 'flutterwave' | 'stripe' | 'paystack'
  isActive: boolean("is_active").notNull().default(false),
  publicKey: text("public_key"),
  secretKey: text("secret_key"),
  webhookSecret: text("webhook_secret"),
  currency: text("currency").notNull().default("NGN"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const storeIntegrationsRelations = relations(storeIntegrations, ({ one }) => ({
  store: one(stores, {
    fields: [storeIntegrations.storeId],
    references: [stores.id],
  }),
}));

export const insertStoreIntegrationSchema = createInsertSchema(storeIntegrations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertStoreIntegration = z.infer<typeof insertStoreIntegrationSchema>;
export type StoreIntegration = typeof storeIntegrations.$inferSelect;

// Promotions Table
export const promotions = pgTable("promotions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type").notNull(), // 'buy_x_get_y' | 'spend_x_get_y'
  buyItemId: varchar("buy_item_id").references(() => inventory.id),
  buyQuantity: integer("buy_quantity"),
  getItemId: varchar("get_item_id").references(() => inventory.id),
  getQuantity: integer("get_quantity"),
  spendAmount: numeric("spend_amount", { precision: 12, scale: 2 }).$type<number>(),
  isActive: boolean("is_active").notNull().default(true),
  isDeleted: boolean("is_deleted").notNull().default(false),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const promotionsRelations = relations(promotions, ({ one }) => ({
  store: one(stores, {
    fields: [promotions.storeId],
    references: [stores.id],
  }),
  buyItem: one(inventory, {
    fields: [promotions.buyItemId],
    references: [inventory.id],
  }),
  getItem: one(inventory, {
    fields: [promotions.getItemId],
    references: [inventory.id],
  }),
}));

export const insertPromotionSchema = createInsertSchema(promotions).omit({
  id: true,
  createdAt: true,
}).extend({
  name: trimmedString(1, "Promotion name is required"),
  type: z.enum(["buy_x_get_y", "spend_x_get_y"]),
  buyQuantity: z.number().min(1).optional().nullable(),
  getQuantity: z.number().min(1).optional().nullable(),
  spendAmount: z.number().min(0).optional().nullable(),
  isActive: z.boolean().default(true),
});

export type InsertPromotion = z.infer<typeof insertPromotionSchema>;
export type Promotion = typeof promotions.$inferSelect;

// Custom Roles Table
export const customRoles = pgTable("custom_roles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessId: varchar("business_id").notNull().references(() => businesses.id),
  name: text("name").notNull(),
  description: text("description"),
  permissions: text("permissions").array().notNull().default(sql`'{}'::text[]`), // array of accessible modules/features
  isDeleted: boolean("is_deleted").notNull().default(false),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const customRolesRelations = relations(customRoles, ({ one }) => ({
  business: one(businesses, {
    fields: [customRoles.businessId],
    references: [businesses.id],
  }),
}));

export const insertCustomRoleSchema = createInsertSchema(customRoles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  name: trimmedString(1, "Role name is required"),
  permissions: z.array(z.string()).default([]),
});

export type InsertCustomRole = z.infer<typeof insertCustomRoleSchema>;
export type CustomRole = typeof customRoles.$inferSelect;

// V2 Feature: Return Logs
export const returnLogs = pgTable("return_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  checkoutId: varchar("checkout_id").notNull().references(() => checkouts.id),
  orderId: varchar("order_id").notNull().references(() => orders.id),
  quantity: numeric("quantity", { precision: 12, scale: 4 }).$type<number>().notNull(),
  refundAmount: numeric("refund_amount", { precision: 12, scale: 2 }).$type<number>().notNull(),
  refundMethod: text("refund_method").notNull(),
  reason: text("reason"),
  staffId: varchar("staff_id").references(() => staff.id),
  userId: varchar("user_id").references(() => users.id),
  restockEventId: varchar("restock_event_id").references(() => inventoryRestockEvents.id),
  inventoryQuantityBeforeReturn: numeric("inventory_quantity_before_return", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  inventoryQuantityAfterReturn: numeric("inventory_quantity_after_return", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const returnLogsRelations = relations(returnLogs, ({ one }) => ({
  store: one(stores, { fields: [returnLogs.storeId], references: [stores.id] }),
  checkout: one(checkouts, { fields: [returnLogs.checkoutId], references: [checkouts.id] }),
  order: one(orders, { fields: [returnLogs.orderId], references: [orders.id] }),
  restockEvent: one(inventoryRestockEvents, { fields: [returnLogs.restockEventId], references: [inventoryRestockEvents.id] }),
}));

export const insertReturnLogSchema = createInsertSchema(returnLogs).omit({ id: true, createdAt: true }).extend({
  refundAmount: z.number(),
});
export type InsertReturnLog = z.infer<typeof insertReturnLogSchema>;
export type ReturnLog = typeof returnLogs.$inferSelect;

// V2 Feature: Store Credit Transactions
export const storeCreditTransactions = pgTable("store_credit_transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  customerId: varchar("customer_id").notNull().references(() => customers.id),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  amount: numeric("amount", { precision: 12, scale: 2 }).$type<number>().notNull(), // positive for additions, negative for redemptions
  type: text("type").notNull(), // 'issued_refund', 'purchase_redemption', 'manual_adjustment'
  checkoutId: varchar("checkout_id").references(() => checkouts.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const storeCreditTransactionsRelations = relations(storeCreditTransactions, ({ one }) => ({
  customer: one(customers, { fields: [storeCreditTransactions.customerId], references: [customers.id] }),
  store: one(stores, { fields: [storeCreditTransactions.storeId], references: [stores.id] }),
  checkout: one(checkouts, { fields: [storeCreditTransactions.checkoutId], references: [checkouts.id] }),
}));

export const insertStoreCreditTransactionSchema = createInsertSchema(storeCreditTransactions).omit({ id: true, createdAt: true }).extend({
  amount: z.number(),
});
export type InsertStoreCreditTransaction = z.infer<typeof insertStoreCreditTransactionSchema>;
export type StoreCreditTransaction = typeof storeCreditTransactions.$inferSelect;

// V2 Feature: Cash Drawer Management
export const cashRegisterSessions = pgTable("cash_register_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  status: text("status").notNull().default("open"), // open, closed
  openedAt: timestamp("opened_at").notNull().defaultNow(),
  closedAt: timestamp("closed_at"),
  openedByUserId: varchar("opened_by_user_id").references(() => users.id),
  closedByUserId: varchar("closed_by_user_id").references(() => users.id),
  openingFloat: numeric("opening_float", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  expectedCash: numeric("expected_cash", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  actualCash: numeric("actual_cash", { precision: 12, scale: 2 }).$type<number>(),
  difference: numeric("difference", { precision: 12, scale: 2 }).$type<number>(),
  notes: text("notes"),
});

export const cashDrops = pgTable("cash_drops", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull().references(() => cashRegisterSessions.id),
  amount: numeric("amount", { precision: 12, scale: 2 }).$type<number>().notNull(),
  droppedAt: timestamp("dropped_at").notNull().defaultNow(),
  droppedByUserId: varchar("dropped_by_user_id").references(() => users.id),
  notes: text("notes"),
});

export const cashRegisterRelations = relations(cashRegisterSessions, ({ one, many }) => ({
  store: one(stores, { fields: [cashRegisterSessions.storeId], references: [stores.id] }),
  drops: many(cashDrops),
}));

export const cashDropsRelations = relations(cashDrops, ({ one }) => ({
  session: one(cashRegisterSessions, { fields: [cashDrops.sessionId], references: [cashRegisterSessions.id] }),
}));

export const insertCashRegisterSessionSchema = createInsertSchema(cashRegisterSessions).omit({ id: true }).extend({
  openingFloat: z.number().optional(),
  expectedCash: z.number().optional(),
  actualCash: z.number().nullable().optional(),
  difference: z.number().nullable().optional(),
});
export const insertCashDropSchema = createInsertSchema(cashDrops).omit({ id: true }).extend({
  amount: z.number(),
});
export type CashRegisterSession = typeof cashRegisterSessions.$inferSelect;
export type CashDrop = typeof cashDrops.$inferSelect;

// V2 Feature: Accounts Payable (Vendor Bills)
export const vendors = pgTable("vendors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  name: text("name").notNull(),
  contactName: text("contact_name"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  notes: text("notes"),
  isArchived: boolean("is_archived").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const vendorBills = pgTable("vendor_bills", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  vendorId: varchar("vendor_id").notNull().references(() => vendors.id),
  amount: numeric("amount", { precision: 12, scale: 2 }).$type<number>().notNull(),
  amountPaid: numeric("amount_paid", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  status: text("status").notNull().default("unpaid"), // unpaid, partial, paid
  dueDate: timestamp("due_date"),
  billDate: timestamp("bill_date").notNull().defaultNow(),
  notes: text("notes"),
  linkedRestockEventId: varchar("linked_restock_event_id").references(() => inventoryRestockEvents.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const vendorRelations = relations(vendors, ({ many }) => ({
  bills: many(vendorBills),
}));

export const vendorBillRelations = relations(vendorBills, ({ one }) => ({
  vendor: one(vendors, { fields: [vendorBills.vendorId], references: [vendors.id] }),
  restockEvent: one(inventoryRestockEvents, { fields: [vendorBills.linkedRestockEventId], references: [inventoryRestockEvents.id] }),
}));

export const insertVendorSchema = createInsertSchema(vendors).omit({ id: true, createdAt: true }).extend({
  email: z.string().trim().toLowerCase().refine(v => !v || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v), "Enter a valid email address.").optional().or(z.literal("")),
  phone: z.string().trim().refine(v => !v || v.replace(/\D/g, "").length >= 7, "Enter a valid phone number.").optional().or(z.literal("")),
});
export const insertVendorBillSchema = createInsertSchema(vendorBills).omit({ id: true, createdAt: true }).extend({
  amount: z.number(),
  amountPaid: z.number().optional(),
});
export type Vendor = typeof vendors.$inferSelect;
export type VendorBill = typeof vendorBills.$inferSelect;
export type InsertVendor = z.infer<typeof insertVendorSchema>;
export type InsertVendorBill = z.infer<typeof insertVendorBillSchema>;

// V2 Feature: Stock Audits
export const stockAudits = pgTable("stock_audits", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  status: text("status").notNull().default("draft"), // draft, approved
  notes: text("notes"),
  conductedByStaffId: varchar("conducted_by_staff_id").references(() => staff.id),
  approvedByUserId: varchar("approved_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  approvedAt: timestamp("approved_at"),
});

export const stockAuditItems = pgTable("stock_audit_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  auditId: varchar("audit_id").notNull().references(() => stockAudits.id),
  inventoryId: varchar("inventory_id").notNull().references(() => inventory.id),
  systemQuantity: numeric("system_quantity", { precision: 12, scale: 2 }).$type<number>().notNull(),
  physicalQuantity: numeric("physical_quantity", { precision: 12, scale: 2 }).$type<number>().notNull(),
  variance: numeric("variance", { precision: 12, scale: 2 }).$type<number>().notNull(),
  reason: text("reason"),
});

export const stockAuditRelations = relations(stockAudits, ({ one, many }) => ({
  store: one(stores, { fields: [stockAudits.storeId], references: [stores.id] }),
  conductedBy: one(staff, { fields: [stockAudits.conductedByStaffId], references: [staff.id] }),
  approvedBy: one(users, { fields: [stockAudits.approvedByUserId], references: [users.id] }),
  items: many(stockAuditItems),
}));

export const stockAuditItemRelations = relations(stockAuditItems, ({ one }) => ({
  audit: one(stockAudits, { fields: [stockAuditItems.auditId], references: [stockAudits.id] }),
  inventory: one(inventory, { fields: [stockAuditItems.inventoryId], references: [inventory.id] }),
}));

export const insertStockAuditSchema = createInsertSchema(stockAudits).omit({ id: true, createdAt: true });
export const insertStockAuditItemSchema = createInsertSchema(stockAuditItems).omit({ id: true });
export type StockAudit = typeof stockAudits.$inferSelect;
export type StockAuditItem = typeof stockAuditItems.$inferSelect;

// V2 Feature: Bundled Components
export const bundleComponents = pgTable("bundle_components", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  parentInventoryId: varchar("parent_inventory_id").notNull().references(() => inventory.id),
  componentInventoryId: varchar("component_inventory_id").notNull().references(() => inventory.id),
  quantity: numeric("quantity", { precision: 12, scale: 2 }).$type<number>().notNull().default(1),
});

export const bundleComponentsRelations = relations(bundleComponents, ({ one }) => ({
  parent: one(inventory, { fields: [bundleComponents.parentInventoryId], references: [inventory.id] }),
  component: one(inventory, { fields: [bundleComponents.componentInventoryId], references: [inventory.id] }),
}));

export const insertBundleComponentSchema = createInsertSchema(bundleComponents).omit({ id: true });
export type BundleComponent = typeof bundleComponents.$inferSelect;

// V3 Feature: Quotes & Estimates
export const quotes = pgTable("quotes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  customerId: varchar("customer_id").references(() => customers.id),
  quoteRef: text("quote_ref").notNull().unique(),
  status: text("status").notNull().default("draft"),
  totalPrice: numeric("total_price", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  notes: text("notes"),
  validUntil: timestamp("valid_until"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const quoteItems = pgTable("quote_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  quoteId: varchar("quote_id").notNull().references(() => quotes.id),
  inventoryId: varchar("inventory_id").notNull().references(() => inventory.id),
  quantity: numeric("quantity", { precision: 12, scale: 2 }).$type<number>().notNull().default(1),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  totalPrice: numeric("total_price", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
});

export const quotesRelations = relations(quotes, ({ one, many }) => ({
  store: one(stores, { fields: [quotes.storeId], references: [stores.id] }),
  customer: one(customers, { fields: [quotes.customerId], references: [customers.id] }),
  items: many(quoteItems),
}));

export const quoteItemsRelations = relations(quoteItems, ({ one }) => ({
  quote: one(quotes, { fields: [quoteItems.quoteId], references: [quotes.id] }),
  inventory: one(inventory, { fields: [quoteItems.inventoryId], references: [inventory.id] }),
}));

export const insertQuoteSchema = createInsertSchema(quotes).omit({ id: true, createdAt: true, updatedAt: true }).extend({
  totalPrice: z.number().optional(),
});
export const insertQuoteItemSchema = createInsertSchema(quoteItems).omit({ id: true }).extend({
  unitPrice: z.number().optional(),
  totalPrice: z.number().optional(),
});
export type InsertQuote = z.infer<typeof insertQuoteSchema>;
export type InsertQuoteItem = z.infer<typeof insertQuoteItemSchema>;
export type Quote = typeof quotes.$inferSelect;
export type QuoteItem = typeof quoteItems.$inferSelect;

// V3 Feature: Purchase Orders
export const purchaseOrders = pgTable("purchase_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  vendorId: varchar("vendor_id").notNull().references(() => vendors.id),
  poNumber: text("po_number").notNull().unique(),
  status: text("status").notNull().default("draft"),
  totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  expectedDelivery: timestamp("expected_delivery"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const purchaseOrderItems = pgTable("purchase_order_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  poId: varchar("po_id").notNull().references(() => purchaseOrders.id),
  inventoryId: varchar("inventory_id").notNull().references(() => inventory.id),
  quantity: numeric("quantity", { precision: 12, scale: 2 }).$type<number>().notNull(),
  receivedQuantity: numeric("received_quantity", { precision: 12, scale: 4 }).$type<number>().notNull().default(0),
  unitCost: numeric("unit_cost", { precision: 12, scale: 2 }).$type<number>().notNull(),
  totalCost: numeric("total_cost", { precision: 12, scale: 2 }).$type<number>().notNull(),
});

export const purchaseOrderRelations = relations(purchaseOrders, ({ one, many }) => ({
  store: one(stores, { fields: [purchaseOrders.storeId], references: [stores.id] }),
  vendor: one(vendors, { fields: [purchaseOrders.vendorId], references: [vendors.id] }),
  items: many(purchaseOrderItems),
}));

export const purchaseOrderItemRelations = relations(purchaseOrderItems, ({ one }) => ({
  purchaseOrder: one(purchaseOrders, { fields: [purchaseOrderItems.poId], references: [purchaseOrders.id] }),
  inventory: one(inventory, { fields: [purchaseOrderItems.inventoryId], references: [inventory.id] }),
}));

export const insertPurchaseOrderSchema = createInsertSchema(purchaseOrders).omit({ id: true, createdAt: true, updatedAt: true }).extend({
  totalAmount: z.number().optional(),
});
export const insertPurchaseOrderItemSchema = createInsertSchema(purchaseOrderItems).omit({ id: true }).extend({
  unitCost: z.number(),
  totalCost: z.number(),
});
export type InsertPurchaseOrder = z.infer<typeof insertPurchaseOrderSchema>;
export type InsertPurchaseOrderItem = z.infer<typeof insertPurchaseOrderItemSchema>;
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type PurchaseOrderItem = typeof purchaseOrderItems.$inferSelect;

// V3 Feature: Stock Transfers
export const stockTransfers = pgTable("stock_transfers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  fromStoreId: varchar("from_store_id").notNull().references(() => stores.id),
  toStoreId: varchar("to_store_id").notNull().references(() => stores.id),
  status: text("status").notNull().default("pending"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const stockTransferItems = pgTable("stock_transfer_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  transferId: varchar("transfer_id").notNull().references(() => stockTransfers.id),
  inventoryId: varchar("inventory_id").notNull().references(() => inventory.id),
  quantity: numeric("quantity", { precision: 12, scale: 2 }).$type<number>().notNull(),
});

export const stockTransferRelations = relations(stockTransfers, ({ one, many }) => ({
  fromStore: one(stores, { fields: [stockTransfers.fromStoreId], references: [stores.id], relationName: "transferFrom" }),
  toStore: one(stores, { fields: [stockTransfers.toStoreId], references: [stores.id], relationName: "transferTo" }),
  items: many(stockTransferItems),
}));

export const stockTransferItemRelations = relations(stockTransferItems, ({ one }) => ({
  transfer: one(stockTransfers, { fields: [stockTransferItems.transferId], references: [stockTransfers.id] }),
  inventory: one(inventory, { fields: [stockTransferItems.inventoryId], references: [inventory.id] }),
}));

export const insertStockTransferSchema = createInsertSchema(stockTransfers).omit({ id: true, createdAt: true, updatedAt: true });
export const insertStockTransferItemSchema = createInsertSchema(stockTransferItems).omit({ id: true });
export type InsertStockTransfer = z.infer<typeof insertStockTransferSchema>;
export type InsertStockTransferItem = z.infer<typeof insertStockTransferItemSchema>;
export type StockTransfer = typeof stockTransfers.$inferSelect;
export type StockTransferItem = typeof stockTransferItems.$inferSelect;

// V4 Feature: Tax Rates
export const taxRates = pgTable("tax_rates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  name: text("name").notNull(),
  rate: numeric("rate", { precision: 5, scale: 2 }).$type<number>().notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const taxRateRelations = relations(taxRates, ({ one }) => ({
  store: one(stores, { fields: [taxRates.storeId], references: [stores.id] }),
}));

export const insertTaxRateSchema = createInsertSchema(taxRates).omit({ id: true, createdAt: true }).extend({
  rate: z.number(),
});
export type InsertTaxRate = z.infer<typeof insertTaxRateSchema>;
export type TaxRate = typeof taxRates.$inferSelect;

// V4 Feature: Inventory Batches
export const inventoryBatches = pgTable("inventory_batches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  inventoryId: varchar("inventory_id").notNull().references(() => inventory.id),
  batchNumber: text("batch_number").notNull(),
  expiryDate: timestamp("expiry_date").notNull(),
  quantity: integer("quantity").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const inventoryBatchRelations = relations(inventoryBatches, ({ one }) => ({
  store: one(stores, { fields: [inventoryBatches.storeId], references: [stores.id] }),
  inventory: one(inventory, { fields: [inventoryBatches.inventoryId], references: [inventory.id] }),
}));

export const insertInventoryBatchSchema = createInsertSchema(inventoryBatches).omit({ id: true, createdAt: true });
export type InsertInventoryBatch = z.infer<typeof insertInventoryBatchSchema>;
export type InventoryBatch = typeof inventoryBatches.$inferSelect;

// --- SUPER ADMIN PORTAL TABLES ---

// Super Admins Table
export const superAdmins = pgTable("super_admins", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  email: text("email").unique().notNull(),
  passwordHash: text("password_hash").notNull(),
  mfaSecret: text("mfa_secret"),
  mfaEnabled: boolean("mfa_enabled").notNull().default(false),
  role: text("role").notNull().default("ops_manager"), // 'super_admin', 'ops_manager', 'support_agent', 'finance_admin'
  status: text("status").notNull().default("active"), // 'active', 'suspended'
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at"),
});

export const superAdminsRelations = relations(superAdmins, ({ many }) => ({
  auditLogs: many(superAdminAuditLogs),
}));

export const insertSuperAdminSchema = createInsertSchema(superAdmins).omit({ id: true, createdAt: true }).extend({
  email: z.string().email("Invalid email address"),
});
export type InsertSuperAdmin = z.infer<typeof insertSuperAdminSchema>;
export type SuperAdmin = typeof superAdmins.$inferSelect;

// Feature Flags Table
export const featureFlags = pgTable("feature_flags", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").unique().notNull(),
  status: text("status").notNull().default("off"), // 'on', 'off', 'scoped', 'by_plan'
  scopedOrgIds: jsonb("scoped_org_ids"), // JSON array of business/organisation IDs
  subscriptionTier: text("subscription_tier"), // e.g. 'pro', 'premium' (optional plan scope)
  description: text("description").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  updatedBy: text("updated_by"), // email of the admin who updated it
});

export const insertFeatureFlagSchema = createInsertSchema(featureFlags).omit({ id: true, updatedAt: true });
export type InsertFeatureFlag = z.infer<typeof insertFeatureFlagSchema>;
export type FeatureFlag = typeof featureFlags.$inferSelect;

// Announcements Table
export const announcements = pgTable("announcements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  message: text("message").notNull(),
  type: text("type").notNull().default("info"), // 'info', 'warning', 'update', 'maintenance'
  target: text("target").notNull().default("all"), // 'all', 'active', 'specific_plan', 'specific_org'
  targetOrgId: varchar("target_org_id").references(() => organisations.id),
  showFrom: timestamp("show_from").notNull(),
  showUntil: timestamp("show_until").notNull(),
  dismissible: boolean("dismissible").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  createdBy: text("created_by"), // email of the admin who created it
});

export const announcementsRelations = relations(announcements, ({ one }) => ({
  targetOrg: one(organisations, { fields: [announcements.targetOrgId], references: [organisations.id] }),
}));

export const insertAnnouncementSchema = createInsertSchema(announcements).omit({ id: true, createdAt: true });
export type InsertAnnouncement = z.infer<typeof insertAnnouncementSchema>;
export type Announcement = typeof announcements.$inferSelect;

// Super Admin Audit Logs Table (Immutable Operations Ledger)
export const superAdminAuditLogs = pgTable("super_admin_audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  adminId: varchar("admin_id").notNull().references(() => superAdmins.id),
  adminEmail: text("admin_email").notNull(),
  adminRole: text("admin_role").notNull(),
  action: text("action").notNull(), // e.g. 'suspend_business', 'reset_user_password', 'toggle_feature_flag'
  target: text("target").notNull(), // description/ID of the target affected resource
  ipAddress: text("ip_address").notNull(),
  details: jsonb("details"), // JSON payload detailing old/new parameters
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const superAdminAuditLogsRelations = relations(superAdminAuditLogs, ({ one }) => ({
  admin: one(superAdmins, { fields: [superAdminAuditLogs.adminId], references: [superAdmins.id] }),
}));

export const insertSuperAdminAuditLogSchema = createInsertSchema(superAdminAuditLogs).omit({ id: true, createdAt: true });
export type InsertSuperAdminAuditLog = z.infer<typeof insertSuperAdminAuditLogSchema>;
export type SuperAdminAuditLog = typeof superAdminAuditLogs.$inferSelect;

// ── Persistent Email Queue ──────────────────────────────────────────────────
export const pendingEmails = pgTable("pending_emails", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  to: text("to").notNull(),
  subject: text("subject").notNull(),
  html: text("html").notNull(),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at").notNull().defaultNow(),
  status: text("status").notNull().default("pending"), // 'pending' | 'sent' | 'failed'
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type PendingEmail = typeof pendingEmails.$inferSelect;
export type InsertPendingEmail = typeof pendingEmails.$inferInsert;

// ── Application Audit Logs ──────────────────────────────────────────────────
export const auditLogs = pgTable("audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  action: text("action").notNull(),
  resource: text("resource").notNull(),
  resourceId: text("resource_id"),
  userId: text("user_id"),
  ip: text("ip"),
  status: text("status").notNull(), // 'success' | 'failure'
  errorMessage: text("error_message"),
  details: jsonb("details"),
});

export type AuditLog = typeof auditLogs.$inferSelect;


// ── Payroll Deductions ──────────────────────────────────────────────────────
// Per-staff deductions applied against gross pay before disbursement
export const payrollDeductions = pgTable("payroll_deductions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  periodId: varchar("period_id").notNull().references(() => payrollPeriods.id),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  staffId: varchar("staff_id").notNull().references(() => staff.id),
  type: text("type").notNull(), // 'tax', 'advance_recovery', 'penalty', 'insurance', 'other'
  label: text("label").notNull(), // Human-readable description shown on payslip
  amount: numeric("amount", { precision: 12, scale: 2 }).$type<number>().notNull(),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const payrollDeductionsRelations = relations(payrollDeductions, ({ one }) => ({
  period: one(payrollPeriods, { fields: [payrollDeductions.periodId], references: [payrollPeriods.id] }),
  staff: one(staff, { fields: [payrollDeductions.staffId], references: [staff.id] }),
}));

export type PayrollDeduction = typeof payrollDeductions.$inferSelect;
export type InsertPayrollDeduction = typeof payrollDeductions.$inferInsert;

// ── Payroll Disbursements ───────────────────────────────────────────────────
// Tracks how each staff member was actually paid for a period
export const payrollDisbursements = pgTable("payroll_disbursements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  periodId: varchar("period_id").notNull().references(() => payrollPeriods.id),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  staffId: varchar("staff_id").notNull().references(() => staff.id),
  amountPaid: numeric("amount_paid", { precision: 12, scale: 2 }).$type<number>().notNull(),
  method: text("method").notNull().default("cash"), // 'cash', 'bank_transfer', 'mobile_money'
  reference: text("reference"), // Bank reference or transaction ID
  notes: text("notes"),
  paidByUserId: varchar("paid_by_user_id").references(() => users.id),
  paidAt: timestamp("paid_at").notNull().defaultNow(),
});

export const payrollDisbursementsRelations = relations(payrollDisbursements, ({ one }) => ({
  period: one(payrollPeriods, { fields: [payrollDisbursements.periodId], references: [payrollPeriods.id] }),
  staff: one(staff, { fields: [payrollDisbursements.staffId], references: [staff.id] }),
}));

export type PayrollDisbursement = typeof payrollDisbursements.$inferSelect;
export type InsertPayrollDisbursement = typeof payrollDisbursements.$inferInsert;

// ── Salary Advances ─────────────────────────────────────────────────────────
// Mid-period cash advances to staff, tracked for payroll deduction
export const salaryAdvances = pgTable("salary_advances", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  staffId: varchar("staff_id").notNull().references(() => staff.id),
  amount: numeric("amount", { precision: 12, scale: 2 }).$type<number>().notNull(),
  date: text("date").notNull(), // YYYY-MM-DD
  notes: text("notes"),
  recoveredPeriodId: varchar("recovered_period_id").references(() => payrollPeriods.id), // Set when deducted from payroll
  isRecovered: boolean("is_recovered").notNull().default(false),
  givenByUserId: varchar("given_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const salaryAdvancesRelations = relations(salaryAdvances, ({ one }) => ({
  store: one(stores, { fields: [salaryAdvances.storeId], references: [stores.id] }),
  staff: one(staff, { fields: [salaryAdvances.staffId], references: [staff.id] }),
  recoveredPeriod: one(payrollPeriods, { fields: [salaryAdvances.recoveredPeriodId], references: [payrollPeriods.id] }),
}));

export type SalaryAdvance = typeof salaryAdvances.$inferSelect;

// ── Sale Drafts ──────────────────────────────────────────────────────────────
// Saved (but not yet committed) POS cart sessions. Nothing in here touches
// inventory, revenue, or any financial record — it is purely a snapshot of
// the in-progress cart so staff can return to it later.
export const saleDrafts = pgTable("sale_drafts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
  name: text("name"), // optional label shown in the drafts list
  cartData: jsonb("cart_data").notNull().$type<Array<{
    inventoryId: string;
    name: string;
    type: string;
    quantity: number;
    customPrice: number;
    totalPrice: number;
    leadStaffId: string | null;
    assistingStaff1Id: string | null;
    assistingStaff2Id: string | null;
    commissionSplit: string;
    unit?: string | null;
    allowFractional?: boolean;
  }>>(),
  customerId: varchar("customer_id").references(() => customers.id),
  staffId: varchar("staff_id").references(() => staff.id),
  paymentMethod: text("payment_method").default("cash"),
  discountAmount: numeric("discount_amount", { precision: 12, scale: 2 }).$type<number>().default(0),
  discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }).$type<number>().default(0),
  discountReason: text("discount_reason"),
  discountApprovedBy: text("discount_approved_by"),
  redeemPoints: boolean("redeem_points").notNull().default(false),
  redeemStoreCredit: boolean("redeem_store_credit").notNull().default(false),
  creditUpfrontPaid: numeric("credit_upfront_paid", { precision: 12, scale: 2 }).$type<number>().default(0),
  creditDueDate: text("credit_due_date"),
  splitPayments: jsonb("split_payments").$type<Array<{ method: string; amount: number }>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type SaleDraft = typeof saleDrafts.$inferSelect;
export type InsertSalaryAdvance = typeof salaryAdvances.$inferInsert;
