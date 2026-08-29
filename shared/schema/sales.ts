import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, boolean, integer, timestamp, unique, index, jsonb, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { stores } from "./stores";
import { inventory, type Inventory } from "./catalog";
import { staff, type Staff } from "./staff";
import { bookings } from "./bookings";
import { users, type User } from "./auth";
import { customers, type Customer } from "./customers";
import type { Store } from "./stores";
import type { Business } from "./organisations";

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
  isAddendum: boolean("is_addendum").notNull().default(false),
  addendumReason: text("addendum_reason"),
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
}, (t) => [
  index("idx_transactions_store_date").on(t.storeId, t.transactionDate),
  index("idx_transactions_checkout").on(t.checkoutId),
  index("idx_transactions_customer").on(t.customerId),
  index("idx_transactions_inventory").on(t.inventoryId),
]);

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
    // Union of every distinct staff id (lead + assisting) across all line items
    // of a merged multi-service receipt. See groupTransactions() in
    // server/routes/transaction.routes.ts.
    serviceStaffIds?: string[];
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
