import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, numeric, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { trimmedString } from "./_helpers";
import { stores } from "./stores";
import { businesses } from "./organisations";
import { checkouts, orders } from "./sales";
import { staff } from "./staff";
import { users } from "./auth";
import { inventoryRestockEvents } from "./inventory-ops";
import { customers } from "./customers";

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
}, (table) => [
  index("idx_cash_register_sessions_store_status").on(table.storeId, table.status),
]);

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
