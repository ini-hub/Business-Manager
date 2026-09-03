import type { Express, Request, Response } from "express";
import { verifyResendWebhookSignature } from "../lib/resendWebhook";
import { recordDeliveryEvent, type DeliveryStatus } from "../services/EmailQueue";

const RESEND_WEBHOOK_SECRET = (process.env.RESEND_WEBHOOK_SECRET || "").trim();

if (!RESEND_WEBHOOK_SECRET) {
  console.warn("[EmailWebhook] WARNING: RESEND_WEBHOOK_SECRET is not set. Delivery events will be rejected.");
}

// Resend event types -> the outcome we care about recording. Everything else
// (email.sent, email.opened, email.clicked, etc.) is acknowledged but not
// persisted - "sent" is already tracked by EmailQueue itself, and opens/
// clicks aren't a delivery-failure signal worth a column for.
const EVENT_TO_STATUS: Record<string, DeliveryStatus> = {
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.delivery_delayed": "delayed",
};

/**
 * Fills the gap flagged in EmailQueue.flush(): the "[EmailQueue] Sent" log
 * only means Resend's API accepted the send, never that it actually reached
 * an inbox. This is what a malformed Subject header (see
 * server/sanitize.ts's sanitizeHeaderValue) hid behind for the signup OTP
 * email - Resend returned 2xx, the app logged success, and the only real
 * signal that something was wrong was a user saying "it never arrived."
 *
 * Configure this URL (https://<app host>/api/webhooks/resend) and the
 * email.delivered / email.bounced / email.complained / email.delivery_delayed
 * events under Resend's dashboard -> Webhooks, then set the signing secret
 * it gives you as RESEND_WEBHOOK_SECRET.
 */
export function registerEmailWebhookRoutes(app: Express): void {
  app.post("/api/webhooks/resend", async (req: Request, res: Response) => {
    try {
      const rawBody = (req as any).rawBody as Buffer;
      const verified =
        !!RESEND_WEBHOOK_SECRET &&
        verifyResendWebhookSignature(
          rawBody,
          {
            svixId: req.headers["svix-id"] as string | undefined,
            svixTimestamp: req.headers["svix-timestamp"] as string | undefined,
            svixSignature: req.headers["svix-signature"] as string | undefined,
          },
          RESEND_WEBHOOK_SECRET,
        );
      if (!verified) {
        console.warn("[EmailWebhook] Invalid or unconfigured Resend signature - rejecting.");
        return res.status(401).json({ error: "Invalid signature" });
      }

      const { type, data } = req.body as { type?: string; data?: { email_id?: string } };
      const status = type ? EVENT_TO_STATUS[type] : undefined;
      const emailId = data?.email_id;

      if (status && emailId) {
        const matched = await recordDeliveryEvent(emailId, status);
        if (matched && (status === "bounced" || status === "complained")) {
          console.warn(`[EmailWebhook] ${status} — to: ${matched.to}, subject: ${matched.subject}`);
        }
      }

      // Ack every event (including ones we don't track) so Resend doesn't retry.
      res.status(200).json({ received: true });
    } catch (error) {
      console.error("[EmailWebhook] processing error:", error);
      res.status(200).json({ received: true });
    }
  });
}
