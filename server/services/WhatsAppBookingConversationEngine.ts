import crypto from "crypto";
import { fromZonedTime } from "date-fns-tz";
import { db } from "../db";
import {
  whatsappConversations,
  whatsappOptIns,
  whatsappBookingAccessTokens,
  inventory,
  stores,
  type WhatsappConversation,
} from "@shared/schema";
import { eq, and, lte, inArray, desc } from "drizzle-orm";
import { CustomerRepository } from "../repositories/CustomerRepository";
import { BookingRepository } from "../repositories/BookingRepository";
import type { NotificationRepository } from "../repositories/NotificationRepository";
import { normalizePhoneNumber } from "../sanitize";
import { getStoreTimezone } from "../lib/dateUtils";
import { sendFreeTextMessage, sendInteractiveMessage } from "./WhatsAppService";
import { getAppUrl } from "../lib/appUrl";
import { CountLimitError } from "../lib/entitlements";
import { withAdvisoryLock } from "../lib/advisoryLock";

const customerRepository = new CustomerRepository();
const bookingRepository = new BookingRepository();

// Lazy/dynamic import, not a top-level one: NotificationRepository sits on a
// pre-existing require cycle (NotificationRepository -> websocket -> auth ->
// storage -> NotificationRepository). storage.ts is always the first thing
// loaded in the real app, so the cycle resolves fine there - but this file
// can be the shallow entry point in isolated tests (see
// WhatsAppBookingConversationEngine.parseInboundMessage.test.ts), where a
// top-level import hit the cycle mid-initialization and threw "is not a
// constructor". Deferring the import until the handoff/notify functions
// actually run sidesteps it without touching the cycle itself.
let notificationRepositoryInstance: NotificationRepository | null = null;
async function getNotificationRepository(): Promise<NotificationRepository> {
  if (!notificationRepositoryInstance) {
    const { NotificationRepository } = await import("../repositories/NotificationRepository");
    notificationRepositoryInstance = new NotificationRepository();
  }
  return notificationRepositoryInstance;
}

const CONVERSATION_TTL_MS = 30 * 60 * 1000; // 30 min idle -> abandoned
const ACCESS_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const STOP_KEYWORDS = new Set(["stop", "unsubscribe", "cancel subscription", "opt out"]);

type InboundMeta = {
  type: string;
  text?: string;
  interactiveReplyId?: string;
};

export function parseInboundMessage(raw: any): InboundMeta {
  const type = raw?.type ?? "text";
  if (type === "interactive") {
    const replyId = raw?.interactive?.list_reply?.id ?? raw?.interactive?.button_reply?.id;
    return { type, interactiveReplyId: replyId };
  }
  return { type, text: raw?.text?.body };
}

async function getOrCreateConversation(storeId: string, waPhoneE164: string): Promise<WhatsappConversation> {
  const [existing] = await db
    .select()
    .from(whatsappConversations)
    .where(and(
      eq(whatsappConversations.storeId, storeId),
      eq(whatsappConversations.waPhoneE164, waPhoneE164),
      inArray(whatsappConversations.state, ["greeting", "awaiting_service_selection", "awaiting_preferred_time", "awaiting_confirmation"]),
    ))
    .orderBy(desc(whatsappConversations.updatedAt))
    .limit(1);

  if (existing && existing.expiresAt.getTime() > Date.now()) {
    return existing;
  }
  if (existing) {
    await db.update(whatsappConversations).set({ state: "abandoned", updatedAt: new Date() }).where(eq(whatsappConversations.id, existing.id));
  }

  const [created] = await db
    .insert(whatsappConversations)
    .values({
      storeId,
      waPhoneE164,
      state: "greeting",
      context: {},
      expiresAt: new Date(Date.now() + CONVERSATION_TTL_MS),
    })
    .returning();
  return created;
}

async function touchConversation(id: string, patch: Partial<typeof whatsappConversations.$inferInsert>): Promise<void> {
  await db.update(whatsappConversations).set({
    ...patch,
    lastInboundAt: new Date(),
    expiresAt: new Date(Date.now() + CONVERSATION_TTL_MS),
    updatedAt: new Date(),
  }).where(eq(whatsappConversations.id, id));
}

