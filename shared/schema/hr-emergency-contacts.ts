import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, index } from "drizzle-orm/pg-core";
import { z } from "zod";
import { staff } from "./staff";

// See migrations/0068_hr_emergency_contacts.sql. Fixed field set per the
// product spec - plain multi-row CRUD, no dynamic field builder needed.
export const hrEmergencyContacts = pgTable("hr_emergency_contacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  staffId: varchar("staff_id").notNull().references(() => staff.id),
  name: text("name").notNull(),
  relationship: text("relationship"),
  workPhone: text("work_phone"),
  workPhoneExt: text("work_phone_ext"),
  homePhone: text("home_phone"),
  mobile: text("mobile"),
  email: text("email"),
  addressStreet1: text("address_street1"),
  addressStreet2: text("address_street2"),
  addressCity: text("address_city"),
  addressState: text("address_state"),
  addressPostcode: text("address_postcode"),
  addressCountry: text("address_country"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("idx_hr_emergency_contacts_staff").on(table.staffId),
]);

export const hrEmergencyContactsRelations = relations(hrEmergencyContacts, ({ one }) => ({
  staff: one(staff, { fields: [hrEmergencyContacts.staffId], references: [staff.id] }),
}));

export type HrEmergencyContact = typeof hrEmergencyContacts.$inferSelect;
export type InsertHrEmergencyContact = typeof hrEmergencyContacts.$inferInsert;

export const upsertHrEmergencyContactSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  relationship: z.string().trim().optional(),
  workPhone: z.string().trim().optional(),
  workPhoneExt: z.string().trim().optional(),
  homePhone: z.string().trim().optional(),
  mobile: z.string().trim().optional(),
  email: z.string().trim().email().optional().or(z.literal("")),
  addressStreet1: z.string().trim().optional(),
  addressStreet2: z.string().trim().optional(),
  addressCity: z.string().trim().optional(),
  addressState: z.string().trim().optional(),
  addressPostcode: z.string().trim().optional(),
  addressCountry: z.string().trim().optional(),
});
export type UpsertHrEmergencyContactInput = z.infer<typeof upsertHrEmergencyContactSchema>;
