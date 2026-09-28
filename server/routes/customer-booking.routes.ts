import type { Express, Request, Response } from "express";
import { db } from "../db";
import { eq, and, gt } from "drizzle-orm";
import { whatsappBookingAccessTokens, bookings, stores } from "@shared/schema";
import { BookingRepository } from "../repositories/BookingRepository";

const bookingRepository = new BookingRepository();

async function loadBookingForToken(token: string) {
  const [row] = await db
    .select({ access: whatsappBookingAccessTokens, booking: bookings, storeName: stores.name })
    .from(whatsappBookingAccessTokens)
    .innerJoin(bookings, eq(whatsappBookingAccessTokens.bookingId, bookings.id))
    .innerJoin(stores, eq(bookings.storeId, stores.id))
    .where(and(eq(whatsappBookingAccessTokens.token, token), gt(whatsappBookingAccessTokens.expiresAt, new Date())));
  return row;
}

/**
 * Public (no session) customer-facing booking view, reached via the magic
 * link sent at the end of the WhatsApp booking conversation
 * (WhatsAppBookingConversationEngine.finalizeBooking). Scoped to exactly one
 * booking - deliberately not a general customer-auth system. Reuses
 * BookingRepository rather than a parallel read/cancel path.
 */
export function registerCustomerBookingRoutes(app: Express): void {
  app.get("/api/my-booking/:token", async (req: Request, res: Response) => {
    try {
      const row = await loadBookingForToken(req.params.token);
      if (!row) return res.status(404).json({ error: "This link has expired or is invalid." });

      const items = await bookingRepository.getBookingItems(row.booking.id);
      return res.json({
        booking: {
          bookingRef: row.booking.bookingRef,
          status: row.booking.status,
          scheduledAt: row.booking.scheduledAt,
          totalPrice: row.booking.totalPrice,
          depositAmount: row.booking.depositAmount,
          notes: row.booking.notes,
        },
        storeName: row.storeName,
        items: items.map((i) => ({ quantity: i.quantity, unitPrice: i.unitPrice, totalPrice: i.totalPrice })),
      });
    } catch (error) {
      console.error("[CustomerBooking] Load error:", error);
      return res.status(500).json({ error: "Failed to load booking." });
    }
  });

  app.post("/api/my-booking/:token/cancel", async (req: Request, res: Response) => {
    try {
      const row = await loadBookingForToken(req.params.token);
      if (!row) return res.status(404).json({ error: "This link has expired or is invalid." });
      if (["completed", "cancelled", "no_show"].includes(row.booking.status)) {
        return res.status(400).json({ error: `Booking is already ${row.booking.status} and can't be cancelled.` });
      }

      await bookingRepository.updateBookingStatus(row.booking.id, "cancelled");
      return res.json({ success: true });
    } catch (error) {
      console.error("[CustomerBooking] Cancel error:", error);
      return res.status(500).json({ error: "Failed to cancel booking." });
    }
  });
}
