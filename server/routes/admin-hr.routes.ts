import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../db";
import { isAdminAuthenticated, requireAdminRole } from "../auth-admin";
import { hrFieldDefinitionService } from "../services/HrFieldDefinitionService";
import { hrDocumentService } from "../services/HrDocumentService";
import {
  hrFieldSectionEnum,
  hrSectionEnum,
  createHrFieldDefinitionSchema,
  updateHrFieldDefinitionSchema,
  reorderHrFieldDefinitionsSchema,
  createHrDocumentFolderSchema,
  superAdminAuditLogs,
} from "@shared/schema";

/**
 * Super-admin config surface for the HR module's dynamic field builder and
 * per-business section enable/require toggles - see HrFieldDefinitionService
 * and shared/schema/hr-field-definitions.ts / hr-config.ts. Mirrors the
 * isAdminAuthenticated + requireAdminRole gating used throughout
 * server/routes-admin.ts; kept as its own router/file rather than growing
 * that ~2400-line file further.
 */
export const adminHrRouter = Router();

// Mirrors the unexported writeAuditLog() in server/routes-admin.ts (same
// target table, same shape) - not imported from there because that file
// doesn't export it, and duplicating this ~15-line helper is cheaper than
// restructuring that file just to share it.
async function writeAdminAuditLog(req: Request, action: string, target: string, details?: unknown) {
  const admin = (req as any).admin;
  if (!admin) return;
  try {
    await db.insert(superAdminAuditLogs).values({
      adminId: admin.adminId,
      adminEmail: admin.email,
      adminRole: admin.role,
      action,
      target,
      ipAddress: req.ip || "127.0.0.1",
      details: details ? JSON.stringify(details) : null,
    });
  } catch (error) {
    console.error("Admin HR audit log write failure:", error);
  }
}

adminHrRouter.get(
  "/businesses/:businessId/hr/sections",
  isAdminAuthenticated,
  requireAdminRole(["super_admin", "ops_manager"]),
  async (req: Request, res: Response) => {
    res.json(await hrFieldDefinitionService.listSections(req.params.businessId));
  },
);

adminHrRouter.put(
  "/businesses/:businessId/hr/sections/:section",
  isAdminAuthenticated,
  requireAdminRole(["super_admin"]),
  async (req: Request, res: Response) => {
    try {
      const section = hrSectionEnum.find((s) => s === req.params.section);
      if (!section) return res.status(400).json({ error: "Unknown section." });
      const body = z.object({ isEnabled: z.boolean().optional(), isRequiredForOnboarding: z.boolean().optional() }).parse(req.body);
      const row = await hrFieldDefinitionService.updateSection(req.params.businessId, section, body);
      if (!row) return res.status(404).json({ error: "Section config not found for this business." });
      await writeAdminAuditLog(req, "hr_section_updated", req.params.businessId, { section, ...body });
      res.json(row);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0]?.message || "Invalid submission." });
      console.error("Admin HR section update error:", error);
      res.status(500).json({ error: "Could not update this section." });
    }
  },
);

adminHrRouter.get(
  "/businesses/:businessId/hr/fields/:section",
  isAdminAuthenticated,
  requireAdminRole(["super_admin", "ops_manager"]),
  async (req: Request, res: Response) => {
    const section = hrFieldSectionEnum.find((s) => s === req.params.section);
    if (!section) return res.status(400).json({ error: "Unknown section." });
    res.json(await hrFieldDefinitionService.list(req.params.businessId, section));
  },
);

adminHrRouter.post(
  "/businesses/:businessId/hr/fields/:section",
  isAdminAuthenticated,
  requireAdminRole(["super_admin"]),
  async (req: Request, res: Response) => {
    try {
      const section = hrFieldSectionEnum.find((s) => s === req.params.section);
      if (!section) return res.status(400).json({ error: "Unknown section." });
      const input = createHrFieldDefinitionSchema.parse(req.body);
      const result = await hrFieldDefinitionService.create(req.params.businessId, section, input);
      if ("error" in result) return res.status(400).json({ error: result.error });
      await writeAdminAuditLog(req, "hr_field_created", req.params.businessId, { section, fieldKey: input.fieldKey, label: input.label });
      res.status(201).json(result);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0]?.message || "Invalid submission." });
      console.error("Admin HR field create error:", error);
      res.status(500).json({ error: "Could not create this field." });
    }
  },
);

adminHrRouter.patch(
  "/businesses/:businessId/hr/fields/:fieldId",
  isAdminAuthenticated,
  requireAdminRole(["super_admin"]),
  async (req: Request, res: Response) => {
    try {
      const input = updateHrFieldDefinitionSchema.parse(req.body);
      const row = await hrFieldDefinitionService.update(req.params.businessId, req.params.fieldId, input);
      if (!row) return res.status(404).json({ error: "Field not found." });
      await writeAdminAuditLog(req, "hr_field_updated", req.params.fieldId, input);
      res.json(row);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0]?.message || "Invalid submission." });
      console.error("Admin HR field update error:", error);
      res.status(500).json({ error: "Could not update this field." });
    }
  },
);

adminHrRouter.delete(
  "/businesses/:businessId/hr/fields/:fieldId",
  isAdminAuthenticated,
  requireAdminRole(["super_admin"]),
  async (req: Request, res: Response) => {
    const outcome = await hrFieldDefinitionService.remove(req.params.businessId, req.params.fieldId);
    if (outcome.kind === "not_found") return res.status(404).json({ error: "Field not found." });
    if (outcome.kind === "refused_system_field") {
      return res.status(409).json({ error: "This is a default field and cannot be deleted - disable it instead." });
    }
    await writeAdminAuditLog(req, "hr_field_deleted", req.params.fieldId, { businessId: req.params.businessId });
    res.json({ message: "Deleted." });
  },
);

adminHrRouter.post(
  "/businesses/:businessId/hr/fields/:section/reorder",
  isAdminAuthenticated,
  requireAdminRole(["super_admin"]),
  async (req: Request, res: Response) => {
    try {
      const section = hrFieldSectionEnum.find((s) => s === req.params.section);
      if (!section) return res.status(400).json({ error: "Unknown section." });
      const { orderedIds } = reorderHrFieldDefinitionsSchema.parse(req.body);
      await hrFieldDefinitionService.reorder(req.params.businessId, section, orderedIds);
      await writeAdminAuditLog(req, "hr_fields_reordered", req.params.businessId, { section, orderedIds });
      res.json({ message: "Reordered." });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0]?.message || "Invalid submission." });
      console.error("Admin HR field reorder error:", error);
      res.status(500).json({ error: "Could not reorder fields." });
    }
  },
);

adminHrRouter.get(
  "/businesses/:businessId/hr/document-folders",
  isAdminAuthenticated,
  requireAdminRole(["super_admin", "ops_manager"]),
  async (req: Request, res: Response) => {
    res.json(await hrDocumentService.listFolders(req.params.businessId));
  },
);

adminHrRouter.post(
  "/businesses/:businessId/hr/document-folders",
  isAdminAuthenticated,
  requireAdminRole(["super_admin"]),
  async (req: Request, res: Response) => {
    try {
      const input = createHrDocumentFolderSchema.parse(req.body);
      const result = await hrDocumentService.createFolder(req.params.businessId, input);
      if ("error" in result) return res.status(400).json({ error: result.error });
      await writeAdminAuditLog(req, "hr_document_folder_created", req.params.businessId, input);
      res.status(201).json(result);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0]?.message || "Invalid submission." });
      console.error("Admin HR document folder create error:", error);
      res.status(500).json({ error: "Could not create this folder." });
    }
  },
);
