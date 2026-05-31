import { db } from "../db";
import { creditEntries, reminderLogs, settings, customers, stores } from "@shared/schema";
import { eq, and, inArray, isNotNull, gte, lte } from "drizzle-orm";
import { sendSMS } from "../email";

const POLL_INTERVAL_MS = 60 * 60 * 1000; // every hour

function today(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-NG");
}

function buildMessage(customerName: string, businessName: string, balance: number, dueDate: string | null, isOverdue: boolean, language: string): string {
  const formattedDate = dueDate ? new Date(dueDate).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }) : "";
  const amount = `₦${formatNumber(balance)}`;

  if (language === "pidgin") {
    return isOverdue
      ? `Hello ${customerName},\n\nYour balance of ${amount} for ${businessName} don pass the due date wey una agree.\n\nAbeg reach us make we sort am out.\nWe appreciate your business! 🙏`
      : `Hello ${customerName}! 👋\n\nThis na ${businessName}.\nYou get balance of ${amount} wey due on ${formattedDate}.\n\nIf you don pay already, abeg ignore this message.\nIf not, make you try settle before the date.\n\nThank you! 🙏`;
  }
  return isOverdue
    ? `Hello ${customerName},\n\nThis is a reminder from ${businessName}.\nYour balance of ${amount} has passed its agreed due date.\n\nPlease contact us as soon as possible to sort this out.\nThank you! 🙏`
    : `Hello ${customerName},\n\nThis is a reminder from ${businessName}.\nYou have an outstanding balance of ${amount} due on ${formattedDate}.\n\nPlease arrange payment before the due date.\nThank you! 🙏`;
}

async function wasRecentlySentFor(creditEntryId: string, windowStart: Date): Promise<boolean> {
  const [log] = await db
    .select({ id: reminderLogs.id })
    .from(reminderLogs)
    .where(and(
      eq(reminderLogs.creditEntryId, creditEntryId),
      eq(reminderLogs.type, "auto"),
      gte(reminderLogs.createdAt, windowStart)
    ))
    .limit(1);
  return !!log;
}

async function processStore(storeId: string, storeName: string): Promise<void> {
  // Load store settings
  const [storeSettings] = await db.select().from(settings).where(eq(settings.storeId, storeId)).limit(1);

  const daysBefore = storeSettings?.borrowBookReminderDaysBefore ?? 2;
  const onDueDate = storeSettings?.borrowBookReminderOnDueDate ?? true;
  const daysAfter = storeSettings?.borrowBookReminderDaysAfter ?? 3;
  const repeatDays = storeSettings?.borrowBookReminderRepeatDays ?? 7;
  const stopDays = storeSettings?.borrowBookReminderStopDays ?? 30;
  const language = storeSettings?.borrowBookReminderLanguage ?? "both";

  const now = today();

  // Get all active credit entries with a due date
  const entries = await db
    .select()
    .from(creditEntries)
    .where(and(
      eq(creditEntries.storeId, storeId),
      inArray(creditEntries.status, ["owing", "partial", "overdue"]),
      isNotNull(creditEntries.dueDate)
    ));

  for (const entry of entries) {
    if (!entry.dueDate) continue;
    const due = new Date(entry.dueDate);
    due.setHours(0, 0, 0, 0);

    const daysUntilDue = daysBetween(now, due);  // negative if overdue
    const daysOverdue = daysBetween(due, now);    // positive if overdue

    let shouldSend = false;
    let windowStart = new Date(now);

    if (daysUntilDue === daysBefore) {
      // Pre-due reminder
      shouldSend = true;
      windowStart = addDays(now, -1); // dedupe: one reminder per 24 h window
    } else if (daysUntilDue === 0 && onDueDate) {
      // Due-date reminder
      shouldSend = true;
      windowStart = addDays(now, -1);
    } else if (daysOverdue >= daysAfter && daysOverdue <= stopDays) {
      // Post-due repeating reminders
      const cyclePosition = (daysOverdue - daysAfter) % repeatDays;
      if (cyclePosition === 0) {
        shouldSend = true;
        windowStart = addDays(now, -(repeatDays - 1));
      }
    }

    if (!shouldSend) continue;

    // Deduplicate: skip if already sent in this window
    if (await wasRecentlySentFor(entry.id, windowStart)) continue;

    // Load customer
    const customer = await db.select().from(customers).where(eq(customers.id, entry.customerId)).limit(1).then(r => r[0]);
    if (!customer?.mobileNumber) continue;

    const isOverdue = daysOverdue > 0;
    const phone = `${customer.countryCode || "+234"}${customer.mobileNumber.replace(/^0/, "")}`;
    const langs = language === "both" ? ["english", "pidgin"] : [language];

    for (const lang of langs) {
      const message = buildMessage(customer.name, storeName, entry.outstandingBalance, entry.dueDate ? String(entry.dueDate) : null, isOverdue, lang);
      sendSMS(phone, message);
    }

    // Log the reminder
    await db.insert(reminderLogs).values({
      creditEntryId: entry.id,
      channel: "sms",
      type: "auto",
      status: "sent",
      messageContent: buildMessage(customer.name, storeName, entry.outstandingBalance, entry.dueDate ? String(entry.dueDate) : null, isOverdue, "english"),
    });

    console.log(`[CreditReminder] Sent auto-reminder for entry ${entry.id} — customer ${customer.name}, store ${storeName}`);
  }
}

async function runCreditReminders(): Promise<void> {
  const allStores = await db.select({ id: stores.id, name: stores.name }).from(stores);
  for (const store of allStores) {
    try {
      await processStore(store.id, store.name);
    } catch (err) {
      console.error(`[CreditReminder] Error processing store ${store.id}:`, err);
    }
  }
}

export function startCreditReminderService(): void {
  // Fire 10 s after startup to process any due reminders from the previous session
  setTimeout(() => runCreditReminders().catch(e => console.error("[CreditReminder]", e)), 10_000);
  setInterval(() => runCreditReminders().catch(e => console.error("[CreditReminder]", e)), POLL_INTERVAL_MS);
  console.log("[CreditReminder] Service started — polling every hour.");
}
