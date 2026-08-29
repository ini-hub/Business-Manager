import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

// ── Persistent Email Queue ──────────────────────────────────────────────────
export const pendingEmails = pgTable("pending_emails", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  to: text("to").notNull(),
  subject: text("subject").notNull(),
  html: text("html").notNull(),
  replyTo: text("reply_to"), // set so a human can just hit reply (e.g. support-request emails reply-to the tenant)
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at").notNull().defaultNow(),
  status: text("status").notNull().default("pending"), // 'pending' | 'sent' | 'failed'
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type PendingEmail = typeof pendingEmails.$inferSelect;
export type InsertPendingEmail = typeof pendingEmails.$inferInsert;

// ── Application Audit Logs ──────────────────────────────────────────────────
// Append-only event log for every state-changing action across the app.
// Mutation is blocked at the DB level (see migrations/0014_audit_logs_append_only.sql)
// except for the narrow PII-redaction path guarded by redactedAt/redactedByUserId.
export const auditLogChannelEnum = ["web", "api", "import", "system", "admin"] as const;
export type AuditLogChannel = typeof auditLogChannelEnum[number];

export const auditLogs = pgTable("audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  action: text("action").notNull(),
  resource: text("resource").notNull(),
  resourceId: text("resource_id"),
  userId: text("user_id"),
  ip: text("ip"),
  status: text("status").notNull(), // 'success' | 'failure'
  errorMessage: text("error_message"),
  details: jsonb("details"),

  // Actor identity, snapshotted at time of action (names/roles can change later)
  actorRole: text("actor_role"),
  actorName: text("actor_name"),
  actorEmail: text("actor_email"),

  // Tenant/store scoping — avoids the fragile join-through-users used before this column existed
  businessId: text("business_id"),
  storeId: text("store_id"),

  // Before/after — full row snapshots, not a field-diff map (see design plan for rationale)
  previousValues: jsonb("previous_values"),
  newValues: jsonb("new_values"),
  changedFields: text("changed_fields").array(),

  // Origin / "from where"
  userAgent: text("user_agent"),
  channel: text("channel").notNull().default("web"), // 'web' | 'api' | 'import' | 'system' | 'admin'

  // Correlation — groups bulk fan-out / CSV import rows together
  batchId: varchar("batch_id"),

  // Narrow redaction path — the ONLY mutation the append-only trigger permits
  redactedAt: timestamp("redacted_at"),
  redactedByUserId: text("redacted_by_user_id"),
});

export type AuditLog = typeof auditLogs.$inferSelect;

// ── Audit Log Batches ────────────────────────────────────────────────────────
// Correlates a bulk fan-out action or CSV import into one reviewable unit.
// Individual audit_logs rows point back here via batchId.
export const auditLogBatchKindEnum = [
  "bulk_delete",
  "bulk_archive",
  "bulk_restore",
  "bulk_update",
  "csv_import_staff",
  "csv_import_expense",
  "csv_import_vendor",
] as const;
export type AuditLogBatchKind = typeof auditLogBatchKindEnum[number];

export const auditLogBatches = pgTable("audit_log_batches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessId: text("business_id").notNull(),
  initiatedBy: text("initiated_by"),
  kind: text("kind").notNull(), // see auditLogBatchKindEnum
  label: text("label"), // human-readable summary, e.g. "Bulk delete: 40 inventory items"
  totalCount: integer("total_count").notNull().default(0),
  successCount: integer("success_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  details: jsonb("details"), // e.g. rejected-row errors from a CSV import
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});

export type AuditLogBatch = typeof auditLogBatches.$inferSelect;
export type InsertAuditLogBatch = typeof auditLogBatches.$inferInsert;
