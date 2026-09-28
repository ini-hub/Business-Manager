import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, numeric, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { trimmedString, optionalTrimmedString } from "./_helpers";
import { stores } from "./stores";

// Owner capital contributions and withdrawals. Retained earnings is NOT stored
// here — it is derived on read as cumulative net profit since inception
// (AnalyticsService.getProfitLossSummary with no date range) minus cumulative
// withdrawals, so it always reflects a continuous running balance with no
// period-close step.
export const capitalContributions = pgTable("capital_contributions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  type: text("type").notNull(), // capital_injection | withdrawal
  amount: numeric("amount", { precision: 12, scale: 2 }).$type<number>().notNull(),
  description: text("description"),
  date: date("date").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const capitalContributionsRelations = relations(capitalContributions, ({ one }) => ({
  store: one(stores, {
    fields: [capitalContributions.storeId],
    references: [stores.id],
  }),
}));

export const insertCapitalContributionSchema = createInsertSchema(capitalContributions).omit({ id: true, createdAt: true }).extend({
  type: z.enum(["capital_injection", "withdrawal"]),
  amount: z.number().positive("Amount must be greater than 0"),
  description: optionalTrimmedString(),
});
export type InsertCapitalContribution = z.infer<typeof insertCapitalContributionSchema>;
export type CapitalContribution = typeof capitalContributions.$inferSelect;

// Manually tracked assets (cash on hand, equipment, other fixed/other assets).
// Not auto-adjusted by sales activity - see shared/schema/accounting.ts's
// module comment on capitalContributions for how retained earnings covers the
// profit-driven side of the balance sheet instead.
export const assets = pgTable("assets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  name: text("name").notNull(),
  category: text("category").notNull(), // cash | fixed | other
  value: numeric("value", { precision: 12, scale: 2 }).$type<number>().notNull(),
  acquiredDate: date("acquired_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const assetsRelations = relations(assets, ({ one }) => ({
  store: one(stores, {
    fields: [assets.storeId],
    references: [stores.id],
  }),
}));

export const insertAssetSchema = createInsertSchema(assets).omit({ id: true, createdAt: true, updatedAt: true }).extend({
  name: trimmedString(1, "Asset name is required"),
  category: z.enum(["cash", "fixed", "other"]),
  value: z.number().min(0, "Value cannot be negative"),
  acquiredDate: optionalTrimmedString(),
  notes: optionalTrimmedString(),
});
export type InsertAsset = z.infer<typeof insertAssetSchema>;
export type Asset = typeof assets.$inferSelect;

// Manually tracked liabilities (loans, payables, other obligations).
export const liabilities = pgTable("liabilities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  name: text("name").notNull(),
  category: text("category").notNull(), // loan | payable | other
  amount: numeric("amount", { precision: 12, scale: 2 }).$type<number>().notNull(),
  dueDate: date("due_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const liabilitiesRelations = relations(liabilities, ({ one }) => ({
  store: one(stores, {
    fields: [liabilities.storeId],
    references: [stores.id],
  }),
}));

export const insertLiabilitySchema = createInsertSchema(liabilities).omit({ id: true, createdAt: true, updatedAt: true }).extend({
  name: trimmedString(1, "Liability name is required"),
  category: z.enum(["loan", "payable", "other"]),
  amount: z.number().min(0, "Amount cannot be negative"),
  dueDate: optionalTrimmedString(),
  notes: optionalTrimmedString(),
});
export type InsertLiability = z.infer<typeof insertLiabilitySchema>;
export type Liability = typeof liabilities.$inferSelect;
