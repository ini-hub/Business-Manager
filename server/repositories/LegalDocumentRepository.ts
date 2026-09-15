import { db } from "../db";
import { eq, asc, desc, isNull, sql } from "drizzle-orm";
import {
  legalDocuments,
  legalDocumentVersions,
  legalDocumentAcceptances,
  type LegalDocument,
  type LegalDocumentVersion,
  type LegalDocumentAcceptance,
} from "@shared/schema";

export class LegalDocumentRepository {
  async getByType(documentType: string): Promise<LegalDocument | undefined> {
    const [row] = await db.select().from(legalDocuments).where(eq(legalDocuments.documentType, documentType));
    return row;
  }

  /**
   * Every non-archived document/section, oldest first (the three seeded
   * defaults, then whatever a super admin has added since) - for the public
   * /api/legal listing, every consent screen, and the recordAcceptance
   * fan-out. Not limited to a fixed set of types - a super admin can add
   * further sections via createDocument below, and remove one from this set
   * entirely via archiveDocument without deleting its history.
   */
  async getAllActive(): Promise<LegalDocument[]> {
    return db.select().from(legalDocuments).where(isNull(legalDocuments.archivedAt)).orderBy(asc(legalDocuments.createdAt));
  }

  /** Every document/section including archived ones - the super-admin list view, so an archived section can still be reviewed or reactivated. */
  async getAllIncludingArchived(): Promise<LegalDocument[]> {
    return db.select().from(legalDocuments).orderBy(asc(legalDocuments.createdAt));
  }

  /**
   * First-ever version for a brand-new document/section: creates the
   * aggregate row and version 1 in one transaction. Mirrors
   * StaffContractRepository.createContractWithFirstVersion. Callers must
   * have already confirmed documentType is available - the unique
   * constraint backs this up regardless.
   */
  async createDocument(params: {
    documentType: string;
    title: string;
    contentMarkdown: string;
    contentHash: string;
    createdByAdminId: string | null;
  }): Promise<{ document: LegalDocument; version: LegalDocumentVersion }> {
    return db.transaction(async (tx) => {
      const [document] = await tx.insert(legalDocuments).values({
        documentType: params.documentType,
        title: params.title,
      }).returning();

      const [version] = await tx.insert(legalDocumentVersions).values({
        documentId: document.id,
        versionNumber: 1,
        contentMarkdown: params.contentMarkdown,
        contentHash: params.contentHash,
        createdByAdminId: params.createdByAdminId,
      }).returning();

      const [updated] = await tx.update(legalDocuments)
        .set({ currentVersionId: version.id, updatedAt: new Date() })
        .where(eq(legalDocuments.id, document.id))
        .returning();

      return { document: updated, version };
    });
  }

