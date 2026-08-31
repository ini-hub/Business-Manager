import bcrypt from "bcrypt";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { users, organisationMembers, staff as staffTable, type Staff, type User, type StaffInviteStatus } from "@shared/schema";
import { sendActivationEmail, sendAddedToOrgEmail } from "../email";
import { generateActivationCode, activationCodeExpiry } from "../lib/activation-code";
import { checkResendCooldown } from "../lib/otp-cooldown";
import { getViolatedConstraint } from "../db-errors";

const SALT_ROUNDS = 12;

export type InviteReason = "create" | "email_change" | "manual_resend";

export type InviteOutcome =
  | { kind: "activation_sent"; userId: string }
  | { kind: "added_to_existing_user"; userId: string }
  | { kind: "relinked"; userId: string; retiredUserId: string }
  | { kind: "already_active"; userId: string }
  | { kind: "skipped"; reason: "no_email" | "no_business" | "archived" }
  | { kind: "cooldown"; retryAfterMinutes: number }
  | { kind: "conflict"; reason: "email_belongs_to_active_account" }
  | { kind: "failed"; reason: string };

export interface InviteParams {
  staff: Staff;
  businessId: string | null | undefined;
  email: string;
  role: "manager" | "staff";
  normalizedPhone?: string | null;
  inviterName?: string;
  inviterUserId?: string;
  reason: InviteReason;
  /** Manual resends respect the 3/hour DB cooldown; create and email_change do not. */
  respectCooldown: boolean;
  /** Only the PATCH email-change path may move a staff row onto a different user. */
  allowRelink: boolean;
}

/** Inputs to the pure email-change decision. Kept DB-free so it is unit-testable. */
export interface EmailChangePlanInput {
  staffUserId: string | null;
  /** The user row staff.userId points at, if any. */
  linkedUser: Pick<User, "id" | "createdByInvitation" | "activationCodeUsed" | "lastLoginAt"> | null;
  /** That user's membership status in THIS business, or null if there is no row. */
  linkedMemberStatus: string | null;
  /** The user that already owns the new email address, if any. */
  newEmailOwnerId: string | null;
  /** How many organisations the linked user belongs to. */
  linkedOrgCount: number;
  /** True when the linked user is an owner of this business. */
  linkedIsOwner: boolean;
  /** True when the linked user is the manager making the request. */
  linkedIsRequester: boolean;
}

export type EmailChangePlan =
  /** No login account yet - just invite from scratch. */
  | { action: "invite" }
  /** Pending invite: re-point users.email and re-issue the code. */
  | { action: "reinvite" }
  /** Activated account: direct overwrite plus an OTP the holder must confirm. */
  | { action: "overwrite_and_verify" }
  /** staff.email had drifted from users.email; nothing to send. */
  | { action: "sync" }
  /** New address belongs to someone else and the current link is disposable. */
  | { action: "relink" }
  | { action: "refuse"; reason: string; message: string };

/**
 * One idempotent entry point for every way a staff member gets invited:
 * initial create, an email correction, and a manual resend.
 *
 * The invariant is that inviteStaff is keyed on (businessId, email) and
 * converges - running it twice never produces a second users row for the same
 * address, never a second membership for (userId, organisationId), and never
 * downgrades an active membership. Re-issuing the activation code is the one
 * intended mutation on a repeat call, since that is what "resend" means.
 *
 * It returns outcomes rather than throwing for expected states; only
 * unexpected DB errors propagate, and callers map those to 409/500.
 */
export class StaffInviteService {
  // ─── The pure decision that drives PATCH /api/staff/:id ───────────────────

