import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, date, index } from "drizzle-orm/pg-core";
import { z } from "zod";
import { staff } from "./staff";
import { users } from "./auth";

// See migrations/0071_hr_disciplinary.sql.
export const hrDisciplinaryRecords = pgTable("hr_disciplinary_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  staffId: varchar("staff_id").notNull().references(() => staff.id),
  incidentDate: date("incident_date").notNull(),
  closedDate: date("closed_date"),
  complaintIssuedBy: text("complaint_issued_by"),
  description: text("description").notNull(),
  action: text("action"),
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("idx_hr_disciplinary_records_staff").on(table.staffId, table.incidentDate),
]);

export const hrDisciplinaryRecordsRelations = relations(hrDisciplinaryRecords, ({ one }) => ({
  staff: one(staff, { fields: [hrDisciplinaryRecords.staffId], references: [staff.id] }),
}));

export type HrDisciplinaryRecord = typeof hrDisciplinaryRecords.$inferSelect;

export const upsertHrDisciplinaryRecordSchema = z.object({
  incidentDate: z.string().min(1),
  closedDate: z.string().optional(),
  complaintIssuedBy: z.string().trim().optional(),
  description: z.string().trim().min(1, "Description is required"),
  action: z.string().trim().optional(),
});
export type UpsertHrDisciplinaryRecordInput = z.infer<typeof upsertHrDisciplinaryRecordSchema>;
