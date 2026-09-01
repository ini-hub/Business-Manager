import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { isAuthenticated } from "../auth";
import bcrypt from "bcrypt";
import crypto from "crypto";
import {
  sendActivationEmail,
  sendAddedToOrgEmail,
  sendEmailVerificationOtpEmail,
  sendEmailChangeNoticeToOldAddress,
} from "../email";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { staffInviteService, type InviteOutcome, type ExistingLink } from "../services/StaffInviteService";
import { syncStaffNameToLinkedUser } from "../services/IdentitySync";

// The invite form is a deliberate enumeration-oracle blind spot (see the
// "Collapsed deliberately" comment below): a manager must never learn that
// an email they typed belongs to a name/store in ANOTHER business, not even
// that such a link exists. So this is the one place existingLinks (from
// attachExistingUser/relinkAndRetire) gets read, and it drops every link
// outside the current invite's own business before anything - API response
// or this business's own audit log - sees it.
function sameBusinessExistingLinks(
  outcome: InviteOutcome,
  businessId: string | undefined,
): ExistingLink[] {
  if (!("existingLinks" in outcome) || !outcome.existingLinks || !businessId) return [];
  return outcome.existingLinks.filter((l) => l.businessId === businessId);
}

const SALT_ROUNDS = 12;
import {
  insertBusinessSchema,
  insertStoreSchema,
  insertCustomerSchema,
  insertStaffSchema,
  insertInventorySchema,
  insertPromotionSchema,
  insertCustomRoleSchema,
  insertStoreIntegrationSchema,
  insertExpenseSchema,
  type UserRole,
  orders,
  checkouts,
  promotions,
  transactions,
  customers,
  inventory,
  staff,
  customRoles,
  taxRates,
  repayments,
  expenses,
  cashDrops,
  creditEntries,
  cashRegisterSessions,
} from "@shared/schema";
import { z } from "zod";
import { db } from "../db";
import { eq, and, gte, lte, gt, count, desc } from "drizzle-orm";
import { sanitizeString, sanitizeUUID, sanitizeNumber, sanitizeBoolean, sanitizePhoneNumber, sanitizeStoreCode } from "../sanitize";
import { normalizePhoneForStorage } from "@shared/phone-utils";
import { isUniqueViolation, getViolatedConstraint } from "../db-errors";
import { auditLogger } from "../audit";
import { bulkUploadService } from "../services/BulkUploadService";
import { analyticsService } from "../services/AnalyticsService";
import { getUserId, getClientIp, getAuditContext, formatZodErrors, checkBusinessAccess, getUserStores, verifyStoreAccess, verifyRecordStoreAccess, triggerAutoRecalculate, broadcastChange } from './helpers';

export type RouteMiddlewares = {
  isAuthenticated: any;
  requireRole: (...roles: any[]) => any;
  requireManagerOrOwner: any;
  checkStoreAccess: (storeId: string, req: Request, res: Response) => Promise<boolean>;
};

