import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { z } from "zod";
import { storage } from "../storage";
import { objectStorage } from "../lib/objectStorage";
import { generateGuarantorSigningToken } from "../auth";
import { auditLogger } from "../audit";
import { notifyGuarantorOfSigningLink } from "../lib/guarantorNotify";
import { verifyRecordStoreAccess, formatZodErrors, getAuditContext } from "./helpers";
import { hasModulePermission } from "../lib/permissions";
import { hrPersonalProfileService } from "../services/HrPersonalProfileService";
import { hrEmergencyContactService } from "../services/HrEmergencyContactService";
import { hrJobHistoryService } from "../services/HrJobHistoryService";
import { hrTimeOffService } from "../services/HrTimeOffService";
import { hrDocumentService } from "../services/HrDocumentService";
import { estateBeneficiaryService } from "../services/EstateBeneficiaryService";
import { hrDisciplinaryService } from "../services/HrDisciplinaryService";
import { guarantorFormService } from "../services/GuarantorFormService";
import { getPublicHolidays } from "../lib/publicHolidays";
import {
  upsertHrFieldValuesSchema,
  upsertHrEmergencyContactSchema,
  createHrJobInfoSchema,
  createHrAdditionalJobInfoSchema,
  createHrTimeOffRequestSchema,
  attachHrDocumentSchema,
  ALLOWED_HR_DOCUMENT_MIME_TYPES,
  MAX_HR_DOCUMENT_FILE_SIZE_BYTES,
  upsertHrDependantSchema,
  upsertHrEstateBeneficiarySchema,
  upsertHrDisciplinaryRecordSchema,
  initiateGuarantorFormSchema,
  ALLOWED_GUARANTOR_DOC_MIME_TYPES,
  MAX_GUARANTOR_DOC_FILE_SIZE_BYTES,
  createHrFieldDefinitionSchema,
  updateHrFieldDefinitionSchema,
  hrFieldSectionEnum,
} from "@shared/schema";

interface RouteMiddlewares {
  isAuthenticated: any;
  requireManagerOrOwner: any;
}

function getUserId(req: Request): string | undefined {
  return (req as any).user?.userId || (req as any).user?.id;
}

function isOwnStaffRecord(req: Request, staffMember: { userId: string | null }): boolean {
  const uid = getUserId(req);
  return !!uid && staffMember.userId === uid;
}

/**
 * Resolves :staffId, checks the caller can see it (self, or a manager/owner
 * with store access), and returns the staff row - or writes the error
 * response itself and returns undefined. `managerOnly` gates the
 * manager-controlled sections (job history, disciplinary records, time-off
 * approval) where a staff member may read but never write.
 */
async function authorizeStaffAccess(
  req: Request,
  res: Response,
  staffId: string,
  opts: { managerOnly?: boolean } = {},
): Promise<{ id: string; storeId: string; userId: string | null } | undefined> {
  const staffMember = await storage.getStaff(staffId);
  if (!staffMember) {
    res.status(404).json({ error: "Staff member not found." });
    return undefined;
  }
  const self = isOwnStaffRecord(req, staffMember);
  const user = (req as any).user;
  const isManager = await hasModulePermission(user, "Staff & Payroll");

  if (opts.managerOnly) {
    if (!isManager || !(await verifyRecordStoreAccess(req, staffMember.storeId))) {
      res.status(403).json({ error: "Only a manager or owner can do this." });
      return undefined;
    }
    return staffMember;
  }

  if (self) return staffMember;
  if (isManager && (await verifyRecordStoreAccess(req, staffMember.storeId))) return staffMember;

  res.status(403).json({ error: "You don't have access to this staff member's HR profile." });
  return undefined;
}

/**
 * Staff/manager-facing HR profile CRUD, for staff who are already fully
 * active (see server/routes/profile-completion.routes.ts for the
 * pre-activation onboarding-gate version of personal/emergency/guarantor).
 */
