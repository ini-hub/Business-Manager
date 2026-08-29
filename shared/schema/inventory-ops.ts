import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, boolean, integer, timestamp, unique, index, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { trimmedString } from "./_helpers";
import { stores } from "./stores";
import { inventory } from "./catalog";
import { staff } from "./staff";
import { users } from "./auth";

// Cost strategy for restock events
export const costStrategyEnum = ["keep", "last", "weighted", "override"] as const;
export type CostStrategy = typeof costStrategyEnum[number];

// Inventory Restock Events table - tracks all restock operations with audit trail
export const inventoryRestockEvents = pgTable("inventory_restock_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  inventoryId: varchar("inventory_id").notNull().references(() => inventory.id),
  staffId: varchar("staff_id").references(() => staff.id), // Who performed the restock
  userId: varchar("user_id").references(() => users.id), // Alternative: owner/manager without staff record
  quantityAdded: numeric("quantity_added", { precision: 12, scale: 2 }).$type<number>().notNull(),
  previousQuantity: numeric("previous_quantity", { precision: 12, scale: 2 }).$type<number>().notNull(),
  newQuantity: numeric("new_quantity", { precision: 12, scale: 2 }).$type<number>().notNull(),
  unitCost: numeric("unit_cost", { precision: 12, scale: 2 }).$type<number>().notNull(), // Cost per unit for this restock
  previousCostPrice: numeric("previous_cost_price", { precision: 12, scale: 2 }).$type<number>().notNull(),
  newCostPrice: numeric("new_cost_price", { precision: 12, scale: 2 }).$type<number>().notNull(),
  previousSellingPrice: numeric("previous_selling_price", { precision: 12, scale: 2 }).$type<number>().notNull(),
  newSellingPrice: numeric("new_selling_price", { precision: 12, scale: 2 }).$type<number>().notNull(),
  costStrategy: text("cost_strategy").notNull().default("keep"), // keep, last, weighted, override
  notes: text("notes"), // Optional notes for this restock
  reason: text("reason").notNull().default("Regular Restock"), // Regular Restock, Returned Stock, Correction, Opening Stock
  attachment: text("attachment"), // Optional receipt upload url
  restockedAt: timestamp("restocked_at").notNull().defaultNow(),
});

export const inventoryRestockEventsRelations = relations(inventoryRestockEvents, ({ one }) => ({
  store: one(stores, {
    fields: [inventoryRestockEvents.storeId],
    references: [stores.id],
  }),
  inventory: one(inventory, {
    fields: [inventoryRestockEvents.inventoryId],
    references: [inventory.id],
  }),
  staff: one(staff, {
    fields: [inventoryRestockEvents.staffId],
    references: [staff.id],
  }),
  user: one(users, {
    fields: [inventoryRestockEvents.userId],
    references: [users.id],
  }),
}));

export const insertRestockEventSchema = createInsertSchema(inventoryRestockEvents).omit({
  id: true,
  restockedAt: true,
  previousQuantity: true,
  newQuantity: true,
  previousCostPrice: true,
  newCostPrice: true,
  previousSellingPrice: true,
  newSellingPrice: true,
}).extend({
  quantityAdded: z.number().min(1, "Quantity must be at least 1"),
  unitCost: z.number().min(0, "Unit cost cannot be negative"),
  costStrategy: z.enum(costStrategyEnum).default("keep"),
  newSellingPrice: z.number().min(0, "Selling price cannot be negative").optional(),
  notes: z.string().optional(),
  reason: z.enum(["Regular Restock", "Returned Stock", "Correction", "Opening Stock"]).default("Regular Restock"),
  attachment: z.string().optional().nullable(),
});
export type InsertRestockEvent = z.infer<typeof insertRestockEventSchema>;
export type RestockEvent = typeof inventoryRestockEvents.$inferSelect;

// V2 Feature: Bundled Components
export const bundleComponents = pgTable("bundle_components", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  parentInventoryId: varchar("parent_inventory_id").notNull().references(() => inventory.id),
  componentInventoryId: varchar("component_inventory_id").notNull().references(() => inventory.id),
  quantity: numeric("quantity", { precision: 12, scale: 2 }).$type<number>().notNull().default(1),
});

export const bundleComponentsRelations = relations(bundleComponents, ({ one }) => ({
  parent: one(inventory, { fields: [bundleComponents.parentInventoryId], references: [inventory.id] }),
  component: one(inventory, { fields: [bundleComponents.componentInventoryId], references: [inventory.id] }),
}));

export const insertBundleComponentSchema = createInsertSchema(bundleComponents).omit({ id: true });
export type BundleComponent = typeof bundleComponents.$inferSelect;

// V2 Feature: Stock Audits
export const stockAudits = pgTable("stock_audits", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  status: text("status").notNull().default("draft"), // draft, approved
  notes: text("notes"),
  conductedByStaffId: varchar("conducted_by_staff_id").references(() => staff.id),
  approvedByUserId: varchar("approved_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  approvedAt: timestamp("approved_at"),
});

