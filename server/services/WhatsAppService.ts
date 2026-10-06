import { db } from "../db";
import { whatsappNumbers, whatsappMessages, whatsappBroadcastRecipients, whatsappBroadcasts } from "@shared/schema";
import { eq, and, lte, sql } from "drizzle-orm";
import { decryptSecret } from "../lib/credentialEncryption";
import { withAdvisoryLock } from "../lib/advisoryLock";

const GRAPH_API_VERSION = process.env.WHATSAPP_GRAPH_API_VERSION || "v21.0";
const RETRY_DELAYS_MS = [60_000, 300_000, 900_000]; // 1 min, 5 min, 15 min
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

type StoreCredentials = { phoneNumberId: string; accessToken: string };

async function getStoreCredentials(storeId: string): Promise<StoreCredentials | null> {
  const [row] = await db
    .select()
    .from(whatsappNumbers)
    .where(and(eq(whatsappNumbers.storeId, storeId), eq(whatsappNumbers.status, "active")));
  if (!row || !row.accessTokenEncrypted) return null;
  try {
    return { phoneNumberId: row.phoneNumberId, accessToken: decryptSecret(row.accessTokenEncrypted) };
  } catch (err) {
    console.error(`[WhatsAppService] Failed to decrypt access token for store ${storeId}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

async function callGraphApi(phoneNumberId: string, accessToken: string, body: unknown): Promise<{ ok: boolean; messageId?: string; errorCode?: string; errorMessage?: string }> {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, errorCode: String(json?.error?.code ?? res.status), errorMessage: json?.error?.message ?? "Unknown WhatsApp API error" };
  }
  return { ok: true, messageId: json?.messages?.[0]?.id };
}

export type TemplateVariables = Record<string, string>;

/**
 * Builds a Cloud API body-component parameter list from a {"1": ..., "2": ...}
 * variable map. Placeholder keys must be sorted numerically, not
 * lexically - "10" sorts before "2" as a string, which would silently swap
 * two template variables in any template with 10+ placeholders.
 */
export function buildTemplateComponents(variables: TemplateVariables): { type: string; parameters: { type: string; text: string }[] }[] | undefined {
  const keys = Object.keys(variables);
  if (keys.length === 0) return undefined;
  return [{
    type: "body",
    parameters: keys.sort((a, b) => Number(a) - Number(b)).map((k) => ({ type: "text", text: variables[k] })),
  }];
}

type QueueEntry = {
  storeId: string;
  customerId?: string;
  toPhoneE164: string;
  messageType: "template" | "text" | "interactive_button" | "interactive_list";
  templateName?: string;
  templateVariables?: TemplateVariables;
  bodyText?: string;
  broadcastId?: string;
  graphBody: unknown;
};

/**
 * Persists the send durably (same contract as EmailQueue.enqueueEmail) then
 * kicks an immediate flush attempt. Returns once queued, not once delivered
 * - actual delivery status arrives later via the status webhook.
 */
async function enqueue(entry: QueueEntry): Promise<string> {
  const [row] = await db.insert(whatsappMessages).values({
    storeId: entry.storeId,
    customerId: entry.customerId,
    direction: "outbound",
    toPhoneE164: entry.toPhoneE164,
    messageType: entry.messageType,
    templateName: entry.templateName,
    templateVariables: entry.templateVariables,
    bodyText: entry.bodyText,
    broadcastId: entry.broadcastId,
    payload: entry.graphBody,
    status: "queued",
  }).returning({ id: whatsappMessages.id });
  withAdvisoryLock("whatsapp-queue", flush).catch(() => undefined);
  return row.id;
}

// Rough rate-limit safeguard: cap how many sends a single store can push per
// 30s flush tick, so a large broadcast drains gradually across ticks instead
// of blasting Meta's per-second limits in one burst. Not a real
// implementation of Meta's messaging-tier math (whatsappNumbers.
// messagingTierLimit is a 24h unique-recipient cap, not a per-second rate) -
// good enough for a first pass; revisit if broadcasts need finer control.
const MAX_SENDS_PER_STORE_PER_TICK = 20;

let flushing = false;

async function flush(): Promise<void> {
  if (flushing) return;
  flushing = true;

  try {
    const due = await db
      .select()
      .from(whatsappMessages)
      .where(and(eq(whatsappMessages.status, "queued"), lte(whatsappMessages.nextAttemptAt, new Date())));

    const sentThisTickByStore = new Map<string, number>();

    for (const item of due) {
      const sentSoFar = sentThisTickByStore.get(item.storeId) ?? 0;
      if (sentSoFar >= MAX_SENDS_PER_STORE_PER_TICK) continue; // picked up next tick
      sentThisTickByStore.set(item.storeId, sentSoFar + 1);

      const creds = await getStoreCredentials(item.storeId);
      if (!creds) {
        console.error(`[WhatsAppService] No active WhatsApp number/credentials for store ${item.storeId} — leaving message ${item.id} queued.`);
        continue;
      }

      const result = await callGraphApi(creds.phoneNumberId, creds.accessToken, item.payload);

      if (result.ok) {
        console.log(`[WhatsAppService] Sent to ${item.toPhoneE164} (attempt ${item.attempts + 1})`);
        await db.update(whatsappMessages).set({
          status: "sent",
          waMessageId: result.messageId,
          attempts: item.attempts + 1,
          sentAt: new Date(),
        }).where(eq(whatsappMessages.id, item.id));
        if (item.broadcastId) {
          await db.update(whatsappBroadcastRecipients).set({ status: "sent" }).where(eq(whatsappBroadcastRecipients.whatsappMessageId, item.id));
          await db.update(whatsappBroadcasts).set({ sentCount: sql`${whatsappBroadcasts.sentCount} + 1` }).where(eq(whatsappBroadcasts.id, item.broadcastId));
        }
      } else {
        console.error(`[WhatsAppService] Send error for ${item.toPhoneE164}: ${result.errorCode} ${result.errorMessage}`);
        const nextAttempts = item.attempts + 1;
        if (nextAttempts >= MAX_ATTEMPTS) {
          await db.update(whatsappMessages).set({
            status: "failed",
            attempts: nextAttempts,
            errorCode: result.errorCode,
            errorMessage: result.errorMessage,
            failedAt: new Date(),
          }).where(eq(whatsappMessages.id, item.id));
          if (item.broadcastId) {
            await db.update(whatsappBroadcastRecipients).set({ status: "failed" }).where(eq(whatsappBroadcastRecipients.whatsappMessageId, item.id));
            await db.update(whatsappBroadcasts).set({ failedCount: sql`${whatsappBroadcasts.failedCount} + 1` }).where(eq(whatsappBroadcasts.id, item.broadcastId));
          }
        } else {
          const delay = RETRY_DELAYS_MS[nextAttempts - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
          await db.update(whatsappMessages).set({
            attempts: nextAttempts,
            nextAttemptAt: new Date(Date.now() + delay),
            errorCode: result.errorCode,
            errorMessage: result.errorMessage,
          }).where(eq(whatsappMessages.id, item.id));
        }
      }
    }
  } catch (err) {
    console.error("[WhatsAppService] Flush error:", err instanceof Error ? err.message : err);
  } finally {
    flushing = false;
  }
}

// Flush every 30 seconds, same cadence as EmailQueue
setInterval(() => withAdvisoryLock("whatsapp-queue", flush).catch(() => undefined), 30_000);

export function flushOnStartup(): void {
  withAdvisoryLock("whatsapp-queue", flush).catch(() => undefined);
}

/**
 * Sends a pre-approved Meta template message. Required outside the 24h
 * customer-service window (e.g. booking reminders) - Cloud API rejects free
 * text there. Returns the queued whatsapp_messages row id (truthy = queued
 * ok), or null if it couldn't even be persisted - mirroring sendEmail/
 * sendSMS's "queued, not delivered" contract used by BookingReminderService.
 * broadcastId links the send back to a campaign (server/repositories/
 * BroadcastRepository.ts) for per-recipient status tracking.
 */
export async function sendTemplateMessage(
  storeId: string,
  toPhoneE164: string,
  templateName: string,
  languageCode: string,
  variables: TemplateVariables,
  customerId?: string,
  broadcastId?: string,
): Promise<string | null> {
  const components = buildTemplateComponents(variables);

  const graphBody = {
    messaging_product: "whatsapp",
    to: toPhoneE164,
    type: "template",
    template: { name: templateName, language: { code: languageCode }, components },
  };

  try {
    return await enqueue({ storeId, customerId, toPhoneE164, messageType: "template", templateName, templateVariables: variables, broadcastId, graphBody });
  } catch (err) {
    console.error("[WhatsAppService] Failed to persist template message to DB:", err);
    return null;
  }
}

/**
 * Free-form text - only deliverable inside Meta's 24h customer-service
 * window (i.e. the customer messaged first, recently). Used by the booking
 * conversation engine, not by reminders.
 */
export async function sendFreeTextMessage(
  storeId: string,
  toPhoneE164: string,
  body: string,
  customerId?: string,
): Promise<boolean> {
  const graphBody = {
    messaging_product: "whatsapp",
    to: toPhoneE164,
    type: "text",
    text: { body },
  };

  try {
    await enqueue({ storeId, customerId, toPhoneE164, messageType: "text", bodyText: body, graphBody });
    return true;
  } catch (err) {
    console.error("[WhatsAppService] Failed to persist text message to DB:", err);
    return false;
  }
}

type InteractiveListSection = { title?: string; rows: { id: string; title: string; description?: string }[] };
export type InteractiveMessage =
  | { kind: "list"; bodyText: string; buttonText: string; sections: InteractiveListSection[] }
  | { kind: "buttons"; bodyText: string; buttons: { id: string; title: string }[] };

/**
 * Interactive list/button messages for the booking conversation engine's
 * structured Q&A (service selection, slot selection, yes/no confirmation).
 * Like sendFreeTextMessage, only deliverable inside the 24h window.
 */
export async function sendInteractiveMessage(
  storeId: string,
  toPhoneE164: string,
  message: InteractiveMessage,
  customerId?: string,
): Promise<boolean> {
  const interactive = message.kind === "list"
    ? {
        type: "list",
        body: { text: message.bodyText },
        action: { button: message.buttonText, sections: message.sections.map((s) => ({ title: s.title, rows: s.rows })) },
      }
    : {
        type: "button",
        body: { text: message.bodyText },
        action: { buttons: message.buttons.map((b) => ({ type: "reply", reply: { id: b.id, title: b.title } })) },
      };

  const graphBody = {
    messaging_product: "whatsapp",
    to: toPhoneE164,
    type: "interactive",
    interactive,
  };

  try {
    await enqueue({
      storeId,
      customerId,
      toPhoneE164,
      messageType: message.kind === "list" ? "interactive_list" : "interactive_button",
      bodyText: message.bodyText,
      graphBody,
    });
    return true;
  } catch (err) {
    console.error("[WhatsAppService] Failed to persist interactive message to DB:", err);
    return false;
  }
}

/**
 * Records a Meta status callback (sent/delivered/read/failed) against the
 * row created in enqueue(), matched by waMessageId - the Cloud API analogue
 * of EmailQueue.recordDeliveryEvent, called from
 * server/routes/whatsapp-webhooks.routes.ts.
 */
export async function recordStatusEvent(
  waMessageId: string,
  status: "sent" | "delivered" | "read" | "failed",
  error?: { code?: string; message?: string },
): Promise<{ toPhoneE164: string | null; storeId: string } | null> {
  const timestampField = status === "delivered" ? { deliveredAt: new Date() }
    : status === "read" ? { readAt: new Date() }
    : status === "failed" ? { failedAt: new Date() }
    : {};

  const [updated] = await db
    .update(whatsappMessages)
    .set({
      status,
      errorCode: error?.code,
      errorMessage: error?.message,
      ...timestampField,
    })
    .where(eq(whatsappMessages.waMessageId, waMessageId))
    .returning({ toPhoneE164: whatsappMessages.toPhoneE164, storeId: whatsappMessages.storeId });
  return updated ?? null;
}

/**
 * Resolves storeId from Meta's phone_number_id, the routing key carried on
 * every inbound webhook payload. Unmatched numbers return null - caller
 * (whatsapp-webhooks.routes.ts) logs and still acks 200 so Meta doesn't retry.
 */
export async function resolveStoreIdByPhoneNumberId(phoneNumberId: string): Promise<string | null> {
  const [row] = await db
    .select({ storeId: whatsappNumbers.storeId })
    .from(whatsappNumbers)
    .where(eq(whatsappNumbers.phoneNumberId, phoneNumberId));
  return row?.storeId ?? null;
}

/**
 * Logs an inbound message. Called from the webhook route before handing off
 * to the (Phase 2) conversation engine.
 */
export async function recordInboundMessage(entry: {
  storeId: string;
  customerId?: string;
  waMessageId: string;
  fromPhoneE164: string;
  messageType: string;
  bodyText?: string;
  payload: unknown;
}): Promise<void> {
  await db.insert(whatsappMessages).values({
    storeId: entry.storeId,
    customerId: entry.customerId,
    direction: "inbound",
    waMessageId: entry.waMessageId,
    fromPhoneE164: entry.fromPhoneE164,
    messageType: entry.messageType,
    bodyText: entry.bodyText,
    payload: entry.payload,
    status: "delivered",
  });
}