  /** Deactivates a document - excluded from getAllActive from this point on, but every version and acceptance row is left untouched. */
  async archiveDocument(documentId: string): Promise<LegalDocument> {
    const [document] = await db.update(legalDocuments)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(legalDocuments.id, documentId))
      .returning();
    return document;
  }

  async reactivateDocument(documentId: string): Promise<LegalDocument> {
    const [document] = await db.update(legalDocuments)
      .set({ archivedAt: null, updatedAt: new Date() })
      .where(eq(legalDocuments.id, documentId))
      .returning();
    return document;
  }

  /** How many acceptance rows exist for this document - a hard delete is only ever offered when this is zero (LegalDocumentService.deleteDocument). */
  async countAcceptances(documentId: string): Promise<number> {
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
      .from(legalDocumentAcceptances)
      .where(eq(legalDocumentAcceptances.documentId, documentId));
    return count;
  }

  /**
   * Permanently removes a document and every version of it. Only ever
   * called after LegalDocumentService.deleteDocument has confirmed
   * countAcceptances is zero - a document anyone has accepted must be
   * archived instead, never deleted, since legal_document_acceptances rows
   * reference its versions and are meant to be a permanent record.
   */
  async deleteDocument(documentId: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.update(legalDocuments).set({ currentVersionId: null }).where(eq(legalDocuments.id, documentId));
      await tx.delete(legalDocumentVersions).where(eq(legalDocumentVersions.documentId, documentId));
      await tx.delete(legalDocuments).where(eq(legalDocuments.id, documentId));
    });
  }

  async getVersionById(id: string): Promise<LegalDocumentVersion | undefined> {
    const [row] = await db.select().from(legalDocumentVersions).where(eq(legalDocumentVersions.id, id));
    return row;
  }

  /** Every version ever written for a document, newest first - the super-admin history view. */
  async getAllVersions(documentId: string): Promise<LegalDocumentVersion[]> {
    return db.select().from(legalDocumentVersions)
      .where(eq(legalDocumentVersions.documentId, documentId))
      .orderBy(desc(legalDocumentVersions.versionNumber));
  }

  /**
   * Publishes a new version: inserts version N+1, stamps the previous
   * current version's supersededAt, repoints currentVersionId - all in one
   * transaction. Never mutates an existing version's content. Mirrors
   * StaffContractRepository.addReplacementVersion.
   */
  async addNewVersion(params: {
    document: LegalDocument;
    contentMarkdown: string;
    contentHash: string;
    createdByAdminId: string | null;
  }): Promise<{ document: LegalDocument; version: LegalDocumentVersion }> {
    return db.transaction(async (tx) => {
      const [{ maxVersion }] = await tx
        .select({ maxVersion: legalDocumentVersions.versionNumber })
        .from(legalDocumentVersions)
        .where(eq(legalDocumentVersions.documentId, params.document.id))
        .orderBy(desc(legalDocumentVersions.versionNumber))
        .limit(1);

      if (params.document.currentVersionId) {
        await tx.update(legalDocumentVersions)
          .set({ supersededAt: new Date() })
          .where(eq(legalDocumentVersions.id, params.document.currentVersionId));
      }

      const [version] = await tx.insert(legalDocumentVersions).values({
        documentId: params.document.id,
        versionNumber: (maxVersion ?? 0) + 1,
        contentMarkdown: params.contentMarkdown,
        contentHash: params.contentHash,
        createdByAdminId: params.createdByAdminId,
      }).returning();

      const [document] = await tx.update(legalDocuments)
        .set({ currentVersionId: version.id, updatedAt: new Date() })
        .where(eq(legalDocuments.id, params.document.id))
        .returning();

      return { document, version };
    });
  }

  /**
   * Writes one acceptance row per document, all sharing the same
   * acceptedAt/ip/userAgent - a single consent action. Each row is
   * hash-pinned to that document's current version at the moment of
   * acceptance, mirroring StaffContractRepository.recordSignature's
   * contentHashAtSigning.
   */
  async recordAcceptance(params: {
    userId: string;
    organisationId: string | null;
    ipAddress: string;
    userAgent: string;
    documents: Array<{ documentId: string; documentVersionId: string; contentHash: string }>;
  }): Promise<LegalDocumentAcceptance[]> {
    if (params.documents.length === 0) return [];
    return db.transaction(async (tx) => {
      const rows = await tx.insert(legalDocumentAcceptances).values(
        params.documents.map(d => ({
          documentId: d.documentId,
          documentVersionId: d.documentVersionId,
          userId: params.userId,
          organisationId: params.organisationId,
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
          contentHashAtAcceptance: d.contentHash,
        })),
      ).returning();
      return rows;
    });
  }

  /**
   * This user's latest acceptance row per document type, for the staleness
   * check in LegalDocumentService.hasAcceptedCurrentDocuments. One query,
   * newest-first, deduped in JS by documentId (first row seen per id wins).
   */
  async getLatestAcceptancesByUser(userId: string): Promise<LegalDocumentAcceptance[]> {
    const rows = await db.select().from(legalDocumentAcceptances)
      .where(eq(legalDocumentAcceptances.userId, userId))
      .orderBy(desc(legalDocumentAcceptances.acceptedAt));
    const seen = new Set<string>();
    const latest: LegalDocumentAcceptance[] = [];
    for (const row of rows) {
      if (seen.has(row.documentId)) continue;
      seen.add(row.documentId);
      latest.push(row);
    }
    return latest;
  }
}
