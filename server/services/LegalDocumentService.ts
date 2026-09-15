import crypto from "crypto";
import { LegalDocumentRepository } from "../repositories/LegalDocumentRepository";
import {
  type LegalDocument,
  type LegalDocumentVersion,
} from "@shared/schema";

export interface DocumentWithCurrentVersion {
  document: LegalDocument;
  version: LegalDocumentVersion;
}

export type CreateDocumentOutcome =
  | { kind: "created"; document: LegalDocument; version: LegalDocumentVersion }
  | { kind: "duplicate_type" };

export type DeleteDocumentOutcome =
  | { kind: "deleted" }
  | { kind: "not_found" }
  | { kind: "has_acceptances"; acceptanceCount: number };

export type RecordAcceptanceOutcome =
  | { kind: "recorded" }
  | { kind: "stale"; currentDocumentTypes: string[] };

/**
 * Owns the versioned-document + acceptance-ledger model behind the platform
 * Terms and Conditions / Privacy Policy / Data Usage Policy. Styled after
 * StaffContractService: one db-transaction-backed repository call per
 * multi-row write, sha256 content hashing at publish time, hash-pinned
 * acceptance rows.
 */
export class LegalDocumentService {
  private repo = new LegalDocumentRepository();

  // ─── Reads ──────────────────────────────────────────────────────────────

  /** Undefined for an unpublished, unknown, OR archived document - all three read as "not currently available" to a caller. */
  async getCurrentDocument(documentType: string): Promise<DocumentWithCurrentVersion | undefined> {
    const document = await this.repo.getByType(documentType);
    if (!document || document.archivedAt || !document.currentVersionId) return undefined;
    const version = await this.repo.getVersionById(document.currentVersionId);
    if (!version) return undefined;
    return { document, version };
  }

  /**
   * Every non-archived document/section, oldest first, with its current
   * version - for the public /api/legal listing and every signup/consent
   * screen. Not limited to the three seeded defaults - reflects whatever a
   * super admin has added via createDocument, and excludes whatever they've
   * archived via archiveDocument.
   */
  async listAllCurrent(): Promise<DocumentWithCurrentVersion[]> {
    const documents = await this.repo.getAllActive();
    const results: DocumentWithCurrentVersion[] = [];
    for (const document of documents) {
      if (!document.currentVersionId) continue;
      const version = await this.repo.getVersionById(document.currentVersionId);
      if (version) results.push({ document, version });
    }
    return results;
  }

  /** Same as listAllCurrent but includes archived documents too - the super-admin list view, so an archived section can still be reviewed or reactivated. */
  async listAllForAdmin(): Promise<DocumentWithCurrentVersion[]> {
    const documents = await this.repo.getAllIncludingArchived();
    const results: DocumentWithCurrentVersion[] = [];
    for (const document of documents) {
      if (!document.currentVersionId) continue;
      const version = await this.repo.getVersionById(document.currentVersionId);
      if (version) results.push({ document, version });
    }
    return results;
  }

  async getVersionHistory(documentType: string): Promise<Array<LegalDocumentVersion & { isCurrent: boolean }>> {
    const document = await this.repo.getByType(documentType);
    if (!document) return [];
    const versions = await this.repo.getAllVersions(document.id);
    return versions.map(v => ({ ...v, isCurrent: v.id === document.currentVersionId }));
  }

  // ─── Create / publish (super admin) ────────────────────────────────────

  /**
   * Adds a brand-new section beyond the three seeded defaults (Terms and
   * Conditions / Privacy Policy / Data Usage Policy) - e.g. a Cookie Policy
   * or a region-specific addendum. Every signup/login consent screen and the
   * public /api/legal listing picks it up automatically since they all read
   * from listAllCurrent/repo.getAll rather than a fixed set of types.
   */
  async createDocument(params: {
    documentType: string;
    title: string;
    contentMarkdown: string;
    adminId: string;
  }): Promise<CreateDocumentOutcome> {
    const existing = await this.repo.getByType(params.documentType);
    if (existing) {
      return { kind: "duplicate_type" };
    }

    const contentMarkdown = params.contentMarkdown.trim();
    const contentHash = this.hashText(contentMarkdown);

    const { document, version } = await this.repo.createDocument({
      documentType: params.documentType,
      title: params.title.trim(),
      contentMarkdown,
      contentHash,
      createdByAdminId: params.adminId,
    });

    return { kind: "created", document, version };
  }

  async publishNewVersion(params: {
    documentType: string;
    title?: string;
    contentMarkdown: string;
    adminId: string;
  }): Promise<DocumentWithCurrentVersion> {
    const document = await this.repo.getByType(params.documentType);
    if (!document) {
      throw new Error(`Unknown legal document type: ${params.documentType}`);
    }

    const contentMarkdown = params.contentMarkdown.trim();
    const contentHash = this.hashText(contentMarkdown);

    const { document: updated, version } = await this.repo.addNewVersion({
      document,
      contentMarkdown,
      contentHash,
      createdByAdminId: params.adminId,
    });

    // Publishing a new version deliberately does NOT touch existing
    // acceptance rows - they simply stop matching updated.currentVersionId,
    // which is exactly what makes hasAcceptedCurrentDocuments below treat
    // every previously-consented account as stale again.
    return { document: updated, version };
  }

