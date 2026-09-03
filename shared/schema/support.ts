import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { organisations } from "./organisations";
import { users } from "./auth";
import { superAdmins } from "./super-admin";

// A persistent, per-user conversation with "Support" - used both by a
// locked-out owner (suspended for a reason other than non-payment, or a
// trial-expired org with no subscription) and generally from the Help &
// Support page. One open thread per user at a time, enforced by the partial
// unique index below: sending a message either continues the existing open
// thread or starts a fresh one - the client never tracks thread ids itself.
export const supportThreads = pgTable("support_threads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organisationId: varchar("organisation_id").notNull().references(() => organisations.id),
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id),
  reason: text("reason").notNull().default("general"), // 'general', or a snapshot of business.suspensionReason / 'trial_expired' when started from the paywall
  status: text("status").notNull().default("open"), // 'open', 'resolved'
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastMessageAt: timestamp("last_message_at").notNull().defaultNow(),
  lastMessageBySenderType: text("last_message_by_sender_type").notNull().default("user"), // 'user', 'admin'
  resolvedAt: timestamp("resolved_at"),
  resolvedByAdminId: varchar("resolved_by_admin_id").references(() => superAdmins.id),
  resolutionOutcome: text("resolution_outcome"), // 'reactivated' | 'suspension_upheld' | null - only ever set for a GENUINE_SUSPENSION_REASONS thread; null for general/trial_expired/non_payment threads and every thread resolved before this column existed
  userLastReadAt: timestamp("user_last_read_at").notNull().defaultNow(),
  adminLastReadAt: timestamp("admin_last_read_at"),
}, (table) => [
  index("idx_support_threads_status").on(table.status),
  index("idx_support_threads_org").on(table.organisationId),
  uniqueIndex("uq_support_threads_one_open_per_user").on(table.createdByUserId).where(sql`status = 'open'`),
]);

// Suspension reasons a thread's `reason` snapshot can carry that represent an
// actual admin-imposed lockout - every organisations.suspensionReason value
// except 'non_payment' (self-serve via checkout/Paywall, auto-clears on
// payment - see server/lib/billing.ts, never reaches this admin chat flow).
// A thread whose reason is one of these, opened while the org is still
// status 'suspended', requires an explicit "Reactivate & Resolve" /
// "Close - keep suspended" outcome instead of the generic resolve/reopen
// toggle (see server/routes-admin.ts support-thread routes).
export const GENUINE_SUSPENSION_REASONS = [
  "policy_violation",
  "fraudulent_activity",
  "owner_request",
  "inactivity",
  "other",
] as const;
export type GenuineSuspensionReason = typeof GENUINE_SUSPENSION_REASONS[number];

export function isGenuineSuspensionReason(reason: string): boolean {
  return (GENUINE_SUSPENSION_REASONS as readonly string[]).includes(reason);
}

export const RESOLUTION_OUTCOMES = ["reactivated", "suspension_upheld"] as const;
export type ResolutionOutcome = typeof RESOLUTION_OUTCOMES[number];

export const supportThreadsRelations = relations(supportThreads, ({ one, many }) => ({
  organisation: one(organisations, { fields: [supportThreads.organisationId], references: [organisations.id] }),
  createdBy: one(users, { fields: [supportThreads.createdByUserId], references: [users.id] }),
  messages: many(supportThreadMessages),
}));

export const insertSupportThreadSchema = createInsertSchema(supportThreads)
  .omit({ id: true, createdAt: true, lastMessageAt: true, lastMessageBySenderType: true, status: true, resolvedAt: true, resolvedByAdminId: true, resolutionOutcome: true, userLastReadAt: true, adminLastReadAt: true });
export type InsertSupportThread = z.infer<typeof insertSupportThreadSchema>;
export type SupportThread = typeof supportThreads.$inferSelect;

export const supportThreadMessages = pgTable("support_thread_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  threadId: varchar("thread_id").notNull().references(() => supportThreads.id),
  senderType: text("sender_type").notNull(), // 'user', 'admin'
  senderUserId: varchar("sender_user_id").references(() => users.id),
  senderAdminId: varchar("sender_admin_id").references(() => superAdmins.id),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("idx_support_thread_messages_thread").on(table.threadId, table.createdAt),
]);

export const supportThreadMessagesRelations = relations(supportThreadMessages, ({ one }) => ({
  thread: one(supportThreads, { fields: [supportThreadMessages.threadId], references: [supportThreads.id] }),
}));

export const insertSupportThreadMessageSchema = createInsertSchema(supportThreadMessages)
  .omit({ id: true, createdAt: true, threadId: true, senderType: true, senderUserId: true, senderAdminId: true })
  .extend({
    body: z.string().trim().min(1, "Please enter a message.").max(2000, "Message is too long."),
  });
export type InsertSupportThreadMessage = z.infer<typeof insertSupportThreadMessageSchema>;
export type SupportThreadMessage = typeof supportThreadMessages.$inferSelect;
