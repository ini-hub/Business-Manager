import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, unique, index, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { trimmedString } from "./_helpers";
import { stores } from "./stores";
import { users } from "./auth";
import { checkouts } from "./sales";

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