  // ─── Deactivate / reactivate / delete (super admin) ────────────────────

  /**
   * Deactivates a document/section - it immediately stops being required
   * (listAllCurrent/hasAcceptedCurrentDocuments no longer see it, so nobody
   * is asked to accept it going forward) and its public read/consent-screen
   * links stop resolving, but every version and every acceptance ever
   * recorded against it is kept, unlike deleteDocument below.
   */
  async archiveDocument(documentType: string): Promise<LegalDocument | undefined> {
    const document = await this.repo.getByType(documentType);
    if (!document) return undefined;
    return this.repo.archiveDocument(document.id);
  }

  async reactivateDocument(documentType: string): Promise<LegalDocument | undefined> {
    const document = await this.repo.getByType(documentType);
    if (!document) return undefined;
    return this.repo.reactivateDocument(document.id);
  }

  /**
   * Permanently removes a document and its version history - only when
   * nobody has ever accepted it (a mistaken addition, not a real policy).
   * Once even one acceptance row references it, archiveDocument is the only
   * option: legal_document_acceptances is meant to be a permanent record,
   * and deleting the document/version rows it references would corrupt it.
   */
  async deleteDocument(documentType: string): Promise<DeleteDocumentOutcome> {
    const document = await this.repo.getByType(documentType);
    if (!document) return { kind: "not_found" };

    const acceptanceCount = await this.repo.countAcceptances(document.id);
    if (acceptanceCount > 0) {
      return { kind: "has_acceptances", acceptanceCount };
    }

    await this.repo.deleteDocument(document.id);
    return { kind: "deleted" };
  }

  // ─── Acceptance ─────────────────────────────────────────────────────────

  /** Sorted list of every currently-active document type - what a client's claimed acceptedDocumentTypes must exactly match. Cheap: reuses listAllCurrent. */
  async getCurrentDocumentTypes(): Promise<string[]> {
    const current = await this.listAllCurrent();
    return current.map(c => c.document.documentType).sort();
  }

  /**
   * Records one consent action against every current document, hash-pinned
   * to whichever version is current for each at this moment - the same
   * "content_hash_at_signing" rationale as staff contracts. Used by signup,
   * the retroactive login gate, and staff first-activation.
   *
   * Requires the caller to state exactly which document types it actually
   * presented to the user and got checked (acceptedDocumentTypes) - and
   * refuses to record anything unless that set exactly matches what's
   * current right now. Without this, a document archived/reactivated/added
   * between the consent screen loading and the user submitting would get
   * silently recorded as accepted (or a newly-required one silently
   * skipped) even though the user never saw it - this was a real bug, not
   * hypothetical: an admin toggling a section's archive state mid-session
   * caused exactly this. The actual hash-pinning still comes from the
   * server's own current lookup, never from anything client-supplied, so
   * this can't be used to fabricate acceptance of stale content either.
   */
  async recordAcceptance(params: {
    userId: string;
    organisationId: string | null;
    ipAddress: string;
    userAgent: string;
    acceptedDocumentTypes: string[];
  }): Promise<RecordAcceptanceOutcome> {
    const current = await this.listAllCurrent();
    const currentTypes = current.map(c => c.document.documentType).sort();
    const providedTypes = Array.from(new Set(params.acceptedDocumentTypes)).sort();
    const matches = currentTypes.length === providedTypes.length
      && currentTypes.every((t, i) => t === providedTypes[i]);

    if (!matches) {
      return { kind: "stale", currentDocumentTypes: currentTypes };
    }

    await this.repo.recordAcceptance({
      userId: params.userId,
      organisationId: params.organisationId,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      documents: current.map(c => ({
        documentId: c.document.id,
        documentVersionId: c.version.id,
        contentHash: c.version.contentHash,
      })),
    });
    return { kind: "recorded" };
  }

  /**
   * True only if this user has an acceptance row, for every document/section
   * that currently exists, pointing at that document's *current* version.
   * Publishing a new version repoints currentVersionId, which makes every
   * prior acceptance stale without touching the acceptance rows themselves
   * - that's the whole re-consent mechanism. Adding a new section works the
   * same way: nobody has an acceptance row for it yet, so every existing
   * user is asked to accept it too on their next login.
   */
  async hasAcceptedCurrentDocuments(userId: string): Promise<boolean> {
    const [current, latestAcceptances] = await Promise.all([
      this.listAllCurrent(),
      this.repo.getLatestAcceptancesByUser(userId),
    ]);
    if (current.length === 0) {
      // No document has a published version yet (shouldn't happen once the
      // seed migration has run) - fail open rather than lock everyone out.
      return true;
    }
    const acceptedVersionByDocument = new Map(latestAcceptances.map(a => [a.documentId, a.documentVersionId]));
    return current.every(c => acceptedVersionByDocument.get(c.document.id) === c.version.id);
  }

  private hashText(text: string): string {
    return crypto.createHash("sha256").update(text, "utf8").digest("hex");
  }
}

export const legalDocumentService = new LegalDocumentService();
