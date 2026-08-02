import { Resend } from "resend";
import { db } from "../db";
import { pendingEmails } from "@shared/schema";
import { eq, and, lte } from "drizzle-orm";

const RESEND_API_KEY = (process.env.RESEND_API_KEY || "").trim();
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "noreply@kowope.bolujo.com";
const BUSINESS_NAME = process.env.BUSINESS_NAME || "Business Manager";

if (!RESEND_API_KEY) {
  console.warn("[EmailQueue] WARNING: RESEND_API_KEY is not set. Emails will not be sent.");
}

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

const RETRY_DELAYS_MS = [60_000, 300_000, 900_000]; // 1 min, 5 min, 15 min
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

// HTML-only emails (no text/plain part) are a strong spam signal to Gmail's
// filters — derive a plain-text fallback so every message is multipart.
function htmlToText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<(br|\/p|\/div|\/h[1-6])\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

let flushing = false;

async function flush(): Promise<void> {
  if (flushing || !resend) return;
  flushing = true;

  try {
    const due = await db
      .select()
      .from(pendingEmails)
      .where(and(eq(pendingEmails.status, "pending"), lte(pendingEmails.nextAttemptAt, new Date())));

    for (const item of due) {
      try {
        const { error } = await resend.emails.send({
          from: `${BUSINESS_NAME} <${RESEND_FROM_EMAIL}>`,
          to: item.to,
          subject: item.subject,
          html: item.html,
          text: htmlToText(item.html),
          replyTo: item.replyTo || undefined,
        });
        if (error) throw new Error(`${error.name}: ${error.message}`);
        console.log(`[EmailQueue] Sent to ${item.to} (attempt ${item.attempts + 1})`);
        await db.update(pendingEmails).set({ status: "sent", attempts: item.attempts + 1 }).where(eq(pendingEmails.id, item.id));
      } catch (err) {
        console.error(`[EmailQueue] Resend error for ${item.to}:`, err instanceof Error ? err.message : err);
        const nextAttempts = item.attempts + 1;
        if (nextAttempts >= MAX_ATTEMPTS) {
          console.error(`[EmailQueue] Dropped after ${nextAttempts} attempts — to: ${item.to}, subject: ${item.subject}`);
          await db.update(pendingEmails).set({ status: "failed", attempts: nextAttempts }).where(eq(pendingEmails.id, item.id));
        } else {
          const delay = RETRY_DELAYS_MS[nextAttempts - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
          const nextAttemptAt = new Date(Date.now() + delay);
          console.warn(`[EmailQueue] Retry ${nextAttempts}/${MAX_ATTEMPTS - 1} in ${delay / 1000}s for ${item.to}`);
          await db.update(pendingEmails).set({ attempts: nextAttempts, nextAttemptAt }).where(eq(pendingEmails.id, item.id));
        }
      }
    }
  } catch (err) {
    console.error("[EmailQueue] Flush error:", err instanceof Error ? err.message : err);
  } finally {
    flushing = false;
  }
}

// Flush every 30 seconds
setInterval(flush, 30_000);

// Call this on server startup to drain emails queued during downtime
export function flushOnStartup(): void {
  flush().catch(() => undefined);
}

export function sendEmail(payload: { to: string; subject: string; html: string; replyTo?: string }): void {
  db.insert(pendingEmails).values({
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
    replyTo: payload.replyTo,
  }).then(() => {
    flush().catch(() => undefined);
  }).catch((err) => {
    console.error("[EmailQueue] Failed to persist email to DB:", err);
  });
}

export async function getQueueStats(): Promise<{ pending: number; failed: number }> {
  const rows = await db.select({ status: pendingEmails.status }).from(pendingEmails)
    .where(eq(pendingEmails.status, "pending"));
  const failedRows = await db.select({ status: pendingEmails.status }).from(pendingEmails)
    .where(eq(pendingEmails.status, "failed"));
  return { pending: rows.length, failed: failedRows.length };
}