async function sendServiceList(storeId: string, waPhoneE164: string): Promise<void> {
  const services = await db
    .select({ id: inventory.id, name: inventory.name, sellingPrice: inventory.sellingPrice })
    .from(inventory)
    .where(and(eq(inventory.storeId, storeId), eq(inventory.type, "service"), eq(inventory.isDeleted, false)))
    .limit(10);

  if (services.length === 0) {
    await sendFreeTextMessage(storeId, waPhoneE164, "Sorry, we don't have any bookable services set up right now. A team member will reach out shortly.");
    return;
  }

  await sendInteractiveMessage(storeId, waPhoneE164, {
    kind: "list",
    bodyText: "Hi! 👋 What would you like to book?",
    buttonText: "Choose a service",
    sections: [{
      rows: services.map((s) => ({ id: `svc:${s.id}`, title: s.name.slice(0, 24), description: `₦${Number(s.sellingPrice).toLocaleString()}` })),
    }],
  });
}

// No availability/slot system exists (and per the current requirement,
// none is needed): a booking here is a REQUEST, not a confirmed
// appointment. The customer states a preferred time in their own words;
// staff review the request afterward (asking further questions if needed)
// and accept or reject it through the normal Bookings screen, which sets
// the real scheduledAt via BookingRepository.rescheduleBooking /
// updateBookingStatus - no parallel logic here.
async function askPreferredTime(storeId: string, waPhoneE164: string): Promise<void> {
  await sendFreeTextMessage(storeId, waPhoneE164, "Great choice! What day/time works best for you? (e.g. \"tomorrow around 2pm\" or \"this Saturday morning\")");
}

async function sendConfirmationPrompt(storeId: string, waPhoneE164: string, context: any): Promise<void> {
  await sendInteractiveMessage(storeId, waPhoneE164, {
    kind: "buttons",
    bodyText: `Confirm your booking request:\n\n${context.serviceName}\nPreferred time: ${context.preferredTimeText}\n\nWe'll follow up to confirm the exact time. Shall I send this request?`,
    buttons: [{ id: "confirm:yes", title: "Yes, send request" }, { id: "confirm:no", title: "No, cancel" }],
  });
}

async function finalizeBooking(storeId: string, waPhoneE164: string, conversation: WhatsappConversation): Promise<void> {
  const context = conversation.context as any;
  const normalizedPhone = normalizePhoneNumber(waPhoneE164);

  let customer = await customerRepository.findCustomerByPhone(storeId, normalizedPhone);
  if (!customer) {
    // countryCode here is a dial code ("+234"), not an ISO country ("NG") -
    // matches how every other customer row stores it (see customers.ts /
    // stores.phoneCountryCode), not insertCustomerSchema's form-input
    // default, which is for a different (ISO-selector) input path.
    const [store] = await db.select({ phoneCountryCode: stores.phoneCountryCode }).from(stores).where(eq(stores.id, storeId));
    try {
      customer = await customerRepository.createCustomer({
        storeId,
        name: `WhatsApp ${normalizedPhone}`,
        mobileNumber: normalizedPhone,
        countryCode: store?.phoneCountryCode || "+234",
        address: "",
      } as any);
    } catch (error) {
      // The business is at its free-tier customer cap: no new customer record
      // can be created, so tell the person to contact the business directly
      // rather than dropping the conversation silently.
      if (error instanceof CountLimitError) {
        await sendFreeTextMessage(storeId, waPhoneE164, "Sorry, we can't take new booking requests through WhatsApp right now. Please contact the business directly.");
        await touchConversation(conversation.id, { state: "abandoned" });
        return;
      }
      throw error;
    }
  }
  await ensureImplicitOptIn(storeId, customer.id);

  const price = Number(context.servicePrice) || 0;

  // scheduledAt is NOT NULL on bookings, but there's no real time to put
  // here yet - this is a request, not a confirmed appointment. Placeholder
  // (tomorrow, store-local 09:00) gets overwritten by staff via the normal
  // Bookings screen's reschedule action once they accept the request and
  // agree an actual time with the customer.
  const timezone = await getStoreTimezone(storeId);
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const placeholderScheduledAt = fromZonedTime(`${tomorrow}T09:00:00`, timezone);

  const booking = await bookingRepository.createBooking({
    storeId,
    customerId: customer.id,
    type: "appointment",
    status: "pending",
    scheduledAt: placeholderScheduledAt,
    depositAmount: 0,
    subtotal: price,
    discountAmount: 0,
    discountPercent: 0,
    totalPrice: price,
    reminderPreference: "whatsapp",
    notes: `Booking request via WhatsApp - pending staff confirmation.\nCustomer's preferred time: ${context.preferredTimeText}`,
    bookingItems: context.serviceId ? [{
      inventoryId: context.serviceId,
      quantity: 1,
      unitPrice: price,
      totalPrice: price,
    }] : [],
  } as any);

  const token = crypto.randomBytes(24).toString("base64url");
  await db.insert(whatsappBookingAccessTokens).values({
    bookingId: booking.id,
    customerId: customer.id,
    token,
    expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_MS),
  });

  const link = `${getAppUrl()}/my-booking/${token}`;
  await sendFreeTextMessage(storeId, waPhoneE164,
    `Thanks! Your booking request has been received ✅\n\nRef: ${booking.bookingRef}\n${context.serviceName}\nPreferred time: ${context.preferredTimeText}\n\nA team member will confirm your appointment shortly. Track it here:\n${link}`,
    customer.id,
  );
  await notifyNewBookingRequest(storeId, booking.bookingRef, customer.name, context.preferredTimeText);

  await touchConversation(conversation.id, { state: "completed", customerId: customer.id, resultingBookingId: booking.id });
}

