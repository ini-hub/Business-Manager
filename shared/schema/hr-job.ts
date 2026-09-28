import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, index, date } from "drizzle-orm/pg-core";
import { z } from "zod";
import { staff } from "./staff";
import { users } from "./auth";

// See migrations/0066_hr_job_history.sql for the full rationale. Both
// tables are insert-only - "current" is whichever row has the max
// effectiveDate for a given staff member. No update/delete path is exposed;
// a correction is a new row with a later effectiveDate.
export const hrJobInfoHistory = pgTable("hr_job_info_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  staffId: varchar("staff_id").notNull().references(() => staff.id),
  effectiveDate: date("effective_date").notNull(),
  location: text("location"),
  division: text("division"),
  department: text("department"),
  jobTitle: text("job_title"),
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("idx_hr_job_info_history_staff").on(table.staffId, table.effectiveDate),
]);

export const hrAdditionalJobInfoHistory = pgTable("hr_additional_job_info_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  staffId: varchar("staff_id").notNull().references(() => staff.id),
  effectiveDate: date("effective_date").notNull(),
  employeeBoxId: text("employee_box_id"),
  legalEntity: text("legal_entity"),
  beneficiaryEntity: text("beneficiary_entity"),
  team: text("team"),
  subteam: text("subteam"),
  jobFamily: text("job_family"),
  level: text("level"),
  comment: text("comment"),
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("idx_hr_additional_job_info_history_staff").on(table.staffId, table.effectiveDate),
]);

export const hrJobInfoHistoryRelations = relations(hrJobInfoHistory, ({ one }) => ({
  staff: one(staff, { fields: [hrJobInfoHistory.staffId], references: [staff.id] }),
}));
export const hrAdditionalJobInfoHistoryRelations = relations(hrAdditionalJobInfoHistory, ({ one }) => ({
  staff: one(staff, { fields: [hrAdditionalJobInfoHistory.staffId], references: [staff.id] }),
}));

export type HrJobInfoHistory = typeof hrJobInfoHistory.$inferSelect;
export type InsertHrJobInfoHistory = typeof hrJobInfoHistory.$inferInsert;
export type HrAdditionalJobInfoHistory = typeof hrAdditionalJobInfoHistory.$inferSelect;
export type InsertHrAdditionalJobInfoHistory = typeof hrAdditionalJobInfoHistory.$inferInsert;

export const createHrJobInfoSchema = z.object({
  effectiveDate: z.string().min(1),
  location: z.string().trim().optional(),
  division: z.string().trim().optional(),
  department: z.string().trim().optional(),
  jobTitle: z.string().trim().optional(),
});
export type CreateHrJobInfoInput = z.infer<typeof createHrJobInfoSchema>;

export const createHrAdditionalJobInfoSchema = z.object({
  effectiveDate: z.string().min(1),
  employeeBoxId: z.string().trim().optional(),
  legalEntity: z.string().trim().optional(),
  beneficiaryEntity: z.string().trim().optional(),
  team: z.string().trim().optional(),
  subteam: z.string().trim().optional(),
  jobFamily: z.string().trim().optional(),
  level: z.string().trim().optional(),
  comment: z.string().trim().optional(),
});
export type CreateHrAdditionalJobInfoInput = z.infer<typeof createHrAdditionalJobInfoSchema>;
