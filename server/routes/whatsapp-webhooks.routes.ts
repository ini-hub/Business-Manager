import type { Express, Request, Response } from "express";
import { verifyMetaWebhookSignature } from "../lib/metaWebhook";
import { resolveStoreIdByPhoneNumberId, recordInboundMessage, recordStatusEvent } from "../services/WhatsAppService";
import { getEffectiveWhatsAppPlatformCredentials } from "../lib/platformConfig";
import { handleInboundMessage } from "../services/WhatsAppBookingConversationEngine";

const STATUS_MAP: Record<string, "sent" | "delivered" | "read" | "failed"> = {
  sent: "sent",
  delivered: "delivered",
  read: "read",
  failed: "failed",
};

/**
 * Meta WhatsApp Cloud API webhook. Configure this URL
 * (https://<app host>/api/webhooks/whatsapp) under the Meta app's
 * WhatsApp > Configuration > Webhook. The verify token and app secret are
 * DB-configured from Super Admin > Platform Settings (rotatable with no
 * redeploy - see server/lib/platformConfig.ts), falling back to the
 * WHATSAPP_VERIFY_TOKEN / WHATSAPP_APP_SECRET env vars for deployments that
 * haven't configured them there yet.
 *
 * Both inbound customer messages and outbound delivery-status callbacks
 * arrive on the same POST payload shape (value.messages vs value.statuses),
 * same as Resend's single endpoint in email-webhooks.routes.ts.
 */
export function registerWhatsAppWebhookRoutes(app: Express): void {
  // Meta's one-time (and periodic re-)verification handshake.
  app.get("/api/webhooks/whatsapp", async (req: Request, res: Response) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    const creds = await getEffectiveWhatsAppPlatformCredentials();
    if (mode === "subscribe" && creds && token === creds.verifyToken) {
      res.status(200).send(challenge);
    } else {
      res.status(403).json({ error: "Verification failed" });
    }
  });

  app.post("/api/webhooks/whatsapp", async (req: Request, res: Response) => {
    try {
      const rawBody = (req as any).rawBody as Buffer;
      const creds = await getEffectiveWhatsAppPlatformCredentials();
      const verified = !!creds && verifyMetaWebhookSignature(rawBody, req.headers["x-hub-signature-256"] as string | undefined, creds.appSecret);
      if (!verified) {
        console.warn("[WhatsAppWebhook] Invalid or unconfigured signature — rejecting.");
        return res.status(401).json({ error: "Invalid signature" });
      }

      const entries = (req.body?.entry ?? []) as any[];
      for (const entry of entries) {
        for (const change of entry?.changes ?? []) {
          const value = change?.value;
          if (!value?.metadata?.phone_number_id) continue;

          const storeId = await resolveStoreIdByPhoneNumberId(value.metadata.phone_number_id);
          if (!storeId) {
            console.warn(`[WhatsAppWebhook] No store registered for phone_number_id ${value.metadata.phone_number_id} — dropping event.`);
            continue;
          }

          for (const message of value.messages ?? []) {
            await recordInboundMessage({
              storeId,
              waMessageId: message.id,
              fromPhoneE164: message.from,
              messageType: message.type ?? "text",
              bodyText: message.text?.body,
              payload: message,
            });
            try {
              await handleInboundMessage(storeId, message.from, message);
            } catch (err) {
              console.error("[WhatsAppWebhook] Conversation engine error:", err);
            }
          }

          for (const status of value.statuses ?? []) {
            const mapped = STATUS_MAP[status.status];
            if (!mapped) continue;
            const matched = await recordStatusEvent(status.id, mapped, status.errors?.[0] ? { code: String(status.errors[0].code), message: status.errors[0].title } : undefined);
            if (matched && mapped === "failed") {
              console.warn(`[WhatsAppWebhook] Delivery failed — to: ${matched.toPhoneE164}, store: ${matched.storeId}`);
            }
          }
        }
      }

      // Ack every event so Meta doesn't retry.
      res.status(200).json({ received: true });
    } catch (error) {
      console.error("[WhatsAppWebhook] processing error:", error);
      res.status(200).json({ received: true });
    }
  });
}
