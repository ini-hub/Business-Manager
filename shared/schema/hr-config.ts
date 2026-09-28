import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, unique } from "drizzle-orm/pg-core";
import { organisations } from "./organisations";

// See migrations/0065_hr_section_config.sql for the full rationale.
export const hrSectionEnum = [
  "personal",
  "job",
  "time_off",
  "emergency",
  "documents",
  "benefits",
  "disciplinary",
  "guarantor",
] as const;
export type HrSection = typeof hrSectionEnum[number];

// Per-business on/off + "required before a new staff member gets full
// access" toggles. Seeded per business by the migration with the stated
// defaults (personal/emergency/guarantor required, the rest enabled but not
// required) so hrProfileGate.ts never has to hard-code a fallback - a
// missing row would be a data bug, not a "use the default" signal.
export const hrSectionConfig = pgTable("hr_section_config", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessId: varchar("business_id").notNull().references(() => organisations.id),
  section: text("section").notNull(), // hrSectionEnum
  isEnabled: boolean("is_enabled").notNull().default(true),
  isRequiredForOnboarding: boolean("is_required_for_onboarding").notNull().default(false),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  unique("hr_section_config_business_section_unique").on(table.businessId, table.section),
]);

export type HrSectionConfig = typeof hrSectionConfig.$inferSelect;
export type InsertHrSectionConfig = typeof hrSectionConfig.$inferInsert;
