import crypto from "crypto";
import { storage } from "../storage";
import { StaffContractRepository } from "../repositories/StaffContractRepository";
import { objectStorage } from "../lib/objectStorage";
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

export type AttachContractOutcome =
  | { kind: "attached"; contract: StaffContract; version: StaffContractVersion }
  | { kind: "replaced"; contract: StaffContract; version: StaffContractVersion }
  | { kind: "refused_already_signed" }
  | { kind: "invalid"; reason: string };

export type SignOutcome =
  | { kind: "signed"; contract: StaffContract; signature: StaffContractSignature }
  | { kind: "not_pending"; reason: string }
  | { kind: "name_mismatch"; reason: string };

export type DeclineOutcome =
  | { kind: "declined"; contract: StaffContract }
  | { kind: "not_pending"; reason: string };

export interface ContractForReview {
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
export class StaffContractService {
  private repo = new StaffContractRepository();

  // ─── Attach / replace ──────────────────────────────────────────────────────

  async attachContract(params: {
    staffId: string;
    createdByUserId: string;
    input: AttachContractInput;
  }): Promise<AttachContractOutcome> {
    const { staffId, createdByUserId, input } = params;
    const existing = await this.repo.getByStaffId(staffId);

    if (existing && existing.status === "signed") {
      // A signed contract is a completed legal record - replacing its content
      // here would silently invalidate what the staff member actually agreed
      // to. Amending a signed contract is a distinct, not-yet-built feature.
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

      versionPayload = {
        contractType: input.contractType,
        contentText: null,
        storageKey: input.storageKey,
        fileMimeType: meta.contentType || input.fileMimeType,
        fileSizeBytes: meta.contentLength ?? input.fileSizeBytes,
        fileOriginalName: input.fileOriginalName,
        altText: input.contractType === "image" ? input.altText : null,
        contentHash: this.hashObjectIdentity(input.storageKey, meta),
      };
      // TODO: run malware scan on storage_key before it is ever presented for
      // review/signature. No scanning infra exists yet - see plan doc.
    }

    if (!existing) {
      const { contract, version } = await this.repo.createContractWithFirstVersion({
        staffId,
        createdByUserId,
        version: versionPayload,
      });
      return { kind: "attached", contract, version };
    }

    const { contract, version } = await this.repo.addReplacementVersion({
      contract: existing,
      createdByUserId,
      version: versionPayload,
    });
    return { kind: "replaced", contract, version };
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
  }>> {
    const contract = await this.repo.getById(staffContractId);
    if (!contract) return [];
    const versions = await this.repo.getAllVersions(staffContractId);

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
      };
    }));
  }

  async sign(params: {
    staffContractId: string;
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
    const version = await this.repo.getVersionById(contract.currentVersionId);
    if (!version) return { kind: "not_pending", reason: "Contract content is missing." };

    const { contract: updated, signature } = await this.repo.recordSignature({
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

    return { kind: "signed", contract: updated, signature };
  }

  async decline(params: {
    staffContractId: string;
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

    const updated = await this.repo.recordDecline({
      staffContractId: contract.id,
      reason: params.reason,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    });

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
   * the member isn't currently 'active': someone still mid-onboarding
   * already reaches contract_pending naturally through
   * set-activated-password, so there's nothing for this to do.
   *
   * Deliberately does not touch anything in the caller's session - no
   * existing access-check in this app re-verifies organisation_members.
   * status per-request, so a JWT already issued keeps working until it
   * expires. This only changes what happens the next time they log in.
   */
  async requireSignatureForActiveMember(userId: string, organisationId: string): Promise<boolean> {
    const member = await storage.getOrganisationMember(userId, organisationId);
    if (member?.status !== "active") return false;
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
    return name.trim().toLowerCase().replace(/\s+/g, " ");
  }

  // ─── Hashing helpers ──────────────────────────────────────────────────────

  private hashText(text: string): string {
    return crypto.createHash("sha256").update(text, "utf8").digest("hex");
  }

  /**
   * We never re-download the uploaded bytes here (the whole point of the
   * presigned-PUT flow is that this server never touches file bytes), so the
   * "content identity" hashed is the object's key + the bucket's own ETag +
   * size, which changes if and only if the underlying bytes do.
   */
  private hashObjectIdentity(storageKey: string, meta: { etag?: string; contentLength?: number }): string {
    return crypto.createHash("sha256")
      .update(`${storageKey}:${meta.etag ?? ""}:${meta.contentLength ?? ""}`, "utf8")
      .digest("hex");
  }
}

export const staffContractService = new StaffContractService();
