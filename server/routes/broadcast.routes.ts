import { parsePage, paginated } from "../lib/pagination";
import type { Express, Request, Response } from "express";
import { db } from "../db";
import { inArray } from "drizzle-orm";
import { customers } from "@shared/schema";
import { BroadcastRepository } from "../repositories/BroadcastRepository";
import { sendTemplateMessage } from "../services/WhatsAppService";
import { getUserId } from "./helpers";

export type RouteMiddlewares = {
  isAuthenticated: any;
  requireRole: (...roles: any[]) => any;
  requireManagerOrOwner: any;
  checkStoreAccess: (storeId: string, req: Request, res: Response) => Promise<boolean>;
};

const broadcastRepository = new BroadcastRepository();

/**
 * Staff-facing broadcast/campaign endpoints - select customers, pick an
 * approved template, fill in the merge-field mapping, send. Actual delivery
 * happens through WhatsAppService's existing queue/throttle/retry flush loop
 * (server/services/WhatsAppService.ts) - this only enqueues each recipient's
 * send and links it back to the broadcast for status tracking.
 */
export function registerBroadcastRoutes(app: Express, { isAuthenticated, requireManagerOrOwner, checkStoreAccess }: RouteMiddlewares): void {
  app.get("/api/whatsapp/templates", isAuthenticated, async (req: Request, res: Response) => {
    const storeId = req.query.storeId as string;
    if (!storeId) return res.status(400).json({ error: "Store ID is required." });
    if (!(await checkStoreAccess(storeId, req, res))) return;

    try {
      const templates = await broadcastRepository.listTemplates(storeId);
      res.json(templates);
    } catch (error) {
      res.status(500).json({ error: "Failed to load WhatsApp templates." });
    }
  });

  app.get("/api/whatsapp/broadcasts", isAuthenticated, async (req: Request, res: Response) => {
    const storeId = req.query.storeId as string;
    if (!storeId) return res.status(400).json({ error: "Store ID is required." });
    if (!(await checkStoreAccess(storeId, req, res))) return;

    try {
      const page = parsePage(req.query);
      const { rows, total } = await broadcastRepository.listBroadcastsPage(storeId, page);
      res.json(paginated(rows, total, page));
    } catch (error) {
      res.status(500).json({ error: "Failed to load broadcasts." });
    }
  });

  app.get("/api/whatsapp/broadcasts/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const broadcast = await broadcastRepository.getBroadcast(req.params.id);
      if (!broadcast) return res.status(404).json({ error: "Broadcast not found." });
      if (!(await checkStoreAccess(broadcast.storeId, req, res))) return;

      const recipients = await broadcastRepository.getRecipients(broadcast.id);
      res.json({ broadcast, recipients: recipients.map((r) => ({ ...r.recipient, customerName: r.customerName })) });
    } catch (error) {
      res.status(500).json({ error: "Failed to load broadcast." });
    }
  });

  app.post("/api/whatsapp/broadcasts", requireManagerOrOwner, async (req: Request, res: Response) => {
    const { storeId, name, templateId, variableMapping, customerIds } = req.body;
    if (!storeId || !name || !templateId || !Array.isArray(customerIds) || customerIds.length === 0) {
      return res.status(400).json({ error: "storeId, name, templateId, and a non-empty customerIds list are required." });
    }
    if (!(await checkStoreAccess(storeId, req, res))) return;

    try {
      // Server-side opt-in enforcement - never trust the UI's selection alone
      // (Phase 4 compliance requirement).
      const optedIn = await broadcastRepository.filterOptedInCustomerIds(customerIds);
      const excluded = customerIds.length - optedIn.length;

      const broadcast = await broadcastRepository.createBroadcast(
        {
          storeId,
          createdByStaffId: getUserId(req),
          name,
          templateId,
          variableMapping: variableMapping ?? {},
          status: "draft",
        } as any,
        optedIn,
      );

      res.json({ broadcast, excludedForConsent: excluded });
    } catch (error) {
      console.error("[Broadcast] create error:", error);
      res.status(500).json({ error: "Failed to create broadcast." });
    }
  });

  app.post("/api/whatsapp/broadcasts/:id/send", requireManagerOrOwner, async (req: Request, res: Response) => {
    try {
      const broadcast = await broadcastRepository.getBroadcast(req.params.id);
      if (!broadcast) return res.status(404).json({ error: "Broadcast not found." });
      if (!(await checkStoreAccess(broadcast.storeId, req, res))) return;
      if (broadcast.status !== "draft") return res.status(400).json({ error: `Broadcast is already ${broadcast.status}.` });

      await broadcastRepository.markSending(broadcast.id);

      const recipients = await broadcastRepository.getRecipients(broadcast.id);
      const template = (await broadcastRepository.listTemplates(broadcast.storeId)).find((t) => t.id === broadcast.templateId);
      if (!template) {
        return res.status(400).json({ error: "The template for this broadcast is no longer approved/available." });
      }

      const mapping = (broadcast.variableMapping ?? {}) as Record<string, string>;

      // Batch-load all customers in one query instead of N queries
      const customerIds = recipients.map(r => r.recipient.customerId);
      const allCustomers = customerIds.length > 0
        ? await db.select().from(customers).where(inArray(customers.id, customerIds))
        : [];
      const customerMap = new Map(allCustomers.map(c => [c.id, c]));

      for (const { recipient, customerName } of recipients) {
        const customer = customerMap.get(recipient.customerId);
        if (!customer?.mobileNumber) continue;
        const phone = `${customer.countryCode || "+234"}${customer.mobileNumber.replace(/^0/, "")}`;

        const variables: Record<string, string> = {};
        for (const [placeholder, field] of Object.entries(mapping)) {
          variables[placeholder] = field === "customer.name" ? (customerName ?? customer.name) : field;
        }

        const messageId = await sendTemplateMessage(broadcast.storeId, phone, template.metaTemplateName, template.language, variables, customer.id, broadcast.id);
        if (messageId) {
          await broadcastRepository.setRecipientMessage(recipient.id, messageId);
        }
      }

      res.json({ success: true });
    } catch (error) {
      console.error("[Broadcast] send error:", error);
      res.status(500).json({ error: "Failed to start sending broadcast." });
    }
  });
}
