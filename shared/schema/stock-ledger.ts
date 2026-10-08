import { sql } from "drizzle-orm";
import { pgTable, varchar, text, timestamp, numeric, index } from "drizzle-orm/pg-core";
import { stores } from "./stores";
import { inventory } from "./catalog";
import { users } from "./auth";
import { staff } from "./staff";

// Every reason stock can move. Kept as a closed list so reports can group on it; add a value
// here (and nowhere else) when a new flow starts changing inventory.quantity.
export const stockMovementReasons = [
  "opening_balance", // synthetic row written by migration 0116 so SUM(delta) matches today's stock
  "sale",
  "sale_void",
  "sale_return",
  "consumable_use",
  "consumable_restore",
  "restock",
  "po_receipt",
  "transfer_out",
  "transfer_in",
  "partner_transfer_out",
  "partner_transfer_in",
  "audit_adjustment",
  "manual_edit",
  "bulk_import",
] as const;
export type StockMovementReason = typeof stockMovementReasons[number];

// Append-only. One row per change to inventory.quantity, so that
//   inventory.quantity = SUM(delta) per inventory row
// holds at all times (scripts/stock-ledger-parity.ts asserts it). Rows are never updated or
// deleted: a correction is a new row.
export const stockMovements = pgTable("stock_movements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  // Cascade: hardDeleteInventoryItem removes never-sold items, and their history goes with them.
  inventoryId: varchar("inventory_id").notNull().references(() => inventory.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  // 14,4 matches inventory.quantity (migration 0026), so fractional and metered stock round-trips.
  quantityBefore: numeric("quantity_before", { precision: 14, scale: 4, mode: "number" }).notNull(),
  quantityAfter: numeric("quantity_after", { precision: 14, scale: 4, mode: "number" }).notNull(),
  delta: numeric("delta", { precision: 14, scale: 4, mode: "number" }).notNull(),
  // The document that caused the move (order, checkout, restock event, transfer, audit...).
  // Soft reference on purpose: it spans many tables and must survive their deletion.
  refType: text("ref_type"),
  refId: varchar("ref_id"),
  actorUserId: varchar("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  actorStaffId: varchar("actor_staff_id").references(() => staff.id, { onDelete: "set null" }),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("idx_stock_movements_item_time").on(table.inventoryId, table.createdAt),
  index("idx_stock_movements_store_time").on(table.storeId, table.createdAt),
  index("idx_stock_movements_ref").on(table.refType, table.refId),
]);

export type StockMovement = typeof stockMovements.$inferSelect;
export type InsertStockMovement = typeof stockMovements.$inferInsert;
