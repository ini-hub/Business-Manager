import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, index, uniqueIndex, numeric, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { organisations } from "./organisations";
import { stores } from "./stores";
import { users } from "./auth";
import { inventory } from "./catalog";

// ========== PARTNER (INTER-BUSINESS) TRANSFERS ==========
// Stock sent between two different businesses that have connected as partners.
// Same-business moves stay in stock_transfers. Obligations are kept in their own ledger,
// not in credit_entries / vendor_bills, which require a customer / vendor row.

export const partnershipStatusEnum = ["pending", "active", "declined", "revoked"] as const;
export type PartnershipStatus = typeof partnershipStatusEnum[number];

export const partnerTransferStatusEnum = [
  "requested", "offered", "accepted", "shipped", "received", "disputed", "closed", "rejected", "cancelled",
] as const;
export type PartnerTransferStatus = typeof partnerTransferStatusEnum[number];

export const partnerTransferKindEnum = ["send", "request"] as const;
export type PartnerTransferKind = typeof partnerTransferKindEnum[number];

export const settlementTypeEnum = ["none", "payable", "return_in_kind"] as const;
export type SettlementType = typeof settlementTypeEnum[number];

export const settlementMethodEnum = ["cash", "transfer", "pos", "goods_return"] as const;
export type SettlementMethod = typeof settlementMethodEnum[number];