  planStaffEmailChange(input: EmailChangePlanInput): EmailChangePlan {
    const {
      staffUserId, linkedUser, linkedMemberStatus, newEmailOwnerId,
      linkedOrgCount, linkedIsOwner, linkedIsRequester,
    } = input;

    // No login account behind this staff row yet: whether or not the new
    // address already belongs to someone, inviteStaff picks the right branch.
    if (!staffUserId || !linkedUser) return { action: "invite" };

    // The address is already this person's own - staff.email had simply
    // drifted out of sync with users.email. Nothing to send.
    if (newEmailOwnerId && newEmailOwnerId === staffUserId) return { action: "sync" };

    const activated = linkedMemberStatus === "active"
      || linkedUser.activationCodeUsed
      || !!linkedUser.lastLoginAt;

    if (newEmailOwnerId && newEmailOwnerId !== staffUserId) {
      // The corrected address belongs to a different platform user. Moving the
      // staff row onto them is only safe if what we are abandoning is a
      // never-used placeholder from a mistyped invite.
      const disposable = linkedUser.createdByInvitation
        && !linkedUser.activationCodeUsed
        && !linkedUser.lastLoginAt
        && linkedMemberStatus === "pending"
        && linkedOrgCount <= 1;
      if (!disposable) {
        return {
          action: "refuse",
          reason: "email_belongs_to_another_account",
          message: "That email already belongs to another account. Ask the staff member to change it from their own profile settings, or archive this record and add them again.",
        };
      }
      return { action: "relink" };
    }

    // Hard safety rail: a manager at business A must never be able to repoint
    // the login of someone who also works at business B, nor an owner's, nor
    // their own. These accounts are out of this form's authority entirely.
    if (linkedOrgCount > 1 || linkedIsOwner || linkedIsRequester) {
      return {
        action: "refuse",
        reason: "login_out_of_scope",
        message: "This person's login is shared with another business, or belongs to an owner. They must change their email from Settings → Profile.",
      };
    }

    return activated ? { action: "overwrite_and_verify" } : { action: "reinvite" };
  }

  // ─── The write path ───────────────────────────────────────────────────────

  async inviteStaff(params: InviteParams): Promise<InviteOutcome> {
    const { staff, businessId, email, role, reason, respectCooldown, allowRelink } = params;

    if (!email) return { kind: "skipped", reason: "no_email" };
    if (!businessId) return { kind: "skipped", reason: "no_business" };
    if (staff.isArchived) return { kind: "skipped", reason: "archived" };

    const emailLower = email.toLowerCase();
    const business = await storage.getBusinessById(businessId);
    const businessName = business?.name || "Business Workspace";
    const existing = await storage.getUserByIdentifier(emailLower);

    // (A) Nobody owns this address yet - mint a brand new invited account.
    if (!existing) {
      return this.createInvitedUser({ ...params, emailLower, businessName });
    }

    // (B) Already the account behind this staff row - resend or repair.
    if (existing.id === staff.userId) {
      return this.resendToLinkedUser({ ...params, user: existing, businessName });
    }

    // (C) Address belongs to an existing platform user and this staff row has
    //     no account yet - attach them to the business.
    if (!staff.userId) {
      return this.attachExistingUser({ ...params, user: existing, businessName });
    }

    // (D) Address belongs to someone else while this staff row is already
    //     linked. Only the email-change path may resolve this, and only by
    //     abandoning a disposable placeholder.
    if (!allowRelink) return { kind: "conflict", reason: "email_belongs_to_active_account" };

    const linked = await storage.getUser(staff.userId);
    if (!linked || !(await this.isDisposablePlaceholder(linked, businessId, staff.id))) {
      return { kind: "conflict", reason: "email_belongs_to_active_account" };
    }
    return this.relinkAndRetire({ ...params, newUser: existing, placeholder: linked, businessName });
  }

  // ─── Branch A: new invited account ────────────────────────────────────────

  private async createInvitedUser(
    p: InviteParams & { emailLower: string; businessName: string },
  ): Promise<InviteOutcome> {
    const { staff, businessId, emailLower, role, normalizedPhone, inviterUserId, businessName } = p;
    const activationCode = generateActivationCode();

    // Both password and passwordHash get the placeholder: several legacy code
    // paths read one or the other, and a null in either reads as "no password
    // set yet", which would let the account be claimed without the code.
    const placeholderPassword = await bcrypt.hash(crypto.randomUUID(), SALT_ROUNDS);

    // One transaction for the three rows. A half-applied invite - a user with
    // no membership, or a membership no staff row points at - is precisely the
    // failure this whole change exists to stop producing.
    const newUser = await db.transaction(async (tx) => {
      const [created] = await tx.insert(users).values({
        email: emailLower,
        password: placeholderPassword,
        passwordHash: placeholderPassword,
        businessId: businessId!,
        name: staff.name,
        phone: normalizedPhone || null,
        role,
        isVerified: true,
        activationCode,
        activationCodeExpiry: activationCodeExpiry(),
        activationCodeUsed: false,
        createdByInvitation: true,
      }).returning();

      await tx.insert(organisationMembers).values({
        userId: created.id,
        organisationId: businessId!,
        role,
        staffId: staff.staffNumber,
        status: "pending",
        invitedByUserId: inviterUserId,
      });

      await tx.update(staffTable).set({ userId: created.id }).where(eq(staffTable.id, staff.id));
      return created;
    });

    return this.deliver(
      () => sendActivationEmail(emailLower, staff.name, businessName, role, activationCode),
      { kind: "activation_sent", userId: newUser.id },
    );
  }

