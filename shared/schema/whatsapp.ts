import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, jsonb, integer, unique, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { stores } from "./stores";
import { customers } from "./customers";
import { bookings } from "./bookings";

export const whatsappNumberStatusEnum = ["pending_verification", "active", "disabled"] as const;
export type WhatsAppNumberStatus = typeof whatsappNumberStatusEnum[number];

// One WhatsApp Business number per store. phoneNumberId (Meta's id, not the
// human phone number) is the actual routing key - every inbound webhook
// payload carries it, and it's what maps a message back to a storeId.
export const whatsappNumbers = pgTable("whatsapp_numbers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  phoneNumberId: text("phone_number_id").notNull(),
  wabaId: text("waba_id").notNull(),
  displayPhoneNumber: text("display_phone_number"),
  // Encrypted at rest (server-side key, see WhatsAppService) - never the raw
  // Meta long-lived token in plaintext.
  accessTokenEncrypted: text("access_token_encrypted"),
  status: text("status").notNull().default("pending_verification"),
  qualityRating: text("quality_rating"),
  messagingTierLimit: integer("messaging_tier_limit"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  unique("whatsapp_numbers_store_unique").on(table.storeId),
  unique("whatsapp_numbers_phone_number_id_unique").on(table.phoneNumberId),
]);

export const whatsappNumbersRelations = relations(whatsappNumbers, ({ one }) => ({
  store: one(stores, {
    fields: [whatsappNumbers.storeId],
    references: [stores.id],
  }),
}));

export const insertWhatsappNumberSchema = createInsertSchema(whatsappNumbers).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWhatsappNumber = z.infer<typeof insertWhatsappNumberSchema>;
export type WhatsappNumber = typeof whatsappNumbers.$inferSelect;

export const whatsappMessageDirectionEnum = ["outbound", "inbound"] as const;
export type WhatsappMessageDirection = typeof whatsappMessageDirectionEnum[number];

export const whatsappMessageTypeEnum = ["template", "text", "interactive_button", "interactive_list", "flow"] as const;
export type WhatsappMessageType = typeof whatsappMessageTypeEnum[number];

export const whatsappMessageStatusEnum = ["queued", "sent", "delivered", "read", "failed"] as const;
export type WhatsappMessageStatus = typeof whatsappMessageStatusEnum[number];

// Outbound + inbound message/delivery log. Mirrors pendingEmails' queue +
// webhook-driven status pattern (see server/services/EmailQueue.ts).
export const whatsappMessages = pgTable("whatsapp_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  customerId: varchar("customer_id").references(() => customers.id),
  direction: text("direction").notNull(),
  waMessageId: text("wa_message_id"),
  toPhoneE164: text("to_phone_e164"),
  fromPhoneE164: text("from_phone_e164"),
  messageType: text("message_type").notNull(),
  templateName: text("template_name"),
  templateVariables: jsonb("template_variables"),
  bodyText: text("body_text"),
  payload: jsonb("payload"),
  broadcastId: varchar("broadcast_id"),
  status: text("status").notNull().default("queued"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at").notNull().defaultNow(),
  sentAt: timestamp("sent_at"),
  deliveredAt: timestamp("delivered_at"),
  readAt: timestamp("read_at"),
  failedAt: timestamp("failed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  unique("whatsapp_messages_wa_message_id_unique").on(table.waMessageId),
  index("idx_whatsapp_messages_store_direction").on(table.storeId, table.direction, table.createdAt),
  index("idx_whatsapp_messages_broadcast").on(table.broadcastId),
]);

export const whatsappMessagesRelations = relations(whatsappMessages, ({ one }) => ({
  store: one(stores, {
    fields: [whatsappMessages.storeId],
    references: [stores.id],
  }),
  customer: one(customers, {
    fields: [whatsappMessages.customerId],
    references: [customers.id],
  }),
}));

export const insertWhatsappMessageSchema = createInsertSchema(whatsappMessages).omit({ id: true, createdAt: true });
export type InsertWhatsappMessage = z.infer<typeof insertWhatsappMessageSchema>;
export type WhatsappMessage = typeof whatsappMessages.$inferSelect;

export const whatsappConversationStateEnum = [
  "greeting",
  "awaiting_service_selection",
  "awaiting_preferred_time",
  "awaiting_confirmation",
  "completed",
  "abandoned",
] as const;
export type WhatsappConversationState = typeof whatsappConversationStateEnum[number];

// Session state for the inbound booking bot (WhatsAppBookingConversationEngine).
// Not a hard-unique (storeId, waPhoneE164) constraint - a fresh conversation
// starts after one completes/abandons, so lookups take the most recently
// updated non-terminal row.
export const whatsappConversations = pgTable("whatsapp_conversations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  customerId: varchar("customer_id").references(() => customers.id),
  waPhoneE164: text("wa_phone_e164").notNull(),
  state: text("state").notNull().default("greeting"),
  context: jsonb("context").notNull().default(sql`'{}'::jsonb`),
  lastInboundAt: timestamp("last_inbound_at").notNull().defaultNow(),
  lastOutboundAt: timestamp("last_outbound_at"),
  expiresAt: timestamp("expires_at").notNull(),
  resultingBookingId: varchar("resulting_booking_id").references(() => bookings.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("idx_whatsapp_conversations_store_phone").on(table.storeId, table.waPhoneE164, table.updatedAt),
]);

export const whatsappConversationsRelations = relations(whatsappConversations, ({ one }) => ({
  store: one(stores, {
    fields: [whatsappConversations.storeId],
    references: [stores.id],
  }),
  customer: one(customers, {
    fields: [whatsappConversations.customerId],
    references: [customers.id],
  }),
  resultingBooking: one(bookings, {
    fields: [whatsappConversations.resultingBookingId],
    references: [bookings.id],
  }),
}));

export const insertWhatsappConversationSchema = createInsertSchema(whatsappConversations).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWhatsappConversation = z.infer<typeof insertWhatsappConversationSchema>;
export type WhatsappConversation = typeof whatsappConversations.$inferSelect;

// Magic-link customer self-service, scoped to a single booking (not a
// general customer-auth system) - issued by the conversation engine on
// booking confirmation, sent back as a link in the WhatsApp confirmation
// message.
export const whatsappBookingAccessTokens = pgTable("whatsapp_booking_access_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bookingId: varchar("booking_id").notNull().references(() => bookings.id),
  customerId: varchar("customer_id").notNull().references(() => customers.id),
  token: text("token").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  unique("whatsapp_booking_access_tokens_token_unique").on(table.token),
]);