export function registerHrRoutes(app: Express, { isAuthenticated }: RouteMiddlewares): void {
  // ─── Sections (per-business enabled/required config) ────────────────────

  app.get("/api/hr/sections", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const businessId = (req as any).user?.businessId;
      if (!businessId) return res.status(400).json({ error: "No business in scope." });
      const { hrFieldDefinitionService } = await import("../services/HrFieldDefinitionService");
      res.json(await hrFieldDefinitionService.listSections(businessId));
    } catch (error) {
      console.error("HR sections error:", error);
      res.status(500).json({ error: "Could not load HR section settings." });
    }
  });

  app.put("/api/hr/sections/:section", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const businessId = user?.businessId;
      const userRole = user?.role;

      if (!businessId) return res.status(400).json({ error: "No business in scope." });
      if (userRole !== "owner") return res.status(403).json({ error: "Only business owners can modify HR profile settings." });

      const { hrFieldDefinitionService } = await import("../services/HrFieldDefinitionService");
      const section = req.params.section as any;
      const body = z.object({ isEnabled: z.boolean().optional(), isRequiredForOnboarding: z.boolean().optional() }).parse(req.body);

      const row = await hrFieldDefinitionService.updateSection(businessId, section, body);
      if (!row) return res.status(404).json({ error: "Section config not found for this business." });

      const ctx = await getAuditContext(req, {});
      auditLogger.logEvent(ctx, "HR_SECTION_UPDATED", "hr_section_config", `${businessId}:${section}`, "success", { section, ...body });

      res.json(row);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: formatZodErrors(error.errors) });
      console.error("HR section update error:", error);
      res.status(500).json({ error: "Could not update this section." });
    }
  });

  // ─── Field management (business owner) ──────────────────────────────────

  app.post("/api/hr/fields/:section", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const businessId = user?.businessId;
      const userRole = user?.role;

      if (!businessId) return res.status(400).json({ error: "No business in scope." });
      if (userRole !== "owner") return res.status(403).json({ error: "Only business owners can create custom HR fields." });

      const section = hrFieldSectionEnum.find((s) => s === req.params.section);
      if (!section) return res.status(400).json({ error: "Unknown section." });

      const { hrFieldDefinitionService } = await import("../services/HrFieldDefinitionService");
      const input = createHrFieldDefinitionSchema.parse(req.body);
      const result = await hrFieldDefinitionService.create(businessId, section, input);
      if ("error" in result) return res.status(400).json({ error: result.error });

      const ctx = await getAuditContext(req, {});
      auditLogger.logEvent(ctx, "HR_FIELD_CREATED", "hr_field_definitions", result.id, "success", { details: { section, fieldKey: input.fieldKey, label: input.label } });

      res.status(201).json(result);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: formatZodErrors(error.errors) });
      console.error("HR field create error:", error);
      res.status(500).json({ error: "Could not create this field." });
    }
  });

  app.patch("/api/hr/fields/:fieldId", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const businessId = user?.businessId;
      const userRole = user?.role;

      if (!businessId) return res.status(400).json({ error: "No business in scope." });
      if (userRole !== "owner") return res.status(403).json({ error: "Only business owners can modify HR fields." });

      const { hrFieldDefinitionService } = await import("../services/HrFieldDefinitionService");
      const input = updateHrFieldDefinitionSchema.parse(req.body);
      const row = await hrFieldDefinitionService.update(businessId, req.params.fieldId, input);
      if (!row) return res.status(404).json({ error: "Field not found." });

      const ctx = await getAuditContext(req, {});
      auditLogger.logEvent(ctx, "HR_FIELD_UPDATED", "hr_field_definitions", req.params.fieldId, "success", { newValues: input });

      res.json(row);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: formatZodErrors(error.errors) });
      console.error("HR field update error:", error);
      res.status(500).json({ error: "Could not update this field." });
    }
  });

  app.delete("/api/hr/fields/:fieldId", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const businessId = user?.businessId;
      const userRole = user?.role;

      if (!businessId) return res.status(400).json({ error: "No business in scope." });
      if (userRole !== "owner") return res.status(403).json({ error: "Only business owners can delete HR fields." });

      const { hrFieldDefinitionService } = await import("../services/HrFieldDefinitionService");
      const outcome = await hrFieldDefinitionService.remove(businessId, req.params.fieldId);
      if (outcome.kind === "not_found") return res.status(404).json({ error: "Field not found." });
      if (outcome.kind === "refused_system_field") {
        return res.status(409).json({ error: "This is a default field and cannot be deleted - disable it instead." });
      }

      const ctx = await getAuditContext(req, {});
      auditLogger.logEvent(ctx, "HR_FIELD_DELETED", "hr_field_definitions", req.params.fieldId, "success", { businessId });

      res.json({ message: "Deleted." });
    } catch (error) {
      console.error("HR field delete error:", error);
      res.status(500).json({ error: "Could not delete this field." });
    }
  });

  // ─── Personal / Job (dynamic fields) ─────────────────────────────────────

  app.get("/api/hr/fields/:section", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const section = req.params.section as "personal" | "job_current";
      const businessId = (req as any).user?.businessId;
      if (!businessId) return res.status(400).json({ error: "No business in scope." });
      res.json(await hrPersonalProfileService.getFieldDefinitions(businessId, section));
    } catch (error) {
      console.error("HR field defs error:", error);
      res.status(500).json({ error: "Could not load fields." });
    }
  });

  app.get("/api/hr/staff/:staffId/field-values/:section", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const staffMember = await authorizeStaffAccess(req, res, req.params.staffId);
      if (!staffMember) return;
      const section = req.params.section as "personal" | "job_current";
      const businessId = (req as any).user?.businessId;
      res.json(await hrPersonalProfileService.getValues(staffMember.id, section, businessId));
    } catch (error) {
      console.error("HR field values error:", error);
      res.status(500).json({ error: "Could not load field values." });
    }
  });

  app.put("/api/hr/staff/:staffId/field-values/:section", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const staffMember = await authorizeStaffAccess(req, res, req.params.staffId);
      if (!staffMember) return;
      const section = req.params.section as "personal" | "job_current";
      const businessId = (req as any).user?.businessId;
      const input = upsertHrFieldValuesSchema.parse(req.body);
      const result = await hrPersonalProfileService.upsertValues({
        staffId: staffMember.id, businessId, section, updatedByUserId: getUserId(req)!, input,
      });
      if (!result.ok) return res.status(400).json({ error: result.error });

      const ctx = await getAuditContext(req, { storeId: staffMember.storeId });
      auditLogger.logEvent(ctx, "HR_FIELD_VALUES_UPDATED", "hr_field_values", staffMember.id, "success", {
        details: { section, fieldCount: input.values.length },
      });

      res.json({ message: "Saved." });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: formatZodErrors(error.errors) });
      console.error("HR field values save error:", error);
      res.status(500).json({ error: "Could not save field values." });
    }
  });

  // ─── Job history (manager-only writes) ──────────────────────────────────

  app.get("/api/hr/staff/:staffId/job-history", isAuthenticated, async (req: Request, res: Response) => {
    const staffMember = await authorizeStaffAccess(req, res, req.params.staffId);
    if (!staffMember) return;
    res.json(await hrJobHistoryService.listJobInfo(staffMember.id));
  });

  app.post("/api/hr/staff/:staffId/job-history", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const staffMember = await authorizeStaffAccess(req, res, req.params.staffId, { managerOnly: true });
      if (!staffMember) return;
      const input = createHrJobInfoSchema.parse(req.body);
      const row = await hrJobHistoryService.addJobInfo(staffMember.id, getUserId(req)!, input);

      const ctx = await getAuditContext(req, { storeId: staffMember.storeId });
      auditLogger.logEvent(ctx, "HR_JOB_INFO_ADDED", "hr_job_info_history", row.id, "success", { newValues: input });

      res.status(201).json(row);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: formatZodErrors(error.errors) });
      console.error("HR job history error:", error);
      res.status(500).json({ error: "Could not save job info." });
    }
  });

  app.get("/api/hr/staff/:staffId/additional-job-history", isAuthenticated, async (req: Request, res: Response) => {
    const staffMember = await authorizeStaffAccess(req, res, req.params.staffId);
    if (!staffMember) return;
    res.json(await hrJobHistoryService.listAdditionalJobInfo(staffMember.id));
  });

  app.post("/api/hr/staff/:staffId/additional-job-history", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const staffMember = await authorizeStaffAccess(req, res, req.params.staffId, { managerOnly: true });
      if (!staffMember) return;
      const input = createHrAdditionalJobInfoSchema.parse(req.body);
      const row = await hrJobHistoryService.addAdditionalJobInfo(staffMember.id, getUserId(req)!, input);

      const ctx = await getAuditContext(req, { storeId: staffMember.storeId });
      auditLogger.logEvent(ctx, "HR_ADDITIONAL_JOB_INFO_ADDED", "hr_additional_job_info_history", row.id, "success", { newValues: input });

      res.status(201).json(row);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: formatZodErrors(error.errors) });
      console.error("HR additional job history error:", error);
      res.status(500).json({ error: "Could not save job info." });
    }
  });

  // ─── Time off ─────────────────────────────────────────────────────────────

  app.get("/api/hr/staff/:staffId/time-off/balances", isAuthenticated, async (req: Request, res: Response) => {
    const staffMember = await authorizeStaffAccess(req, res, req.params.staffId);
    if (!staffMember) return;
    res.json(await hrTimeOffService.getBalances(staffMember.id));
  });

  app.get("/api/hr/staff/:staffId/time-off/requests", isAuthenticated, async (req: Request, res: Response) => {
    const staffMember = await authorizeStaffAccess(req, res, req.params.staffId);
    if (!staffMember) return;
    res.json(await hrTimeOffService.listRequests(staffMember.id));
  });

  app.post("/api/hr/staff/:staffId/time-off/requests", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const staffMember = await authorizeStaffAccess(req, res, req.params.staffId);
      if (!staffMember) return;
      const input = createHrTimeOffRequestSchema.parse(req.body);
      const row = await hrTimeOffService.createRequest(staffMember.id, input);

      const ctx = await getAuditContext(req, { storeId: staffMember.storeId });
      auditLogger.logEvent(ctx, "HR_TIME_OFF_REQUESTED", "hr_time_off_requests", row.id, "success", { newValues: input });

      res.status(201).json(row);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: formatZodErrors(error.errors) });
      console.error("HR time off request error:", error);
      res.status(500).json({ error: "Could not submit this request." });
    }
  });

  app.post("/api/hr/staff/:staffId/time-off/requests/:requestId/approve", isAuthenticated, async (req: Request, res: Response) => {
    const staffMember = await authorizeStaffAccess(req, res, req.params.staffId, { managerOnly: true });
    if (!staffMember) return;
    const outcome = await hrTimeOffService.approve(req.params.requestId, getUserId(req)!);
    if (outcome.kind === "not_pending") return res.status(409).json({ error: outcome.reason });

    const ctx = await getAuditContext(req, { storeId: staffMember.storeId });
    auditLogger.logEvent(ctx, "HR_TIME_OFF_APPROVED", "hr_time_off_requests", req.params.requestId, "success", {});

    res.json(outcome);
  });

  app.post("/api/hr/staff/:staffId/time-off/requests/:requestId/reject", isAuthenticated, async (req: Request, res: Response) => {
    const staffMember = await authorizeStaffAccess(req, res, req.params.staffId, { managerOnly: true });
    if (!staffMember) return;
    const outcome = await hrTimeOffService.reject(req.params.requestId, getUserId(req)!);
    if (outcome.kind === "not_pending") return res.status(409).json({ error: outcome.reason });

    const ctx = await getAuditContext(req, { storeId: staffMember.storeId });
    auditLogger.logEvent(ctx, "HR_TIME_OFF_REJECTED", "hr_time_off_requests", req.params.requestId, "success", {});

    res.json(outcome);
  });

  app.get("/api/hr/staff/:staffId/time-off/history", isAuthenticated, async (req: Request, res: Response) => {
    const staffMember = await authorizeStaffAccess(req, res, req.params.staffId);
    if (!staffMember) return;
    const leaveType = typeof req.query.leaveType === "string" ? (req.query.leaveType as any) : undefined;
    res.json(await hrTimeOffService.listHistory(staffMember.id, leaveType));
  });

  app.get("/api/hr/time-off/public-holidays", isAuthenticated, async (req: Request, res: Response) => {
    const country = typeof req.query.country === "string" ? req.query.country : "NG";
    res.json(getPublicHolidays(country));
  });

  // ─── Emergency contacts ───────────────────────────────────────────────────

  app.get("/api/hr/staff/:staffId/emergency-contacts", isAuthenticated, async (req: Request, res: Response) => {
    const staffMember = await authorizeStaffAccess(req, res, req.params.staffId);
    if (!staffMember) return;
    res.json(await hrEmergencyContactService.list(staffMember.id));
  });

  app.post("/api/hr/staff/:staffId/emergency-contacts", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const staffMember = await authorizeStaffAccess(req, res, req.params.staffId);
      if (!staffMember) return;
      const input = upsertHrEmergencyContactSchema.parse(req.body);
      const row = await hrEmergencyContactService.create(staffMember.id, input);

      const ctx = await getAuditContext(req, { storeId: staffMember.storeId });
      auditLogger.logEvent(ctx, "HR_EMERGENCY_CONTACT_ADDED", "hr_emergency_contacts", row.id, "success", { newValues: input });

      res.status(201).json(row);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: formatZodErrors(error.errors) });
      console.error("HR emergency contact error:", error);
      res.status(500).json({ error: "Could not save this contact." });
    }
  });

  app.patch("/api/hr/staff/:staffId/emergency-contacts/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const staffMember = await authorizeStaffAccess(req, res, req.params.staffId);
      if (!staffMember) return;
      const input = upsertHrEmergencyContactSchema.parse(req.body);
      const row = await hrEmergencyContactService.update(staffMember.id, req.params.id, input);
      if (!row) return res.status(404).json({ error: "Contact not found." });

      const ctx = await getAuditContext(req, { storeId: staffMember.storeId });
      auditLogger.logEvent(ctx, "HR_EMERGENCY_CONTACT_UPDATED", "hr_emergency_contacts", row.id, "success", { newValues: input });

      res.json(row);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: formatZodErrors(error.errors) });
      console.error("HR emergency contact update error:", error);
      res.status(500).json({ error: "Could not update this contact." });
    }
  });

  app.delete("/api/hr/staff/:staffId/emergency-contacts/:id", isAuthenticated, async (req: Request, res: Response) => {
    const staffMember = await authorizeStaffAccess(req, res, req.params.staffId);
    if (!staffMember) return;
    const removed = await hrEmergencyContactService.remove(staffMember.id, req.params.id);
    if (!removed) return res.status(404).json({ error: "Contact not found." });

    const ctx = await getAuditContext(req, { storeId: staffMember.storeId });
    auditLogger.logEvent(ctx, "HR_EMERGENCY_CONTACT_REMOVED", "hr_emergency_contacts", req.params.id, "success", {});

    res.json({ message: "Removed." });
  });

  // ─── Documents ────────────────────────────────────────────────────────────

  app.get("/api/hr/document-folders", isAuthenticated, async (req: Request, res: Response) => {
    const businessId = (req as any).user?.businessId;
    if (!businessId) return res.status(400).json({ error: "No business in scope." });
    res.json(await hrDocumentService.listFolders(businessId));
  });

  app.post("/api/hr/documents/upload-url", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { fileName, mimeType } = req.body;
      if (!fileName || !mimeType) return res.status(400).json({ error: "fileName and mimeType are required." });
      if (!ALLOWED_HR_DOCUMENT_MIME_TYPES.includes(mimeType)) {
        return res.status(400).json({ error: `File type ${mimeType} is not allowed.` });
      }
      const businessId = (req as any).user?.businessId || "unscoped";
      const safeName = String(fileName).replace(/[^a-zA-Z0-9._-]/g, "_");
      const storageKey = `hr-documents/${businessId}/${Date.now()}-${crypto.randomBytes(6).toString("hex")}-${safeName}`;
      const uploadUrl = await objectStorage.getSignedPutUrl(storageKey, mimeType);
      res.json({ uploadUrl, storageKey, maxFileSizeBytes: MAX_HR_DOCUMENT_FILE_SIZE_BYTES });
    } catch (error) {
      console.error("HR document upload-url error:", error);
      res.status(500).json({ error: "Could not prepare the upload. Please try again." });
    }
  });

  app.get("/api/hr/staff/:staffId/documents", isAuthenticated, async (req: Request, res: Response) => {
    const staffMember = await authorizeStaffAccess(req, res, req.params.staffId);
    if (!staffMember) return;
    const folderId = typeof req.query.folderId === "string" ? req.query.folderId : undefined;
    res.json(await hrDocumentService.listDocuments(staffMember.id, folderId));
  });

  app.post("/api/hr/staff/:staffId/documents", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const staffMember = await authorizeStaffAccess(req, res, req.params.staffId);
      if (!staffMember) return;
      const input = attachHrDocumentSchema.parse(req.body);
      const outcome = await hrDocumentService.attach({ staffId: staffMember.id, uploadedByUserId: getUserId(req)!, input });
      if (outcome.kind === "invalid") return res.status(400).json({ error: outcome.reason });

      const ctx = await getAuditContext(req, { storeId: staffMember.storeId });
      auditLogger.logEvent(ctx, "HR_DOCUMENT_ATTACHED", "hr_documents", outcome.document.id, "success", {
        details: { fileName: outcome.document.fileName, folderId: outcome.document.folderId },
      });

      res.status(201).json(outcome.document);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: formatZodErrors(error.errors) });
      console.error("HR document attach error:", error);
      res.status(500).json({ error: "Could not attach this document." });
    }
  });

  app.delete("/api/hr/staff/:staffId/documents/:id", isAuthenticated, async (req: Request, res: Response) => {
    const staffMember = await authorizeStaffAccess(req, res, req.params.staffId);
    if (!staffMember) return;
    const removed = await hrDocumentService.remove(staffMember.id, req.params.id);
    if (!removed) return res.status(404).json({ error: "Document not found." });

    const ctx = await getAuditContext(req, { storeId: staffMember.storeId });
    auditLogger.logEvent(ctx, "HR_DOCUMENT_REMOVED", "hr_documents", req.params.id, "success", {});

    res.json({ message: "Removed." });
  });

  // ─── Benefits: dependants + estate beneficiaries ─────────────────────────

  app.get("/api/hr/staff/:staffId/dependants", isAuthenticated, async (req: Request, res: Response) => {
    const staffMember = await authorizeStaffAccess(req, res, req.params.staffId);
    if (!staffMember) return;
    res.json(await estateBeneficiaryService.listDependants(staffMember.id));
  });

  app.post("/api/hr/staff/:staffId/dependants", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const staffMember = await authorizeStaffAccess(req, res, req.params.staffId);
      if (!staffMember) return;
      const input = upsertHrDependantSchema.parse(req.body);
      const row = await estateBeneficiaryService.createDependant(staffMember.id, input);

      const ctx = await getAuditContext(req, { storeId: staffMember.storeId });
      auditLogger.logEvent(ctx, "HR_DEPENDANT_ADDED", "hr_dependants", row.id, "success", { newValues: input });

      res.status(201).json(row);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: formatZodErrors(error.errors) });
      console.error("HR dependant error:", error);
      res.status(500).json({ error: "Could not save this dependant." });
    }
  });

  app.delete("/api/hr/staff/:staffId/dependants/:id", isAuthenticated, async (req: Request, res: Response) => {
    const staffMember = await authorizeStaffAccess(req, res, req.params.staffId);
    if (!staffMember) return;
    const removed = await estateBeneficiaryService.removeDependant(staffMember.id, req.params.id);
    if (!removed) return res.status(404).json({ error: "Dependant not found." });

    const ctx = await getAuditContext(req, { storeId: staffMember.storeId });
    auditLogger.logEvent(ctx, "HR_DEPENDANT_REMOVED", "hr_dependants", req.params.id, "success", {});

    res.json({ message: "Removed." });
  });

  app.get("/api/hr/staff/:staffId/estate-beneficiaries", isAuthenticated, async (req: Request, res: Response) => {
    const staffMember = await authorizeStaffAccess(req, res, req.params.staffId);
    if (!staffMember) return;
    res.json(await estateBeneficiaryService.listBeneficiaries(staffMember.id));
  });

  app.post("/api/hr/staff/:staffId/estate-beneficiaries", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const staffMember = await authorizeStaffAccess(req, res, req.params.staffId);
      if (!staffMember) return;
      const input = upsertHrEstateBeneficiarySchema.parse(req.body);
      const outcome = await estateBeneficiaryService.createBeneficiary(staffMember.id, input);
      if (outcome.kind === "exceeds_100") {
        return res.status(400).json({ error: `This would bring the total to ${outcome.totalAfter}%. Beneficiary percentages cannot exceed 100% in total.` });
      }

      const ctx = await getAuditContext(req, { storeId: staffMember.storeId });
      auditLogger.logEvent(ctx, "HR_ESTATE_BENEFICIARY_ADDED", "hr_estate_beneficiaries", outcome.beneficiary.id, "success", { newValues: input });

      res.status(201).json(outcome.beneficiary);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: formatZodErrors(error.errors) });
      console.error("HR estate beneficiary error:", error);
      res.status(500).json({ error: "Could not save this beneficiary." });
    }
  });

  app.patch("/api/hr/staff/:staffId/estate-beneficiaries/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const staffMember = await authorizeStaffAccess(req, res, req.params.staffId);
      if (!staffMember) return;
      const input = upsertHrEstateBeneficiarySchema.parse(req.body);
      const outcome = await estateBeneficiaryService.updateBeneficiary(staffMember.id, req.params.id, input);
      if (outcome.kind === "not_found") return res.status(404).json({ error: "Beneficiary not found." });
      if (outcome.kind === "exceeds_100") {
        return res.status(400).json({ error: `This would bring the total to ${outcome.totalAfter}%. Beneficiary percentages cannot exceed 100% in total.` });
      }

      const ctx = await getAuditContext(req, { storeId: staffMember.storeId });
      auditLogger.logEvent(ctx, "HR_ESTATE_BENEFICIARY_UPDATED", "hr_estate_beneficiaries", outcome.beneficiary.id, "success", { newValues: input });

      res.json(outcome.beneficiary);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: formatZodErrors(error.errors) });
      console.error("HR estate beneficiary update error:", error);
      res.status(500).json({ error: "Could not update this beneficiary." });
    }
  });

  app.delete("/api/hr/staff/:staffId/estate-beneficiaries/:id", isAuthenticated, async (req: Request, res: Response) => {
    const staffMember = await authorizeStaffAccess(req, res, req.params.staffId);
    if (!staffMember) return;
    const outcome = await estateBeneficiaryService.removeBeneficiary(staffMember.id, req.params.id);
    if (outcome.kind === "not_found") return res.status(404).json({ error: "Beneficiary not found." });

    const ctx = await getAuditContext(req, { storeId: staffMember.storeId });
    auditLogger.logEvent(ctx, "HR_ESTATE_BENEFICIARY_REMOVED", "hr_estate_beneficiaries", req.params.id, "success", {});

    res.json({ message: "Removed." });
  });

  // ─── Disciplinary records (manager-only) ─────────────────────────────────

  app.get("/api/hr/staff/:staffId/disciplinary", isAuthenticated, async (req: Request, res: Response) => {
    const staffMember = await authorizeStaffAccess(req, res, req.params.staffId, { managerOnly: true });
    if (!staffMember) return;
    res.json(await hrDisciplinaryService.list(staffMember.id));
  });

  app.post("/api/hr/staff/:staffId/disciplinary", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const staffMember = await authorizeStaffAccess(req, res, req.params.staffId, { managerOnly: true });
      if (!staffMember) return;
      const input = upsertHrDisciplinaryRecordSchema.parse(req.body);
      const row = await hrDisciplinaryService.create(staffMember.id, getUserId(req)!, input);

      const ctx = await getAuditContext(req, { storeId: staffMember.storeId });
      auditLogger.logEvent(ctx, "HR_DISCIPLINARY_RECORD_ADDED", "hr_disciplinary_records", row.id, "success", { newValues: input });

      res.status(201).json(row);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: formatZodErrors(error.errors) });
      console.error("HR disciplinary record error:", error);
      res.status(500).json({ error: "Could not save this record." });
    }
  });

  app.patch("/api/hr/staff/:staffId/disciplinary/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const staffMember = await authorizeStaffAccess(req, res, req.params.staffId, { managerOnly: true });
      if (!staffMember) return;
      const input = upsertHrDisciplinaryRecordSchema.parse(req.body);
      const row = await hrDisciplinaryService.update(staffMember.id, req.params.id, input);
      if (!row) return res.status(404).json({ error: "Record not found." });

      const ctx = await getAuditContext(req, { storeId: staffMember.storeId });
      auditLogger.logEvent(ctx, "HR_DISCIPLINARY_RECORD_UPDATED", "hr_disciplinary_records", row.id, "success", { newValues: input });

      res.json(row);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: formatZodErrors(error.errors) });
      console.error("HR disciplinary record update error:", error);
      res.status(500).json({ error: "Could not update this record." });
    }
  });

  // ─── Guarantor (post-activation view/resubmit) ───────────────────────────
  // The onboarding-time submission flow lives in
  // server/routes/profile-completion.routes.ts; this covers a staff member
  // (or their manager) checking status or resubmitting later, once already
  // active - e.g. a business that enables the guarantor section without
  // requiring it for onboarding.

  app.get("/api/hr/staff/:staffId/guarantor", isAuthenticated, async (req: Request, res: Response) => {
    const staffMember = await authorizeStaffAccess(req, res, req.params.staffId);
    if (!staffMember) return;
    const form = await guarantorFormService.getByStaffId(staffMember.id);
    if (!form) return res.json({ status: "pending_submission" });
    const submission = await guarantorFormService.getEmployeeSubmissionForStaff(staffMember.id);
    res.json({ status: form.status, declinedReason: form.declinedReason, ...submission });
  });

  app.post("/api/hr/guarantor/upload-url", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { fileName, mimeType } = req.body;
      if (!fileName || !mimeType) return res.status(400).json({ error: "fileName and mimeType are required." });
      if (!ALLOWED_GUARANTOR_DOC_MIME_TYPES.includes(mimeType)) {
        return res.status(400).json({ error: `File type ${mimeType} is not allowed.` });
      }
      const userId = getUserId(req) || "unscoped";
      const safeName = String(fileName).replace(/[^a-zA-Z0-9._-]/g, "_");
      const storageKey = `hr-guarantor/${userId}/${Date.now()}-${crypto.randomBytes(6).toString("hex")}-${safeName}`;
      const uploadUrl = await objectStorage.getSignedPutUrl(storageKey, mimeType);
      res.json({ uploadUrl, storageKey, maxFileSizeBytes: MAX_GUARANTOR_DOC_FILE_SIZE_BYTES });
    } catch (error) {
      console.error("HR guarantor upload-url error:", error);
      res.status(500).json({ error: "Could not prepare the upload. Please try again." });
    }
  });

  // Employee-side: Employee + Next of Kin data only. The guarantor section
  // itself is filled by the actual guarantor via the returned signingToken
  // link - see GuarantorFormService and server/routes/guarantor.routes.ts.
  app.post("/api/hr/staff/:staffId/guarantor/initiate", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const staffMember = await authorizeStaffAccess(req, res, req.params.staffId);
      if (!staffMember) return;
      const input = initiateGuarantorFormSchema.parse(req.body);
      const outcome = await guarantorFormService.initiate({ staffId: staffMember.id, createdByUserId: getUserId(req)!, input });
      if (outcome.kind === "refused_already_signed") {
        return res.status(409).json({ error: "This guarantor form has already been signed and cannot be replaced." });
      }
      if (outcome.kind === "invalid") return res.status(400).json({ error: outcome.reason });

      const ctx = await getAuditContext(req, { storeId: staffMember.storeId });
      auditLogger.logEvent(ctx, "HR_GUARANTOR_INITIATED", "hr_guarantor_form", outcome.form.id, "success", {
        details: { staffId: staffMember.id },
      });

      const signingToken = generateGuarantorSigningToken(outcome.form.id);
      notifyGuarantorOfSigningLink({
        staffId: staffMember.id,
        guarantorContactEmail: input.guarantorContactEmail,
        guarantorFormId: outcome.form.id,
        signingToken,
      });

      res.status(201).json({ message: "Guarantor form initiated. We've emailed your guarantor the signing link - you can also share it directly below.", signingToken });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: formatZodErrors(error.errors) });
      console.error("HR guarantor initiate error:", error);
      res.status(500).json({ error: "Could not submit the guarantor form." });
    }
  });
}
