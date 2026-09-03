import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { requireContractPendingToken, generateToken } from "../auth";
import { staffContractService } from "../services/StaffContractService";
import { signContractSchema, declineContractSchema } from "@shared/schema";
import { getClientIp } from "./helpers";
import { z } from "zod";
import { broadcastDataChange } from "../websocket";

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
export function registerContractRoutes(app: Express): void {
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
      if (outcome.kind !== "signed") {
        return res.status(409).json({ error: outcome.reason });
      }

      // Same tail as set-activated-password: the person is now fully
      // activated, so this is where the real session actually begins.
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
      const activatedMember = await storage.updateOrganisationMemberStatus(member.id, "active", new Date());
      const business = await storage.getBusinessById(businessId);

      const payload = {
        userId: user.id,
        organisationId: activatedMember.organisationId,
        role: activatedMember.role,
        staffId: activatedMember.staffId || undefined,
        email: user.email || undefined,
      };
      const token = generateToken(payload);

      res.cookie("jwt_token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: "lax",
      });
      res.clearCookie("contract_pending_token");

      broadcastDataChange(businessId, "staff", staff.storeId, "updated");

      res.json({
        message: "Contract signed. Welcome aboard!",
        user: {
          id: user.id,
          email: user.email || user.phone || "",
          role: activatedMember.role,
          businessId,
          isVerified: true,
        },
        business,
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
        staffName: staff.name,
        businessName: business?.name || "your workspace",
        inviterEmail: inviter?.email || undefined,
        inviterName: inviter?.name || undefined,
        reason: body.reason,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      });

      if (outcome.kind !== "declined") {
        return res.status(409).json({ error: outcome.reason });
      }

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
