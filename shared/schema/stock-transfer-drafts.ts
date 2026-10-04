import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, jsonb } from "drizzle-orm/pg-core";
import { stores } from "./stores";
import { users } from "./auth";

// ── Stock Transfer Drafts ────────────────────────────────────────────────────
// A half-filled "send stock" / "request stock" form, saved so it can be resumed.
// Form state only: it lives outside stock_transfers on purpose, so a draft never
// reserves stock, appears in shipment counts, or reaches the other branch.
// `storeId` is the branch the user was working in when they saved.
export const stockTransferDrafts = pgTable("stock_transfer_drafts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
  kind: text("kind").notNull().default("send"), // 'send' | 'request'
  otherStoreId: varchar("other_store_id"), // receiver when sending, supplier when requesting
  formData: jsonb("form_data").notNull().$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type StockTransferDraft = typeof stockTransferDrafts.$inferSelect;
