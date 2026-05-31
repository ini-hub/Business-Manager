import nodemailer from "nodemailer";

const GMAIL_USER = (process.env.GMAIL_USER || "ebolujo101@gmail.com").trim();
const GMAIL_APP_PASSWORD = (process.env.GMAIL_APP_PASSWORD || "yfbr epll pzch cjcp").replace(/\s/g, "");
const BUSINESS_NAME = process.env.BUSINESS_NAME || "Excellent Bolujo";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
});

interface QueueItem {
  id: string;
  to: string;
  subject: string;
  html: string;
  attempts: number;
  nextAttemptAt: number;
}

const RETRY_DELAYS_MS = [60_000, 300_000, 900_000]; // 1 min, 5 min, 15 min
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

const queue: QueueItem[] = [];
let flushing = false;

function enqueue(to: string, subject: string, html: string): void {
  queue.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    to,
    subject,
    html,
    attempts: 0,
    nextAttemptAt: Date.now(),
  });
}

async function flush(): Promise<void> {
  if (flushing) return;
  flushing = true;
  const now = Date.now();
  const due = queue.filter(item => item.nextAttemptAt <= now);

  for (const item of due) {
    try {
      await transporter.sendMail({
        from: `"${BUSINESS_NAME}" <${GMAIL_USER}>`,
        to: item.to,
        subject: item.subject,
        html: item.html,
      });
      console.log(`[EmailQueue] Sent to ${item.to} (attempt ${item.attempts + 1})`);
      const idx = queue.indexOf(item);
      if (idx !== -1) queue.splice(idx, 1);
    } catch (err) {
      item.attempts++;
      if (item.attempts >= MAX_ATTEMPTS) {
        console.error(`[EmailQueue] Dropped after ${item.attempts} attempts — to: ${item.to}, subject: ${item.subject}`);
        const idx = queue.indexOf(item);
        if (idx !== -1) queue.splice(idx, 1);
      } else {
        const delay = RETRY_DELAYS_MS[item.attempts - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
        item.nextAttemptAt = Date.now() + delay;
        console.warn(`[EmailQueue] Retry ${item.attempts}/${MAX_ATTEMPTS - 1} scheduled in ${delay / 1000}s for ${item.to}`);
      }
    }
  }
  flushing = false;
}

// Start the flush loop — runs every 30 seconds
setInterval(flush, 30_000);

export function sendEmail(payload: { to: string; subject: string; html: string }): void {
  enqueue(payload.to, payload.subject, payload.html);
  // Fire immediately without waiting — failures will retry
  flush().catch(() => undefined);
}

export function getQueueLength(): number {
  return queue.length;
}
