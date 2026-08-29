import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { stores } from "./stores";
import { users } from "./auth";

// Notifications table
export const notifications = pgTable("notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").references(() => stores.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  type: text("type").notNull(), // 'low_stock', 'void_transaction', 'payroll_period', 'system'
  message: text("message").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  archivedAt: timestamp("archived_at"),
}, (table) => [
  index("idx_notifications_user").on(table.userId),
]);

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
  store: one(stores, {
    fields: [notifications.storeId],
    references: [stores.id],
  }),
}));

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;
