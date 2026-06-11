import nodemailer from "nodemailer";
import { db } from "../db";
import { pendingEmails } from "@shared/schema";
import { eq, and, lte } from "drizzle-orm";

const RESEND_API_KEY = (process.env.RESEND_API_KEY || "").trim();
const EMAIL_FROM = (process.env.EMAIL_FROM || "").trim();
const BUSINESS_NAME = process.env.BUSINESS_NAME || "Business Manager";

if (!RESEND_API_KEY || !EMAIL_FROM) {
  console.warn("[EmailQueue] WARNING: RESEND_API_KEY or EMAIL_FROM is not set. Emails will not be sent.");
}

const transporter = nodemailer.createTransport({
  host: "smtp.resend.com",
  port: 465,
  secure: true,
  auth: { user: "resend", pass: RESEND_API_KEY },
});

const RETRY_DELAYS_MS = [60_000, 300_000, 900_000]; // 1 min, 5 min, 15 min
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

let flushing = false;

async function flush(): Promise<void> {
  if (flushing || !RESEND_API_KEY || !EMAIL_FROM) return;
  flushing = true;

  try {
    const due = await db
      .select()
      .from(pendingEmails)
      .where(and(eq(pendingEmails.status, "pending"), lte(pendingEmails.nextAttemptAt, new Date())));

    for (const item of due) {
      try {
        await transporter.sendMail({
          from: `"${BUSINESS_NAME}" <${EMAIL_FROM}>`,
          to: item.to,
          subject: item.subject,
          html: item.html,
        });
        console.log(`[EmailQueue] Sent to ${item.to} (attempt ${item.attempts + 1})`);
        await db.update(pendingEmails).set({ status: "sent", attempts: item.attempts + 1 }).where(eq(pendingEmails.id, item.id));
      } catch (err) {
        console.error(`[EmailQueue] SMTP error for ${item.to}:`, err instanceof Error ? err.message : err);
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

export function sendEmail(payload: { to: string; subject: string; html: string }): void {
  db.insert(pendingEmails).values({
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
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
