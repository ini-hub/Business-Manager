import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, boolean, integer, timestamp, unique, index, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { trimmedString } from "./_helpers";
import { stores } from "./stores";
import { staff } from "./staff";
import { transactions } from "./sales";

// Customers table
export const customers = pgTable("customers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  name: text("name").notNull(),
  customerNumber: text("customer_number").notNull(),
  mobileNumber: text("mobile_number"), // Optional
  countryCode: text("country_code").default("+234"), // Default to Nigeria
  address: text("address").notNull(),
  birthday: timestamp("birthday"),
  loyaltyPoints: integer("loyalty_points").notNull().default(0),
  storeCreditBalance: numeric("store_credit_balance", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  isArchived: boolean("is_archived").notNull().default(false),
  globalCustomerId: varchar("global_customer_id"), // Links local profiles sharing same phone
  isConfirmedDistinct: boolean("is_confirmed_distinct").notNull().default(false),
  duplicateOfId: varchar("duplicate_of_id"), // Links to other duplicate customer profile
  mergedIntoId: varchar("merged_into_id"), // Links to target profile if merged
  staffId: varchar("staff_id"), // Links to staff record if this customer is a staff member
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  unique("customer_store_number_unique").on(table.storeId, table.customerNumber),
  index("idx_customers_store").on(table.storeId),
]);

export const customersRelations = relations(customers, ({ one, many }) => ({
  store: one(stores, {
    fields: [customers.storeId],
    references: [stores.id],
  }),
  transactions: many(transactions),
  staffMember: one(staff, {
    fields: [customers.staffId],
    references: [staff.id],
  }),
}));

export const insertCustomerSchema = createInsertSchema(customers).omit({ id: true, isArchived: true, updatedAt: true }).extend({
  name: trimmedString(1, "Customer name is required"),
  customerNumber: z.string().optional().default(""),
  countryCode: z.string().default("NG"),
  mobileNumber: z.string().transform(s => s.trim()).refine(v => !v || v.replace(/\D/g, "").length >= 7, "Enter a valid phone number.").optional().default(""),
  address: z.string().transform(s => s.trim()).default(""),
  birthday: z.string().optional().nullable(),
  storeCreditBalance: z.number().optional(),
  staffId: z.string().optional().nullable(),
});
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type Customer = typeof customers.$inferSelect;
