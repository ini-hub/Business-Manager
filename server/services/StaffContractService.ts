import crypto from "crypto";
import { storage } from "../storage";
import { StaffContractRepository } from "../repositories/StaffContractRepository";
import { objectStorage } from "../lib/objectStorage";
import { scanBuffer } from "../lib/malwareScan";
import { sendContractDeclinedEmail } from "../email";
import {
  ALLOWED_CONTRACT_MIME_TYPES,
  MAX_CONTRACT_FILE_SIZE_BYTES,
  type AttachContractInput,
  type StaffContract,
  type StaffContractVersion,
  type StaffContractSignature,
  type StaffContractStatus,
  type InsertStaffContractVersion,
} from "@shared/schema";

type NewVersionPayload = Omit<
  InsertStaffContractVersion,
  "id" | "staffContractId" | "versionNumber" | "createdByUserId" | "createdAt" | "supersededAt"
>;

type AttachContractOutcome =
  | { kind: "attached"; contract: StaffContract; version: StaffContractVersion }
  | { kind: "replaced"; contract: StaffContract; version: StaffContractVersion }
  | { kind: "amended"; contract: StaffContract; version: StaffContractVersion }
  | { kind: "refused_already_signed" }
  | { kind: "invalid"; reason: string };

type SignOutcome =
  | { kind: "signed"; contract: StaffContract; signature: StaffContractSignature }
  | { kind: "not_pending"; reason: string }
  | { kind: "name_mismatch"; reason: string }
  | { kind: "version_changed"; reason: string };

type DeclineOutcome =
  | { kind: "declined"; contract: StaffContract }
  | { kind: "not_pending"; reason: string }
  | { kind: "version_changed"; reason: string };

interface ContractForReview {
  contract: StaffContract;
  version: StaffContractVersion;
  /** Only present for file/image contracts. */
  signedGetUrl?: string;
}

/**
 * Owns the versioned-document + audit-trailed-signature model behind staff
 * onboarding contracts. Styled after StaffInviteService: outcome-union
 * returns instead of throwing for expected states, one db.transaction per
 * multi-row write (delegated to StaffContractRepository).
 */
/** Where /api/staff/contract-upload-url stages a business's uploads before they are attached. */
export function contractStagingPrefix(businessId: string): string {
  return `staff-contracts/pending/${businessId}/`;
}

type StaffContractStatusSelf = "pending_signature" | "signed" | "declined";

const VERSION_CHANGED_REASON = "Your manager updated this contract while you were reading it. Please review the latest version before continuing.";

class StaffContractService {
  private repo = new StaffContractRepository();

  // ─── Attach / replace ──────────────────────────────────────────────────────

