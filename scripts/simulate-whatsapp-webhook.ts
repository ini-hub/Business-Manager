/**
 * Fires a fake, correctly-signed Meta WhatsApp Cloud API webhook payload at
 * a locally running server, so the full inbound pipeline (signature
 * verification -> store routing -> WhatsAppBookingConversationEngine) can
 * be exercised end-to-end without a real Meta app or test number.
 *
 * Signs with whatever app secret the server would actually check
 * (getEffectiveWhatsAppPlatformCredentials - DB-configured in Super Admin >
 * Platform Settings, falling back to WHATSAPP_APP_SECRET), so this only
 * works once *something* is configured there, even a made-up local value.
 *
 * Usage:
 *   npx tsx scripts/simulate-whatsapp-webhook.ts message <phoneNumberId> <fromPhone> "some text"
 *   npx tsx scripts/simulate-whatsapp-webhook.ts list-reply <phoneNumberId> <fromPhone> svc:abc123
 *   npx tsx scripts/simulate-whatsapp-webhook.ts button-reply <phoneNumberId> <fromPhone> confirm:yes
 *   npx tsx scripts/simulate-whatsapp-webhook.ts status <phoneNumberId> <waMessageId> delivered
 *
 * Optional: set SIMULATE_URL to point somewhere other than http://localhost:5000.
 */
import crypto from "crypto";
import { getEffectiveWhatsAppPlatformCredentials } from "../server/lib/platformConfig";

const BASE_URL = process.env.SIMULATE_URL || "http://localhost:5000";

function sign(body: string, secret: string): string {
  return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
}

async function post(body: unknown, appSecret: string): Promise<void> {
  const json = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}/api/webhooks/whatsapp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": sign(json, appSecret),
    },
    body: json,
  });
  const text = await res.text();
  console.log(`-> ${res.status} ${res.statusText}`);
  console.log(text);
}

function messagePayload(phoneNumberId: string, from: string, message: Record<string, unknown>) {
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: "simulated-waba-id",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: from, phone_number_id: phoneNumberId },
          contacts: [{ profile: { name: "Simulated Customer" }, wa_id: from }],
          messages: [{
            from,
            id: `wamid.simulated-${Date.now()}`,
            timestamp: String(Math.floor(Date.now() / 1000)),
            ...message,
          }],
        },
      }],
    }],
  };
}

function statusPayload(phoneNumberId: string, waMessageId: string, status: string) {
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: "simulated-waba-id",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: "0000000000", phone_number_id: phoneNumberId },
          statuses: [{
            id: waMessageId,
            status,
            timestamp: String(Math.floor(Date.now() / 1000)),
            recipient_id: "0000000000",
          }],
        },
      }],
    }],
  };
}

async function main() {
  const [kind, ...rest] = process.argv.slice(2);
  const creds = await getEffectiveWhatsAppPlatformCredentials();
  if (!creds) {
    console.error("No WhatsApp platform app secret configured (Super Admin > Platform Settings, or WHATSAPP_APP_SECRET env var). Nothing to sign with.");
    process.exit(1);
  }

  switch (kind) {
    case "message": {
      const [phoneNumberId, from, ...textParts] = rest;
      if (!phoneNumberId || !from) throw new Error("Usage: message <phoneNumberId> <fromPhone> \"text\"");
      const body = messagePayload(phoneNumberId, from, { type: "text", text: { body: textParts.join(" ") || "Hi" } });
      await post(body, creds.appSecret);
      break;
    }
    case "list-reply": {
      const [phoneNumberId, from, replyId] = rest;
      if (!phoneNumberId || !from || !replyId) throw new Error("Usage: list-reply <phoneNumberId> <fromPhone> <replyId>");
      const body = messagePayload(phoneNumberId, from, {
        type: "interactive",
        interactive: { type: "list_reply", list_reply: { id: replyId, title: replyId } },
      });
      await post(body, creds.appSecret);
      break;
    }
    case "button-reply": {
      const [phoneNumberId, from, replyId] = rest;
      if (!phoneNumberId || !from || !replyId) throw new Error("Usage: button-reply <phoneNumberId> <fromPhone> <replyId>");
      const body = messagePayload(phoneNumberId, from, {
        type: "interactive",
        interactive: { type: "button_reply", button_reply: { id: replyId, title: replyId } },
      });
      await post(body, creds.appSecret);
      break;
    }
    case "status": {
      const [phoneNumberId, waMessageId, status] = rest;
      if (!phoneNumberId || !waMessageId || !status) throw new Error("Usage: status <phoneNumberId> <waMessageId> <sent|delivered|read|failed>");
      const body = statusPayload(phoneNumberId, waMessageId, status);
      await post(body, creds.appSecret);
      break;
    }
    default:
      console.error("Unknown command. Use: message | list-reply | button-reply | status");
      process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
