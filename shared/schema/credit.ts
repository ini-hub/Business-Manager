import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, index, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { stores } from "./stores";
import { customers } from "./customers";
import { checkouts } from "./sales";
import { staff } from "./staff";

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
}, (table) => [
  index("idx_credit_entries_store").on(table.storeId),
]);

// How a repayment reached the business. `payroll_deduction` is NOT cash: the
// debt was settled by withholding it from the debtor's salary, so cash-flow
// reporting (which filters on "cash") must continue to exclude it.
export const repaymentMethodEnum = ["cash", "transfer", "pos", "payroll_deduction"] as const;
export type RepaymentMethod = typeof repaymentMethodEnum[number];

export const repayments = pgTable("repayments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  creditEntryId: varchar("credit_entry_id").notNull().references(() => creditEntries.id),
  amountReceived: numeric("amount_received", { precision: 12, scale: 2 }).$type<number>().notNull(),
  paymentMethod: text("payment_method").notNull().default("cash"), // see repaymentMethodEnum
  notes: text("notes"),
  recordedByStaffId: varchar("recorded_by_staff_id").references(() => staff.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_repayments_credit_entry").on(table.creditEntryId),
]);

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
