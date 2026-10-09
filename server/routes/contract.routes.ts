import type { Express, Request, RequestHandler, Response } from "express";
import { storage } from "../storage";
import { requireContractPendingToken } from "../auth";
import { completeStaffActivation } from "../lib/authFlow";
import { staffContractService } from "../services/StaffContractService";
import { signContractSchema, declineContractSchema } from "@shared/schema";
import { getClientIp, type AuditContext } from "./helpers";
import { auditLogger } from "../audit";
import { sendContractSignedEmail } from "../email";
import { z } from "zod";

function getUserAgent(req: Request): string {
  const ua = req.headers["user-agent"];
  return typeof ua === "string" ? ua : "unknown";
}

/**
 * Self-service contract review/sign/decline, reached only via the
 * contract_pending_token cookie minted by set-activated-password / login in
 * server/routes.ts when a staff member's onboarding contract is still
 * pending_signature. Deliberately NOT behind isAuthenticated - see
 * requireContractPendingToken in server/auth.ts for why this token can never
 * become a normal session.
 */
/**
 * These routes run on a contract_pending_token, so there is no req.user for
 * getAuditContext to read; the actor is the staff member the token was minted for.
 */
function auditContextFor(req: Request, staff: { storeId: string; name: string }, userId: string, businessId?: string): AuditContext {
  return {
    userId,
    role: "staff",
    name: staff.name,
    businessId,
    storeId: staff.storeId,
    ip: getClientIp(req),
    userAgent: getUserAgent(req),
    channel: "web",
  };
}

