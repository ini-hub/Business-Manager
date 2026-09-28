import type { Express, Request, Response } from "express";
import { WhatsAppTemplateRepository } from "../repositories/WhatsAppTemplateRepository";
import { whatsappTemplateCategoryEnum, whatsappTemplateStatusEnum } from "@shared/schema";

export type RouteMiddlewares = {
  isAuthenticated: any;
  requireRole: (...roles: any[]) => any;
  requireManagerOrOwner: any;
  checkStoreAccess: (storeId: string, req: Request, res: Response) => Promise<boolean>;
};

const templateRepository = new WhatsAppTemplateRepository();

/**
 * Registry for the Meta-approved templates a store can use in broadcasts
 * (server/routes/broadcast.routes.ts only lists status="approved" ones for
 * the composer). Meta approval itself happens outside this app - staff
 * submit the template in their Meta Business account, then mirror its
 * result here (name, body, category) so the composer knows it exists and
 * what its placeholders mean. variableCount is derived server-side from the
 * body text (server/lib/whatsappTemplateVariables.ts), never trusted from
 * the client.
 */
export function registerWhatsAppTemplateRoutes(app: Express, { isAuthenticated, requireManagerOrOwner, checkStoreAccess }: RouteMiddlewares): void {
  app.get("/api/stores/:storeId/whatsapp-templates", isAuthenticated, async (req: Request, res: Response) => {
    const { storeId } = req.params;
    if (!(await checkStoreAccess(storeId, req, res))) return;

    try {
      const templates = await templateRepository.list(storeId);
      res.json(templates);
    } catch (error) {
      res.status(500).json({ error: "Failed to load templates." });
    }
  });

  app.post("/api/stores/:storeId/whatsapp-templates", requireManagerOrOwner, async (req: Request, res: Response) => {
    const { storeId } = req.params;
    if (!(await checkStoreAccess(storeId, req, res))) return;

    const { metaTemplateName, category, language, bodyText, variableLabels, status } = req.body;
    if (!metaTemplateName || !category || !bodyText) {
      return res.status(400).json({ error: "metaTemplateName, category, and bodyText are required." });
    }
    if (!whatsappTemplateCategoryEnum.includes(category)) {
      return res.status(400).json({ error: `category must be one of: ${whatsappTemplateCategoryEnum.join(", ")}` });
    }
    if (status && !whatsappTemplateStatusEnum.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${whatsappTemplateStatusEnum.join(", ")}` });
    }

    try {
      const template = await templateRepository.create({
        storeId,
        metaTemplateName,
        metaTemplateId: null,
        category,
        language: language || "en_US",
        bodyText,
        variableLabels: variableLabels ?? null,
        status: status || "pending",
      } as any);
      res.status(201).json(template);
    } catch (error) {
      console.error("[WhatsAppTemplate] create error:", error);
      res.status(500).json({ error: "Failed to create template." });
    }
  });

  app.put("/api/stores/:storeId/whatsapp-templates/:id", requireManagerOrOwner, async (req: Request, res: Response) => {
    const { storeId, id } = req.params;
    if (!(await checkStoreAccess(storeId, req, res))) return;

    try {
      const existing = await templateRepository.get(id);
      if (!existing || existing.storeId !== storeId) {
        return res.status(404).json({ error: "Template not found." });
      }

      const { metaTemplateName, category, language, bodyText, variableLabels, status } = req.body;
      if (category && !whatsappTemplateCategoryEnum.includes(category)) {
        return res.status(400).json({ error: `category must be one of: ${whatsappTemplateCategoryEnum.join(", ")}` });
      }
      if (status && !whatsappTemplateStatusEnum.includes(status)) {
        return res.status(400).json({ error: `status must be one of: ${whatsappTemplateStatusEnum.join(", ")}` });
      }

      const updated = await templateRepository.update(id, {
        ...(metaTemplateName !== undefined && { metaTemplateName }),
        ...(category !== undefined && { category }),
        ...(language !== undefined && { language }),
        ...(bodyText !== undefined && { bodyText }),
        ...(variableLabels !== undefined && { variableLabels }),
        ...(status !== undefined && { status }),
      });
      res.json(updated);
    } catch (error) {
      console.error("[WhatsAppTemplate] update error:", error);
      res.status(500).json({ error: "Failed to update template." });
    }
  });

  // Soft-disable rather than delete - a disabled template stays visible in
  // history for broadcasts already sent with it (whatsappBroadcasts.templateId
  // references it), just excluded from new campaigns.
  app.post("/api/stores/:storeId/whatsapp-templates/:id/disable", requireManagerOrOwner, async (req: Request, res: Response) => {
    const { storeId, id } = req.params;
    if (!(await checkStoreAccess(storeId, req, res))) return;

    try {
      const existing = await templateRepository.get(id);
      if (!existing || existing.storeId !== storeId) {
        return res.status(404).json({ error: "Template not found." });
      }
      const updated = await templateRepository.update(id, { status: "disabled" });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to disable template." });
    }
  });
}