export const whatsappBookingAccessTokensRelations = relations(whatsappBookingAccessTokens, ({ one }) => ({
  booking: one(bookings, {
    fields: [whatsappBookingAccessTokens.bookingId],
    references: [bookings.id],
  }),
  customer: one(customers, {
    fields: [whatsappBookingAccessTokens.customerId],
    references: [customers.id],
  }),
}));

export const insertWhatsappBookingAccessTokenSchema = createInsertSchema(whatsappBookingAccessTokens).omit({ id: true, createdAt: true });
export type InsertWhatsappBookingAccessToken = z.infer<typeof insertWhatsappBookingAccessTokenSchema>;
export type WhatsappBookingAccessToken = typeof whatsappBookingAccessTokens.$inferSelect;

// ─── Phase 3: templates + broadcasts ───────────────────────────────────────

export const whatsappTemplateCategoryEnum = ["marketing", "utility", "authentication"] as const;
export type WhatsappTemplateCategory = typeof whatsappTemplateCategoryEnum[number];

export const whatsappTemplateStatusEnum = ["pending", "approved", "rejected", "disabled"] as const;
export type WhatsappTemplateStatus = typeof whatsappTemplateStatusEnum[number];

// Meta-approved template registry, per store (each store has its own WABA).
// Cloud API requires using one of these outside the 24h customer-service
// window - see server/services/WhatsAppService.ts's sendTemplateMessage.
export const whatsappTemplates = pgTable("whatsapp_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  metaTemplateName: text("meta_template_name").notNull(),
  metaTemplateId: text("meta_template_id"),
  category: text("category").notNull(),
  language: text("language").notNull().default("en_US"),
  bodyText: text("body_text").notNull(),
  variableCount: integer("variable_count").notNull().default(0),
  variableLabels: jsonb("variable_labels"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const whatsappTemplatesRelations = relations(whatsappTemplates, ({ one }) => ({
  store: one(stores, {
    fields: [whatsappTemplates.storeId],
    references: [stores.id],
  }),
}));

export const insertWhatsappTemplateSchema = createInsertSchema(whatsappTemplates).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWhatsappTemplate = z.infer<typeof insertWhatsappTemplateSchema>;
export type WhatsappTemplate = typeof whatsappTemplates.$inferSelect;

export const whatsappBroadcastStatusEnum = ["draft", "queued", "sending", "completed", "failed"] as const;
export type WhatsappBroadcastStatus = typeof whatsappBroadcastStatusEnum[number];

export const whatsappBroadcasts = pgTable("whatsapp_broadcasts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  createdByStaffId: varchar("created_by_staff_id"),
  name: text("name").notNull(),
  templateId: varchar("template_id").notNull().references(() => whatsappTemplates.id),
  variableMapping: jsonb("variable_mapping").notNull().default(sql`'{}'::jsonb`),
  status: text("status").notNull().default("draft"),
  scheduledAt: timestamp("scheduled_at"),
  totalRecipients: integer("total_recipients").notNull().default(0),
  sentCount: integer("sent_count").notNull().default(0),
  deliveredCount: integer("delivered_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const whatsappBroadcastsRelations = relations(whatsappBroadcasts, ({ one, many }) => ({
  store: one(stores, {
    fields: [whatsappBroadcasts.storeId],
    references: [stores.id],
  }),
  template: one(whatsappTemplates, {
    fields: [whatsappBroadcasts.templateId],
    references: [whatsappTemplates.id],
  }),
  recipients: many(whatsappBroadcastRecipients),
}));

export const insertWhatsappBroadcastSchema = createInsertSchema(whatsappBroadcasts).omit({ id: true, createdAt: true, completedAt: true, totalRecipients: true, sentCount: true, deliveredCount: true, failedCount: true });
export type InsertWhatsappBroadcast = z.infer<typeof insertWhatsappBroadcastSchema>;
export type WhatsappBroadcast = typeof whatsappBroadcasts.$inferSelect;

// Join table (not a jsonb array on whatsappBroadcasts) so per-recipient
// send/failure status is queryable for the staff progress view.
export const whatsappBroadcastRecipients = pgTable("whatsapp_broadcast_recipients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  broadcastId: varchar("broadcast_id").notNull().references(() => whatsappBroadcasts.id),
  customerId: varchar("customer_id").notNull().references(() => customers.id),
  whatsappMessageId: varchar("whatsapp_message_id").references(() => whatsappMessages.id),
  status: text("status").notNull().default("queued"),
}, (table) => [
  index("idx_whatsapp_broadcast_recipients_broadcast").on(table.broadcastId),
]);

