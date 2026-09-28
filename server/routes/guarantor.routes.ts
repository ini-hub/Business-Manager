import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { z } from "zod";
import { storage } from "../storage";
import { requireGuarantorSigningToken } from "../auth";
import { objectStorage } from "../lib/objectStorage";
import { guarantorFormService } from "../services/GuarantorFormService";
import { isHrProfileComplete } from "../lib/hrProfileGate";
import { fillAndSignGuarantorFormSchema, declineGuarantorFormSchema, ALLOWED_GUARANTOR_DOC_MIME_TYPES, MAX_GUARANTOR_DOC_FILE_SIZE_BYTES } from "@shared/schema";
import { getClientIp } from "./helpers";
import { broadcastDataChange } from "../websocket";
import { auditLogger } from "../audit";

function getUserAgent(req: Request): string {
  const ua = req.headers["user-agent"];
  return typeof ua === "string" ? ua : "unknown";
}

/**
 * The actual guarantor's own fill/sign/decline flow, reached via a
 * guarantor_pending token minted when the employee initiates the form
 * (server/routes/hr.routes.ts, server/routes/profile-completion.routes.ts).
 * The guarantor is never a users row and never authenticates - see
 * requireGuarantorSigningToken in server/auth.ts - so audit entries here use
 * auditLogger.log() directly with a synthetic actor rather than
 * getAuditContext(), which reads req.user. Signing here is what can finally
 * flip a staff member's organisation_members.status to 'active' if the
 * guarantor section was the last outstanding required one - unlike every
 * other profile-completion step, this can happen while the employee has no
 * active session at all, so the activation side-effect has to live here
 * rather than behind POST /api/profile-completion/complete.
 */
export function registerGuarantorRoutes(app: Express): void {
  app.get("/api/guarantor/pending", requireGuarantorSigningToken, async (req: Request, res: Response) => {
    try {
      const { guarantorFormId } = (req as any).guarantorSession;
      const form = await guarantorFormService.getById(guarantorFormId);
      if (!form) return res.status(404).json({ error: "Form not found." });
      if (form.status !== "awaiting_guarantor") {
        return res.status(409).json({ error: "This form has already been resolved.", status: form.status });
      }
      const current = await guarantorFormService.getCurrentVersionWithDocuments(guarantorFormId);
      if (!current) return res.status(404).json({ error: "Form content is missing." });

      res.json({ version: current.version, documents: current.documents });
    } catch (error) {
      console.error("Get pending guarantor form error:", error);
      res.status(500).json({ error: "Could not load this form. Please try again." });
    }
  });

  // Presigned upload for the guarantor's OWN documents (ID/photo) and
  // signature image - a separate endpoint from every other upload-url route
  // in the app because the guarantor holds a guarantor_pending token, not a
  // session or a profile_pending_token.
  app.post("/api/guarantor/upload-url", requireGuarantorSigningToken, async (req: Request, res: Response) => {
    try {
      const { fileName, mimeType } = req.body;
      if (!fileName || !mimeType) return res.status(400).json({ error: "fileName and mimeType are required." });
      if (!ALLOWED_GUARANTOR_DOC_MIME_TYPES.includes(mimeType)) {
        return res.status(400).json({ error: `File type ${mimeType} is not allowed.` });
      }
      const { guarantorFormId } = (req as any).guarantorSession;
      const safeName = String(fileName).replace(/[^a-zA-Z0-9._-]/g, "_");
      const storageKey = `hr-guarantor/${guarantorFormId}/${Date.now()}-${crypto.randomBytes(6).toString("hex")}-${safeName}`;
      const uploadUrl = await objectStorage.getSignedPutUrl(storageKey, mimeType);
      res.json({ uploadUrl, storageKey, maxFileSizeBytes: MAX_GUARANTOR_DOC_FILE_SIZE_BYTES });
    } catch (error) {
      console.error("Guarantor upload-url error:", error);
      res.status(500).json({ error: "Could not prepare the upload. Please try again." });
    }
  });

  // The guarantor's own section (identity, business info, eligibility
  // checklist, ID/photo) plus the signature image - filled and signed in
  // one atomic, one-time call. See GuarantorFormService.fillAndSign.
  app.post("/api/guarantor/fill", requireGuarantorSigningToken, async (req: Request, res: Response) => {
    const { guarantorFormId } = (req as any).guarantorSession;
    try {
      const body = fillAndSignGuarantorFormSchema.parse(req.body);

      const outcome = await guarantorFormService.fillAndSign({
        guarantorFormId,
        input: body,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      });

      if (outcome.kind !== "signed") {
        auditLogger.log({
          action: "HR_GUARANTOR_FILL_AND_SIGN",
          resource: "hr_guarantor_form",
          resourceId: guarantorFormId,
          status: "failure",
          ip: getClientIp(req),
          userAgent: getUserAgent(req),
          errorMessage: outcome.reason,
          channel: "guarantor_link",
        });
        return res.status(409).json({ error: outcome.reason });
      }

      const staff = await storage.getStaff(outcome.form.staffId);
      const store = staff ? await storage.getStore(staff.storeId) : undefined;

      auditLogger.log({
        action: "HR_GUARANTOR_FILL_AND_SIGN",
        resource: "hr_guarantor_form",
        resourceId: guarantorFormId,
        status: "success",
        ip: getClientIp(req),
        userAgent: getUserAgent(req),
        businessId: store?.businessId,
        storeId: staff?.storeId,
        details: { staffId: staff?.id, printedFullName: body.printedFullName },
        channel: "guarantor_link",
      });

      if (staff && store) {
        const gate = await isHrProfileComplete(staff.id, store.businessId);
        if (gate.complete && staff.userId) {
          const member = await storage.getOrganisationMember(staff.userId, store.businessId);
          if (member && member.status !== "active") {
            await storage.updateOrganisationMemberStatus(member.id, "active", new Date());
            broadcastDataChange(store.businessId, "staff", staff.storeId, "updated");
          }
        }
      }

      res.json({ message: "Thank you. Your signature has been recorded." });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0]?.message || "Invalid submission." });
      console.error("Fill/sign guarantor form error:", error);
      res.status(500).json({ error: "Could not record your submission. Please try again." });
    }
  });

  app.post("/api/guarantor/decline", requireGuarantorSigningToken, async (req: Request, res: Response) => {
    const { guarantorFormId } = (req as any).guarantorSession;
    try {
      const body = declineGuarantorFormSchema.parse(req.body);
      const outcome = await guarantorFormService.decline({ guarantorFormId, reason: body.reason });
      if (outcome.kind !== "declined") {
        return res.status(409).json({ error: outcome.reason });
      }

      const staff = await storage.getStaff(outcome.form.staffId);
      const store = staff ? await storage.getStore(staff.storeId) : undefined;
      auditLogger.log({
        action: "HR_GUARANTOR_DECLINED",
        resource: "hr_guarantor_form",
        resourceId: guarantorFormId,
        status: "success",
        ip: getClientIp(req),
        userAgent: getUserAgent(req),
        businessId: store?.businessId,
        storeId: staff?.storeId,
        details: { staffId: staff?.id, reason: body.reason },
        channel: "guarantor_link",
      });

      res.json({ message: "Response recorded." });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0]?.message || "Invalid submission." });
      console.error("Decline guarantor form error:", error);
      res.status(500).json({ error: "Could not record your response. Please try again." });
    }
  });
}
