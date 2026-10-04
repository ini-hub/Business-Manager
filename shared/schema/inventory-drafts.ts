import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, jsonb } from "drizzle-orm/pg-core";
import { stores } from "./stores";
import { users } from "./auth";

// ── Inventory Drafts ─────────────────────────────────────────────────────────
// A half-filled "New item" wizard, saved so it can be resumed. It is a snapshot
// of form state only: it lives outside products/inventory on purpose, so a draft
// can never reach the POS, stock totals, reports or free-plan item caps.
export const inventoryDrafts = pgTable("inventory_drafts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
  name: text("name"), // item name typed so far — label in the drafts list
  type: text("type"), // 'product' | 'service' | 'supply' once chosen
  formData: jsonb("form_data").notNull().$type<Record<string, unknown>>(),
  step: text("step"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InventoryDraft = typeof inventoryDrafts.$inferSelect;