export const whatsappBroadcastRecipientsRelations = relations(whatsappBroadcastRecipients, ({ one }) => ({
  broadcast: one(whatsappBroadcasts, {
    fields: [whatsappBroadcastRecipients.broadcastId],
    references: [whatsappBroadcasts.id],
  }),
  customer: one(customers, {
    fields: [whatsappBroadcastRecipients.customerId],
    references: [customers.id],
  }),
  message: one(whatsappMessages, {
    fields: [whatsappBroadcastRecipients.whatsappMessageId],
    references: [whatsappMessages.id],
  }),
}));

export const insertWhatsappBroadcastRecipientSchema = createInsertSchema(whatsappBroadcastRecipients).omit({ id: true });
export type InsertWhatsappBroadcastRecipient = z.infer<typeof insertWhatsappBroadcastRecipientSchema>;
export type WhatsappBroadcastRecipient = typeof whatsappBroadcastRecipients.$inferSelect;

// ─── Phase 4: consent / opt-in audit trail ─────────────────────────────────

export const whatsappOptInEventEnum = ["opt_in", "opt_out"] as const;
export type WhatsappOptInEvent = typeof whatsappOptInEventEnum[number];

export const whatsappOptInSourceEnum = ["inbound_message", "staff_manual", "broadcast_reply_stop"] as const;
export type WhatsappOptInSource = typeof whatsappOptInSourceEnum[number];

// Audit trail, not just a boolean flag - NDPA/GDPR benefit from a provable
// history of when/how consent was given or withdrawn. Broadcast targeting
// (server/repositories/BroadcastRepository.ts) filters against the latest
// event per customer server-side, never relying on UI filtering alone.
export const whatsappOptIns = pgTable("whatsapp_opt_ins", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  customerId: varchar("customer_id").notNull().references(() => customers.id),
  storeId: varchar("store_id").notNull().references(() => stores.id),
  event: text("event").notNull(),
  source: text("source").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("idx_whatsapp_opt_ins_customer").on(table.customerId, table.createdAt),
]);

export const whatsappOptInsRelations = relations(whatsappOptIns, ({ one }) => ({
  customer: one(customers, {
    fields: [whatsappOptIns.customerId],
    references: [customers.id],
  }),
  store: one(stores, {
    fields: [whatsappOptIns.storeId],
    references: [stores.id],
  }),
}));

export const insertWhatsappOptInSchema = createInsertSchema(whatsappOptIns).omit({ id: true, createdAt: true });
export type InsertWhatsappOptIn = z.infer<typeof insertWhatsappOptInSchema>;
export type WhatsappOptIn = typeof whatsappOptIns.$inferSelect;
