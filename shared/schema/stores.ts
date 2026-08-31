import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, boolean, integer, timestamp, unique, numeric, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { trimmedString, optionalTrimmedString } from "./_helpers";
import { businesses } from "./organisations";
import { customers } from "./customers";
import { staff } from "./staff";
import { inventory, products } from "./catalog";

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
  timezone: text("timezone").notNull().default("Africa/Lagos"), // IANA timezone identifier
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
  timezone: z.string().default("Africa/Lagos"),
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

// Settings table (per-store configuration)
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
  // Loyalty Points program
  loyaltyPointsPerCurrency: integer("loyalty_points_per_currency").notNull().default(100), // 1 point earned per this much spent
  loyaltyPointValue: numeric("loyalty_point_value", { precision: 12, scale: 2 }).$type<number>().notNull().default(10), // value of 1 point on redemption, in the store's currency
  // ── Attendance & Clock-In ──────────────────────────────────────────────────
  // NOTE: every column below must also appear in the sanitizeSettings allowlist
  // in server/routes/settings.routes.ts, or PUT /api/settings drops it silently
  // and returns 200.
  clockInEnabled: boolean("clock_in_enabled").notNull().default(false),
  geofenceLatitude: numeric("geofence_latitude", { precision: 9, scale: 6 }).$type<number>(),
  geofenceLongitude: numeric("geofence_longitude", { precision: 9, scale: 6 }).$type<number>(),
  geofencePlaceLabel: text("geofence_place_label"),
  geofenceRadiusMeters: integer("geofence_radius_meters").notNull().default(50),
  // A fix reporting 80 m of error cannot prove a 50 m fence either way. Readings
  // worse than this are rejected as unusable rather than treated as "outside".
  geofenceMaxAccuracyMeters: integer("geofence_max_accuracy_meters").notNull().default(100),
  openingTime: text("opening_time").notNull().default("09:00"), // HH:MM, store-local
  lateGraceMinutes: integer("late_grace_minutes").notNull().default(0),
  // Flat amount per late day, deliberately uncapped — it may exceed a day's
  // transport. Where it exceeds the period's pay the existing mark-paid clamp
  // carries the excess forward.
  lateDeductionAmount: numeric("late_deduction_amount", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  lateDeductionEnabled: boolean("late_deduction_enabled").notNull().default(false),
  requirePunchPin: boolean("require_punch_pin").notNull().default(false),
  maxOfflinePunchAgeMinutes: integer("max_offline_punch_age_minutes").notNull().default(720),
  retroRequestMaxAgeDays: integer("retro_request_max_age_days").notNull().default(7),
  // 0 = Sunday. Defaults to [0], reproducing the rule PayrollService hardcoded.
  defaultWeeklyOffDays: jsonb("default_weekly_off_days").$type<number[]>().notNull().default(sql`'[0]'::jsonb`),
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
  loyaltyPointValue: z.number().optional(),
  geofenceLatitude: z.number().min(-90).max(90).nullable().optional(),
  geofenceLongitude: z.number().min(-180).max(180).nullable().optional(),
  geofenceRadiusMeters: z.number().int().min(10).max(5000).optional(),
  geofenceMaxAccuracyMeters: z.number().int().min(10).max(1000).optional(),
  openingTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Opening time must be HH:MM").optional(),
  lateGraceMinutes: z.number().int().min(0).max(720).optional(),
  lateDeductionAmount: z.number().min(0).optional(),
  maxOfflinePunchAgeMinutes: z.number().int().min(0).max(10080).optional(),
  retroRequestMaxAgeDays: z.number().int().min(0).max(90).optional(),
  defaultWeeklyOffDays: z.array(z.number().int().min(0).max(6)).optional(),
});
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Settings = typeof settings.$inferSelect;
