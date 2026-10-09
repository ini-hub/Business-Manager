import type { Express, Request, Response } from "express";
import { db } from "../db";
import { whatsappNumbers } from "@shared/schema";
import { eq } from "drizzle-orm";
import { encryptSecret } from "../lib/credentialEncryption";
import { discoverWhatsAppNumbers, MetaGraphError } from "../lib/metaGraphDiscovery";
import { requirePermission } from "../lib/permissionGate";

export type RouteMiddlewares = {
  isAuthenticated: any;
  requireRole: (...roles: any[]) => any;
  requireManagerOrOwner: any;
  checkStoreAccess: (storeId: string, req: Request, res: Response) => Promise<boolean>;
};

const MASK = "••••••••••••••••";

/**
 * Lets a store owner/manager connect or change the WhatsApp number their
 * store's customers message (shared/schema/whatsapp.ts's whatsappNumbers) -
 * previously only settable via scripts/register-whatsapp-number.ts. Distinct
 * from the platform-wide app secret/verify token in Super Admin > Platform
 * Settings (server/routes-admin.ts), which every store's webhook routes
 * through regardless of which store's number sent the message.
 */
export function registerWhatsAppNumberRoutes(app: Express, { isAuthenticated, requireManagerOrOwner, checkStoreAccess }: RouteMiddlewares): void {
  app.get("/api/stores/:storeId/whatsapp-number", isAuthenticated, async (req: Request, res: Response) => {
    const { storeId } = req.params;
    if (!(await checkStoreAccess(storeId, req, res))) return;

    try {
      const [row] = await db.select().from(whatsappNumbers).where(eq(whatsappNumbers.storeId, storeId));
      if (!row) return res.json(null);
      res.json({
        phoneNumberId: row.phoneNumberId,
        wabaId: row.wabaId,
        displayPhoneNumber: row.displayPhoneNumber,
        status: row.status,
        qualityRating: row.qualityRating,
        accessTokenSet: !!row.accessTokenEncrypted,
        updatedAt: row.updatedAt,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to load WhatsApp number." });
    }
  });

  // Given a system-user access token, discovers the WhatsApp numbers it can
  // see via Meta's Graph API, so the owner picks their number from a list
  // instead of manually finding/typing phone_number_id and waba_id. Never
  // persists anything - PUT below does that once a number is picked.
  app.post("/api/stores/:storeId/whatsapp-number/discover", requirePermission("/settings"), async (req: Request, res: Response) => {
    const { storeId } = req.params;
    if (!(await checkStoreAccess(storeId, req, res))) return;

    const { accessToken } = req.body;
    if (!accessToken || typeof accessToken !== "string") {
      return res.status(400).json({ error: "accessToken is required." });
    }

    try {
      const wabas = await discoverWhatsAppNumbers(accessToken);
      res.json({ wabas });
    } catch (error) {
      if (error instanceof MetaGraphError) {
        return res.status(400).json({ error: error.message });
      }
      console.error("[WhatsAppNumber] discover error:", error);
      res.status(500).json({ error: "Couldn't reach Meta to discover numbers. Try again in a moment." });
    }
  });

  app.put("/api/stores/:storeId/whatsapp-number", requirePermission("/settings"), async (req: Request, res: Response) => {
    const { storeId } = req.params;
    if (!(await checkStoreAccess(storeId, req, res))) return;

    const { phoneNumberId, wabaId, displayPhoneNumber, accessToken, status } = req.body;
    if (!phoneNumberId || !wabaId) {
      return res.status(400).json({ error: "phoneNumberId and wabaId are required." });
    }

    try {
      const [existing] = await db.select().from(whatsappNumbers).where(eq(whatsappNumbers.storeId, storeId));

      // phone_number_id is the webhook routing key (server/services/
      // WhatsAppService.ts's resolveStoreIdByPhoneNumberId) - it must stay
      // unique across stores, or an inbound message could route to the
      // wrong business.
      if (phoneNumberId !== existing?.phoneNumberId) {
        const [collision] = await db.select().from(whatsappNumbers).where(eq(whatsappNumbers.phoneNumberId, phoneNumberId));
        if (collision && collision.storeId !== storeId) {
          return res.status(409).json({ error: "This WhatsApp number is already connected to a different store." });
        }
      }

      // Sentinel-compare-on-write, same convention as storeIntegrations
      // (client/src/pages/settings/components/store-integrations.tsx) - the
      // masked bullet value means "unchanged", never overwrite with it.
      let accessTokenEncrypted = existing?.accessTokenEncrypted ?? null;
      if (typeof accessToken === "string" && accessToken !== MASK) {
        accessTokenEncrypted = accessToken ? encryptSecret(accessToken) : null;
      }

      const values = {
        storeId,
        phoneNumberId,
        wabaId,
        displayPhoneNumber: displayPhoneNumber || null,
        accessTokenEncrypted,
        status: status === "disabled" ? "disabled" : (existing?.status ?? "active"),
        updatedAt: new Date(),
      };

      const [saved] = existing
        ? await db.update(whatsappNumbers).set(values).where(eq(whatsappNumbers.id, existing.id)).returning()
        : await db.insert(whatsappNumbers).values(values).returning();

      res.json({
        phoneNumberId: saved.phoneNumberId,
        wabaId: saved.wabaId,
        displayPhoneNumber: saved.displayPhoneNumber,
        status: saved.status,
        accessTokenSet: !!saved.accessTokenEncrypted,
      });
    } catch (error) {
      console.error("[WhatsAppNumber] update error:", error);
      res.status(500).json({ error: "Failed to save WhatsApp number." });
    }
  });
}
