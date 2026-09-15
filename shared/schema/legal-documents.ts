import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, boolean, integer, timestamp, unique, index } from "drizzle-orm/pg-core";
import { z } from "zod";
import { users } from "./auth";
import { organisations } from "./organisations";
import { superAdmins } from "./super-admin";

// See migrations/0055_legal_documents_consent.sql for the full rationale.
// Modeled directly on shared/schema/staff-contracts.ts: versioned immutable
// content + a content_hash integrity anchor + an append-only acceptance
// ledger. The difference from staff contracts is that these documents are
// global (one row per document type, not per-staff-member), and a single
// consent action accepts every currently-published document at once.
//
// documentType was never DB-constrained to exactly these three - it's a
// plain unique text column - so a super admin can add further sections
// beyond the three seeded defaults (LegalDocumentService.createDocument).
// This tuple is kept only as the set the seed migration provisions and a
// sensible default for LegalDocumentType typing; nothing in the runtime
// enforces documentType is limited to it.
export const legalDocumentTypeEnum = ["terms_and_conditions", "privacy_policy", "data_usage_policy"] as const;
export type LegalDocumentType = typeof legalDocumentTypeEnum[number];

// A super-admin-authored slug for a newly added section: lowercase snake_case,
// 2-50 chars, matching the shape of the three seeded document_type values.
export const legalDocumentSlugSchema = z.string()
  .trim()
  .min(2, "Must be at least 2 characters")
  .max(50, "Must be 50 characters or fewer")
  .regex(/^[a-z][a-z0-9_]*$/, "Use lowercase letters, numbers, and underscores only, starting with a letter");

// One row per document type/section. Extra sections beyond the three seeded
// by the migration are created via LegalDocumentService.createDocument.
// current_version_id is a pointer rather than "whatever the latest version
// is" so publishing a new version is an atomic repoint, exactly like
// staffContracts.currentVersionId.
export const legalDocuments = pgTable("legal_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  documentType: text("document_type").notNull().unique(), // slug - terms_and_conditions | privacy_policy | data_usage_policy | any admin-added section
  title: text("title").notNull(),
  currentVersionId: varchar("current_version_id"),
  // Deactivation, not deletion - see migrations/0056_legal_documents_archive.sql.
  // An archived document is excluded from listAllCurrent/
  // hasAcceptedCurrentDocuments and the public /api/legal reads, but its
  // versions and every acceptance ever recorded against it are kept intact.
  archivedAt: timestamp("archived_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Immutable content history - a row here is written once and never UPDATEd.
// Publishing a replacement means: insert a new version, stamp the old one's
// supersededAt, repoint legalDocuments.currentVersionId - all in one
// transaction. See LegalDocumentService.publishNewVersion.
export const legalDocumentVersions = pgTable("legal_document_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  documentId: varchar("document_id").notNull().references(() => legalDocuments.id),
  versionNumber: integer("version_number").notNull(),
  contentMarkdown: text("content_markdown").notNull(),
  contentHash: text("content_hash").notNull(), // sha256 of the exact markdown shown - the immutability anchor
  // Nullable: the migration's seed v1 row has no real admin author.
  createdByAdminId: varchar("created_by_admin_id").references(() => superAdmins.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  supersededAt: timestamp("superseded_at"),
}, (table) => [
  unique("legal_document_versions_document_version_unique").on(table.documentId, table.versionNumber),
  index("idx_legal_document_versions_document").on(table.documentId),
]);

// Append-only audit record of an acceptance event. No update/delete path is
// ever exposed from application code. One row per document type per
// acceptance event - a single consent action (signup, retroactive login
// gate, staff activation) writes one row per document, all sharing the same
// acceptedAt/ip/userAgent, each hash-pinned to that document's current
// version at the moment of acceptance.
export const legalDocumentAcceptances = pgTable("legal_document_acceptances", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  documentId: varchar("document_id").notNull().references(() => legalDocuments.id),
  documentVersionId: varchar("document_version_id").notNull().references(() => legalDocumentVersions.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  organisationId: varchar("organisation_id").references(() => organisations.id),
  ipAddress: text("ip_address").notNull(),
  userAgent: text("user_agent").notNull(),
  contentHashAtAcceptance: text("content_hash_at_acceptance").notNull(),
  acceptedAt: timestamp("accepted_at").notNull().defaultNow(),
}, (table) => [
  index("idx_legal_document_acceptances_user").on(table.userId),
  index("idx_legal_document_acceptances_document").on(table.documentId),
]);

export const legalDocumentsRelations = relations(legalDocuments, ({ one, many }) => ({
  currentVersion: one(legalDocumentVersions, {
    fields: [legalDocuments.currentVersionId],
    references: [legalDocumentVersions.id],
  }),
  versions: many(legalDocumentVersions),
}));

export const legalDocumentVersionsRelations = relations(legalDocumentVersions, ({ one }) => ({
  document: one(legalDocuments, {
    fields: [legalDocumentVersions.documentId],
    references: [legalDocuments.id],
  }),
}));

export const legalDocumentAcceptancesRelations = relations(legalDocumentAcceptances, ({ one }) => ({
  document: one(legalDocuments, {
    fields: [legalDocumentAcceptances.documentId],
    references: [legalDocuments.id],
  }),
  version: one(legalDocumentVersions, {
    fields: [legalDocumentAcceptances.documentVersionId],
    references: [legalDocumentVersions.id],
  }),
}));

export type LegalDocument = typeof legalDocuments.$inferSelect;
export type InsertLegalDocument = typeof legalDocuments.$inferInsert;
export type LegalDocumentVersion = typeof legalDocumentVersions.$inferSelect;
export type InsertLegalDocumentVersion = typeof legalDocumentVersions.$inferInsert;
export type LegalDocumentAcceptance = typeof legalDocumentAcceptances.$inferSelect;
export type InsertLegalDocumentAcceptance = typeof legalDocumentAcceptances.$inferInsert;

// ─── API input schemas ──────────────────────────────────────────────────────

// What a super admin submits to publish a new version, from
// PUT /api/admin/legal-documents/:type.
export const publishLegalDocumentVersionSchema = z.object({
  title: z.string().trim().min(1).optional(),
  contentMarkdown: z.string().trim().min(1, "Document content is required"),
});
export type PublishLegalDocumentVersionInput = z.infer<typeof publishLegalDocumentVersionSchema>;

// What a super admin submits to add a brand-new section, from
// POST /api/admin/legal-documents.
export const createLegalDocumentSchema = z.object({
  documentType: legalDocumentSlugSchema,
  title: z.string().trim().min(1, "Title is required"),
  contentMarkdown: z.string().trim().min(1, "Document content is required"),
});
export type CreateLegalDocumentInput = z.infer<typeof createLegalDocumentSchema>;

// What the login-flow consent screen submits, mirroring signContractSchema's
// shape in shared/schema/staff-contracts.ts. Deliberately doesn't name
// specific documents - see the equivalent comment on signupSchema.acceptedLegalTerms
// in shared/schema/auth.ts.
export const acceptLegalConsentSchema = z.object({
  affirmedReadAndAgree: z.literal(true, {
    errorMap: () => ({ message: "You must confirm you have read and agree to our current legal documents" }),
  }),
  // See the matching field on signupSchema in shared/schema/auth.ts - same
  // server-side exact-match validation against what's current at submission
  // time (LegalDocumentService.recordAcceptance).
  acceptedDocumentTypes: z.array(z.string().min(1)).min(1, "You must confirm you have read and agree to our current legal documents"),
});
export type AcceptLegalConsentInput = z.infer<typeof acceptLegalConsentSchema>;