  // ─── Branch B: resend / repair for the already-linked account ─────────────

  private async resendToLinkedUser(
    p: InviteParams & { user: User; businessName: string },
  ): Promise<InviteOutcome> {
    const { staff, businessId, user, role, respectCooldown, reason, businessName } = p;

    let member = await storage.getOrganisationMember(user.id, businessId!);
    if (!member) {
      // A membership that never got written - the invite crashed part-way.
      // Repairing it here is what makes resend a genuine recovery tool.
      member = await this.ensureMember(
        user.id, businessId!, role, staff.staffNumber,
        user.activationCodeUsed ? "active" : "pending",
      );
    }
    if (member?.status === "active") return { kind: "already_active", userId: user.id };

    if (respectCooldown) {
      const cooldown = checkResendCooldown(user.resendAttempts, user.resendWindowStart);
      if (!cooldown.allowed) {
        return { kind: "cooldown", retryAfterMinutes: cooldown.retryAfterMinutes };
      }
    }

    const activationCode = generateActivationCode();
    const cooldown = respectCooldown
      ? checkResendCooldown(user.resendAttempts, user.resendWindowStart)
      : null;

    await storage.updateUser(user.id, {
      // An email change points at a brand new mailbox, so the old address's
      // resend counter is meaningless and must not block the correction.
      ...(reason === "email_change"
        ? { resendAttempts: 0, resendWindowStart: null }
        : cooldown && cooldown.allowed
          ? { resendAttempts: cooldown.nextAttempts, resendWindowStart: cooldown.nextWindowStart }
          : {}),
      activationCode,
      activationCodeExpiry: activationCodeExpiry(),
      activationCodeUsed: false,
    });

    // A partial member verified a code that we have just invalidated, so send
    // them back to the start rather than leaving them stranded mid-flow.
    if (member && member.status === "partial") {
      await storage.updateOrganisationMemberStatus(member.id, "pending");
    }

    return this.deliver(
      () => sendActivationEmail(p.email.toLowerCase(), staff.name, businessName, role, activationCode),
      { kind: "activation_sent", userId: user.id },
    );
  }

  // ─── Branch C: attach an existing platform user ───────────────────────────

  private async attachExistingUser(
    p: InviteParams & { user: User; businessName: string },
  ): Promise<InviteOutcome> {
    const { staff, businessId, user, role, inviterName, inviterUserId, businessName } = p;

    await this.ensureMember(user.id, businessId!, role, staff.staffNumber, "active", inviterUserId);
    await storage.updateStaff(staff.id, { userId: user.id });

    return this.deliver(
      () => sendAddedToOrgEmail(
        p.email.toLowerCase(), staff.name, businessName, role,
        inviterName || "The Business Owner",
      ),
      { kind: "added_to_existing_user", userId: user.id },
    );
  }

  // ─── Branch D: relink onto another account, retire the placeholder ────────

