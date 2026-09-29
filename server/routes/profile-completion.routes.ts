import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { z } from "zod";
import { storage } from "../storage";
import { requireProfilePendingToken, generateToken, generateGuarantorSigningToken } from "../auth";
import { issueSession } from "../lib/authSessions";
import { isHrProfileComplete } from "../lib/hrProfileGate";
import { hrPersonalProfileService } from "../services/HrPersonalProfileService";
import { hrEmergencyContactService } from "../services/HrEmergencyContactService";
import { guarantorFormService } from "../services/GuarantorFormService";
import { objectStorage } from "../lib/objectStorage";
import { getClientIp } from "./helpers";
import { broadcastDataChange } from "../websocket";
import { auditLogger } from "../audit";
import { notifyGuarantorOfSigningLink } from "../lib/guarantorNotify";
import {
  upsertHrFieldValuesSchema,
  upsertHrEmergencyContactSchema,
  initiateGuarantorFormSchema,
  ALLOWED_GUARANTOR_DOC_MIME_TYPES,
  MAX_GUARANTOR_DOC_FILE_SIZE_BYTES,
} from "@shared/schema";

/**
 * This flow runs entirely on the profile_pending_token, never req.user, so
 * there's no getAuditContext()-style helper to reach for - this builds the
 * same shape directly from the pending session plus a staff/store lookup.
 */
async function logProfileCompletionEvent(req: Request, staffId: string, userId: string, action: string, resource: string, resourceId: string | undefined, details?: Record<string, unknown>) {
  const staff = await storage.getStaff(staffId);
  const store = staff ? await storage.getStore(staff.storeId) : undefined;
  auditLogger.log({
    action,
    resource,
    resourceId,
    userId,
    ip: getClientIp(req),
    status: "success",
    businessId: store?.businessId,
    storeId: staff?.storeId,
    details,
    userAgent: getUserAgent(req),
    channel: "onboarding",
  });
}

function getUserAgent(req: Request): string {
  const ua = req.headers["user-agent"];
  return typeof ua === "string" ? ua : "unknown";
}

function zodErrorResponse(error: z.ZodError) {
  const issue = error.errors[0];
  return { error: issue?.message || "Invalid submission.", field: issue?.path?.join(".") || undefined };
}

/**
 * Self-service HR-profile completion, reached only via the
 * profile_pending_token cookie minted by set-activated-password / login
 * (server/lib/authFlow.ts) when required sections (personal/emergency/
 * guarantor, per hr_section_config) are still outstanding. Deliberately NOT
 * behind isAuthenticated - see requireProfilePendingToken in server/auth.ts.
 *
 * The guarantor section is the one part that cannot be fully resolved here:
 * initiating the form only gets it to awaiting_guarantor - the guarantor
 * section itself can only be filled by the actual guarantor. The actual
 * activation-on-completion in that case happens from
 * server/routes/guarantor.routes.ts once the guarantor fills and signs.
 */
