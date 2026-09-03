import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, boolean, integer, timestamp, unique, index, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { organisations } from "./organisations";
import { subscriptionPayments } from "./organisations";

// Pay-per-feature entitlement model (requirements: see the plan this shipped
// from — "Pay-Per-Feature Entitlement Model"). This is a monetization catalog,
// layered on top of - and deliberately separate from - `plans.features`
// (an unstructured jsonb bullet list for the base-plan comparison cards) and
// `featureFlags` in super-admin.ts (a release kill-switch, not a purchase
// mechanism). See getOrgEntitlements in server/lib/entitlements.ts for how
// the two compose: a disabled flag overrides purchased access, never the
// reverse.

// One row per purchasable-or-free capability in the app.
//   tierType:
//     'free'              - always granted, no entitlement row needed
//     'paid_flat'         - a standalone paid add-on
//     'paid_metered_limit'- free up to freeLimit, then requires purchase
//                           (staff seats, customer capacity)
//     'bundle_parent'      - purchasable; grants every 'bundle_child' row
//                           whose parentFeatureId points at it
//     'bundle_child'       - never purchased on its own (priceMonthly/
//                           priceAnnual are null); granted only via its parent
export const featureCatalog = pgTable("feature_catalog", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  key: text("key").unique().notNull(), // stable code identifier, e.g. 'staff_seats_addon'
  name: text("name").notNull(),
  description: text("description"),
  category: text("category").notNull(), // 'vendor_mgmt' | 'staff_mgmt' | 'customer_mgmt' | 'financial_mgmt' | 'tax_compliance' | 'inventory_mgmt' | 'analytics' | 'business_settings'
  tierType: text("tier_type").notNull(), // see comment above
  priceMonthly: numeric("price_monthly", { precision: 12, scale: 2 }).$type<number>(),
  priceAnnual: numeric("price_annual", { precision: 12, scale: 2 }).$type<number>(),
  currency: text("currency").notNull().default("NGN"),
  parentFeatureId: varchar("parent_feature_id").references((): any => featureCatalog.id), // set only for tierType='bundle_child'
  freeLimit: integer("free_limit"), // only for tierType='paid_metered_limit': 1 (staff), 50 (customers)
  limitType: text("limit_type"), // symbolic key checkAndReserveCountLimit switches on: 'staff_seats' | 'customer_count'
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const featureCatalogRelations = relations(featureCatalog, ({ one, many }) => ({
  parentFeature: one(featureCatalog, {
    fields: [featureCatalog.parentFeatureId],
    references: [featureCatalog.id],
    relationName: "bundleChildren",
  }),
  bundleChildren: many(featureCatalog, { relationName: "bundleChildren" }),
}));

export const insertFeatureCatalogSchema = createInsertSchema(featureCatalog)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    key: z.string().trim().min(1, "Feature key is required").regex(/^[a-z][a-z0-9_]*$/, "Use lowercase snake_case, e.g. 'staff_seats_addon'."),
    name: z.string().trim().min(1, "Feature name is required"),
    category: z.enum(["vendor_mgmt", "staff_mgmt", "customer_mgmt", "financial_mgmt", "tax_compliance", "inventory_mgmt", "analytics", "business_settings"]),
    tierType: z.enum(["free", "paid_flat", "paid_metered_limit", "bundle_parent", "bundle_child"]),
    priceMonthly: z.number().nonnegative().nullable().optional(),
    priceAnnual: z.number().nonnegative().nullable().optional(),
  });
export type InsertFeatureCatalog = z.infer<typeof insertFeatureCatalogSchema>;
export type FeatureCatalog = typeof featureCatalog.$inferSelect;

// Prerequisite edges, enforced at purchase time (server/routes/billing.routes.ts)
// - never re-checked per request, since purchase-time enforcement keeps the
// graph consistent by construction. E.g. self_check_in -> attendance_management.
export const featureDependencies = pgTable("feature_dependencies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  featureId: varchar("feature_id").notNull().references(() => featureCatalog.id),
  dependsOnFeatureId: varchar("depends_on_feature_id").notNull().references(() => featureCatalog.id),
}, (table) => [
  unique("uq_feature_dependencies").on(table.featureId, table.dependsOnFeatureId),
]);

export const featureDependenciesRelations = relations(featureDependencies, ({ one }) => ({
  feature: one(featureCatalog, { fields: [featureDependencies.featureId], references: [featureCatalog.id] }),
  dependsOn: one(featureCatalog, { fields: [featureDependencies.dependsOnFeatureId], references: [featureCatalog.id] }),
}));

export type FeatureDependency = typeof featureDependencies.$inferSelect;

// One row per org per *purchased* feature (standalone or bundle_parent only -
// bundle children are never entitled directly, see getOrgEntitlements). At
// most one 'active' row per (organisationId, featureId) - enforced by a
// partial unique index in migrations/0048_feature_catalog_and_entitlements.sql,
// not expressible in drizzle's table builder.
export const orgFeatureEntitlements = pgTable("org_feature_entitlements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organisationId: varchar("organisation_id").notNull().references(() => organisations.id),
  featureId: varchar("feature_id").notNull().references(() => featureCatalog.id),
  status: text("status").notNull().default("active"), // 'active' | 'pending_removal' | 'removed'
  source: text("source").notNull(), // 'purchased' | 'grandfathered' | 'grandfathered_sunset' | 'admin_grant'
  effectiveFrom: timestamp("effective_from").notNull().defaultNow(),
  removalEffectiveAt: timestamp("removal_effective_at"), // set for 'pending_removal': owner-cancel -> currentPeriodEnd, sunset -> paywallEffectiveAt
  subscriptionPaymentId: varchar("subscription_payment_id").references(() => subscriptionPayments.id), // audit trail back to the charge that paid for this, null for grandfathered/admin_grant
  grantedByAdminId: varchar("granted_by_admin_id"), // set only for source='admin_grant' - which super admin comped this
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("idx_org_feature_entitlements_org").on(table.organisationId),
  index("idx_org_feature_entitlements_feature").on(table.featureId),
]);

export const orgFeatureEntitlementsRelations = relations(orgFeatureEntitlements, ({ one }) => ({
  organisation: one(organisations, { fields: [orgFeatureEntitlements.organisationId], references: [organisations.id] }),
  feature: one(featureCatalog, { fields: [orgFeatureEntitlements.featureId], references: [featureCatalog.id] }),
  subscriptionPayment: one(subscriptionPayments, { fields: [orgFeatureEntitlements.subscriptionPaymentId], references: [subscriptionPayments.id] }),
}));

export type OrgFeatureEntitlement = typeof orgFeatureEntitlements.$inferSelect;
export type InsertOrgFeatureEntitlement = typeof orgFeatureEntitlements.$inferInsert;

// Dedupe log for the sunset-notice campaign (server/services/FeatureSunsetReminderService.ts)
// when a currently-free feature is being paywalled - directly mirrors
// trialReminderLogs in organisations.ts, one row per (org, feature, stage) sent.
export const featureSunsetReminderLogs = pgTable("feature_sunset_reminder_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organisationId: varchar("organisation_id").notNull().references(() => organisations.id),
  featureId: varchar("feature_id").notNull().references(() => featureCatalog.id),
  stage: text("stage").notNull(), // '30_days' | '7_days' | '1_day' | 'today'
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  unique("uq_feature_sunset_reminder_logs").on(table.organisationId, table.featureId, table.stage),
]);

export type InsertFeatureSunsetReminderLog = typeof featureSunsetReminderLogs.$inferInsert;
export type FeatureSunsetReminderLog = typeof featureSunsetReminderLogs.$inferSelect;
