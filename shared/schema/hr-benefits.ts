import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, numeric, date, index } from "drizzle-orm/pg-core";
import { z } from "zod";
import { staff } from "./staff";

// See migrations/0070_hr_benefits.sql.
export const hrDependants = pgTable("hr_dependants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  staffId: varchar("staff_id").notNull().references(() => staff.id),
  name: text("name").notNull(),
  relationship: text("relationship"),
  gender: text("gender"),
  ssn: text("ssn"),
  birthDate: date("birth_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("idx_hr_dependants_staff").on(table.staffId),
]);

// The "percentages across all rows for a staff member sum to 100" invariant
// is enforced in EstateBeneficiaryService inside a transaction with row
// locking, not a DB CHECK constraint - Postgres can't express a cross-row
// constraint declaratively without a trigger, and a trigger just duplicates
// the same logic in SQL with worse testability. Every mutating endpoint
// goes through that one service method.
export const hrEstateBeneficiaries = pgTable("hr_estate_beneficiaries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  staffId: varchar("staff_id").notNull().references(() => staff.id),
  name: text("name").notNull(),
  relationship: text("relationship"),
  address: text("address"),
  phone: text("phone"),
  percentage: numeric("percentage", { precision: 5, scale: 2 }).$type<number>().notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("idx_hr_estate_beneficiaries_staff").on(table.staffId),
]);

export const hrDependantsRelations = relations(hrDependants, ({ one }) => ({
  staff: one(staff, { fields: [hrDependants.staffId], references: [staff.id] }),
}));
export const hrEstateBeneficiariesRelations = relations(hrEstateBeneficiaries, ({ one }) => ({
  staff: one(staff, { fields: [hrEstateBeneficiaries.staffId], references: [staff.id] }),
}));

export type HrDependant = typeof hrDependants.$inferSelect;
export type HrEstateBeneficiary = typeof hrEstateBeneficiaries.$inferSelect;

export const upsertHrDependantSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  relationship: z.string().trim().optional(),
  gender: z.string().trim().optional(),
  ssn: z.string().trim().optional(),
  birthDate: z.string().optional(),
});
export type UpsertHrDependantInput = z.infer<typeof upsertHrDependantSchema>;

export const upsertHrEstateBeneficiarySchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  relationship: z.string().trim().optional(),
  address: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  percentage: z.number().min(0.01).max(100),
});
export type UpsertHrEstateBeneficiaryInput = z.infer<typeof upsertHrEstateBeneficiarySchema>;