export const stockAuditItems = pgTable("stock_audit_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  auditId: varchar("audit_id").notNull().references(() => stockAudits.id),
  inventoryId: varchar("inventory_id").notNull().references(() => inventory.id),
  systemQuantity: numeric("system_quantity", { precision: 14, scale: 4 }).$type<number>().notNull(),
  physicalQuantity: numeric("physical_quantity", { precision: 14, scale: 4 }).$type<number>().notNull(),
  variance: numeric("variance", { precision: 14, scale: 4 }).$type<number>().notNull(),
  reason: text("reason"),
});

export const stockAuditRelations = relations(stockAudits, ({ one, many }) => ({
  store: one(stores, { fields: [stockAudits.storeId], references: [stores.id] }),
  conductedBy: one(staff, { fields: [stockAudits.conductedByStaffId], references: [staff.id] }),
  approvedBy: one(users, { fields: [stockAudits.approvedByUserId], references: [users.id] }),
  items: many(stockAuditItems),
}));

export const stockAuditItemRelations = relations(stockAuditItems, ({ one }) => ({
  audit: one(stockAudits, { fields: [stockAuditItems.auditId], references: [stockAudits.id] }),
  inventory: one(inventory, { fields: [stockAuditItems.inventoryId], references: [inventory.id] }),
}));

export const insertStockAuditSchema = createInsertSchema(stockAudits).omit({ id: true, createdAt: true });
export const insertStockAuditItemSchema = createInsertSchema(stockAuditItems).omit({ id: true });
export type StockAudit = typeof stockAudits.$inferSelect;
export type StockAuditItem = typeof stockAuditItems.$inferSelect;

// V4 Feature: Inventory Batches
export const inventoryBatches = pgTable("inventory_batches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  inventoryId: varchar("inventory_id").notNull().references(() => inventory.id),
  batchNumber: text("batch_number").notNull(),
  expiryDate: timestamp("expiry_date").notNull(),
  quantity: integer("quantity").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const inventoryBatchRelations = relations(inventoryBatches, ({ one }) => ({
  store: one(stores, { fields: [inventoryBatches.storeId], references: [stores.id] }),
  inventory: one(inventory, { fields: [inventoryBatches.inventoryId], references: [inventory.id] }),
}));

export const insertInventoryBatchSchema = createInsertSchema(inventoryBatches).omit({ id: true, createdAt: true });
export type InsertInventoryBatch = z.infer<typeof insertInventoryBatchSchema>;
export type InventoryBatch = typeof inventoryBatches.$inferSelect;

// Promotions Table
export const promotions = pgTable("promotions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type").notNull(), // 'buy_x_get_y' | 'spend_x_get_y'
  buyItemId: varchar("buy_item_id").references(() => inventory.id),
  buyQuantity: integer("buy_quantity"),
  getItemId: varchar("get_item_id").references(() => inventory.id),
  getQuantity: integer("get_quantity"),
  spendAmount: numeric("spend_amount", { precision: 12, scale: 2 }).$type<number>(),
  isActive: boolean("is_active").notNull().default(true),
  isDeleted: boolean("is_deleted").notNull().default(false),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const promotionsRelations = relations(promotions, ({ one }) => ({
  store: one(stores, {
    fields: [promotions.storeId],
    references: [stores.id],
  }),
  buyItem: one(inventory, {
    fields: [promotions.buyItemId],
    references: [inventory.id],
  }),
  getItem: one(inventory, {
    fields: [promotions.getItemId],
    references: [inventory.id],
  }),
}));

export const insertPromotionSchema = createInsertSchema(promotions).omit({
  id: true,
  createdAt: true,
}).extend({
  name: trimmedString(1, "Promotion name is required"),
  type: z.enum(["buy_x_get_y", "spend_x_get_y"]),
  buyQuantity: z.number().min(1).optional().nullable(),
  getQuantity: z.number().min(1).optional().nullable(),
  spendAmount: z.number().min(0).optional().nullable(),
  isActive: z.boolean().default(true),
});

export type InsertPromotion = z.infer<typeof insertPromotionSchema>;
export type Promotion = typeof promotions.$inferSelect;

// V4 Feature: Tax Rates
export const taxRates = pgTable("tax_rates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  name: text("name").notNull(),
  rate: numeric("rate", { precision: 5, scale: 2 }).$type<number>().notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const taxRateRelations = relations(taxRates, ({ one }) => ({
  store: one(stores, { fields: [taxRates.storeId], references: [stores.id] }),
}));

export const insertTaxRateSchema = createInsertSchema(taxRates).omit({ id: true, createdAt: true }).extend({
  rate: z.number(),
});
export type InsertTaxRate = z.infer<typeof insertTaxRateSchema>;
export type TaxRate = typeof taxRates.$inferSelect;
