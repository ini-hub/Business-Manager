import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, unique, index, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { stores } from "./stores";
import { inventory } from "./catalog";
import { orders } from "./sales";

// Consumables: the recipe that says how much back-bar supply an item burns per unit sold.
//
// Grain is the inventory VARIANT, not the product group — "Wash — long hair" and
// "Wash — short hair" burn different amounts, which is the entire point of tracking it.
//
// The consuming side is `inventoryId`, not `serviceInventoryId`: a retail product can
// consume supplies too (packaging, gift wrap). v1 restricts it to services in the
// service layer, but the column name should not have to change for that.
export const serviceConsumables = pgTable("service_consumables", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  inventoryId: varchar("inventory_id").notNull().references(() => inventory.id), // the consuming item
  supplyInventoryId: varchar("supply_inventory_id").notNull().references(() => inventory.id), // must be type='supply'
  // >= 0.01 (enforced by CHECK): inventory.quantity is numeric(12,2), so a smaller
  // recipe would round to zero on the stock column and stock would never move while
  // cost accrued. Stock supplies in ml/g/ea rather than bottles.
  quantityPerUnit: numeric("quantity_per_unit", { precision: 12, scale: 4 }).$type<number>().notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  unique("service_consumables_item_supply_unique").on(table.inventoryId, table.supplyInventoryId),
  index("idx_service_consumables_supply").on(table.supplyInventoryId),
]);

export const serviceConsumablesRelations = relations(serviceConsumables, ({ one }) => ({
  store: one(stores, { fields: [serviceConsumables.storeId], references: [stores.id] }),
  item: one(inventory, { fields: [serviceConsumables.inventoryId], references: [inventory.id] }),
  supply: one(inventory, { fields: [serviceConsumables.supplyInventoryId], references: [inventory.id] }),
}));

export const insertServiceConsumableSchema = createInsertSchema(serviceConsumables)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    quantityPerUnit: z.coerce.number().min(0.0001, "Quantity per unit must be at least 0.0001."),
  });
export type ServiceConsumable = typeof serviceConsumables.$inferSelect;
export type InsertServiceConsumable = z.infer<typeof insertServiceConsumableSchema>;

// Consumables: the consumption ledger, written at checkout — one row per (sale line, supply).
//
// `unitCostAtSale` is a SNAPSHOT and that is not optional. Every other COGS path here
// multiplies a historical quantity by the item's CURRENT cost price; supply costs move
// on every weighted-average restock, so without a snapshot, restocking shampoo would
// silently rewrite last quarter's service costs.
//
// The table carries no lifecycle state. Whether a row counts is derived by joining
// orders -> checkouts and filtering payment_status='completed' AND is_voided=false,
// exactly as getProfitLossSummary already derives revenue. That is what makes void need
// no ledger write and return need no consumables code at all.
//
// createdAt is for audit only and must never be filtered on: the addendum path writes
// its checkout with the ORIGINAL sale date, so the join-derived date is the correct one.
export const orderConsumables = pgTable("order_consumables", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  orderId: varchar("order_id").notNull().references(() => orders.id),
  supplyInventoryId: varchar("supply_inventory_id").notNull().references(() => inventory.id),
  quantityUsed: numeric("quantity_used", { precision: 12, scale: 4 }).$type<number>().notNull(),
  unitCostAtSale: numeric("unit_cost_at_sale", { precision: 12, scale: 2 }).$type<number>().notNull(),
  totalCost: numeric("total_cost", { precision: 12, scale: 2 }).$type<number>().notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  unique("order_consumables_order_supply_unique").on(table.orderId, table.supplyInventoryId),
  index("idx_order_consumables_order").on(table.orderId),
  index("idx_order_consumables_supply").on(table.supplyInventoryId),
  index("idx_order_consumables_store").on(table.storeId),
]);

export const orderConsumablesRelations = relations(orderConsumables, ({ one }) => ({
  store: one(stores, { fields: [orderConsumables.storeId], references: [stores.id] }),
  order: one(orders, { fields: [orderConsumables.orderId], references: [orders.id] }),
  supply: one(inventory, { fields: [orderConsumables.supplyInventoryId], references: [inventory.id] }),
}));

export const insertOrderConsumableSchema = createInsertSchema(orderConsumables).omit({ id: true, createdAt: true });
export type OrderConsumable = typeof orderConsumables.$inferSelect;
export type InsertOrderConsumable = z.infer<typeof insertOrderConsumableSchema>;
