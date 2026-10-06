import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, unique, index, numeric, date } from "drizzle-orm/pg-core";
import { z } from "zod";
import { staff } from "./staff";
import { users } from "./auth";

// See migrations/0067_hr_time_off.sql for the full rationale.
export const hrLeaveTypeEnum = ["annual", "sick", "bereavement", "maternity"] as const;
export type HrLeaveType = typeof hrLeaveTypeEnum[number];

export const hrTimeOffRequestStatusEnum = ["pending", "approved", "rejected", "cancelled"] as const;
export type HrTimeOffRequestStatus = typeof hrTimeOffRequestStatusEnum[number];

// Current balance per staff+leaveType. Always re-derivable from
// hr_time_off_history (a ledger) - every write to this table happens in the
// same transaction as the matching history row, in HrTimeOffService.
export const hrTimeOffBalances = pgTable("hr_time_off_balances", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  staffId: varchar("staff_id").notNull().references(() => staff.id),
  leaveType: text("leave_type").notNull(), // hrLeaveTypeEnum
  available: numeric("available", { precision: 8, scale: 2, mode: "number" }).notNull().default(0),
  used: numeric("used", { precision: 8, scale: 2, mode: "number" }).notNull().default(0),
  earned: numeric("earned", { precision: 8, scale: 2, mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  unique("hr_time_off_balances_staff_leave_type_unique").on(table.staffId, table.leaveType),
]);

export const hrTimeOffRequests = pgTable("hr_time_off_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  staffId: varchar("staff_id").notNull().references(() => staff.id),
  leaveType: text("leave_type").notNull(), // hrLeaveTypeEnum
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  daysRequested: numeric("days_requested", { precision: 8, scale: 2, mode: "number" }).notNull(),
  reason: text("reason"),
  status: text("status").notNull().default("pending"), // hrTimeOffRequestStatusEnum
  reviewedByUserId: varchar("reviewed_by_user_id").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("idx_hr_time_off_requests_staff").on(table.staffId, table.status),
]);

// The ledger. One row per approval or manual balance adjustment.
export const hrTimeOffHistory = pgTable("hr_time_off_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  staffId: varchar("staff_id").notNull().references(() => staff.id),
  requestId: varchar("request_id").references(() => hrTimeOffRequests.id), // nullable: manual adjustments have no request
  leaveType: text("leave_type").notNull(), // hrLeaveTypeEnum
  date: date("date").notNull(),
  description: text("description").notNull(),
  usedDays: numeric("used_days", { precision: 8, scale: 2, mode: "number" }).notNull().default(0),
  earnedDays: numeric("earned_days", { precision: 8, scale: 2, mode: "number" }).notNull().default(0),
  balanceAfter: numeric("balance_after", { precision: 8, scale: 2, mode: "number" }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("idx_hr_time_off_history_staff_type").on(table.staffId, table.leaveType, table.date),
]);

export const hrTimeOffBalancesRelations = relations(hrTimeOffBalances, ({ one }) => ({
  staff: one(staff, { fields: [hrTimeOffBalances.staffId], references: [staff.id] }),
}));
export const hrTimeOffRequestsRelations = relations(hrTimeOffRequests, ({ one }) => ({
  staff: one(staff, { fields: [hrTimeOffRequests.staffId], references: [staff.id] }),
}));
export const hrTimeOffHistoryRelations = relations(hrTimeOffHistory, ({ one }) => ({
  staff: one(staff, { fields: [hrTimeOffHistory.staffId], references: [staff.id] }),
  request: one(hrTimeOffRequests, { fields: [hrTimeOffHistory.requestId], references: [hrTimeOffRequests.id] }),
}));

export type HrTimeOffBalance = typeof hrTimeOffBalances.$inferSelect;
export type HrTimeOffRequest = typeof hrTimeOffRequests.$inferSelect;
export type InsertHrTimeOffRequest = typeof hrTimeOffRequests.$inferInsert;
export type HrTimeOffHistoryEntry = typeof hrTimeOffHistory.$inferSelect;

export const createHrTimeOffRequestSchema = z.object({
  leaveType: z.enum(hrLeaveTypeEnum),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  daysRequested: z.number().positive(),
  reason: z.string().trim().max(1000).optional(),
});
export type CreateHrTimeOffRequestInput = z.infer<typeof createHrTimeOffRequestSchema>;

export const reviewHrTimeOffRequestSchema = z.object({
  note: z.string().trim().max(1000).optional(),
});
export type ReviewHrTimeOffRequestInput = z.infer<typeof reviewHrTimeOffRequestSchema>;
