import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, unique, index, numeric } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { organisations } from "./organisations";

// Owner-entered, effective-dated rate for one ordered currency pair (see migrations/0130_exchange_rates.sql).
// NGN->GHS and GHS->NGN are separate rows; nothing is derived from the other direction.
export const exchangeRates = pgTable("exchange_rates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessId: varchar("business_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  fromCurrency: varchar("from_currency", { length: 3 }).notNull(),
  toCurrency: varchar("to_currency", { length: 3 }).notNull(),
  // Units of `toCurrency` per one unit of `fromCurrency`.
  rate: numeric("rate", { precision: 20, scale: 8, mode: "number" }).notNull(),
  // YYYY-MM-DD, in the same text-date convention as payroll periods and attendance.
  effectiveFrom: varchar("effective_from", { length: 10 }).notNull(),
  source: text("source").notNull().default("manual"), // manual | feed_accepted
  note: text("note"),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  unique("exchange_rates_pair_date_unique").on(t.businessId, t.fromCurrency, t.toCurrency, t.effectiveFrom),
  index("idx_exchange_rates_lookup").on(t.businessId, t.fromCurrency, t.toCurrency, t.effectiveFrom),
]);

export type ExchangeRate = typeof exchangeRates.$inferSelect;