  async attachContract(params: {
    staffId: string;
    /** The uploader's business: file/image keys must live under its staging prefix. */
    businessId: string;
    createdByUserId: string;
    input: AttachContractInput;
    /**
     * Explicit opt-in to amend an already-signed contract. The signed version
     * and its signature stay on record untouched; a new version is added and
     * the staff member must sign it. Without this a signed contract is refused.
     */
    amend?: boolean;
  }): Promise<AttachContractOutcome> {
    const { staffId, businessId, createdByUserId, input } = params;
    const existing = await this.repo.getByStaffId(staffId);

    if (existing && existing.status === "signed" && !params.amend) {
      // A signed contract is a completed legal record - replacing it must be
      // a deliberate amendment, never a silent overwrite.
      return { kind: "refused_already_signed" };
    }

    let versionPayload: NewVersionPayload;

    if (input.contractType === "text") {
      const contentText = input.contentText.trim();
      versionPayload = {
        contractType: "text",
        contentText,
        contentHash: this.hashText(contentText),
        storageKey: null,
        fileMimeType: null,
        fileSizeBytes: null,
        fileOriginalName: null,
        altText: null,
      };
    } else {
      // The key arrives from the client. Without this check a manager could
      // point a contract at (or, via the scan-failure cleanup below, delete)
      // another tenant's object. Must precede every storage call.
      const stagingPrefix = contractStagingPrefix(businessId);
      if (!input.storageKey.startsWith(stagingPrefix) || input.storageKey.split("/").includes("..")) {
        return { kind: "invalid", reason: "That upload doesn't belong to this business. Please upload the file again." };
      }

      if (!ALLOWED_CONTRACT_MIME_TYPES.includes(input.fileMimeType as any)) {
        return { kind: "invalid", reason: `File type ${input.fileMimeType} is not allowed.` };
      }
      if (input.fileSizeBytes > MAX_CONTRACT_FILE_SIZE_BYTES) {
        return { kind: "invalid", reason: "File is larger than the 10 MB limit." };
      }

      // Re-check the object's real metadata rather than trusting the client's
      // declared type/size - a browser can lie about Content-Type on the PUT.
      let meta;
      try {
        meta = await objectStorage.headObject(input.storageKey);
      } catch (error) {
        return { kind: "invalid", reason: "Could not find the uploaded file. Please upload it again." };
      }
      if (meta.contentType && !ALLOWED_CONTRACT_MIME_TYPES.includes(meta.contentType as any)) {
        return { kind: "invalid", reason: "Uploaded file type does not match an allowed contract type." };
      }
      if (meta.contentLength && meta.contentLength > MAX_CONTRACT_FILE_SIZE_BYTES) {
        return { kind: "invalid", reason: "File is larger than the 10 MB limit." };
      }

      // Scanned before this version is ever committed - a contract row must
      // never point at an unscanned or infected object. See
      // server/lib/malwareScan.ts.
      let fileBuffer: Buffer;
      try {
        fileBuffer = await objectStorage.getObjectBuffer(input.storageKey);
      } catch (error) {
        return { kind: "invalid", reason: "Could not read the uploaded file for scanning. Please upload it again." };
      }
      const scan = await scanBuffer(fileBuffer, input.fileOriginalName);
      if (!scan.clean) {
        await objectStorage.deleteObject(input.storageKey).catch(() => undefined);
        return { kind: "invalid", reason: "This file failed a security scan and cannot be attached. Please upload a different file." };
      }

      // The upload URL puts the file under a `pending/` staging prefix,
      // which a bucket lifecycle rule may expire as an abandoned-upload
      // cleanup. Once the file has passed validation and is about to become
      // a permanent contract record, relocate it out of that prefix so it
      // can't disappear out from under a staff member who hasn't signed yet.
      const permanentKey = input.storageKey.replace(/^staff-contracts\/pending\//, "staff-contracts/active/");
      if (permanentKey !== input.storageKey) {
        await objectStorage.copyObject(input.storageKey, permanentKey);
        await objectStorage.deleteObject(input.storageKey).catch(() => undefined);
      }

      versionPayload = {
        contractType: input.contractType,
        contentText: null,
        storageKey: permanentKey,
        fileMimeType: meta.contentType || input.fileMimeType,
        fileSizeBytes: meta.contentLength ?? input.fileSizeBytes,
        fileOriginalName: input.fileOriginalName,
        altText: input.contractType === "image" ? input.altText : null,
        contentHash: this.hashBytes(fileBuffer),
      };
    }

    if (!existing) {
      const { contract, version } = await this.repo.createContractWithFirstVersion({
        staffId,
        createdByUserId,
        version: versionPayload,
      });
      return { kind: "attached", contract, version };
    }

    const wasSigned = existing.status === "signed";
    const { contract, version } = await this.repo.addReplacementVersion({
      contract: existing,
      createdByUserId,
      version: versionPayload,
    });
    return { kind: wasSigned ? "amended" : "replaced", contract, version };
  }

  // ─── Lookups used by the auth flow (server/routes.ts) ───────────────────────

  async getContractByStaffId(staffId: string): Promise<StaffContract | undefined> {
    return this.repo.getByStaffId(staffId);
  }

  /** The contract only if it is genuinely still awaiting a signature. */
  async getPendingContract(staffId: string): Promise<StaffContract | undefined> {
    const contract = await this.repo.getByStaffId(staffId);
    return contract?.status === "pending_signature" ? contract : undefined;
  }

  /**
   * What a staff member is allowed to see of their own contract: only
   * versions they actually signed (a manager's unsigned draft or an
   * amendment awaiting signature is never exposed here), newest first.
   */
  async getSignedCopiesForStaff(staffId: string): Promise<{
    contractStatus: "none" | StaffContractStatusSelf;
    awaitingResignature: boolean;
    copies: Array<{
      versionNumber: number;
      isCurrent: boolean;
      contractType: string;
      contentText?: string | null;
      fileOriginalName?: string | null;
      altText?: string | null;
      signedGetUrl?: string;
      signedAt: Date;
      typedFullName: string;
      contentHash: string;
    }>;
  }> {
    const contract = await this.repo.getByStaffId(staffId);
    if (!contract) return { contractStatus: "none", awaitingResignature: false, copies: [] };

    const [versions, signatures] = await Promise.all([
      this.repo.getAllVersions(contract.id),
      this.repo.getSignaturesForContract(contract.id),
    ]);
    const versionById = new Map(versions.map(v => [v.id, v]));
    const copies = await Promise.all(signatures.map(async (sig) => {
      const v = versionById.get(sig.staffContractVersionId)!;
      return {
        versionNumber: v.versionNumber,
        isCurrent: v.id === contract.currentVersionId,
        contractType: v.contractType,
        contentText: v.contentText,
        fileOriginalName: v.fileOriginalName,
        altText: v.altText,
        signedGetUrl: v.storageKey ? await objectStorage.getSignedGetUrl(v.storageKey) : undefined,
        signedAt: sig.signedAt,
        typedFullName: sig.typedFullName,
        contentHash: sig.contentHashAtSigning,
      };
    }));
    copies.sort((a, b) => b.versionNumber - a.versionNumber);
    return {
      contractStatus: contract.status as StaffContractStatusSelf,
      awaitingResignature: await this.isAwaitingResignature(contract),
      copies,
    };
  }

  /**
   * True when a contract that was signed before is waiting for a fresh
   * signature (an amendment), as opposed to a first-time signature.
   */
  async isAwaitingResignature(contract: StaffContract): Promise<boolean> {
    if (contract.status !== "pending_signature") return false;
    return !!(await this.repo.getSignatureForContract(contract.id));
  }

  /** The append-only signature audit record, once one exists. */
  async getSignatureForContract(staffContractId: string): Promise<StaffContractSignature | undefined> {
    return this.repo.getSignatureForContract(staffContractId);
  }

  // ─── Review / sign / decline ────────────────────────────────────────────────

  async getContractForReview(staffContractId: string): Promise<ContractForReview | undefined> {
    const contract = await this.repo.getById(staffContractId);
    if (!contract?.currentVersionId) return undefined;
    const version = await this.repo.getVersionById(contract.currentVersionId);
    if (!version) return undefined;

    const signedGetUrl = version.storageKey
      ? await objectStorage.getSignedGetUrl(version.storageKey)
      : undefined;

    return { contract, version, signedGetUrl };
  }

  /**
   * Every version ever attached, newest first, for the manager-facing
   * history view on the staff edit page - the immutability that
   * attachContract/addReplacementVersion already guarantees (a replace never
   * mutates the row it supersedes) is what makes this a trustworthy audit
   * trail rather than just "whatever's current right now".
   */
  async getVersionHistory(staffContractId: string): Promise<Array<{
    id: string;
    versionNumber: number;
    contractType: string;
    createdAt: Date;
    supersededAt: Date | null;
    isCurrent: boolean;
    createdByName?: string;
    contentText?: string | null;
    fileOriginalName?: string | null;
    altText?: string | null;
    signedGetUrl?: string;
    signedAt?: Date;
    signedByName?: string;
  }>> {
    const contract = await this.repo.getById(staffContractId);
    if (!contract) return [];
    const [versions, signatures] = await Promise.all([
      this.repo.getAllVersions(staffContractId),
      this.repo.getSignaturesForContract(staffContractId),
    ]);
    const signatureByVersion = new Map(signatures.map(sig => [sig.staffContractVersionId, sig]));

    return Promise.all(versions.map(async (v) => {
      const [creator, signedGetUrl] = await Promise.all([
        storage.getUser(v.createdByUserId),
        v.storageKey ? objectStorage.getSignedGetUrl(v.storageKey) : Promise.resolve(undefined),
      ]);
      return {
        id: v.id,
        versionNumber: v.versionNumber,
        contractType: v.contractType,
        createdAt: v.createdAt,
        supersededAt: v.supersededAt,
        isCurrent: v.id === contract.currentVersionId,
        createdByName: creator?.name || creator?.email || undefined,
        contentText: v.contentText,
        fileOriginalName: v.fileOriginalName,
        altText: v.altText,
        signedGetUrl,
        signedAt: signatureByVersion.get(v.id)?.signedAt,
        signedByName: signatureByVersion.get(v.id)?.typedFullName,
      };
    }));
  }

  async sign(params: {
    staffContractId: string;
    /** The version the signer was shown; refused if it is no longer current. */
    versionId: string;
    staffId: string;
    userId: string;
    typedFullName: string;
    affirmedReadAndAgree: boolean;
    consentedElectronicSignature: boolean;
    ipAddress: string;
    userAgent: string;
  }): Promise<SignOutcome> {
    // Enforced here too, not just by the zod schema at the route boundary -
    // this is the actual legal-consent gate and must not be bypassable by a
    // caller that skips validation.
    if (!params.affirmedReadAndAgree || !params.consentedElectronicSignature) {
      return { kind: "not_pending", reason: "Both the read-and-agree and e-signature consent confirmations are required." };
    }

    // The typed signature must match staff.name - the name on record is now
    // exclusively manager/owner-controlled (set at staff creation, only
    // changeable via PATCH /api/staff/:id; see the comment in
    // POST /api/auth/set-activated-password for why this endpoint no longer
    // lets a staff member rename themselves). Without this check, anyone
    // holding a valid contract_pending session could type any name at all
    // and still be treated as having "signed" it.
    const signingStaff = await storage.getStaff(params.staffId);
    if (!signingStaff || !this.namesMatch(params.typedFullName, signingStaff.name)) {
      return {
        kind: "name_mismatch",
        reason: "The name you typed doesn't match the name on your staff record. Please type it exactly as your employer entered it, or ask your manager to correct it.",
      };
    }

    const contract = await this.repo.getById(params.staffContractId);
    if (!contract || contract.status !== "pending_signature" || !contract.currentVersionId) {
      return { kind: "not_pending", reason: "This contract is not awaiting a signature." };
    }
    if (contract.currentVersionId !== params.versionId) {
      return { kind: "version_changed", reason: VERSION_CHANGED_REASON };
    }
    const version = await this.repo.getVersionById(contract.currentVersionId);
    if (!version) return { kind: "not_pending", reason: "Contract content is missing." };

    const recorded = await this.repo.recordSignature({
      staffContractId: contract.id,
      staffContractVersionId: version.id,
      staffId: params.staffId,
      userId: params.userId,
      typedFullName: params.typedFullName,
      affirmedReadAndAgree: params.affirmedReadAndAgree,
      consentedElectronicSignature: params.consentedElectronicSignature,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      contentHashAtSigning: version.contentHash,
    });
    // Lost a race with a concurrent sign/decline/replacement.
    if (!recorded) return { kind: "not_pending", reason: "This contract is not awaiting a signature." };

    return { kind: "signed", contract: recorded.contract, signature: recorded.signature };
  }

  async decline(params: {
    staffContractId: string;
    versionId: string;
    staffName: string;
    businessName: string;
    inviterEmail?: string;
    inviterName?: string;
    reason?: string;
    ipAddress: string;
    userAgent: string;
  }): Promise<DeclineOutcome> {
    const contract = await this.repo.getById(params.staffContractId);
    if (!contract || contract.status !== "pending_signature") {
      return { kind: "not_pending", reason: "This contract is not awaiting a signature." };
    }
    if (contract.currentVersionId !== params.versionId) {
      return { kind: "version_changed", reason: VERSION_CHANGED_REASON };
    }

    const updated = await this.repo.recordDecline({
      staffContractId: contract.id,
      staffContractVersionId: contract.currentVersionId,
      reason: params.reason,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    });
    if (!updated) return { kind: "not_pending", reason: "This contract is not awaiting a signature." };

    if (params.inviterEmail) {
      try {
        await sendContractDeclinedEmail(
          params.inviterEmail,
          params.inviterName || "there",
          params.staffName,
          params.businessName,
          params.reason,
        );
      } catch (error) {
        console.error("[StaffContract] Failed to send decline notification:", error);
      }
    }

    return { kind: "declined", contract: updated };
  }

  // ─── Re-sign enforcement for already-active staff ──────────────────────────

  /**
   * Manager opt-in path into contract_pending for a staff member who
   * already has full access (checked "require signature" when attaching or
   * replacing a contract). Reuses the exact contract_pending machinery a
   * new hire goes through - login interception, the sign-contract screen,
   * decline handling, the resend-invite refusal - none of which need to
   * know or care how the member arrived there. A no-op (returns false) if
   * the member isn't currently 'active' (or finishing their profile after
   * having signed): someone still mid-onboarding already reaches
   * contract_pending naturally through set-activated-password.
   *
   * Deliberately does not touch anything in the caller's session - no
   * existing access-check in this app re-verifies organisation_members.
   * status per-request, so a JWT already issued keeps working until it
   * expires. This only changes what happens the next time they log in.
   */
  async requireSignatureForActiveMember(userId: string, organisationId: string): Promise<boolean> {
    const member = await storage.getOrganisationMember(userId, organisationId);
    // profile_pending is included so an amendment made while someone is
    // finishing their HR profile can't be skipped by completing the profile.
    if (member?.status !== "active" && member?.status !== "profile_pending") return false;
    await storage.updateOrganisationMemberStatus(member.id, "contract_pending");
    return true;
  }

  // ─── Status projection ──────────────────────────────────────────────────────

  /**
   * Extends the existing invite-status projection pattern (StaffInviteService.
   * computeInviteStatus) with a parallel field. "none" uniformly covers both
   * "no contract was ever attached" and "staff created before this feature
   * shipped" - both are structurally the same thing (no staff_contracts row).
   *
   * "not_applicable_existing_account" is not a stored value - it is derived
   * whenever a contract is still pending_signature but the linked
   * organisation_members row is already 'active'. That covers two cases with
   * one rule: branch C of StaffInviteService (attachExistingUser adds
   * membership as active immediately, with no password step to hang a
   * signature gate off of), and a manager attaching/replacing a contract on
   * a staff member who already completed onboarding before this contract
   * existed - in neither case does this feature ever auto-block a dashboard
   * that member can already reach.
   */
  async computeContractStatus(
    staff: { id: string; userId?: string | null },
    organisationId: string | undefined,
  ): Promise<StaffContractStatus> {
    const map = await this.computeContractStatuses([staff], organisationId);
    return map.get(staff.id) ?? "none";
  }

  /**
   * Batch form of computeContractStatus, for a whole staff list page -
   * one query for the contracts plus one for the reused invite-projection
   * (which already carries organisation_members.status per userId), instead
   * of N+1 lookups. Mirrors StaffInviteService.computeInviteStatuses.
   */
  async computeContractStatuses(
    rows: Array<{ id: string; userId?: string | null }>,
    organisationId: string | undefined,
  ): Promise<Map<string, StaffContractStatus>> {
    const result = new Map<string, StaffContractStatus>();
    const staffIds = rows.map(r => r.id);
    const contracts = await this.repo.getByStaffIds(staffIds);
    const byStaffId = new Map(contracts.map(c => [c.staffId, c]));

    // Only staff whose contract is still pending_signature need a membership
    // check at all (to tell "genuinely pending" from "already active,
    // not_applicable" - see the docstring above computeContractStatus).
    const userIdsNeedingCheck = Array.from(new Set(
      rows
        .filter(r => r.userId && byStaffId.get(r.id)?.status === "pending_signature")
        .map(r => r.userId as string),
    ));
    const projection = organisationId && userIdsNeedingCheck.length
      ? await storage.getInviteProjection(userIdsNeedingCheck, organisationId)
      : [];
    const memberStatusByUserId = new Map(projection.map(p => [p.userId, p.memberStatus]));

    for (const row of rows) {
      const contract = byStaffId.get(row.id);
      if (!contract) {
        result.set(row.id, "none");
        continue;
      }
      if (contract.status === "signed") {
        result.set(row.id, "signed");
        continue;
      }
      if (contract.status === "declined") {
        result.set(row.id, "declined");
        continue;
      }
      // pending_signature
      const memberStatus = row.userId ? memberStatusByUserId.get(row.userId) : undefined;
      result.set(row.id, memberStatus === "active" ? "not_applicable_existing_account" : "pending_signature");
    }
    return result;
  }

  // ─── Signature name-match ───────────────────────────────────────────────────

  /**
   * Exact match after normalization: trim, collapse internal whitespace,
   * case-insensitive. Deliberately not fuzzy/subset-based - a signature
   * name-check exists to confirm identity, and "close enough" defeats that.
   */
  private namesMatch(typed: string, onRecord: string): boolean {
    return this.normalizeName(typed) === this.normalizeName(onRecord);
  }

  private normalizeName(name: string): string {
    // NFC so "é" typed as one character or as e + accent compares equal.
    return name.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
  }

  // ─── Hashing helpers ──────────────────────────────────────────────────────

  private hashText(text: string): string {
    return crypto.createHash("sha256").update(text, "utf8").digest("hex");
  }

  /** sha256 of the exact bytes the staff member will be shown (already in memory from the malware scan). */
  private hashBytes(bytes: Buffer): string {
    return crypto.createHash("sha256").update(bytes).digest("hex");
  }
}

export const staffContractService = new StaffContractService();
