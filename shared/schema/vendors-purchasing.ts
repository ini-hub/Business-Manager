import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, index, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { stores } from "./stores";
import { customers } from "./customers";
import { inventory } from "./catalog";
import { inventoryRestockEvents } from "./inventory-ops";

// V2 Feature: Accounts Payable (Vendor Bills)
export const vendors = pgTable("vendors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  name: text("name").notNull(),
  contactName: text("contact_name"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  notes: text("notes"),
  isArchived: boolean("is_archived").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("idx_vendors_store").on(table.storeId),
]);

export const vendorBills = pgTable("vendor_bills", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  vendorId: varchar("vendor_id").notNull().references(() => vendors.id),
  amount: numeric("amount", { precision: 12, scale: 2 }).$type<number>().notNull(),
  amountPaid: numeric("amount_paid", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  status: text("status").notNull().default("unpaid"), // unpaid, partial, paid
  dueDate: timestamp("due_date"),
  billDate: timestamp("bill_date").notNull().defaultNow(),
  notes: text("notes"),
  linkedRestockEventId: varchar("linked_restock_event_id").references(() => inventoryRestockEvents.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("idx_vendor_bills_store").on(table.storeId),
  index("idx_vendor_bills_vendor").on(table.vendorId),
]);

export const vendorRelations = relations(vendors, ({ many }) => ({
  bills: many(vendorBills),
}));

export const vendorBillRelations = relations(vendorBills, ({ one }) => ({
  vendor: one(vendors, { fields: [vendorBills.vendorId], references: [vendors.id] }),
  restockEvent: one(inventoryRestockEvents, { fields: [vendorBills.linkedRestockEventId], references: [inventoryRestockEvents.id] }),
}));

export const insertVendorSchema = createInsertSchema(vendors).omit({ id: true, createdAt: true }).extend({
  email: z.string().trim().toLowerCase().refine(v => !v || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v), "Enter a valid email address.").optional().or(z.literal("")),
  phone: z.string().trim().refine(v => !v || v.replace(/\D/g, "").length >= 7, "Enter a valid phone number.").optional().or(z.literal("")),
});
export const insertVendorBillSchema = createInsertSchema(vendorBills).omit({ id: true, createdAt: true }).extend({
  amount: z.number(),
  amountPaid: z.number().optional(),
});
export type Vendor = typeof vendors.$inferSelect;
export type VendorBill = typeof vendorBills.$inferSelect;
export type InsertVendor = z.infer<typeof insertVendorSchema>;
export type InsertVendorBill = z.infer<typeof insertVendorBillSchema>;

// V3 Feature: Quotes & Estimates
export const quotes = pgTable("quotes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  customerId: varchar("customer_id").references(() => customers.id),
  quoteRef: text("quote_ref").notNull().unique(),
  status: text("status").notNull().default("draft"),
  totalPrice: numeric("total_price", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  notes: text("notes"),
  validUntil: timestamp("valid_until"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("idx_quotes_store").on(table.storeId),
]);

export const quoteItems = pgTable("quote_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  quoteId: varchar("quote_id").notNull().references(() => quotes.id),
  inventoryId: varchar("inventory_id").notNull().references(() => inventory.id),
  quantity: numeric("quantity", { precision: 12, scale: 2 }).$type<number>().notNull().default(1),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  totalPrice: numeric("total_price", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
});

export const quotesRelations = relations(quotes, ({ one, many }) => ({
  store: one(stores, { fields: [quotes.storeId], references: [stores.id] }),
  customer: one(customers, { fields: [quotes.customerId], references: [customers.id] }),
  items: many(quoteItems),
}));

export const quoteItemsRelations = relations(quoteItems, ({ one }) => ({
  quote: one(quotes, { fields: [quoteItems.quoteId], references: [quotes.id] }),
  inventory: one(inventory, { fields: [quoteItems.inventoryId], references: [inventory.id] }),
}));

export const insertQuoteSchema = createInsertSchema(quotes).omit({ id: true, createdAt: true, updatedAt: true }).extend({
  totalPrice: z.number().optional(),
});
export const insertQuoteItemSchema = createInsertSchema(quoteItems).omit({ id: true }).extend({
  unitPrice: z.number().optional(),
  totalPrice: z.number().optional(),
});
export type InsertQuote = z.infer<typeof insertQuoteSchema>;
export type InsertQuoteItem = z.infer<typeof insertQuoteItemSchema>;
export type Quote = typeof quotes.$inferSelect;
export type QuoteItem = typeof quoteItems.$inferSelect;

// V3 Feature: Purchase Orders
export const purchaseOrders = pgTable("purchase_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  vendorId: varchar("vendor_id").notNull().references(() => vendors.id),
  poNumber: text("po_number").notNull().unique(),
  status: text("status").notNull().default("draft"),
  totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).$type<number>().notNull().default(0),
  expectedDelivery: timestamp("expected_delivery"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("idx_purchase_orders_store").on(table.storeId),
  index("idx_purchase_orders_vendor").on(table.vendorId),
]);

