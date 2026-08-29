import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, boolean, integer, timestamp, unique, index, jsonb, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { trimmedString, optionalTrimmedString } from "./_helpers";
import { stores } from "./stores";
import { organisationMembers, users } from "./auth";

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
  status: text("status").notNull().default("active"), // 'active', 'trialing', 'inactive', 'suspended'
  suspensionReason: text("suspension_reason"), // 'policy_violation', 'non_payment', 'fraudulent_activity', 'owner_request', 'inactivity', 'other'
  suspensionNote: text("suspension_note"),
  suspendedAt: timestamp("suspended_at"),
  deletedAt: timestamp("deleted_at"), // Soft-delete 30-day grace period
  deletionReason: text("deletion_reason"),
  trialEndsAt: timestamp("trial_ends_at"), // null for orgs created before trials existed (grandfathered, never gated)
  activatedAt: timestamp("activated_at"), // set once, on the org's first-ever completed sale
  defaultWalkInCustomerId: varchar("default_walk_in_customer_id"), // cached id of the auto-provisioned trial walk-in customer
  defaultTrialStaffId: varchar("default_trial_staff_id"), // cached id of the auto-provisioned trial default staff record
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

// Subscription plans offered to organisations (platform billing, not tenant-facing payments)
export const plans = pgTable("plans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  priceMonthly: numeric("price_monthly", { precision: 12, scale: 2 }).$type<number>().notNull(),
  priceAnnual: numeric("price_annual", { precision: 12, scale: 2 }).$type<number>().notNull(),
  currency: text("currency").notNull().default("NGN"),
  features: jsonb("features").notNull().default(sql`'[]'::jsonb`),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Plan = typeof plans.$inferSelect;
export type InsertPlan = typeof plans.$inferInsert;

// One subscription per organisation: the source of truth for billing state.
// organisations.status is kept in sync with this for fast gate checks elsewhere.
export const subscriptions = pgTable("subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organisationId: varchar("organisation_id").notNull().references(() => organisations.id).unique(),
  planId: varchar("plan_id").notNull().references(() => plans.id),
  status: text("status").notNull().default("trialing"), // 'trialing', 'active', 'past_due', 'cancelled'
  billingCycle: text("billing_cycle").notNull().default("monthly"), // 'monthly', 'annual'
  currentPeriodStart: timestamp("current_period_start").notNull().defaultNow(),
  currentPeriodEnd: timestamp("current_period_end").notNull(),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  provider: text("provider"), // 'stripe', 'paystack', 'flutterwave' - null until first real charge
  providerCustomerId: text("provider_customer_id"),
  providerSubscriptionId: text("provider_subscription_id"),
  // Paystack's reusable authorization_code from the first successful charge, used to
  // auto-charge renewals via /transaction/charge_authorization without the owner
  // re-entering their card. Null until the first successful payment.
  providerAuthorizationCode: text("provider_authorization_code"),
  // Claim timestamp for the lazy renewal check in server/lib/billing.ts - set right
  // before attempting a renewal charge so concurrent requests can't double-charge.
  renewalAttemptedAt: timestamp("renewal_attempted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("idx_subscriptions_status").on(table.status),
]);

export type Subscription = typeof subscriptions.$inferSelect;
export type InsertSubscription = typeof subscriptions.$inferInsert;

// One row per payment attempt against a subscription (initial checkout or automatic
// renewal charge) - the audit ledger super admins review. `subscriptions` only ever
// holds current state, so this is the only place payment history actually lives.
export const subscriptionPayments = pgTable("subscription_payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organisationId: varchar("organisation_id").notNull().references(() => organisations.id),
  planId: varchar("plan_id").notNull().references(() => plans.id),
  subscriptionId: varchar("subscription_id").references(() => subscriptions.id),
  provider: text("provider").notNull(), // 'paystack' for now; 'stripe'/'flutterwave' once wired
  kind: text("kind").notNull().default("initial"), // 'initial', 'renewal'
  reference: text("reference").notNull().unique(),
  amount: numeric("amount", { precision: 12, scale: 2 }).$type<number>().notNull(),
  currency: text("currency").notNull(),
  billingCycle: text("billing_cycle").notNull(),
  status: text("status").notNull().default("pending"), // 'pending', 'success', 'failed'
  providerResponse: jsonb("provider_response"),
  initiatedByUserId: varchar("initiated_by_user_id").references(() => users.id), // null for system-initiated renewal charges
  createdAt: timestamp("created_at").notNull().defaultNow(),
  verifiedAt: timestamp("verified_at"),
}, (table) => [
  index("idx_subscription_payments_org").on(table.organisationId),
  index("idx_subscription_payments_status").on(table.status),
]);

export const subscriptionPaymentsRelations = relations(subscriptionPayments, ({ one }) => ({
  organisation: one(organisations, { fields: [subscriptionPayments.organisationId], references: [organisations.id] }),
  plan: one(plans, { fields: [subscriptionPayments.planId], references: [plans.id] }),
  subscription: one(subscriptions, { fields: [subscriptionPayments.subscriptionId], references: [subscriptions.id] }),
}));

export type SubscriptionPayment = typeof subscriptionPayments.$inferSelect;
export type InsertSubscriptionPayment = typeof subscriptionPayments.$inferInsert;

// Lightweight funnel instrumentation: signup -> onboarding -> checkout events, per organisation.
// Purely additive/write-only from the app's perspective - nothing reads these yet except future analytics.
export const funnelEvents = pgTable("funnel_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organisationId: varchar("organisation_id").notNull().references(() => organisations.id),
  eventName: text("event_name").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("idx_funnel_events_org_event").on(table.organisationId, table.eventName),
]);

export type FunnelEvent = typeof funnelEvents.$inferSelect;
export type InsertFunnelEvent = typeof funnelEvents.$inferInsert;

// Dedupe log for TrialReminderService - one row per (organisation, stage) sent.
export const trialReminderLogs = pgTable("trial_reminder_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organisationId: varchar("organisation_id").notNull().references(() => organisations.id),
  stage: text("stage").notNull(), // '3_days' | '2_days' | 'today'
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  unique("uq_trial_reminder_logs_org_stage").on(table.organisationId, table.stage),
]);

export type InsertTrialReminderLog = typeof trialReminderLogs.$inferInsert;
export type TrialReminderLog = typeof trialReminderLogs.$inferSelect;