async function recordOptOut(storeId: string, customerId: string | undefined | null): Promise<void> {
  if (!customerId) return;
  await db.insert(whatsappOptIns).values({ customerId, storeId, event: "opt_out", source: "inbound_message" });
}

async function recordOptIn(storeId: string, customerId: string, source: "inbound_message" | "staff_manual"): Promise<void> {
  await db.insert(whatsappOptIns).values({ customerId, storeId, event: "opt_in", source });
}

/**
 * A customer messaging the store's WhatsApp number first is treated as
 * implied consent to be messaged back (standard WhatsApp Business messaging
 * posture) - recorded once, the first time, so broadcast targeting
 * (BroadcastRepository.filterOptedInCustomerIds) has something to work
 * against. Someone who has explicitly opted out stays out until they
 * message START again (see the "start" branch in handleInboundMessage).
 */
async function ensureImplicitOptIn(storeId: string, customerId: string): Promise<void> {
  const [existing] = await db.select({ id: whatsappOptIns.id }).from(whatsappOptIns).where(eq(whatsappOptIns.customerId, customerId)).limit(1);
  if (!existing) await recordOptIn(storeId, customerId, "inbound_message");
}

async function notifyHumanHandoff(storeId: string, waPhoneE164: string): Promise<void> {
  const notificationRepository = await getNotificationRepository();
  await notificationRepository.notifyManagers(storeId, "whatsapp_handoff", `A customer (${waPhoneE164}) asked to speak with a team member on WhatsApp.`);
}

async function notifyNewBookingRequest(storeId: string, bookingRef: string, customerName: string, preferredTimeText: string): Promise<void> {
  const notificationRepository = await getNotificationRepository();
  await notificationRepository.notifyManagers(
    storeId,
    "whatsapp_booking_request",
    `New WhatsApp booking request from ${customerName} (${bookingRef}) — preferred time: ${preferredTimeText}. Review and confirm in Bookings.`,
  );
}

/**
 * Entry point called from server/routes/whatsapp-webhooks.routes.ts for
 * every inbound WhatsApp message. Drives the booking Q&A state machine
 * (greeting -> service -> preferred time -> confirm), matching/creating a
 * customer via the existing CustomerRepository and creating the booking as
 * a pending REQUEST via the existing BookingRepository - no availability
 * check, no parallel booking-creation logic. Staff accept/reject/reschedule
 * the request afterward from the normal Bookings screen.
 */
