import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, boolean, unique, index } from "drizzle-orm/pg-core";
import { z } from "zod";
import { organisations } from "./organisations";
import { staff } from "./staff";
import { users } from "./auth";

// See migrations/0069_hr_documents.sql. Folders are a flat per-business
// configurable list (same pattern as customRoles/expenseCategories), not
// the dynamic field builder - there's no per-folder field schema.
export const hrDocumentFolders = pgTable("hr_document_folders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessId: varchar("business_id").notNull().references(() => organisations.id),
  key: text("key").notNull(),
  label: text("label").notNull(),
  isSystemFolder: boolean("is_system_folder").notNull().default(false),
  isEnabled: boolean("is_enabled").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
}, (table) => [
  unique("hr_document_folders_business_key_unique").on(table.businessId, table.key),
]);

export const hrDocuments = pgTable("hr_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  staffId: varchar("staff_id").notNull().references(() => staff.id),
  folderId: varchar("folder_id").notNull().references(() => hrDocumentFolders.id),
  fileName: text("file_name").notNull(),
  storageKey: text("storage_key").notNull(), // S3 object key
  fileMimeType: text("file_mime_type").notNull(),
  fileSizeBytes: integer("file_size_bytes").notNull(),
  uploadedByUserId: varchar("uploaded_by_user_id").notNull().references(() => users.id),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
}, (table) => [
  index("idx_hr_documents_staff_folder").on(table.staffId, table.folderId),
]);

export const hrDocumentFoldersRelations = relations(hrDocumentFolders, ({ many }) => ({
  documents: many(hrDocuments),
}));
export const hrDocumentsRelations = relations(hrDocuments, ({ one }) => ({
  staff: one(staff, { fields: [hrDocuments.staffId], references: [staff.id] }),
  folder: one(hrDocumentFolders, { fields: [hrDocuments.folderId], references: [hrDocumentFolders.id] }),
}));

export type HrDocumentFolder = typeof hrDocumentFolders.$inferSelect;
export type HrDocument = typeof hrDocuments.$inferSelect;

export const createHrDocumentFolderSchema = z.object({
  key: z.string().trim().min(1).regex(/^[a-z][a-z0-9_]*$/, "Use lowercase letters, numbers, and underscores only"),
  label: z.string().trim().min(1),
});
export type CreateHrDocumentFolderInput = z.infer<typeof createHrDocumentFolderSchema>;

export const attachHrDocumentSchema = z.object({
  folderId: z.string().min(1),
  fileName: z.string().trim().min(1),
  storageKey: z.string().min(1),
  fileMimeType: z.string().min(1),
  fileSizeBytes: z.number().int().positive(),
});
export type AttachHrDocumentInput = z.infer<typeof attachHrDocumentSchema>;

export const ALLOWED_HR_DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;
export const MAX_HR_DOCUMENT_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
