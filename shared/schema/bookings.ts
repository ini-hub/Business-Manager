import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, jsonb, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { stores } from "./stores";
import { customers } from "./customers";
import { staff } from "./staff";
import { inventory } from "./catalog";

export const bookingStatusEnum = ["pending", "confirmed", "in_progress", "completed", "cancelled", "no_show", "rescheduled"] as const;
export type BookingStatus = typeof bookingStatusEnum[number];

export const bookingTypeEnum = ["appointment", "order"] as const;
export type BookingType = typeof bookingTypeEnum[number];

export const reminderPreferenceEnum = ["whatsapp", "sms", "both", "none"] as const;
export type ReminderPreference = typeof reminderPreferenceEnum[number];

export const bookings = pgTable("bookings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  customerId: varchar("customer_id").notNull().references(() => customers.id),
  bookingRef: text("booking_ref").notNull().unique(),
  type: text("type").notNull(),
  status: text("status").notNull().default("pending"),
  scheduledAt: timestamp("scheduled_at").notNull(),
  expectedReadyAt: timestamp("expected_ready_at"),
  leadStaffId: varchar("lead_staff_id").references(() => staff.id),
  assistingStaffId: varchar("assisting_staff_id").references(() => staff.id),
  depositAmount: numeric("deposit_amount", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  depositPaymentMethod: text("deposit_payment_method"),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  discountAmount: numeric("discount_amount", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }).$type<number>().notNull().default(0),
  discountReason: text("discount_reason"),
  discountApprovedBy: text("discount_approved_by"),
  totalPrice: numeric("total_price", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  reminderPreference: text("reminder_preference").notNull().default("whatsapp"),
  reminderSentAt: timestamp("reminder_sent_at"),
  notes: text("notes"),
  rescheduleReason: text("reschedule_reason"),
  rescheduleHistory: jsonb("reschedule_history").notNull().default(sql`'[]'::jsonb`),
  isDeleted: boolean("is_deleted").notNull().default(false),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const bookingItems = pgTable("booking_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bookingId: varchar("booking_id").notNull().references(() => bookings.id),
  inventoryId: varchar("inventory_id").notNull().references(() => inventory.id),
  quantity: numeric("quantity", { precision: 12, scale: 2 }).$type<number>().notNull().default(1),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  totalPrice: numeric("total_price", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
});

export const bookingsRelations = relations(bookings, ({ one, many }) => ({
  store: one(stores, {
    fields: [bookings.storeId],
    references: [stores.id],
  }),
  customer: one(customers, {
    fields: [bookings.customerId],
    references: [customers.id],
  }),
  leadStaff: one(staff, {
    fields: [bookings.leadStaffId],
    references: [staff.id],
    relationName: "bookingLeadStaff",
  }),
  assistingStaff: one(staff, {
    fields: [bookings.assistingStaffId],
    references: [staff.id],
    relationName: "bookingAssistingStaff",
  }),
  items: many(bookingItems),
}));

export const bookingItemsRelations = relations(bookingItems, ({ one }) => ({
  booking: one(bookings, {
    fields: [bookingItems.bookingId],
    references: [bookings.id],
  }),
  inventory: one(inventory, {
    fields: [bookingItems.inventoryId],
    references: [inventory.id],
  }),
}));

export const insertBookingSchema = createInsertSchema(bookings).omit({ id: true, bookingRef: true, createdAt: true, updatedAt: true }).extend({
  depositAmount: z.number().optional(),
  subtotal: z.number().optional(),
  discountAmount: z.number().optional(),
  discountPercent: z.number().optional(),
  totalPrice: z.number().optional(),
});
export type InsertBooking = z.infer<typeof insertBookingSchema>;
export type Booking = typeof bookings.$inferSelect;

export const insertBookingItemSchema = createInsertSchema(bookingItems).omit({ id: true }).extend({
  unitPrice: z.number().optional(),
  totalPrice: z.number().optional(),
});
export type InsertBookingItem = z.infer<typeof insertBookingItemSchema>;
export type BookingItem = typeof bookingItems.$inferSelect;
