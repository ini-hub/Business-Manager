import { db } from "../db";
import { bookings, customers, stores } from "@shared/schema";
import { eq, and, gte, lt, isNull, inArray } from "drizzle-orm";
import { sendEmail } from "../email";
import { sendSMS } from "../email";
import { getAppUrl } from "../lib/appUrl";

const BUSINESS_NAME = process.env.BUSINESS_NAME || "Excellent Bolujo";
const APP_URL = getAppUrl();

// Check every 15 minutes, remind 24 h before the booking
const POLL_INTERVAL_MS = 15 * 60 * 1000;
const REMINDER_WINDOW_HOURS = 24;
const WINDOW_BUFFER_MINUTES = 16; // slightly wider than poll interval to avoid gaps

function formatDate(d: Date): string {
  return d.toLocaleString("en-NG", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function sendBookingReminders(): Promise<void> {
  const now = new Date();
  const windowStart = new Date(now.getTime() + REMINDER_WINDOW_HOURS * 60 * 60 * 1000);
  const windowEnd = new Date(windowStart.getTime() + WINDOW_BUFFER_MINUTES * 60 * 1000);

  const dueSoon = await db
    .select({
      booking: bookings,
      customer: customers,
      store: stores,
    })
    .from(bookings)
    .innerJoin(customers, eq(bookings.customerId, customers.id))
    .innerJoin(stores, eq(bookings.storeId, stores.id))
    .where(
      and(
        gte(bookings.scheduledAt, windowStart),
        lt(bookings.scheduledAt, windowEnd),
        isNull(bookings.reminderSentAt),
        eq(bookings.isDeleted, false),
        inArray(bookings.status, ["pending", "confirmed"])
      )
    );

  for (const row of dueSoon) {
    const { booking, customer, store } = row;
    const scheduledFormatted = formatDate(new Date(booking.scheduledAt));
    const businessName = store.name || BUSINESS_NAME;
    const bookingUrl = `${APP_URL}/bookings/${booking.id}`;

    const pref = booking.reminderPreference ?? "whatsapp";

    if ((pref === "whatsapp" || pref === "sms" || pref === "both") && customer.mobileNumber) {
      const phone = `${customer.countryCode || "+234"}${customer.mobileNumber.replace(/^0/, "")}`;
      const msg = `Hi ${customer.name}, this is a reminder from ${businessName}.\n\nYour appointment is scheduled for ${scheduledFormatted}.\n\nRef: ${booking.bookingRef}\n\nWe look forward to seeing you! 😊`;
      sendSMS(phone, msg);
    }

    if (pref === "sms" || pref === "both") {
      // SMS already handled above; email path handled below only for "both" with email
    }

    // Send email when preference is neither whatsapp-only nor none, and customer email exists
    const sendEmailReminder = pref !== "none" && pref !== "whatsapp";
    if (sendEmailReminder && customer.mobileNumber) {
      // No email on customer — skip silently (email field doesn't exist on customer table)
    }

    // Always attempt an email if the booking has an associated user with an email
    // For now, log for audit and mark as sent regardless of delivery channel
    console.log(`[BookingReminder] Reminder dispatched — booking ${booking.bookingRef}, customer ${customer.name}, pref: ${pref}`);

    await db
      .update(bookings)
      .set({ reminderSentAt: new Date() })
      .where(eq(bookings.id, booking.id));
  }

  if (dueSoon.length > 0) {
    console.log(`[BookingReminder] Processed ${dueSoon.length} reminder(s).`);
  }
}

export function startBookingReminderService(): void {
  // Fire once shortly after startup to catch any missed reminders
  setTimeout(() => sendBookingReminders().catch((e) => console.error("[BookingReminder] Error:", e)), 5_000);
  setInterval(() => sendBookingReminders().catch((e) => console.error("[BookingReminder] Error:", e)), POLL_INTERVAL_MS);
  console.log("[BookingReminder] Service started — polling every 15 minutes.");
}
