import { db } from "../db";
import { getStoreTimezone, toUtcStart, toUtcEnd } from "../lib/dateUtils";
import {
  bookings,
  bookingItems,
  quotes,
  storeCounters,
  type Booking,
  type InsertBooking,
  type BookingItem,
  type InsertBookingItem,
} from "@shared/schema";
import { eq, and, or, inArray, gte, lte, lt, isNull, count, desc, sql } from "drizzle-orm";
import type { PaginationOptions, PaginatedResult } from "../storage";
import { format } from "date-fns";
import { quoteConversionError, QuoteConversionError } from "../lib/quoteConversion";
import { toZonedTime } from "date-fns-tz";

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

  async getBookingsSummary(
    storeId: string,
    groupBy: "day" | "month",
    filters: {
      status?: string[];
      type?: string[];
      staffId?: string;
      startDate?: string;
      endDate?: string;
    } = {}
  ): Promise<{ buckets: Array<{ bucket: string; count: number; revenue: number }>; total: { count: number; revenue: number } }> {
    const tz = await getStoreTimezone(storeId);
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
    if (filters.startDate) conditions.push(gte(bookings.scheduledAt, toUtcStart(filters.startDate, tz)));
    if (filters.endDate)   conditions.push(lte(bookings.scheduledAt, toUtcEnd(filters.endDate,   tz)));

    const rows = await db
      .select({ scheduledAt: bookings.scheduledAt, totalPrice: bookings.totalPrice })
      .from(bookings)
      .where(and(...conditions));

    const bucketMap = new Map<string, { count: number; revenue: number }>();
    let totalCount = 0;
    let totalRevenue = 0;

    for (const row of rows) {
      const zoned = toZonedTime(row.scheduledAt, tz);
      const key = format(zoned, groupBy === "month" ? "yyyy-MM" : "yyyy-MM-dd");
      const revenue = Number(row.totalPrice ?? 0);
      const bucket = bucketMap.get(key) ?? { count: 0, revenue: 0 };
      bucket.count += 1;
      bucket.revenue += revenue;
      bucketMap.set(key, bucket);
      totalCount += 1;
      totalRevenue += revenue;
    }

    const buckets = Array.from(bucketMap.entries())
      .map(([bucket, v]) => ({ bucket, count: v.count, revenue: v.revenue }))
      .sort((a, b) => a.bucket.localeCompare(b.bucket));

    return { buckets, total: { count: totalCount, revenue: totalRevenue } };
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
      if (data.quoteId) {
        const [quote] = await tx.select().from(quotes).where(eq(quotes.id, data.quoteId)).for("update");
        const quoteError = quoteConversionError(quote, data.storeId, "booking");
        if (quoteError) throw new QuoteConversionError(quoteError);
      }

      // Atomic allocation: creates the counter row if missing and serialises concurrent bookings.
      const [counter] = await tx
        .insert(storeCounters)
        .values({ storeId: data.storeId, nextBookingNumber: 2 })
        .onConflictDoUpdate({
          target: storeCounters.storeId,
          set: { nextBookingNumber: sql`${storeCounters.nextBookingNumber} + 1` },
        })
        .returning({ next: storeCounters.nextBookingNumber });
      const bookingNumber = counter.next - 1;
      const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      // booking_ref is unique across all stores, so include a store code (counters are per store).
      const storeCode = data.storeId.replace(/-/g, "").slice(0, 4).toUpperCase();
      const bookingRef = `BKG-${datePart}-${storeCode}-${String(bookingNumber).padStart(4, "0")}`;

      const [booking] = await tx
        .insert(bookings)
        .values({
          storeId: data.storeId,
          customerId: data.customerId,
          bookingRef,
          quoteId: data.quoteId ?? null,
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

      if (data.quoteId) {
        await tx.update(quotes)
          .set({ status: "converted", convertedBookingId: booking.id, updatedAt: new Date() })
          .where(eq(quotes.id, data.quoteId));
      }

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
