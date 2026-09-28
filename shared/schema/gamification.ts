import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, index, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { stores } from "./stores";

// Who a gamification row is about. "customer" and "staff" point at rows in
// those tables; "owner" points at a store itself (there is no per-owner
// login row to key off, so the store IS the subject for business milestones).
export const gamificationSubjectTypeEnum = ["customer", "staff", "owner"] as const;
export type GamificationSubjectType = typeof gamificationSubjectTypeEnum[number];

// Append-only ledger: the source of truth for points. Running totals are
// always derived by summing this table rather than mutated in place, the
// same reasoning as checkoutIdempotencyKeys/transactions elsewhere in this
// schema - an auditable trail beats a bare counter when the reason a
// customer/staff member gained or lost points will eventually be disputed.
export const gamificationPointsLedger = pgTable("gamification_points_ledger", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  subjectType: text("subject_type").notNull(), // gamificationSubjectTypeEnum
  subjectId: varchar("subject_id").notNull(), // customers.id | staff.id | stores.id (owner)
  points: integer("points").notNull(), // signed delta
  reason: text("reason").notNull(), // short machine key, e.g. "checkout_visit", "badge_bonus"
  sourceType: text("source_type"), // e.g. "checkout", "attendance_punch"
  sourceId: varchar("source_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_gamification_points_subject").on(table.storeId, table.subjectType, table.subjectId),
]);

export const gamificationPointsLedgerRelations = relations(gamificationPointsLedger, ({ one }) => ({
  store: one(stores, {
    fields: [gamificationPointsLedger.storeId],
    references: [stores.id],
  }),
}));

// Badge definitions live in code (shared/gamification/badges.ts) since they are
// product copy + eligibility rules, not data an owner edits per-store. This
// table only records that a subject earned one, once.
export const gamificationBadgeAwards = pgTable("gamification_badge_awards", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  subjectType: text("subject_type").notNull(),
  subjectId: varchar("subject_id").notNull(),
  badgeKey: text("badge_key").notNull(),
  awardedAt: timestamp("awarded_at").defaultNow().notNull(),
}, (table) => [
  unique("gamification_badge_award_unique").on(table.storeId, table.subjectType, table.subjectId, table.badgeKey),
  index("idx_gamification_badges_subject").on(table.storeId, table.subjectType, table.subjectId),
]);

export const gamificationBadgeAwardsRelations = relations(gamificationBadgeAwards, ({ one }) => ({
  store: one(stores, {
    fields: [gamificationBadgeAwards.storeId],
    references: [stores.id],
  }),
}));

// Streaks: one row per (subject, streakType). currentCount resets to 0 (or 1)
// when a qualifying period is missed; longestCount only ever grows, so a
// broken streak still shows what the subject once achieved.
export const gamificationStreaks = pgTable("gamification_streaks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  subjectType: text("subject_type").notNull(),
  subjectId: varchar("subject_id").notNull(),
  streakType: text("streak_type").notNull(), // e.g. "visit_week", "on_time_shift", "revenue_target_month"
  currentCount: integer("current_count").notNull().default(0),
  longestCount: integer("longest_count").notNull().default(0),
  lastQualifyingAt: timestamp("last_qualifying_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  unique("gamification_streak_unique").on(table.storeId, table.subjectType, table.subjectId, table.streakType),
]);

export const gamificationStreaksRelations = relations(gamificationStreaks, ({ one }) => ({
  store: one(stores, {
    fields: [gamificationStreaks.storeId],
    references: [stores.id],
  }),
}));

export const insertGamificationPointsLedgerSchema = createInsertSchema(gamificationPointsLedger).omit({ id: true, createdAt: true });
export type InsertGamificationPointsLedger = z.infer<typeof insertGamificationPointsLedgerSchema>;
export type GamificationPointsLedger = typeof gamificationPointsLedger.$inferSelect;

export type GamificationBadgeAward = typeof gamificationBadgeAwards.$inferSelect;
export type GamificationStreak = typeof gamificationStreaks.$inferSelect;
