import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, boolean, integer, timestamp, unique, index } from "drizzle-orm/pg-core";
import { z } from "zod";
import { staff } from "./staff";
import { users } from "./auth";

// See migrations/0046_staff_contract_signing.sql for the full rationale.
export const contractStatusEnum = ["pending_signature", "signed", "declined"] as const;
export type ContractStatus = typeof contractStatusEnum[number];

// The manager-facing projection surfaced alongside staffInviteStatusEnum
// (shared/schema/staff.ts). "none" covers both "no contract was ever
// attached" and "staff created before this feature shipped" - both are
// structurally the same thing (no staff_contracts row), and both mean the
// signature gate is a no-op for this staff member.
export const staffContractStatusEnum = ["none", "pending_signature", "signed", "declined", "not_applicable_existing_account"] as const;
export type StaffContractStatus = typeof staffContractStatusEnum[number];

export const contractTypeEnum = ["file", "image", "text"] as const;
export type ContractType = typeof contractTypeEnum[number];

// One row per staff member. current_version_id is a pointer rather than
// "whatever the latest version is" so a future contract-amendment feature
// (a raise, a policy update) can insert version N+1 and flip status back to
// pending_signature without any schema change.
export const staffContracts = pgTable("staff_contracts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  staffId: varchar("staff_id").notNull().unique().references(() => staff.id),
  currentVersionId: varchar("current_version_id"),
  status: text("status").notNull().default("pending_signature"), // pending_signature | signed | declined
  declinedAt: timestamp("declined_at"),
  declinedReason: text("declined_reason"),
  declinedIp: text("declined_ip"),
  declinedUserAgent: text("declined_user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("idx_staff_contracts_status").on(table.status),
]);

// Immutable content history - a row here is written once and never UPDATEd.
// Replacing a not-yet-signed contract means: insert a new version, stamp the
// old one's supersededAt, repoint staff_contracts.currentVersionId - all in
// one transaction. See StaffContractService.attachContract.
export const staffContractVersions = pgTable("staff_contract_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  staffContractId: varchar("staff_contract_id").notNull().references(() => staffContracts.id),
  versionNumber: integer("version_number").notNull(),
  contractType: text("contract_type").notNull(), // file | image | text
  storageKey: text("storage_key"), // S3 object key; file/image only
  fileMimeType: text("file_mime_type"),
  fileSizeBytes: integer("file_size_bytes"),
  fileOriginalName: text("file_original_name"),
  contentText: text("content_text"), // plain text only; text contracts only - no HTML, so no sanitizer is needed
  altText: text("alt_text"), // accessibility text, required (app-enforced) for image contracts
  contentHash: text("content_hash").notNull(), // sha256 of the exact bytes/text shown - the immutability anchor
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  supersededAt: timestamp("superseded_at"),
}, (table) => [
  unique("staff_contract_versions_contract_version_unique").on(table.staffContractId, table.versionNumber),
  index("idx_staff_contract_versions_contract").on(table.staffContractId),
]);

// Append-only audit record of the actual signing event. No update/delete
// path is ever exposed from application code.
export const staffContractSignatures = pgTable("staff_contract_signatures", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  staffContractId: varchar("staff_contract_id").notNull().references(() => staffContracts.id),
  staffContractVersionId: varchar("staff_contract_version_id").notNull().references(() => staffContractVersions.id),
  staffId: varchar("staff_id").notNull().references(() => staff.id), // denormalized, avoids a join for common queries
  userId: varchar("user_id").notNull().references(() => users.id), // who actually signed
  typedFullName: text("typed_full_name").notNull(),
  affirmedReadAndAgree: boolean("affirmed_read_and_agree").notNull(),
  consentedElectronicSignature: boolean("consented_electronic_signature").notNull(),
  ipAddress: text("ip_address").notNull(),
  userAgent: text("user_agent").notNull(),
  contentHashAtSigning: text("content_hash_at_signing").notNull(),
  signedAt: timestamp("signed_at").notNull().defaultNow(),
}, (table) => [
  index("idx_staff_contract_signatures_staff").on(table.staffId),
]);

export const staffContractsRelations = relations(staffContracts, ({ one, many }) => ({
  staff: one(staff, {
    fields: [staffContracts.staffId],
    references: [staff.id],
  }),
  currentVersion: one(staffContractVersions, {
    fields: [staffContracts.currentVersionId],
    references: [staffContractVersions.id],
  }),
  versions: many(staffContractVersions),
}));

export const staffContractVersionsRelations = relations(staffContractVersions, ({ one }) => ({
  contract: one(staffContracts, {
    fields: [staffContractVersions.staffContractId],
    references: [staffContracts.id],
  }),
}));

export const staffContractSignaturesRelations = relations(staffContractSignatures, ({ one }) => ({
  contract: one(staffContracts, {
    fields: [staffContractSignatures.staffContractId],
    references: [staffContracts.id],
  }),
  version: one(staffContractVersions, {
    fields: [staffContractSignatures.staffContractVersionId],
    references: [staffContractVersions.id],
  }),
}));

export type StaffContract = typeof staffContracts.$inferSelect;
export type InsertStaffContract = typeof staffContracts.$inferInsert;
export type StaffContractVersion = typeof staffContractVersions.$inferSelect;
export type InsertStaffContractVersion = typeof staffContractVersions.$inferInsert;
export type StaffContractSignature = typeof staffContractSignatures.$inferSelect;
export type InsertStaffContractSignature = typeof staffContractSignatures.$inferInsert;

// ─── API input schemas ──────────────────────────────────────────────────────

// What a manager submits to attach/replace a contract, from POST /api/staff
// and POST /api/staff/:id/contract. storageKey-bearing fields are only
// present after the presigned-upload step (server/lib/objectStorage.ts).
export const attachContractSchema = z.discriminatedUnion("contractType", [
  z.object({
    contractType: z.literal("text"),
    contentText: z.string().trim().min(1, "Contract text is required"),
  }),
  z.object({
    contractType: z.literal("file"),
    storageKey: z.string().min(1),
    fileMimeType: z.string().min(1),
    fileSizeBytes: z.number().int().positive(),
    fileOriginalName: z.string().min(1),
  }),
  z.object({
    contractType: z.literal("image"),
    storageKey: z.string().min(1),
    fileMimeType: z.string().min(1),
    fileSizeBytes: z.number().int().positive(),
    fileOriginalName: z.string().min(1),
    altText: z.string().trim().min(1, "Alt text is required for image contracts so they remain accessible"),
  }),
]);
export type AttachContractInput = z.infer<typeof attachContractSchema>;

export const signContractSchema = z.object({
  typedFullName: z.string().trim().min(1, "Type your full name to sign"),
  affirmedReadAndAgree: z.literal(true, {
    errorMap: () => ({ message: "You must confirm you have read and agree to the contract" }),
  }),
  consentedElectronicSignature: z.literal(true, {
    errorMap: () => ({ message: "You must consent to sign and receive documents electronically" }),
  }),
});
export type SignContractInput = z.infer<typeof signContractSchema>;

export const declineContractSchema = z.object({
  reason: z.string().trim().max(2000).optional(),
});
export type DeclineContractInput = z.infer<typeof declineContractSchema>;

// Allow-listed upload types for the file/image path. Kept here (rather than
// only in objectStorage.ts) so the client and the attach-contract validation
// consult the exact same list.
export const ALLOWED_CONTRACT_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;
export const MAX_CONTRACT_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
