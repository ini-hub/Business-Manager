import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, index, uniqueIndex, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { stores } from "./stores";
import { users } from "./auth";
import { checkouts } from "./sales";

// Accounts a store receives non-cash money into (bank accounts, POS terminals, mobile money wallets).
export const PAYMENT_ACCOUNT_KINDS = ["bank", "pos", "mobile_money"] as const;
export type PaymentAccountKind = typeof PAYMENT_ACCOUNT_KINDS[number];

export const storePaymentAccounts = pgTable("store_payment_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  label: text("label").notNull(),
  kind: text("kind").$type<PaymentAccountKind>().notNull().default("bank"),
  bankName: text("bank_name"),
  bankCode: text("bank_code"),
  accountNumber: text("account_number"),
  accountName: text("account_name"),
  // Set when accountName was returned by the bank's own lookup rather than typed in.
  accountVerifiedAt: timestamp("account_verified_at"),
  isDefault: boolean("is_default").notNull().default(false),
  // Deactivated, never deleted: past sales point at the row.
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("idx_store_payment_accounts_store").on(table.storeId),
  uniqueIndex("store_payment_accounts_one_default").on(table.storeId).where(sql`is_default AND is_active`),
]);

export const insertStorePaymentAccountSchema = createInsertSchema(storePaymentAccounts).omit({ id: true, createdAt: true });
export type StorePaymentAccount = typeof storePaymentAccounts.$inferSelect;
export type InsertStorePaymentAccount = typeof storePaymentAccounts.$inferInsert;

export const LEG_CONFIRMATION_STATUSES = ["not_required", "pending", "confirmed"] as const;
export type LegConfirmationStatus = typeof LEG_CONFIRMATION_STATUSES[number];

// One row per payment leg of a receipt. `checkouts` is one row per cart line with the legs
// copied onto each, so anything that aggregates money by method/account reads this instead.
export const salePaymentLegs = pgTable("sale_payment_legs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  receiptNumber: text("receipt_number").notNull(),
  checkoutId: varchar("checkout_id").references(() => checkouts.id), // first line of the receipt
  method: text("method").notNull(), // cash, transfer, flutterwave, credit, store_credit
  amount: numeric("amount", { precision: 12, scale: 2, mode: "number" }).notNull(),
  paymentAccountId: varchar("payment_account_id").references(() => storePaymentAccounts.id),
  // Snapshot so editing or deactivating the account never rewrites history.
  accountLabel: text("account_label"),
  accountDetail: text("account_detail"),
  confirmationStatus: text("confirmation_status").$type<LegConfirmationStatus>().notNull().default("not_required"),
  confirmationSource: text("confirmation_source").$type<"manual" | "gateway" | "bank_feed">(),
  confirmedAt: timestamp("confirmed_at"),
  confirmedByUserId: varchar("confirmed_by_user_id").references(() => users.id),
  reference: text("reference"),
  senderName: text("sender_name"),
  cashTendered: numeric("cash_tendered", { precision: 12, scale: 2, mode: "number" }),
  changeGiven: numeric("change_given", { precision: 12, scale: 2, mode: "number" }),
  changeOwed: numeric("change_owed", { precision: 12, scale: 2, mode: "number" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("idx_sale_payment_legs_receipt").on(table.storeId, table.receiptNumber),
  index("idx_sale_payment_legs_account").on(table.storeId, table.paymentAccountId, table.createdAt),
]);

export type SalePaymentLeg = typeof salePaymentLegs.$inferSelect;
export type InsertSalePaymentLeg = typeof salePaymentLegs.$inferInsert;