export function registerStaffRoutes(app: Express, { isAuthenticated, requireRole, requireManagerOrOwner, checkStoreAccess }: RouteMiddlewares): void {
  // Stops one manager hammering the resend button. The per-invitee limit is a
  // separate, DB-backed 3/hour on users.resendAttempts (shared with
  // /api/auth/resend-activation) so a single mailbox can't be flooded from
  // several manager sessions at once.
  const inviteResendLimiter = rateLimit({
    windowMs: 60_000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: any) => {
      const userId = req.user?.userId ?? req.user?.id;
      return userId != null ? String(userId) : ipKeyGenerator(req.ip ?? "");
    },
    message: { error: "Too many invitation resends. Please wait a moment." },
  });

  // ========== STAFF ==========
  app.get("/api/staff", isAuthenticated, async (req: any, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) {
        return res.status(400).json({ error: "Please select a store first." });
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;

      // userId links a staff row to its login account; never expose it in list
      // responses. inviteStatus is derived from it first, so the client can
      // tell a stranded invitation from an activated account without ever
      // seeing the account id itself.
      const store = await storage.getStore(storeId);
      const businessId = store?.businessId || (req as any).user?.organisationId || (req as any).user?.businessId;
      const attachInviteStatus = async (list: any[]) => {
        const statuses = businessId
          ? await staffInviteService.computeInviteStatuses(list, businessId)
          : new Map();
        list.forEach(s => { s.inviteStatus = statuses.get(s.id) ?? "none"; });
      };
      const redactUserId = (list: any[]) => {
        list.forEach(s => { delete s.userId; });
      };

      const redactWages = (list: any[]) => {
        list.forEach(s => {
          s.payPerMonth = 0;
          s.commissionRateOverride = null;
          s.commissionFixedAmountOverride = null;
          s.activeDayRateOverride = null;
          s.passiveDayRateOverride = null;
          s.leaveDayRateOverride = null;
          s.holidayDayRateOverride = null;
          s.offDayRateOverride = null;
        });
      };

      // Support both paginated and non-paginated queries
      const page = parseInt(req.query.page as string) || 0;
      const limit = parseInt(req.query.limit as string) || 0;

      if (page > 0 && limit > 0) {
        const search = req.query.search as string;
        const includeArchived = req.query.includeArchived === 'true';
        const result = await storage.getStaffPaginated(storeId, { page, limit, search, includeArchived });
        if (req.user?.role === "staff") {
          redactWages(result.data);
        }
        await attachInviteStatus(result.data);
        redactUserId(result.data);
        return res.json(result);
      }

      const staffList = await storage.getStaffList(storeId);
      if (req.user?.role === "staff") {
        redactWages(staffList);
      }
      await attachInviteStatus(staffList);
      redactUserId(staffList);
      res.json(staffList);
    } catch (error) {
      res.status(500).json({ error: "We couldn't load your staff members. Please try again." });
    }
  });

  app.get("/api/staff/:id", isAuthenticated, async (req, res) => {
    try {
      const staffMember = await storage.getStaff(req.params.id);
      if (!staffMember) {
        return res.status(404).json({ error: "Staff member not found." });
      }

      // Verify user has access to this staff member's store
      if (!await verifyRecordStoreAccess(req, staffMember.storeId)) {
        return res.status(403).json({ error: "You don't have access to this staff member." });
      }

      if ((req as any).user?.role === "staff") {
        staffMember.payPerMonth = 0;
        staffMember.commissionRateOverride = null;
        staffMember.commissionFixedAmountOverride = null;
        staffMember.activeDayRateOverride = null;
        staffMember.passiveDayRateOverride = null;
        staffMember.leaveDayRateOverride = null;
        staffMember.holidayDayRateOverride = null;
        staffMember.offDayRateOverride = null;
      }

      const singleStore = await storage.getStore(staffMember.storeId);
      const singleBusinessId = singleStore?.businessId || (req as any).user?.organisationId || (req as any).user?.businessId;
      (staffMember as any).inviteStatus = singleBusinessId
        ? await staffInviteService.computeInviteStatus(staffMember, singleBusinessId)
        : "none";

      delete (staffMember as any).userId;
      res.json(staffMember);
    } catch (error) {
      res.status(500).json({ error: "We couldn't load staff information. Please try again." });
    }
  });

  app.post("/api/staff", requireManagerOrOwner, async (req, res) => {
    try {
      const sanitizeOptionalNumber = (val: any) => {
        if (val === undefined || val === null || val === "") return null;
        return sanitizeNumber(val);
      };

      const sanitizedBody = {
        ...req.body,
        name: sanitizeString(req.body.name),
        email: sanitizeString(req.body.email)?.toLowerCase(),
        mobileNumber: sanitizePhoneNumber(req.body.mobileNumber),
        payPerMonth: sanitizeNumber(req.body.payPerMonth),
        signedContract: sanitizeBoolean(req.body.signedContract),
        role: req.body.role || "staff",
        // Staff compensation and payment overrides
        overridePaymentMethod: sanitizeBoolean(req.body.overridePaymentMethod),
        overrideCommission: sanitizeBoolean(req.body.overrideCommission),
        overrideFormula: sanitizeBoolean(req.body.overrideFormula),
        overrideAttendanceRates: sanitizeBoolean(req.body.overrideAttendanceRates),
        
        commissionFixedAmountOverride: sanitizeOptionalNumber(req.body.commissionFixedAmountOverride),
        commissionTypeOverride: req.body.commissionTypeOverride ? sanitizeString(req.body.commissionTypeOverride) : null,
        commissionFormulaOverride: req.body.commissionFormulaOverride ? sanitizeString(req.body.commissionFormulaOverride) : null,
        
        activeDayRateOverride: sanitizeOptionalNumber(req.body.activeDayRateOverride),
        passiveDayRateOverride: sanitizeOptionalNumber(req.body.passiveDayRateOverride),
        leaveDayRateOverride: sanitizeOptionalNumber(req.body.leaveDayRateOverride),
        holidayDayRateOverride: sanitizeOptionalNumber(req.body.holidayDayRateOverride),
        offDayRateOverride: sanitizeOptionalNumber(req.body.offDayRateOverride),
        
        payLeaveDaysOverride: sanitizeBoolean(req.body.payLeaveDaysOverride),
        payHolidayDaysOverride: sanitizeBoolean(req.body.payHolidayDaysOverride),
        payOffDaysOverride: sanitizeBoolean(req.body.payOffDaysOverride),
      };
      const data = insertStaffSchema.parse(sanitizedBody);
      if (data.storeId && !(await checkStoreAccess(data.storeId, req, res))) return;

      // Phone pre-check, before any staff row is created. sanitizePhoneNumber
      // (above) strips the dial code entirely for the staff.mobileNumber
      // column - normalizePhoneForStorage rebuilds the canonical dial-code-
      // prefixed form matching what users.phone actually stores elsewhere,
      // using this record's own countryCode.
      let normalizedInvitePhone: string | undefined;
      if (data.mobileNumber) {
        normalizedInvitePhone = normalizePhoneForStorage(data.mobileNumber, data.countryCode);
        const emailOwner = data.email ? await storage.getUserByIdentifier(data.email.toLowerCase()) : undefined;
        const phoneOwner = await storage.getUserByIdentifier(normalizedInvitePhone);
        // Only a problem if the phone belongs to a DIFFERENT account than
        // the one email already resolves to - auto-merge-into-existing-user
        // stays email-only (email is the authoritative invite identifier
        // for the "attach to existing user" branch below).
        if (phoneOwner && (!emailOwner || phoneOwner.id !== emailOwner.id)) {
          return res.status(409).json({
            error: "This mobile number is already linked to another account. Please use a different number or check if this staff member already has an account under a different email.",
          });
        }
      }

      const staffMember = await storage.createStaff(data);
      const ctx = await getAuditContext(req, { storeId: data.storeId });
      auditLogger.logEvent(ctx, "CREATE", "staff", staffMember.id, "success", { newValues: staffMember });

      // Invitation + activation. One call into StaffInviteService, which owns
      // the new-user / existing-user branching and is the same code path used
      // by the email-change fix and the manual resend, so the three cannot
      // drift apart.
      let outcome: InviteOutcome;
      let resolvedBusinessId: string | undefined;
      try {
        const store = data.storeId ? await storage.getStore(data.storeId) : null;
        resolvedBusinessId = store?.businessId || (req as any).user?.organisationId || (req as any).user?.businessId;
        outcome = await staffInviteService.inviteStaff({
          staff: staffMember,
          businessId: resolvedBusinessId,
          email: data.email,
          role: (data.role as "manager" | "staff") || "staff",
          normalizedPhone: normalizedInvitePhone,
          inviterName: (req as any).user?.name || "The Business Owner",
          inviterUserId: getUserId(req),
          reason: "create",
          respectCooldown: false,
          allowRelink: false,
        });
      } catch (inviteError) {
        // The staff row is already committed, so we still return 201 - but the
        // manager is told, instead of this vanishing into the server log the
        // way it used to.
        console.error("Failed to process invite/activation email for staff member:", inviteError);
        outcome = { kind: "failed", reason: (inviteError as Error).message };
      }

      const sameBusinessLinks = sameBusinessExistingLinks(outcome, resolvedBusinessId);
      auditLogger.logEvent(
        ctx, "STAFF_INVITE_SENT", "staff", staffMember.id,
        outcome.kind === "failed" ? "failure" : "success",
        // Never the activation code itself - audit_logs is append-only and
        // widely readable. existingLinks is pre-filtered to this business only.
        {
          details: { outcome: outcome.kind, ...(sameBusinessLinks.length ? { existingLinks: sameBusinessLinks } : {}) },
          ...(outcome.kind === "failed" ? { errorMessage: outcome.reason } : {}),
        },
      );

      const inviteStatus = resolvedBusinessId
        ? await staffInviteService.computeInviteStatus(
            { id: staffMember.id, userId: (await storage.getStaff(staffMember.id))?.userId },
            resolvedBusinessId,
          )
        : "none";

      broadcastChange(req, "staff", data.storeId, "created");
      res.status(201).json({
        ...staffMember,
        inviteStatus,
        // Collapsed deliberately: telling a manager whether an arbitrary email
        // already had a platform account is an enumeration oracle.
        inviteSent: outcome.kind === "activation_sent" || outcome.kind === "added_to_existing_user",
        ...(outcome.kind === "failed"
          ? { inviteWarning: "The staff member was saved, but we couldn't queue their invitation email. Use \u201cResend invitation\u201d on the staff list to try again." }
          : {}),
        ...(outcome.kind === "skipped" && outcome.reason === "no_business"
          ? { inviteWarning: "The staff member was saved, but no invitation was sent because this store isn't linked to a business yet." }
          : {}),
        // Only ever the same-business subset - see sameBusinessExistingLinks.
        ...(sameBusinessLinks.length
          ? { existingStaffLinks: sameBusinessLinks.map(({ staffId, storeId, name }) => ({ staffId, storeId, name })) }
          : {}),
      });
    } catch (error) {
      auditLogger.logDataModification("staff", undefined, getUserId(req), "CREATE", false, (error as Error).message);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      const constraint = getViolatedConstraint(error);
      if (constraint === "users_email_unique" || constraint === "staff_email_unique") {
        return res.status(409).json({
          error: "This email address is already assigned to another staff member. Please use a different email."
        });
      }
      if (constraint === "users_phone_unique") {
        return res.status(409).json({
          error: "This mobile number is already linked to another account. Please use a different number."
        });
      }
      if (constraint === "staff_store_mobile_unique") {
        return res.status(409).json({
          error: "This mobile number is already assigned to another staff member in this store. Please use a different number."
        });
      }
      if (isUniqueViolation(error)) {
        return res.status(409).json({
          error: "This staff member could not be created due to a conflicting record. Please check the details and try again."
        });
      }
      res.status(500).json({ error: "We couldn't add this staff member right now. Please try again." });
    }
  });

  app.patch("/api/staff/:id", requireManagerOrOwner, async (req, res) => {
    try {
      const staffMember = await storage.getStaff(req.params.id);
      if (!staffMember) {
        return res.status(404).json({ error: "Staff member not found." });
      }

      // Verify user has access to this staff member's store
      if (!await verifyRecordStoreAccess(req, staffMember.storeId)) {
        return res.status(403).json({ error: "You don't have access to this staff member." });
      }

      const sanitizeOptionalNumber = (val: any) => {
        if (val === undefined || val === null || val === "") return null;
        return sanitizeNumber(val);
      };

      const sanitizedBody: any = {
        ...req.body,
        ...(req.body.name !== undefined && { name: sanitizeString(req.body.name) }),
        ...(req.body.email !== undefined && { email: sanitizeString(req.body.email)?.toLowerCase() }),
        ...(req.body.mobileNumber !== undefined && { mobileNumber: sanitizePhoneNumber(req.body.mobileNumber) }),
        ...(req.body.payPerMonth !== undefined && { payPerMonth: sanitizeNumber(req.body.payPerMonth) }),
        ...(req.body.signedContract !== undefined && { signedContract: sanitizeBoolean(req.body.signedContract) }),
        
        ...(req.body.overridePaymentMethod !== undefined && { overridePaymentMethod: sanitizeBoolean(req.body.overridePaymentMethod) }),
        ...(req.body.overrideCommission !== undefined && { overrideCommission: sanitizeBoolean(req.body.overrideCommission) }),
        ...(req.body.overrideFormula !== undefined && { overrideFormula: sanitizeBoolean(req.body.overrideFormula) }),
        ...(req.body.overrideAttendanceRates !== undefined && { overrideAttendanceRates: sanitizeBoolean(req.body.overrideAttendanceRates) }),
        
        ...(req.body.commissionFixedAmountOverride !== undefined && { commissionFixedAmountOverride: sanitizeOptionalNumber(req.body.commissionFixedAmountOverride) }),
        ...(req.body.commissionTypeOverride !== undefined && { commissionTypeOverride: req.body.commissionTypeOverride ? sanitizeString(req.body.commissionTypeOverride) : null }),
        ...(req.body.commissionFormulaOverride !== undefined && { commissionFormulaOverride: req.body.commissionFormulaOverride ? sanitizeString(req.body.commissionFormulaOverride) : null }),
        
        ...(req.body.activeDayRateOverride !== undefined && { activeDayRateOverride: sanitizeOptionalNumber(req.body.activeDayRateOverride) }),
        ...(req.body.passiveDayRateOverride !== undefined && { passiveDayRateOverride: sanitizeOptionalNumber(req.body.passiveDayRateOverride) }),
        ...(req.body.leaveDayRateOverride !== undefined && { leaveDayRateOverride: sanitizeOptionalNumber(req.body.leaveDayRateOverride) }),
        ...(req.body.holidayDayRateOverride !== undefined && { holidayDayRateOverride: sanitizeOptionalNumber(req.body.holidayDayRateOverride) }),
        ...(req.body.offDayRateOverride !== undefined && { offDayRateOverride: sanitizeOptionalNumber(req.body.offDayRateOverride) }),
        
        ...(req.body.payLeaveDaysOverride !== undefined && { payLeaveDaysOverride: sanitizeBoolean(req.body.payLeaveDaysOverride) }),
        ...(req.body.payHolidayDaysOverride !== undefined && { payHolidayDaysOverride: sanitizeBoolean(req.body.payHolidayDaysOverride) }),
        ...(req.body.payOffDaysOverride !== undefined && { payOffDaysOverride: sanitizeBoolean(req.body.payOffDaysOverride) }),
      };
      // Remove storeId to prevent cross-store migration via PATCH (use transfer endpoint instead)
      delete sanitizedBody.storeId;
      const data = insertStaffSchema.partial().parse(sanitizedBody);

      // ── Email change ────────────────────────────────────────────────────
      // staff.email and users.email are two different things: the first is the
      // HR record, the second is a credential. Updating only the first (which
      // is all this handler used to do) strands the invitation at the mistyped
      // address with no way for either side to recover it.
      const newEmail = data.email?.toLowerCase();
      const emailChanged = !!newEmail && newEmail !== staffMember.email.toLowerCase();
      let inviteAction: string | undefined;
      let existingStaffLinks: ExistingLink[] = [];

      if (emailChanged) {
        const store = await storage.getStore(staffMember.storeId);
        const businessId = store?.businessId;
        const linkedUser = (staffMember.userId ? await storage.getUser(staffMember.userId) : null) ?? null;
        const linkedMember = linkedUser && businessId
          ? await storage.getOrganisationMember(linkedUser.id, businessId)
          : null;
        const newEmailOwner = await storage.getUserByIdentifier(newEmail!);
        const linkedOrgs = linkedUser ? await storage.getOrganisationsByUserId(linkedUser.id) : [];

        const plan = staffInviteService.planStaffEmailChange({
          staffUserId: staffMember.userId ?? null,
          linkedUser,
          linkedMemberStatus: linkedMember?.status ?? null,
          newEmailOwnerId: newEmailOwner?.id ?? null,
          linkedOrgCount: linkedOrgs.length,
          linkedIsOwner: linkedUser?.role === "owner" || linkedMember?.role === "owner",
          linkedIsRequester: !!linkedUser && linkedUser.id === getUserId(req),
        });

        if (plan.action === "refuse") {
          // Refuse before any write at all, so a rejected change leaves
          // staff.email, users.email and the membership completely untouched.
          const ctx = await getAuditContext(req, { storeId: staffMember.storeId });
          auditLogger.logEvent(ctx, "STAFF_EMAIL_CHANGE_REFUSED", "staff", req.params.id, "failure", {
            details: { reason: plan.reason },
            errorMessage: plan.message,
          });
          return res.status(409).json({ error: plan.message });
        }

        const ctx = await getAuditContext(req, { storeId: staffMember.storeId });

        if (plan.action === "reinvite" && linkedUser) {
          // Pending invite: re-point the login email, then let the service
          // mint a fresh code and send it to the corrected address.
          await storage.updateUser(linkedUser.id, { email: newEmail!, isEmailVerified: false });
          const outcome = await staffInviteService.inviteStaff({
            staff: { ...staffMember, email: newEmail! },
            businessId,
            email: newEmail!,
            role: (data.role as "manager" | "staff") || (staffMember.role as "manager" | "staff") || "staff",
            inviterName: (req as any).user?.name,
            inviterUserId: getUserId(req),
            reason: "email_change",
            respectCooldown: false,
            allowRelink: false,
          });
          inviteAction = outcome.kind === "failed" ? "reinvite_failed" : "reinvited";
          auditLogger.logEvent(ctx, "STAFF_INVITE_REISSUED", "staff", req.params.id,
            outcome.kind === "failed" ? "failure" : "success", {
              previousValues: { userEmail: linkedUser.email },
              newValues: { userEmail: newEmail },
              changedFields: ["users.email", "users.activationCode"],
            });

        } else if (plan.action === "overwrite_and_verify" && linkedUser) {
          // Activated account. The overwrite is immediate (a product decision),
          // which is exactly why managerEmailChangedAt is set: while it is
          // non-null the password-reset endpoints refuse, so a manager cannot
          // repoint an address to themselves and then reset their way in.
          const otpCode = crypto.randomInt(100000, 1000000).toString();
          await storage.updateUser(linkedUser.id, {
            email: newEmail!,
            isEmailVerified: false,
            managerEmailChangedAt: new Date(),
            otpCode,
            otpExpiry: new Date(Date.now() + 10 * 60 * 1000),
            otpAttempts: 0,
            // A half-finished self-service change would otherwise resurrect the
            // old address once its own OTP was confirmed.
            pendingEmail: null,
            pendingEmailOtp: null,
            pendingEmailOtpExpiry: null,
            pendingEmailOtpAttempts: 0,
          });
          await sendEmailVerificationOtpEmail(newEmail!, staffMember.name || newEmail!, otpCode);
          if (linkedUser.email) {
            await sendEmailChangeNoticeToOldAddress(linkedUser.email, staffMember.name || linkedUser.email, newEmail!);
          }
          inviteAction = "email_changed_verification_sent";
          auditLogger.logEvent(ctx, "STAFF_EMAIL_OVERWRITE", "staff", req.params.id, "success", {
            previousValues: { userEmail: linkedUser.email },
            newValues: { userEmail: newEmail },
            changedFields: ["users.email"],
          });

        } else if (plan.action === "relink" || plan.action === "invite") {
          const outcome = await staffInviteService.inviteStaff({
            staff: { ...staffMember, email: newEmail! },
            businessId,
            email: newEmail!,
            role: (data.role as "manager" | "staff") || (staffMember.role as "manager" | "staff") || "staff",
            inviterName: (req as any).user?.name,
            inviterUserId: getUserId(req),
            reason: "email_change",
            respectCooldown: false,
            allowRelink: true,
          });
          if (outcome.kind === "conflict") {
            return res.status(409).json({
              error: "That email already belongs to another account. Ask the staff member to change it from their own profile settings, or archive this record and add them again.",
            });
          }
          inviteAction = outcome.kind === "relinked" ? "relinked"
            : outcome.kind === "added_to_existing_user" ? "added_to_existing"
            : outcome.kind === "failed" ? "invite_failed" : "invited";
          existingStaffLinks = sameBusinessExistingLinks(outcome, businessId);
          if (outcome.kind === "relinked") {
            auditLogger.logEvent(ctx, "STAFF_USER_RELINKED", "staff", req.params.id, "success", {
              previousValues: { userId: staffMember.userId },
              newValues: { userId: outcome.userId },
              changedFields: ["staff.userId"],
              // existingStaffLinks is pre-filtered to this business only -
              // see sameBusinessExistingLinks.
              details: { retiredUserId: outcome.retiredUserId, ...(existingStaffLinks.length ? { existingLinks: existingStaffLinks } : {}) },
            });
          }

        } else if (plan.action === "sync") {
          inviteAction = "synced";
        }
      }

      const updatedStaffMember = await storage.updateStaff(req.params.id, data);
      if (!updatedStaffMember) {
        return res.status(404).json({ error: "This staff member no longer exists. They may have been removed." });
      }

      // Keep the linked login account's own name in step - see IdentitySync.
      // (The email side of this is already handled above by the
      // reinvite/overwrite_and_verify/relink branches; name has no such
      // branch since it never needs re-verification, just a mirrored write.)
      if (data.name !== undefined && data.name !== staffMember.name && staffMember.userId) {
        await syncStaffNameToLinkedUser(staffMember.id, staffMember.userId, updatedStaffMember.name);
      }

      const changedFields = Object.keys(data).filter((key) => JSON.stringify((staffMember as any)[key]) !== JSON.stringify((updatedStaffMember as any)[key]));
      if (changedFields.length > 0) {
        const ctx = await getAuditContext(req, { storeId: staffMember.storeId });
        auditLogger.logEvent(ctx, "UPDATE", "staff", req.params.id, "success", {
          previousValues: staffMember,
          newValues: updatedStaffMember,
          changedFields,
        });
      }
      broadcastChange(req, "staff", staffMember.storeId, "updated");
      res.json({
        ...updatedStaffMember,
        ...(inviteAction ? { inviteAction } : {}),
        // Only ever the same-business subset - see sameBusinessExistingLinks.
        ...(existingStaffLinks.length
          ? { existingStaffLinks: existingStaffLinks.map(({ staffId, storeId, name }) => ({ staffId, storeId, name })) }
          : {}),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      // Previously unmapped here, so a duplicate email surfaced as a 500 even
      // though the POST path already returned a clear 409 for the same clash.
      const constraint = getViolatedConstraint(error);
      if (constraint === "staff_email_unique") {
        return res.status(409).json({ error: "Another staff member in this store already uses that email address." });
      }
      if (constraint === "users_email_unique") {
        return res.status(409).json({ error: "That email address is already linked to another account." });
      }
      if (constraint === "users_phone_unique") {
        return res.status(409).json({ error: "That mobile number is already linked to another account." });
      }
      if (constraint === "staff_store_mobile_unique") {
        return res.status(409).json({ error: "Another staff member in this store already uses that mobile number." });
      }
      if (isUniqueViolation(error)) {
        return res.status(409).json({ error: "That change conflicts with an existing record. Please check the details and try again." });
      }
      res.status(500).json({ error: "We couldn't update this staff member right now. Please try again." });
    }
  });

  app.delete("/api/staff/:id", requireManagerOrOwner, async (req, res) => {
    try {
      const staffMember = await storage.getStaff(req.params.id);
      if (!staffMember) {
        return res.status(404).json({ error: "Staff member not found." });
      }

      // Verify user has access to this staff member's store
      if (!await verifyRecordStoreAccess(req, staffMember.storeId)) {
        return res.status(403).json({ error: "You don't have access to this staff member." });
      }

      // Archive instead of delete (soft delete)
      const archived = await storage.archiveStaff(req.params.id);
      if (!archived) {
        return res.status(500).json({ error: "We couldn't archive this staff member. Please try again." });
      }
      const ctx = await getAuditContext(req, { storeId: staffMember.storeId });
      auditLogger.logEvent(ctx, "ARCHIVE", "staff", req.params.id, "success", { previousValues: staffMember, newValues: archived });
      broadcastChange(req, "staff", staffMember.storeId, "deleted");
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "We couldn't archive this staff member. Please try again." });
    }
  });

  // Restore archived staff
  app.post("/api/staff/:id/restore", requireManagerOrOwner, async (req, res) => {
    try {
      const staffMember = await storage.getStaff(req.params.id);
      if (!staffMember) {
        return res.status(404).json({ error: "Staff member not found." });
      }

      // Verify user has access to this staff member's store
      if (!await verifyRecordStoreAccess(req, staffMember.storeId)) {
        return res.status(403).json({ error: "You don't have access to this staff member." });
      }

      const restored = await storage.restoreStaff(req.params.id);
      if (!restored) {
        return res.status(500).json({ error: "We couldn't restore this staff member. Please try again." });
      }
      const ctx = await getAuditContext(req, { storeId: staffMember.storeId });
      auditLogger.logEvent(ctx, "RESTORE", "staff", req.params.id, "success", { previousValues: staffMember, newValues: restored });
      res.json(restored);
    } catch (error) {
      res.status(500).json({ error: "We couldn't restore this staff member. Please try again." });
    }
  });

  // Manager-side invitation resend. Until this existed the only resend was
  // /api/auth/resend-activation, which the invitee drives themselves - useless
  // when the invitation went to an address they never had access to.
  app.post("/api/staff/:id/resend-invite", requireManagerOrOwner, inviteResendLimiter, async (req, res) => {
    try {
      const staffMember = await storage.getStaff(req.params.id);
      if (!staffMember) {
        return res.status(404).json({ error: "Staff member not found." });
      }
      if (!await verifyRecordStoreAccess(req, staffMember.storeId)) {
        return res.status(403).json({ error: "You don't have access to this staff member." });
      }
      if (staffMember.isArchived) {
        return res.status(400).json({ error: "Restore this staff member before resending their invitation." });
      }
      if (!staffMember.email) {
        return res.status(400).json({ error: "Add an email address for this staff member first." });
      }

      const store = await storage.getStore(staffMember.storeId);
      const businessId = store?.businessId || (req as any).user?.organisationId || (req as any).user?.businessId;
      if (!businessId) {
        return res.status(400).json({ error: "This store isn't linked to a business yet, so invitations can't be sent." });
      }

      const outcome = await staffInviteService.inviteStaff({
        staff: staffMember,
        businessId,
        email: staffMember.email,
        role: (staffMember.role as "manager" | "staff") || "staff",
        inviterName: (req as any).user?.name,
        inviterUserId: getUserId(req),
        reason: "manual_resend",
        respectCooldown: true,
        allowRelink: false,
      });

      const ctx = await getAuditContext(req, { storeId: staffMember.storeId });
      const sameBusinessLinks = sameBusinessExistingLinks(outcome, businessId);
      auditLogger.logEvent(ctx, "STAFF_INVITE_RESENT", "staff", req.params.id,
        outcome.kind === "activation_sent" || outcome.kind === "added_to_existing_user" ? "success" : "failure",
        // existingLinks is pre-filtered to this business only - see sameBusinessExistingLinks.
        { details: { outcome: outcome.kind, ...(sameBusinessLinks.length ? { existingLinks: sameBusinessLinks } : {}) } });

      if (outcome.kind === "already_active") {
        return res.status(409).json({ error: "This staff member has already activated their account." });
      }
      if (outcome.kind === "cooldown") {
        return res.status(429).json({
          error: `Too many invitations sent to this address. Please try again in ${outcome.retryAfterMinutes} minutes.`,
          retryAfterMinutes: outcome.retryAfterMinutes,
        });
      }
      if (outcome.kind === "failed") {
        return res.status(502).json({ error: "We couldn't queue the invitation email. Please try again." });
      }
      if (outcome.kind === "skipped" || outcome.kind === "conflict") {
        return res.status(400).json({ error: "We couldn't send an invitation for this staff member." });
      }

      broadcastChange(req, "staff", staffMember.storeId, "updated");
      res.json({
        sent: true,
        inviteStatus: await staffInviteService.computeInviteStatus(
          { id: staffMember.id, userId: outcome.userId },
          businessId,
        ),
      });
    } catch (error) {
      res.status(500).json({ error: "We couldn't resend the invitation right now. Please try again." });
    }
  });

  // Transfer staff to another store
  app.post("/api/staff/:id/transfer", requireManagerOrOwner, async (req, res) => {
    try {
      const { targetStoreId } = req.body;
      if (!targetStoreId) {
        return res.status(400).json({ error: "Please select a store to transfer to." });
      }

      const staffMember = await storage.getStaff(req.params.id);
      if (!staffMember) {
        return res.status(404).json({ error: "Staff member not found." });
      }

      // Verify user has access to this staff member's store
      if (!await verifyRecordStoreAccess(req, staffMember.storeId)) {
        return res.status(403).json({ error: "You don't have access to this staff member." });
      }

      // Verify user has access to the target store
      if (!await verifyStoreAccess(req, targetStoreId)) {
        return res.status(403).json({ error: "You don't have access to the target store." });
      }

      // Get the source store's business
      const sourceStore = await storage.getStore(staffMember.storeId);
      if (!sourceStore) {
        return res.status(404).json({ error: "Source store not found." });
      }

      // Get the target store and verify it belongs to the same business
      const targetStore = await storage.getStore(targetStoreId);
      if (!targetStore) {
        return res.status(404).json({ error: "Target store not found." });
      }

      if (sourceStore.businessId !== targetStore.businessId) {
        return res.status(403).json({ error: "Staff can only be transferred to stores within the same business." });
      }

      if (staffMember.storeId === targetStoreId) {
        return res.status(400).json({ error: "Staff member is already in this store." });
      }

      // Check if a staff member with this email already exists in the target store
      const existingInTarget = await db.select()
        .from(staff)
        .where(and(eq(staff.storeId, targetStoreId), eq(staff.email, staffMember.email)))
        .limit(1);

      if (existingInTarget.length > 0) {
        return res.status(400).json({
          error: "This staff member's email is already registered in the target store (e.g. they are already configured there). They cannot be transferred."
        });
      }

      // Use the storage method to transfer staff with auto-generated staff number
      const updated = await storage.transferStaff(req.params.id, targetStoreId);

      if (!updated) {
        return res.status(500).json({ error: "We couldn't transfer this staff member. Please try again." });
      }

      const ctx = await getAuditContext(req, { storeId: targetStoreId });
      auditLogger.logEvent(ctx, "STAFF_TRANSFER", "staff", req.params.id, "success", {
        previousValues: { storeId: staffMember.storeId },
        newValues: { storeId: updated.storeId },
        changedFields: ["storeId"],
      });
      res.json(updated);
    } catch (error) {
      console.error("Staff transfer error:", error);
      res.status(500).json({ error: "We couldn't transfer this staff member. Please try again." });
    }
  });

  // Permanently delete archived staff
  app.delete("/api/staff/:id/permanent", requireRole("owner"), async (req, res) => {
    try {
      const staffMember = await storage.getStaff(req.params.id);
      if (!staffMember) {
        return res.status(404).json({ error: "Staff member not found." });
      }

      // Verify user has access to this staff member's store
      if (!await verifyRecordStoreAccess(req, staffMember.storeId)) {
        return res.status(403).json({ error: "You don't have access to this staff member." });
      }

      if (!staffMember.isArchived) {
        return res.status(400).json({ error: "Only archived staff can be permanently deleted." });
      }

      const hasCheckouts = await storage.hasStaffCheckouts(req.params.id);
      if (hasCheckouts) {
        return res.status(400).json({
          error: "Cannot permanently delete staff member with existing sales records. This staff member has processed sales that must be preserved for your records."
        });
      }

      const deleted = await storage.deleteStaff(req.params.id);
      if (!deleted) {
        return res.status(500).json({ error: "We couldn't delete this staff member. Please try again." });
      }
      const ctx = await getAuditContext(req, { storeId: staffMember.storeId });
      auditLogger.logEvent(ctx, "PERMANENT_DELETE", "staff", req.params.id, "success", { previousValues: staffMember });
      res.status(204).send();
    } catch (error) {
      console.error("Permanent delete staff error:", error);
      res.status(500).json({ error: "We couldn't delete this staff member. Please try again." });
    }
  });

  // Bulk import staff
  app.post("/api/staff/bulk", requireManagerOrOwner, async (req, res) => {
    try {
      const { data, storeId } = req.body;
      if (!Array.isArray(data) || !storeId) {
        return res.status(400).json({ error: "Invalid data format or missing store." });
      }

      // Verify user has access to this store
      if (!await verifyStoreAccess(req, storeId)) {
        return res.status(403).json({ error: "You don't have access to this store." });
      }

      const result = await bulkUploadService.importStaff(data, storeId, getUserId(req));
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "We couldn't import your staff. Please try again." });
    }
  });

  // ─── Staff Customer Profile ────────────────────────────────────────────────

  app.get("/api/staff/:id/customer-profile", isAuthenticated, async (req, res) => {
    try {
      const staffMember = await storage.getStaff(req.params.id);
      if (!staffMember) return res.status(404).json({ error: "Staff member not found." });
      if (!await verifyRecordStoreAccess(req, staffMember.storeId)) {
        return res.status(403).json({ error: "You don't have access to this staff member." });
      }
      const customer = await storage.getCustomerByStaffId(req.params.id);
      res.json(customer || null);
    } catch (error) {
      res.status(500).json({ error: "Could not load customer profile." });
    }
  });

  app.post("/api/staff/:id/link-customer", requireManagerOrOwner, async (req, res) => {
    try {
      const staffMember = await storage.getStaff(req.params.id);
      if (!staffMember) return res.status(404).json({ error: "Staff member not found." });
      if (!await verifyRecordStoreAccess(req, staffMember.storeId)) {
        return res.status(403).json({ error: "You don't have access to this staff member." });
      }

      const { customerId, createNew } = req.body;

      if (createNew) {
        const existingLink = await storage.getCustomerByStaffId(req.params.id);
        if (existingLink) {
          return res.status(400).json({ error: "This staff member already has a linked customer profile." });
        }
        const newCustomer = await storage.createCustomer({
          storeId: staffMember.storeId,
          name: staffMember.name,
          mobileNumber: staffMember.mobileNumber || "",
          countryCode: staffMember.countryCode,
          address: "",
          customerNumber: "",
          staffId: req.params.id,
        });
        auditLogger.logDataModification("customer", newCustomer.id, getUserId(req), "LINK_STAFF", true, `Linked to staff ${req.params.id}`);
        return res.status(201).json(newCustomer);
      }

      if (!customerId) return res.status(400).json({ error: "customerId or createNew is required." });

      const customer = await storage.getCustomer(customerId);
      if (!customer) return res.status(404).json({ error: "Customer not found." });
      if (!await verifyRecordStoreAccess(req, customer.storeId)) {
        return res.status(403).json({ error: "You don't have access to this customer." });
      }

      const existing = await storage.getCustomerByStaffId(req.params.id);
      if (existing && existing.id !== customerId) {
        return res.status(400).json({ error: "This staff member already has a linked customer profile. Unlink it first." });
      }

      const updated = await storage.linkStaffToCustomer(customerId, req.params.id);
      auditLogger.logDataModification("customer", customerId, getUserId(req), "LINK_STAFF", true, `Linked to staff ${req.params.id}`);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Could not link customer profile." });
    }
  });

  app.delete("/api/staff/:id/link-customer", requireManagerOrOwner, async (req, res) => {
    try {
      const staffMember = await storage.getStaff(req.params.id);
      if (!staffMember) return res.status(404).json({ error: "Staff member not found." });
      if (!await verifyRecordStoreAccess(req, staffMember.storeId)) {
        return res.status(403).json({ error: "You don't have access to this staff member." });
      }

      const customer = await storage.getCustomerByStaffId(req.params.id);
      if (!customer) return res.status(404).json({ error: "No linked customer profile found." });

      await storage.unlinkStaffFromCustomer(customer.id);
      auditLogger.logDataModification("customer", customer.id, getUserId(req), "UNLINK_STAFF", true, `Unlinked from staff ${req.params.id}`);
      res.status(204).end();
    } catch (error) {
      res.status(500).json({ error: "Could not unlink customer profile." });
    }
  });

}