export function registerContractRoutes(app: Express, middlewares?: { isAuthenticated: RequestHandler }): void {
  // The signed-in staff member's own copy of what they signed. Normal session
  // auth (not the pending token): by the time anyone can read this they have
  // signed at least once. Only signed versions are ever returned.
  if (middlewares) {
    app.get("/api/contract/mine", middlewares.isAuthenticated, async (req: Request, res: Response) => {
      try {
        const sessionUser = (req as any).user;
        const sessionUserId: string | undefined = sessionUser?.userId || sessionUser?.id;
        const staffId: string | undefined = sessionUser?.staffId
          || (sessionUserId ? (await storage.getStaffByUserId(sessionUserId))?.id : undefined);
        if (!staffId) return res.json({ contractStatus: "none", awaitingResignature: false, copies: [] });
        const staff = await storage.getStaff(staffId);
        if (!staff || staff.userId !== sessionUserId) {
          return res.status(403).json({ error: "This contract is not associated with your account." });
        }
        res.json(await staffContractService.getSignedCopiesForStaff(staff.id));
      } catch (error) {
        console.error("Get my contract error:", error);
        res.status(500).json({ error: "Could not load your contract. Please try again." });
      }
    });
  }

  app.get("/api/contract/pending", requireContractPendingToken, async (req: Request, res: Response) => {
    try {
      const { staffContractId, userId } = (req as any).contractSession;
      const review = await staffContractService.getContractForReview(staffContractId);
      if (!review) {
        return res.status(404).json({ error: "Contract not found." });
      }
      // Defense in depth: the token is minted for one specific contract, but
      // confirm it still belongs to the account that requested it (e.g. in
      // case the staff row was relinked onto a different account meanwhile).
      const staff = await storage.getStaff(review.contract.staffId);
      if (!staff || staff.userId !== userId) {
        return res.status(403).json({ error: "This contract is no longer associated with your account." });
      }
      if (review.contract.status !== "pending_signature") {
        return res.status(409).json({ error: "This contract has already been resolved." });
      }

      res.json({
        versionId: review.version.id,
        isAmendment: await staffContractService.isAwaitingResignature(review.contract),
        contractType: review.version.contractType,
        contentText: review.version.contentText,
        fileOriginalName: review.version.fileOriginalName,
        fileMimeType: review.version.fileMimeType,
        altText: review.version.altText,
        signedGetUrl: review.signedGetUrl,
        versionNumber: review.version.versionNumber,
      });
    } catch (error) {
      console.error("Get pending contract error:", error);
      res.status(500).json({ error: "Could not load the contract. Please try again." });
    }
  });

  app.post("/api/contract/sign", requireContractPendingToken, async (req: Request, res: Response) => {
    try {
      const { staffContractId, userId } = (req as any).contractSession;
      const body = signContractSchema.parse(req.body);

      const review = await staffContractService.getContractForReview(staffContractId);
      const staff = review ? await storage.getStaff(review.contract.staffId) : undefined;
      if (!staff || staff.userId !== userId) {
        return res.status(403).json({ error: "This contract is no longer associated with your account." });
      }

      const outcome = await staffContractService.sign({
        staffContractId,
        versionId: body.versionId,
        staffId: staff.id,
        userId,
        typedFullName: body.typedFullName,
        affirmedReadAndAgree: body.affirmedReadAndAgree,
        consentedElectronicSignature: body.consentedElectronicSignature,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      });

      if (outcome.kind === "name_mismatch") {
        return res.status(400).json({ error: outcome.reason, code: "name_mismatch" });
      }
      if (outcome.kind === "version_changed") {
        return res.status(409).json({ error: outcome.reason, code: "version_changed" });
      }
      if (outcome.kind !== "signed") {
        return res.status(409).json({ error: outcome.reason });
      }

      const signedStore = await storage.getStore(staff.storeId);
      auditLogger.logEvent(
        auditContextFor(req, staff, userId, signedStore?.businessId),
        "STAFF_CONTRACT_SIGNED", "staff", staff.id, "success",
        { details: { versionId: outcome.signature.staffContractVersionId, contentHash: outcome.signature.contentHashAtSigning } },
      );
      void (async () => {
        try {
          const signer = await storage.getUser(userId);
          const biz = signedStore?.businessId ? await storage.getBusinessById(signedStore.businessId) : undefined;
          const version = review?.version;
          if (signer?.email && version) {
            await sendContractSignedEmail(signer.email, staff.name, biz?.name || "your workspace", {
              versionNumber: version.versionNumber,
              typedFullName: outcome.signature.typedFullName,
              signedAt: outcome.signature.signedAt,
              contentHash: outcome.signature.contentHashAtSigning,
              contractType: version.contractType,
              contentText: version.contentText,
              fileOriginalName: version.fileOriginalName,
            });
          }
        } catch (err) {
          console.error("[StaffContract] Failed to send signed-copy email:", err);
        }
      })();

      // Same tail as set-activated-password: HR-profile gate, then activation
      // and the real session. A member who was already active once (a
      // re-signature) keeps their activation date and skips the profile gate.
      const user = await storage.getUser(userId);
      const store = await storage.getStore(staff.storeId);
      const businessId = store?.businessId;
      if (!user || !businessId) {
        return res.status(500).json({ error: "Could not complete activation. Please contact your manager." });
      }
      const member = await storage.getOrganisationMember(userId, businessId);
      if (!member) {
        return res.status(500).json({ error: "No workspace association found." });
      }
      res.clearCookie("contract_pending_token");
      await completeStaffActivation(user, req, res, {
        organisationId: businessId,
        skipProfileGate: !!member.activatedAt,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0]?.message || "Invalid submission." });
      }
      console.error("Sign contract error:", error);
      res.status(500).json({ error: "Could not record your signature. Please try again." });
    }
  });

  app.post("/api/contract/decline", requireContractPendingToken, async (req: Request, res: Response) => {
    try {
      const { staffContractId, userId } = (req as any).contractSession;
      const body = declineContractSchema.parse(req.body);

      const review = await staffContractService.getContractForReview(staffContractId);
      const staff = review ? await storage.getStaff(review.contract.staffId) : undefined;
      if (!staff || staff.userId !== userId) {
        return res.status(403).json({ error: "This contract is no longer associated with your account." });
      }

      const store = await storage.getStore(staff.storeId);
      const businessId = store?.businessId;
      const business = businessId ? await storage.getBusinessById(businessId) : undefined;
      const member = businessId ? await storage.getOrganisationMember(userId, businessId) : undefined;
      const inviter = member?.invitedByUserId ? await storage.getUser(member.invitedByUserId) : undefined;

      const outcome = await staffContractService.decline({
        staffContractId,
        versionId: body.versionId,
        staffName: staff.name,
        businessName: business?.name || "your workspace",
        inviterEmail: inviter?.email || undefined,
        inviterName: inviter?.name || undefined,
        reason: body.reason,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      });

      if (outcome.kind === "version_changed") {
        return res.status(409).json({ error: outcome.reason, code: "version_changed" });
      }
      if (outcome.kind !== "declined") {
        return res.status(409).json({ error: outcome.reason });
      }

      auditLogger.logEvent(
        auditContextFor(req, staff, userId, businessId),
        "STAFF_CONTRACT_DECLINED", "staff", staff.id, "success",
        { details: { versionId: body.versionId, hasReason: !!body.reason } },
      );

      res.clearCookie("contract_pending_token");
      res.json({ message: "Your decline has been recorded and your manager has been notified." });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0]?.message || "Invalid submission." });
      }
      console.error("Decline contract error:", error);
      res.status(500).json({ error: "Could not record your decision. Please try again." });
    }
  });
}
