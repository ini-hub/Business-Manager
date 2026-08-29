import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, boolean, integer, timestamp, unique, index, jsonb, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { trimmedString } from "./_helpers";
import { stores } from "./stores";
import { orders, transactions, profitLoss } from "./sales";

// Products Table
export const products = pgTable("products", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  name: text("name").notNull(),
  type: text("type").notNull(), // 'product' | 'service' | 'supply' (back-bar consumable, never sold)
  category: text("category"),
  brand: text("brand"),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  isDeleted: boolean("is_deleted").notNull().default(false),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  // Scoped by type: a salon that retails "Shampoo" also stocks it back-bar, and
  // those are two different items with different costs and different stock.
  unique("products_store_type_name_unique").on(table.storeId, table.type, table.name),
]);

export const productsRelations = relations(products, ({ one, many }) => ({
  store: one(stores, {
    fields: [products.storeId],
    references: [stores.id],
  }),
  variants: many(inventory),
}));

// Inventory table
export const inventory = pgTable("inventory", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  name: text("name").notNull(),
  type: text("type").notNull(), // 'product' | 'service' | 'supply' (back-bar consumable, never sold)
  // For a product this is the purchase cost; for a service, the FIXED direct cost of
  // delivering it, EXCLUDING anything covered by a service_consumables recipe — those
  // are costed from the supply's own cost price when the service is sold. A service
  // carrying both a cost price and a recipe would count its consumables twice.
  costPrice: numeric("cost_price", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  sellingPrice: numeric("selling_price", { precision: 12, scale: 2 }).$type<number>().notNull().default(0), // always 0 for supplies — they are never sold
  // Supplies only. 'expensed' charges the purchase straight to Direct Supplies and
  // never meters it per service — the honest default when nobody knows the rate.
  // 'metered' capitalises the purchase and releases cost via a recipe, with a
  // periodic stock count settling whatever the estimate got wrong.
  costingMode: text("costing_mode").notNull().default("expensed"),

  // 4dp because a supply recipe can legitimately be a few ten-thousandths of a
  // unit (a bottle covering 300 services is 0.0033 per service). At 2dp that
  // deduction rounded to zero and stock never moved.
  quantity: numeric("quantity", { precision: 14, scale: 4 }).$type<number>().notNull().default(0), // Supports fractional quantities (e.g. 1.5 kg)
  allowFractional: boolean("allow_fractional").notNull().default(false), // When true, quantity can be a decimal
  unit: text("unit"), // Optional unit label shown in UI and on receipts (e.g. 'kg', 'litre', 'm')
  reorderPoint: numeric("reorder_point", { precision: 12, scale: 2 }).$type<number>(), // Per-item low-stock threshold (null = use global setting)
  commissionSplitOverride: boolean("commission_split_override").default(false).notNull(),
  commissionSplitBusinessShare: integer("commission_split_business_share").default(80).notNull(),
  commissionSplitStaffShare: integer("commission_split_staff_share").default(20).notNull(),
  isBundle: boolean("is_bundle").default(false).notNull(),
  productId: varchar("product_id").notNull().references(() => products.id),
  sku: text("sku"),
  barcode: text("barcode"),
  variantDimensions: jsonb("variant_dimensions"),
  isDeleted: boolean("is_deleted").notNull().default(false),
  deletedAt: timestamp("deleted_at"),
}, (table) => [
  // Scoped by type — see products_store_type_name_unique above.
  unique("inventory_store_type_name_unique").on(table.storeId, table.type, table.name),
  unique("inventory_store_sku_unique").on(table.storeId, table.sku),
  index("idx_inventory_store_qty").on(table.storeId, table.quantity),
]);

export const inventoryRelations = relations(inventory, ({ one, many }) => ({
  store: one(stores, {
    fields: [inventory.storeId],
    references: [stores.id],
  }),
  product: one(products, {
    fields: [inventory.productId],
    references: [products.id],
  }),
  orders: many(orders),
  transactions: many(transactions),
  profitLoss: many(profitLoss),
}));

export const insertProductSchema = createInsertSchema(products).omit({ id: true, createdAt: true, updatedAt: true, isDeleted: true, deletedAt: true }).extend({
  name: trimmedString(1, "Product name is required"),
  type: z.string().transform(s => s.trim()).pipe(z.enum(["product", "service", "supply"], { errorMap: () => ({ message: "Type must be product, service or supply" }) })),
});
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof products.$inferSelect;

export const insertInventorySchema = createInsertSchema(inventory).omit({ id: true, isDeleted: true, deletedAt: true }).extend({
  name: trimmedString(1, "Item name is required"),
  type: z.string().transform(s => s.trim()).pipe(z.enum(["product", "service", "supply"], { errorMap: () => ({ message: "Type must be product, service or supply" }) })),
  // numeric columns come back as strings from pg driver — coerce to number
  quantity: z.preprocess(v => (v === "" || v === null || v === undefined ? 0 : Number(v)), z.number().min(0)).default(0),
  costPrice: z.preprocess(v => (v === "" || v === null || v === undefined ? 0 : Number(v)), z.number()),
  sellingPrice: z.preprocess(v => (v === "" || v === null || v === undefined ? 0 : Number(v)), z.number()),
  productId: z.string().min(1, "Product group ID is required"),
  sku: z.string().optional().nullable(),
  barcode: z.string().optional().nullable(),
  allowFractional: z.boolean().optional().default(false),
  unit: z.string().optional().nullable(),
  reorderPoint: z.preprocess(v => (v === "" || v === null || v === undefined ? null : Number(v)), z.number().min(0).nullable()).optional(),
});
export type InsertInventory = z.infer<typeof insertInventorySchema>;
export type Inventory = typeof inventory.$inferSelect;