export async function handleInboundMessage(storeId: string, fromPhoneE164: string, rawMessage: any): Promise<void> {
  const inbound = parseInboundMessage(rawMessage);
  const conversation = await getOrCreateConversation(storeId, fromPhoneE164);

  // Match against an existing customer as early as possible (not just at
  // booking completion) so opt-in/opt-out tracking and human-handoff notices
  // work even for someone who never finishes a booking. Booking-time is
  // still the only place a NEW customer profile gets created (see
  // finalizeBooking) - a bare inbound message alone doesn't create one.
  if (!conversation.customerId) {
    const matched = await customerRepository.findCustomerByPhone(storeId, normalizePhoneNumber(fromPhoneE164));
    if (matched) {
      conversation.customerId = matched.id;
      await touchConversation(conversation.id, { customerId: matched.id });
      await ensureImplicitOptIn(storeId, matched.id);
    }
  }

  const normalizedText = (inbound.text ?? "").trim().toLowerCase();

  if (normalizedText === "start") {
    if (conversation.customerId) await recordOptIn(storeId, conversation.customerId, "inbound_message");
    await sendFreeTextMessage(storeId, fromPhoneE164, "You're re-subscribed. Message us anytime to book 🙌");
    return;
  }

  if (STOP_KEYWORDS.has(normalizedText)) {
    await recordOptOut(storeId, conversation.customerId);
    await sendFreeTextMessage(storeId, fromPhoneE164, "You've been unsubscribed from WhatsApp messages from us. Reply START to re-subscribe.");
    await touchConversation(conversation.id, { state: "abandoned" });
    return;
  }

  if (normalizedText === "talk to a human" || normalizedText === "human" || normalizedText === "agent") {
    await sendFreeTextMessage(storeId, fromPhoneE164, "Got it — a team member will reach out to you shortly.");
    await notifyHumanHandoff(storeId, fromPhoneE164);
    return;
  }

  switch (conversation.state) {
    case "greeting": {
      await sendServiceList(storeId, fromPhoneE164);
      await touchConversation(conversation.id, { state: "awaiting_service_selection" });
      return;
    }

    case "awaiting_service_selection": {
      const serviceId = inbound.interactiveReplyId?.startsWith("svc:") ? inbound.interactiveReplyId.slice(4) : undefined;
      if (!serviceId) {
        await sendFreeTextMessage(storeId, fromPhoneE164, "Please pick a service from the list above 🙏");
        await sendServiceList(storeId, fromPhoneE164);
        return;
      }
      const [service] = await db.select().from(inventory).where(eq(inventory.id, serviceId));
      if (!service) {
        await sendFreeTextMessage(storeId, fromPhoneE164, "Sorry, that service isn't available anymore. Let's try again.");
        await sendServiceList(storeId, fromPhoneE164);
        return;
      }
      await touchConversation(conversation.id, {
        state: "awaiting_preferred_time",
        context: { serviceId: service.id, serviceName: service.name, servicePrice: Number(service.sellingPrice) },
      });
      await askPreferredTime(storeId, fromPhoneE164);
      return;
    }

    case "awaiting_preferred_time": {
      const preferredTimeText = (inbound.text ?? "").trim();
      if (!preferredTimeText) {
        await sendFreeTextMessage(storeId, fromPhoneE164, "Sorry, what day/time works best for you? Just type it however's easiest (e.g. \"Friday afternoon\").");
        return;
      }
      const nextContext = { ...(conversation.context as any), preferredTimeText };
      await touchConversation(conversation.id, { state: "awaiting_confirmation", context: nextContext });
      await sendConfirmationPrompt(storeId, fromPhoneE164, nextContext);
      return;
    }

    case "awaiting_confirmation": {
      if (inbound.interactiveReplyId === "confirm:yes") {
        await finalizeBooking(storeId, fromPhoneE164, conversation);
        return;
      }
      if (inbound.interactiveReplyId === "confirm:no") {
        await sendFreeTextMessage(storeId, fromPhoneE164, "No problem, booking cancelled. Message us again anytime to start over.");
        await touchConversation(conversation.id, { state: "abandoned" });
        return;
      }
      await sendFreeTextMessage(storeId, fromPhoneE164, "Please tap Yes or No above 🙏");
      return;
    }

    default:
      return;
  }
}

/**
 * Sweeps idle conversations past their TTL to 'abandoned' so a customer who
 * goes quiet mid-flow starts fresh next time instead of resuming a stale
 * state. Shares BookingReminderService's polling style.
 */
export function startWhatsAppConversationTimeoutSweeper(): void {
  const sweep = async () => {
    await db
      .update(whatsappConversations)
      .set({ state: "abandoned", updatedAt: new Date() })
      .where(and(
        inArray(whatsappConversations.state, ["greeting", "awaiting_service_selection", "awaiting_preferred_time", "awaiting_confirmation"]),
        lte(whatsappConversations.expiresAt, new Date()),
      ));
  };
  setInterval(() => withAdvisoryLock("whatsapp-conversation-timeout", sweep).catch((e) => console.error("[WhatsAppConversationTimeout] Error:", e)), 5 * 60 * 1000);
}
