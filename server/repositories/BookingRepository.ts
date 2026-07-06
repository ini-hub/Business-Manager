import { db } from "../db";
import { getStoreTimezone, toUtcStart, toUtcEnd } from "../lib/dateUtils";
import {
  bookings,
  bookingItems,
  storeCounters,
  type Booking,
  type InsertBooking,
  type BookingItem,
  type InsertBookingItem,
} from "@shared/schema";
import { eq, and, or, inArray, gte, lte, lt, isNull, count, desc, sql } from "drizzle-orm";
import type { PaginationOptions, PaginatedResult } from "../storage";

export class BookingRepository {
  async getBookings(storeId: string): Promise<Booking[]> {
    return db
      .select()
      .from(bookings)
      .where(eq(bookings.storeId, storeId))
      .orderBy(desc(bookings.createdAt));
  }

  async getBookingsPaginated(
    storeId: string,
    options: PaginationOptions,
    filters: {
      status?: string[];
      type?: string[];
      staffId?: string;
      customerId?: string;
      startDate?: string;
      endDate?: string;
      search?: string;
    } = {}
  ): Promise<PaginatedResult<Booking>> {
    const page = Math.max(1, options.page);
    const limit = Math.max(1, options.limit);
    const offset = (page - 1) * limit;

    const conditions: any[] = [eq(bookings.storeId, storeId)];

    if (filters.status?.length) {
      conditions.push(inArray(bookings.status, filters.status));
    }
    if (filters.type?.length) {
      conditions.push(inArray(bookings.type, filters.type));
    }
    if (filters.staffId) {
      const staffId = filters.staffId;
      conditions.push(or(eq(bookings.leadStaffId, staffId), eq(bookings.assistingStaffId, staffId)));
    }
    if (filters.customerId) {
      conditions.push(eq(bookings.customerId, filters.customerId));
    }
    if (filters.startDate || filters.endDate) {
      const tz = await getStoreTimezone(storeId);
      if (filters.startDate) conditions.push(gte(bookings.scheduledAt, toUtcStart(filters.startDate, tz)));
      if (filters.endDate)   conditions.push(lte(bookings.scheduledAt, toUtcEnd(filters.endDate,   tz)));
    }
    if (filters.search) {
      const searchPattern = `%${filters.search.trim()}%`;
      const bookingRefPattern = sql`LOWER(${bookings.bookingRef}) LIKE LOWER(${searchPattern})`;
      const notesPattern = sql`LOWER(COALESCE(${bookings.notes}, '')) LIKE LOWER(${searchPattern})`;
      conditions.push(or(bookingRefPattern, notesPattern));
    }

    const [countResult] = await db
      .select({ total: count() })
      .from(bookings)
      .where(and(...conditions));

    const total = Number(countResult?.total ?? 0);
    const data = await db
      .select()
      .from(bookings)
      .where(and(...conditions))
      .orderBy(desc(bookings.createdAt))
      .limit(limit)
      .offset(offset);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      data,
      pagination: { total, page, limit, totalPages, hasMore: page < totalPages },
    };
  }

  async getBooking(id: string): Promise<Booking | undefined> {
    const [booking] = await db.select().from(bookings).where(eq(bookings.id, id));
    return booking;
  }

  async getBookingItems(bookingId: string): Promise<BookingItem[]> {
    return db
      .select()
      .from(bookingItems)
      .where(eq(bookingItems.bookingId, bookingId));
  }

  async createBooking(data: InsertBooking & { bookingItems: InsertBookingItem[] }): Promise<Booking> {
    return db.transaction(async (tx) => {
      const [counter] = await tx.select().from(storeCounters).where(eq(storeCounters.storeId, data.storeId));
      const nextBookingNumber = counter?.nextBookingNumber ?? 1;
      const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const bookingRef = `BKG-${datePart}-${String(nextBookingNumber).padStart(4, "0")}`;

      const [booking] = await tx
        .insert(bookings)
        .values({
          storeId: data.storeId,
          customerId: data.customerId,
          bookingRef,
          type: data.type,
          status: data.status,
          scheduledAt: data.scheduledAt,
          expectedReadyAt: data.expectedReadyAt,
          leadStaffId: data.leadStaffId,
          assistingStaffId: data.assistingStaffId,
          depositAmount: data.depositAmount,
          depositPaymentMethod: data.depositPaymentMethod,
          subtotal: data.subtotal,
          discountAmount: data.discountAmount,
          discountPercent: data.discountPercent,
          discountReason: data.discountReason,
          discountApprovedBy: data.discountApprovedBy,
          totalPrice: data.totalPrice,
          reminderPreference: data.reminderPreference,
          notes: data.notes,
        })
        .returning();

      if (data.bookingItems?.length) {
        const bookingItemRows = data.bookingItems.map((item) => ({
          ...item,
          bookingId: booking.id,
        }));
        await tx.insert(bookingItems).values(bookingItemRows);
      }

      await tx
        .update(storeCounters)
        .set({ nextBookingNumber: sql`${storeCounters.nextBookingNumber} + 1` })
        .where(eq(storeCounters.storeId, data.storeId));

      return booking;
    });
  }

  async updateBooking(
    id: string,
    data: Partial<InsertBooking> & { bookingItems?: InsertBookingItem[] }
  ): Promise<Booking | undefined> {
    return db.transaction(async (tx) => {
      const { bookingItems: items, ...bookingFields } = data;
      const [updated] = await tx
        .update(bookings)
        .set({ ...bookingFields, updatedAt: new Date() })
        .where(eq(bookings.id, id))
        .returning();
      if (!updated) return undefined;

      if (items !== undefined) {
        await tx.delete(bookingItems).where(eq(bookingItems.bookingId, id));
        if (items.length > 0) {
          await tx.insert(bookingItems).values(items.map((item) => ({ ...item, bookingId: id })));
        }
      }
      return updated;
    });
  }

  async updateBookingStatus(id: string, status: string): Promise<Booking | undefined> {
    const [booking] = await db
      .update(bookings)
      .set({ status, updatedAt: new Date() })
      .where(eq(bookings.id, id))
      .returning();
    return booking;
  }

  async rescheduleBooking(id: string, scheduledAt: Date, reason: string): Promise<Booking | undefined> {
    const [existingBooking] = await db.select().from(bookings).where(eq(bookings.id, id));
    if (!existingBooking) return undefined;

    const history = Array.isArray(existingBooking.rescheduleHistory)
      ? existingBooking.rescheduleHistory
      : [];

    history.push({
      previousScheduledAt: existingBooking.scheduledAt,
      reason,
      changedAt: new Date().toISOString(),
    });

    const [updatedBooking] = await db
      .update(bookings)
      .set({
        scheduledAt,
        status: "rescheduled",
        rescheduleReason: reason,
        rescheduleHistory: JSON.stringify(history),
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, id))
      .returning();

    return updatedBooking;
  }

  async getBookingsDueForReminder(windowStart: Date, windowEnd: Date): Promise<Booking[]> {
    return db
      .select()
      .from(bookings)
      .where(
        and(
          gte(bookings.scheduledAt, windowStart),
          lt(bookings.scheduledAt, windowEnd),
          isNull(bookings.reminderSentAt),
          eq(bookings.isDeleted, false),
          inArray(bookings.status, ["pending", "confirmed"]),
        )
      );
  }

  async markReminderSent(id: string): Promise<void> {
    await db.update(bookings).set({ reminderSentAt: new Date() }).where(eq(bookings.id, id));
  }
}