export function registerProfileCompletionRoutes(app: Express): void {
  app.get("/api/profile-completion/status", requireProfilePendingToken, async (req: Request, res: Response) => {
    try {
      const { staffId } = (req as any).profileSession;
      const staff = await storage.getStaff(staffId);
      const store = staff ? await storage.getStore(staff.storeId) : undefined;
      if (!staff || !store) return res.status(404).json({ error: "Staff record not found." });

      const gate = await isHrProfileComplete(staffId, store.businessId);
      res.json({ outstandingSections: gate.outstandingSections, requiredSections: gate.requiredSections, complete: gate.complete });
    } catch (error) {
      console.error("Profile status error:", error);
      res.status(500).json({ error: "Could not load your profile status." });
    }
  });

  app.get("/api/profile-completion/personal/fields", requireProfilePendingToken, async (req: Request, res: Response) => {
    try {
      const { staffId } = (req as any).profileSession;
      const businessId = await hrPersonalProfileService.getBusinessIdForStaff(staffId);
      if (!businessId) return res.status(404).json({ error: "Staff record not found." });
      const fields = await hrPersonalProfileService.getValues(staffId, "personal", businessId);
      res.json(fields);
    } catch (error) {
      console.error("Profile personal fields error:", error);
      res.status(500).json({ error: "Could not load your profile fields." });
    }
  });

  app.put("/api/profile-completion/personal/values", requireProfilePendingToken, async (req: Request, res: Response) => {
    try {
      const { staffId, userId } = (req as any).profileSession;
      const businessId = await hrPersonalProfileService.getBusinessIdForStaff(staffId);
      if (!businessId) return res.status(404).json({ error: "Staff record not found." });
      const input = upsertHrFieldValuesSchema.parse(req.body);
      const result = await hrPersonalProfileService.upsertValues({ staffId, businessId, section: "personal", updatedByUserId: userId, input });
      if (!result.ok) return res.status(400).json({ error: result.error, field: result.field });
      await logProfileCompletionEvent(req, staffId, userId, "HR_FIELD_VALUES_UPDATED", "hr_field_values", staffId, { section: "personal", fieldCount: input.values.length });
      res.json({ message: "Saved." });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json(zodErrorResponse(error));
      console.error("Profile personal values error:", error);
      res.status(500).json({ error: "Could not save your profile fields." });
    }
  });

  app.get("/api/profile-completion/emergency-contacts", requireProfilePendingToken, async (req: Request, res: Response) => {
    try {
      const { staffId } = (req as any).profileSession;
      res.json(await hrEmergencyContactService.list(staffId));
    } catch (error) {
      console.error("Profile emergency contacts error:", error);
      res.status(500).json({ error: "Could not load your emergency contacts." });
    }
  });

  app.post("/api/profile-completion/emergency-contacts", requireProfilePendingToken, async (req: Request, res: Response) => {
    try {
      const { staffId, userId } = (req as any).profileSession;
      const input = upsertHrEmergencyContactSchema.parse(req.body);
      const row = await hrEmergencyContactService.create(staffId, input);
      await logProfileCompletionEvent(req, staffId, userId, "HR_EMERGENCY_CONTACT_ADDED", "hr_emergency_contacts", row.id, { newValues: input });
      res.status(201).json(row);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json(zodErrorResponse(error));
      console.error("Profile create emergency contact error:", error);
      res.status(500).json({ error: "Could not save this contact." });
    }
  });

  app.delete("/api/profile-completion/emergency-contacts/:id", requireProfilePendingToken, async (req: Request, res: Response) => {
    try {
      const { staffId, userId } = (req as any).profileSession;
      const removed = await hrEmergencyContactService.remove(staffId, req.params.id);
      if (!removed) return res.status(404).json({ error: "Contact not found." });
      await logProfileCompletionEvent(req, staffId, userId, "HR_EMERGENCY_CONTACT_REMOVED", "hr_emergency_contacts", req.params.id);
      res.json({ message: "Removed." });
    } catch (error) {
      console.error("Profile delete emergency contact error:", error);
      res.status(500).json({ error: "Could not remove this contact." });
    }
  });

  app.post("/api/profile-completion/guarantor/upload-url", requireProfilePendingToken, async (req: Request, res: Response) => {
    try {
      const { fileName, mimeType } = req.body;
      if (!fileName || !mimeType) return res.status(400).json({ error: "fileName and mimeType are required." });
      if (!ALLOWED_GUARANTOR_DOC_MIME_TYPES.includes(mimeType)) {
        return res.status(400).json({ error: `File type ${mimeType} is not allowed.` });
      }
      const { staffId } = (req as any).profileSession;
      const safeName = String(fileName).replace(/[^a-zA-Z0-9._-]/g, "_");
      const storageKey = `hr-guarantor/${staffId}/${Date.now()}-${crypto.randomBytes(6).toString("hex")}-${safeName}`;
      const uploadUrl = await objectStorage.getSignedPutUrl(storageKey, mimeType);
      res.json({ uploadUrl, storageKey, maxFileSizeBytes: MAX_GUARANTOR_DOC_FILE_SIZE_BYTES });
    } catch (error) {
      console.error("Guarantor upload-url error:", error);
      res.status(500).json({ error: "Could not prepare the upload. Please try again." });
    }
  });

  app.get("/api/profile-completion/guarantor", requireProfilePendingToken, async (req: Request, res: Response) => {
    try {
      const { staffId } = (req as any).profileSession;
      const form = await guarantorFormService.getByStaffId(staffId);
      if (!form) return res.json({ status: "pending_submission" });
      const submission = await guarantorFormService.getEmployeeSubmissionForStaff(staffId);
      res.json({ status: form.status, declinedReason: form.declinedReason, ...submission });
    } catch (error) {
      console.error("Guarantor status error:", error);
      res.status(500).json({ error: "Could not load your guarantor form." });
    }
  });

  // Employee-side: Employee + Next of Kin data only. The guarantor section
  // itself can only be filled by the actual guarantor, via the returned
  // signingToken link - see GuarantorFormService and
  // server/routes/guarantor.routes.ts.
  app.post("/api/profile-completion/guarantor/initiate", requireProfilePendingToken, async (req: Request, res: Response) => {
    try {
      const { staffId, userId } = (req as any).profileSession;
      const input = initiateGuarantorFormSchema.parse(req.body);
      const outcome = await guarantorFormService.initiate({ staffId, createdByUserId: userId, input });

      if (outcome.kind === "refused_already_signed") {
        return res.status(409).json({ error: "This guarantor form has already been signed and cannot be replaced." });
      }
      if (outcome.kind === "invalid") {
        return res.status(400).json({ error: outcome.reason });
      }

      await logProfileCompletionEvent(req, staffId, userId, "HR_GUARANTOR_INITIATED", "hr_guarantor_form", outcome.form.id);

      const signingToken = generateGuarantorSigningToken(outcome.form.id);
      notifyGuarantorOfSigningLink({
        staffId,
        guarantorContactEmail: input.guarantorContactEmail,
        guarantorFormId: outcome.form.id,
        signingToken,
      });

      res.status(201).json({ message: "Guarantor form initiated. We've emailed your guarantor the signing link - you can also share it directly below.", signingToken });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json(zodErrorResponse(error));
      console.error("Guarantor initiate error:", error);
      res.status(500).json({ error: "Could not submit the guarantor form." });
    }
  });

  // Re-checks the gate and, if every required section is now satisfied,
  // finally issues the real session - the same tail as
  // POST /api/contract/sign. If the guarantor form is still awaiting the
  // guarantor's own signature, this returns 409 with the outstanding
  // sections rather than activating; that activation instead happens from
  // guarantor.routes.ts once they sign.
  app.post("/api/profile-completion/complete", requireProfilePendingToken, async (req: Request, res: Response) => {
    try {
      const { staffId, userId } = (req as any).profileSession;
      const staff = await storage.getStaff(staffId);
      const store = staff ? await storage.getStore(staff.storeId) : undefined;
      if (!staff || !store) return res.status(404).json({ error: "Staff record not found." });

      const gate = await isHrProfileComplete(staffId, store.businessId);
      if (!gate.complete) {
        const reasons = gate.outstandingSections.map((s) => gate.outstandingReasons[s]).filter(Boolean);
        return res.status(409).json({
          error: reasons.length > 0 ? reasons.join(" ") : "Some required sections are still incomplete.",
          outstandingSections: gate.outstandingSections,
          outstandingReasons: gate.outstandingReasons,
        });
      }

      const user = await storage.getUser(userId);
      const member = user ? await storage.getOrganisationMember(userId, store.businessId) : undefined;
      if (!user || !member) return res.status(500).json({ error: "Could not complete activation. Please contact your manager." });

      const activatedMember = await storage.updateOrganisationMemberStatus(member.id, "active", new Date());
      const business = await storage.getBusinessById(store.businessId);

      const payload = {
        userId: user.id,
        organisationId: activatedMember.organisationId,
        role: activatedMember.role,
        staffId: activatedMember.staffId || undefined,
        email: user.email || undefined,
      };
      await issueSession(req, res, payload);
      res.clearCookie("profile_pending_token");

      auditLogger.log({
        action: "HR_PROFILE_COMPLETED",
        resource: "organisation_members",
        resourceId: activatedMember.id,
        userId,
        ip: getClientIp(req),
        status: "success",
        businessId: store.businessId,
        storeId: staff.storeId,
        userAgent: getUserAgent(req),
        channel: "onboarding",
      });

      broadcastDataChange(store.businessId, "staff", staff.storeId, "updated");

      res.json({
        message: "Profile complete. Welcome aboard!",
        user: { id: user.id, email: user.email || user.phone || "", role: activatedMember.role, businessId: store.businessId, isVerified: true },
        business,
      });
    } catch (error) {
      console.error("Profile complete error:", error);
      res.status(500).json({ error: "Could not complete your profile. Please try again." });
    }
  });
}