export const purchaseOrderItems = pgTable("purchase_order_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  poId: varchar("po_id").notNull().references(() => purchaseOrders.id),
  inventoryId: varchar("inventory_id").notNull().references(() => inventory.id),
  quantity: numeric("quantity", { precision: 12, scale: 2 }).$type<number>().notNull(),
  receivedQuantity: numeric("received_quantity", { precision: 12, scale: 4 }).$type<number>().notNull().default(0),
  unitCost: numeric("unit_cost", { precision: 12, scale: 2 }).$type<number>().notNull(),
  totalCost: numeric("total_cost", { precision: 12, scale: 2 }).$type<number>().notNull(),
});

export const purchaseOrderRelations = relations(purchaseOrders, ({ one, many }) => ({
  store: one(stores, { fields: [purchaseOrders.storeId], references: [stores.id] }),
  vendor: one(vendors, { fields: [purchaseOrders.vendorId], references: [vendors.id] }),
  items: many(purchaseOrderItems),
}));

export const purchaseOrderItemRelations = relations(purchaseOrderItems, ({ one }) => ({
  purchaseOrder: one(purchaseOrders, { fields: [purchaseOrderItems.poId], references: [purchaseOrders.id] }),
  inventory: one(inventory, { fields: [purchaseOrderItems.inventoryId], references: [inventory.id] }),
}));

export const insertPurchaseOrderSchema = createInsertSchema(purchaseOrders).omit({ id: true, createdAt: true, updatedAt: true }).extend({
  totalAmount: z.number().optional(),
});
export const insertPurchaseOrderItemSchema = createInsertSchema(purchaseOrderItems).omit({ id: true }).extend({
  unitCost: z.number(),
  totalCost: z.number(),
});
export type InsertPurchaseOrder = z.infer<typeof insertPurchaseOrderSchema>;
export type InsertPurchaseOrderItem = z.infer<typeof insertPurchaseOrderItemSchema>;
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type PurchaseOrderItem = typeof purchaseOrderItems.$inferSelect;

// V3 Feature: Stock Transfers
export const stockTransfers = pgTable("stock_transfers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  fromStoreId: varchar("from_store_id").notNull().references(() => stores.id),
  toStoreId: varchar("to_store_id").notNull().references(() => stores.id),
  status: text("status").notNull().default("pending"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("idx_stock_transfers_from_store").on(table.fromStoreId),
  index("idx_stock_transfers_to_store").on(table.toStoreId),
]);

export const stockTransferItems = pgTable("stock_transfer_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  transferId: varchar("transfer_id").notNull().references(() => stockTransfers.id),
  inventoryId: varchar("inventory_id").notNull().references(() => inventory.id),
  quantity: numeric("quantity", { precision: 12, scale: 2 }).$type<number>().notNull(),
});

export const stockTransferRelations = relations(stockTransfers, ({ one, many }) => ({
  fromStore: one(stores, { fields: [stockTransfers.fromStoreId], references: [stores.id], relationName: "transferFrom" }),
  toStore: one(stores, { fields: [stockTransfers.toStoreId], references: [stores.id], relationName: "transferTo" }),
  items: many(stockTransferItems),
}));

export const stockTransferItemRelations = relations(stockTransferItems, ({ one }) => ({
  transfer: one(stockTransfers, { fields: [stockTransferItems.transferId], references: [stockTransfers.id] }),
  inventory: one(inventory, { fields: [stockTransferItems.inventoryId], references: [inventory.id] }),
}));

export const insertStockTransferSchema = createInsertSchema(stockTransfers).omit({ id: true, createdAt: true, updatedAt: true });
export const insertStockTransferItemSchema = createInsertSchema(stockTransferItems).omit({ id: true });
export type InsertStockTransfer = z.infer<typeof insertStockTransferSchema>;
export type InsertStockTransferItem = z.infer<typeof insertStockTransferItemSchema>;
export type StockTransfer = typeof stockTransfers.$inferSelect;
export type StockTransferItem = typeof stockTransferItems.$inferSelect;
