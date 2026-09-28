import { eq, and } from "drizzle-orm";
import { db } from "../db";
import { objectStorage } from "../lib/objectStorage";
import {
  hrDocumentFolders,
  hrDocuments,
  ALLOWED_HR_DOCUMENT_MIME_TYPES,
  MAX_HR_DOCUMENT_FILE_SIZE_BYTES,
  type HrDocumentFolder,
  type HrDocument,
  type AttachHrDocumentInput,
  type CreateHrDocumentFolderInput,
} from "@shared/schema";

export type AttachOutcome = { kind: "attached"; document: HrDocument } | { kind: "invalid"; reason: string };

/** Reuses the presigned-S3-URL pattern from StaffContractService - see server/lib/objectStorage.ts. */
export class HrDocumentService {
  async listFolders(businessId: string): Promise<HrDocumentFolder[]> {
    return db.select().from(hrDocumentFolders)
      .where(and(eq(hrDocumentFolders.businessId, businessId), eq(hrDocumentFolders.isEnabled, true)))
      .orderBy(hrDocumentFolders.sortOrder);
  }

  async createFolder(businessId: string, input: CreateHrDocumentFolderInput): Promise<HrDocumentFolder | { error: string }> {
    const existing = await db.select().from(hrDocumentFolders).where(eq(hrDocumentFolders.businessId, businessId));
    if (existing.some((f) => f.key === input.key)) {
      return { error: `A folder with key "${input.key}" already exists.` };
    }
    const [row] = await db.insert(hrDocumentFolders).values({
      businessId, key: input.key, label: input.label, isSystemFolder: false, sortOrder: existing.length,
    }).returning();
    return row;
  }

  async listDocuments(staffId: string, folderId?: string): Promise<HrDocument[]> {
    const conditions = folderId ? and(eq(hrDocuments.staffId, staffId), eq(hrDocuments.folderId, folderId)) : eq(hrDocuments.staffId, staffId);
    return db.select().from(hrDocuments).where(conditions);
  }

  async attach(params: { staffId: string; uploadedByUserId: string; input: AttachHrDocumentInput }): Promise<AttachOutcome> {
    const { staffId, uploadedByUserId, input } = params;
    if (!ALLOWED_HR_DOCUMENT_MIME_TYPES.includes(input.fileMimeType as any)) {
      return { kind: "invalid", reason: `File type ${input.fileMimeType} is not allowed.` };
    }
    if (input.fileSizeBytes > MAX_HR_DOCUMENT_FILE_SIZE_BYTES) {
      return { kind: "invalid", reason: "File is larger than the 10 MB limit." };
    }
    let meta;
    try {
      meta = await objectStorage.headObject(input.storageKey);
    } catch {
      return { kind: "invalid", reason: "Could not find the uploaded file. Please upload it again." };
    }
    const [document] = await db.insert(hrDocuments).values({
      staffId,
      folderId: input.folderId,
      fileName: input.fileName,
      storageKey: input.storageKey,
      fileMimeType: meta.contentType || input.fileMimeType,
      fileSizeBytes: meta.contentLength ?? input.fileSizeBytes,
      uploadedByUserId,
    }).returning();
    return { kind: "attached", document };
  }

  async getSignedDownloadUrl(storageKey: string): Promise<string> {
    return objectStorage.getSignedGetUrl(storageKey);
  }

  async remove(staffId: string, documentId: string): Promise<boolean> {
    const deleted = await db.delete(hrDocuments)
      .where(and(eq(hrDocuments.id, documentId), eq(hrDocuments.staffId, staffId)))
      .returning({ id: hrDocuments.id });
    return deleted.length > 0;
  }
}

export const hrDocumentService = new HrDocumentService();