  private async relinkAndRetire(
    p: InviteParams & { newUser: User; placeholder: User; businessName: string },
  ): Promise<InviteOutcome> {
    const { staff, businessId, newUser, placeholder, role, inviterName, inviterUserId, businessName } = p;

    const staleMember = await storage.getOrganisationMember(placeholder.id, businessId!);
    const existingMember = await storage.getOrganisationMember(newUser.id, businessId!);

    await db.transaction(async (tx) => {
      if (staleMember) {
        await tx.delete(organisationMembers).where(eq(organisationMembers.id, staleMember.id));
      }

      // Never DELETE the user row - invited_by_user_id, audit logs and
      // notifications reference it. Neutralise it instead. Nulling the email is
      // the critical part: users_email_unique is global, so parking the
      // mistyped address on a dead row would block it forever.
      await tx.update(users).set({
        email: null,
        phone: null,
        status: "deactivated",
        activationCode: null,
        activationCodeExpiry: null,
        activationCodeUsed: true,
        updatedAt: new Date(),
      }).where(eq(users.id, placeholder.id));

      if (!existingMember) {
        await tx.insert(organisationMembers).values({
          userId: newUser.id,
          organisationId: businessId!,
          role,
          staffId: staff.staffNumber,
          status: "active",
          activatedAt: new Date(),
          invitedByUserId: inviterUserId,
        });
      }

      await tx.update(staffTable).set({ userId: newUser.id }).where(eq(staffTable.id, staff.id));
    });

    return this.deliver(
      () => sendAddedToOrgEmail(
        p.email.toLowerCase(), staff.name, businessName, role,
        inviterName || "The Business Owner",
      ),
      { kind: "relinked", userId: newUser.id, retiredUserId: placeholder.id },
    );
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Create the membership unless it already exists. The unique-violation catch
   * closes the check-then-insert race between two concurrent invites; either
   * way the caller ends up with exactly one row.
   */
  private async ensureMember(
    userId: string,
    organisationId: string,
    role: string,
    staffNumber: string,
    status: "pending" | "active",
    invitedByUserId?: string,
  ) {
    const existing = await storage.getOrganisationMember(userId, organisationId);
    if (existing) return existing;
    try {
      return await storage.createOrganisationMember({
        userId,
        organisationId,
        role,
        staffId: staffNumber,
        status,
        invitedByUserId,
        ...(status === "active" ? { activatedAt: new Date() } : {}),
      } as any);
    } catch (error) {
      if (getViolatedConstraint(error) === "org_member_user_org_unique") {
        return storage.getOrganisationMember(userId, organisationId);
      }
      throw error;
    }
  }

  /**
   * Is this user row a never-used stand-in from a mistyped invite, safe to
   * abandon? passwordHash is deliberately not consulted - the invite path
   * writes a bcrypt placeholder into it, so it is never null for invited users.
   * activationCodeUsed and lastLoginAt are the signals that actually mean
   * "a real person has been here".
   */
  private async isDisposablePlaceholder(user: User, businessId: string, staffId: string): Promise<boolean> {
    if (!user.createdByInvitation || user.activationCodeUsed || user.lastLoginAt) return false;

    const member = await storage.getOrganisationMember(user.id, businessId);
    if (member && member.status !== "pending") return false;

    const orgs = await storage.getOrganisationsByUserId(user.id);
    if (orgs.length > 1) return false;

    const otherStaff = await storage.getStaffByUserId(user.id);
    if (otherStaff && otherStaff.id !== staffId) return false;

    return true;
  }

  /**
   * Send, and convert a queue failure into a `failed` outcome without undoing
   * the DB work. The invite genuinely exists at this point; only the message
   * did not get queued, and resend is the fix for that.
   */
  private async deliver(send: () => Promise<void>, success: InviteOutcome): Promise<InviteOutcome> {
    try {
      await send();
      return success;
    } catch (error) {
      console.error("[StaffInvite] Failed to queue invitation email:", error);
      return { kind: "failed", reason: (error as Error).message };
    }
  }

  // ─── inviteStatus projection ──────────────────────────────────────────────

  async computeInviteStatuses(
    rows: Array<{ id: string; userId?: string | null }>,
    organisationId: string,
  ): Promise<Map<string, StaffInviteStatus>> {
    const result = new Map<string, StaffInviteStatus>();
    const userIds = Array.from(new Set(rows.map(r => r.userId).filter((id): id is string => !!id)));

    // One query for the whole page, regardless of its size.
    const projection = userIds.length
      ? await storage.getInviteProjection(userIds, organisationId)
      : [];
    const byUserId = new Map(projection.map(p => [p.userId, p]));

    for (const row of rows) {
      if (!row.userId) {
        result.set(row.id, "none");
        continue;
      }
      const p = byUserId.get(row.userId);
      if (!p) {
        result.set(row.id, "none");
        continue;
      }
      if (p.memberStatus === null) {
        // No membership row at all: still an outstanding invite if the account
        // was created by one and never claimed. Resend repairs the missing row.
        result.set(row.id, p.createdByInvitation && !p.activationCodeUsed ? "pending" : "none");
        continue;
      }
      if (p.memberStatus === "pending") result.set(row.id, "pending");
      else if (p.memberStatus === "partial") result.set(row.id, "partial");
      else result.set(row.id, "active");
    }
    return result;
  }

  async computeInviteStatus(
    row: { id: string; userId?: string | null },
    organisationId: string,
  ): Promise<StaffInviteStatus> {
    const map = await this.computeInviteStatuses([row], organisationId);
    return map.get(row.id) ?? "none";
  }
}

export const staffInviteService = new StaffInviteService();