export const businessPartnerships = pgTable("business_partnerships", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  requesterOrgId: varchar("requester_org_id").notNull().references(() => organisations.id),
  addresseeOrgId: varchar("addressee_org_id").notNull().references(() => organisations.id),
  status: text("status").notNull().default("pending"), // see partnershipStatusEnum
  requestedByUserId: varchar("requested_by_user_id").references(() => users.id),
  respondedByUserId: varchar("responded_by_user_id").references(() => users.id),
  respondedAt: timestamp("responded_at"),
  revokedByOrgId: varchar("revoked_by_org_id").references(() => organisations.id),
  tradeCreditLimit: numeric("trade_credit_limit", { precision: 12, scale: 2, mode: "number" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  // The unordered-pair unique index (LEAST/GREATEST) is created in migration 0113.
  index("idx_business_partnerships_addressee").on(table.addresseeOrgId, table.status),
]);

export const partnerTransfers = pgTable("partner_transfers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  partnershipId: varchar("partnership_id").notNull().references(() => businessPartnerships.id),
  fromOrgId: varchar("from_org_id").notNull().references(() => organisations.id),
  toOrgId: varchar("to_org_id").notNull().references(() => organisations.id),
  fromStoreId: varchar("from_store_id").notNull().references(() => stores.id),
  toStoreId: varchar("to_store_id").notNull().references(() => stores.id),
  kind: text("kind").notNull().default("send"), // see partnerTransferKindEnum
  status: text("status").notNull().default("offered"), // see partnerTransferStatusEnum
  settlementType: text("settlement_type").notNull().default("none"), // see settlementTypeEnum
  agreedTotal: numeric("agreed_total", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
  dueDate: timestamp("due_date"),
  proposedSettlementType: text("proposed_settlement_type"), // see settlementTypeEnum; awaiting the receiver's agreement
  proposedDueDate: timestamp("proposed_due_date"),
  notes: text("notes"),
  rejectionReason: text("rejection_reason"),
  idempotencyKey: text("idempotency_key"),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
  acceptedAt: timestamp("accepted_at"),
  acceptedByUserId: varchar("accepted_by_user_id").references(() => users.id),
  shippedAt: timestamp("shipped_at"),
  shippedByUserId: varchar("shipped_by_user_id").references(() => users.id),
  receivedAt: timestamp("received_at"),
  receivedByUserId: varchar("received_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("uq_partner_transfers_idem").on(table.fromOrgId, table.idempotencyKey).where(sql`idempotency_key IS NOT NULL`),
  index("idx_partner_transfers_from").on(table.fromStoreId, table.status),
  index("idx_partner_transfers_to").on(table.toStoreId, table.status),
]);

export const partnerTransferItems = pgTable("partner_transfer_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  transferId: varchar("transfer_id").notNull().references(() => partnerTransfers.id, { onDelete: "cascade" }),
  // Null on a requested line until the supplier maps it to one of their items when accepting.
  fromInventoryId: varchar("from_inventory_id").references(() => inventory.id),
  name: text("name").notNull(),
  sku: text("sku"),
  barcode: text("barcode"),
  unit: text("unit"),
  quantity: numeric("quantity", { precision: 14, scale: 4, mode: "number" }).notNull(),
  unitCostSnapshot: numeric("unit_cost_snapshot", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
  agreedUnitPrice: numeric("agreed_unit_price", { precision: 12, scale: 2, mode: "number" }),
  toInventoryId: varchar("to_inventory_id").references(() => inventory.id),
  confirmedQuantity: numeric("confirmed_quantity", { precision: 14, scale: 4, mode: "number" }),
  shortfallReason: text("shortfall_reason"), // missing | damaged, set by the receiver for a short line
  shortfallNote: text("shortfall_note"),
}, (table) => [
  index("idx_partner_transfer_items_transfer").on(table.transferId),
]);

export const partnerObligations = pgTable("partner_obligations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  transferId: varchar("transfer_id").notNull().unique().references(() => partnerTransfers.id),
  creditorOrgId: varchar("creditor_org_id").notNull().references(() => organisations.id),
  debtorOrgId: varchar("debtor_org_id").notNull().references(() => organisations.id),
  kind: text("kind").notNull(), // money | goods
  amountDue: numeric("amount_due", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
  amountSettled: numeric("amount_settled", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
  status: text("status").notNull().default("open"), // open | settled | waived
  dueDate: timestamp("due_date"),
  lastRemindedAt: timestamp("last_reminded_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("idx_partner_obligations_creditor").on(table.creditorOrgId, table.status),
  index("idx_partner_obligations_debtor").on(table.debtorOrgId, table.status),
]);

export const partnerSettlements = pgTable("partner_settlements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  obligationId: varchar("obligation_id").notNull().references(() => partnerObligations.id),
  amount: numeric("amount", { precision: 12, scale: 2, mode: "number" }).notNull(),
  method: text("method"), // see settlementMethodEnum
  returnTransferId: varchar("return_transfer_id").references(() => partnerTransfers.id),
  reference: text("reference"),
  notes: text("notes"),
  recordedByOrgId: varchar("recorded_by_org_id").notNull().references(() => organisations.id),
  recordedByUserId: varchar("recorded_by_user_id").references(() => users.id),
  status: text("status").notNull().default("pending"), // pending | confirmed | rejected
  confirmedAt: timestamp("confirmed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("idx_partner_settlements_obligation").on(table.obligationId),
]);

export const shortfallReasonEnum = ["missing", "damaged"] as const;
export type ShortfallReason = typeof shortfallReasonEnum[number];

export const partnerInvites = pgTable("partner_invites", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull().references(() => organisations.id),
  email: text("email").notNull(),
  invitedByUserId: varchar("invited_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  acceptedAt: timestamp("accepted_at"),
});

export const partnerStatementLog = pgTable("partner_statement_log", {
  orgId: varchar("org_id").notNull().references(() => organisations.id),
  period: text("period").notNull(), // YYYY-MM
  sentAt: timestamp("sent_at").notNull().defaultNow(),
});

export const partnerTransferEvents = pgTable("partner_transfer_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  transferId: varchar("transfer_id").notNull().references(() => partnerTransfers.id, { onDelete: "cascade" }),
  orgId: varchar("org_id").notNull().references(() => organisations.id),
  userId: varchar("user_id").references(() => users.id),
  event: text("event").notNull(),
  detail: jsonb("detail"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("idx_partner_transfer_events_transfer").on(table.transferId, table.createdAt),
]);

const positiveQty = z.number().positive("Quantity must be greater than zero");

export const receiveShortfallSchema = z.record(z.object({
  reason: z.enum(shortfallReasonEnum),
  note: z.string().trim().max(300).optional().nullable(),
}));

export const createPartnerTransferSchema = z.object({
  partnerOrgId: z.string().min(1),
  fromStoreId: z.string().min(1),
  toStoreId: z.string().min(1),
  kind: z.enum(partnerTransferKindEnum).default("send"),
  settlementType: z.enum(settlementTypeEnum).default("none"),
  dueDate: z.coerce.date().optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  idempotencyKey: z.string().trim().min(8).max(100).optional(),
  items: z.array(z.object({
    // send: the sender's own item. request: optionally an item the supplier has shared with partners;
    // otherwise omitted and the supplier maps the line on accept.
    fromInventoryId: z.string().min(1).optional(),
    // request: the requester's own item (name and sku are taken from it), or a free-text name.
    toInventoryId: z.string().min(1).optional(),
    name: z.string().trim().min(1).max(200).optional(),
    quantity: positiveQty,
    agreedUnitPrice: z.number().min(0).optional().nullable(),
  })).min(1, "Add at least one item"),
}).superRefine((v, ctx) => {
  v.items.forEach((i, idx) => {
    if (v.kind === "send" && !i.fromInventoryId) ctx.addIssue({ code: "custom", path: ["items", idx], message: "Choose an item to send." });
    if (v.kind === "request" && !i.toInventoryId && !i.name && !i.fromInventoryId) ctx.addIssue({ code: "custom", path: ["items", idx], message: "Name the item you need." });
  });
});
export type CreatePartnerTransfer = z.infer<typeof createPartnerTransferSchema>;

export const insertBusinessPartnershipSchema = createInsertSchema(businessPartnerships).omit({ id: true, createdAt: true, updatedAt: true });
export type BusinessPartnership = typeof businessPartnerships.$inferSelect;
export type PartnerTransfer = typeof partnerTransfers.$inferSelect;
export type PartnerTransferItem = typeof partnerTransferItems.$inferSelect;
export type PartnerObligation = typeof partnerObligations.$inferSelect;
export type PartnerSettlement = typeof partnerSettlements.$inferSelect;
export type PartnerTransferEvent = typeof partnerTransferEvents.$inferSelect;
