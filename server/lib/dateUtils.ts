import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { db } from "../db";
import { stores } from "@shared/schema";
import { eq } from "drizzle-orm";

const tzCache = new Map<string, string>();

export async function getStoreTimezone(storeId: string): Promise<string> {
  if (tzCache.has(storeId)) return tzCache.get(storeId)!;
  const [row] = await db
    .select({ timezone: stores.timezone })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);
  const tz = row?.timezone ?? "Africa/Lagos";
  tzCache.set(storeId, tz);
  return tz;
}

export function invalidateStoreTimezone(storeId: string): void {
  tzCache.delete(storeId);
}

export function toUtcStart(dateStr: string, timezone: string): Date {
  return fromZonedTime(`${dateStr}T00:00:00`, timezone);
}

export function toUtcEnd(dateStr: string, timezone: string): Date {
  return fromZonedTime(`${dateStr}T23:59:59.999`, timezone);
}

/** The store-local calendar date (YYYY-MM-DD) an instant falls on. */
export function storeLocalDate(instant: Date, timezone: string): string {
  return formatInTimeZone(instant, timezone, "yyyy-MM-dd");
}

/** Minutes since store-local midnight, for comparing against a configured opening time. */
export function storeLocalMinutesOfDay(instant: Date, timezone: string): number {
  const [hours, minutes] = formatInTimeZone(instant, timezone, "HH:mm").split(":");
  return Number(hours) * 60 + Number(minutes);
}

/** Parses "HH:MM" into minutes since midnight; null if malformed. */
export function parseTimeOfDay(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Day of week (0 = Sunday) for a date string that is ALREADY store-local wall clock.
 *
 * Must read as UTC: `new Date("2026-08-30T00:00:00")` is parsed in the *server's* zone, so
 * a server west of UTC lands on the previous day and the whole roster shifts by one.
 * Appending "Z" pins it to a bare calendar date with no zone conversion at all.
 */
export function dayOfWeekForLocalDate(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

/** Today's date in the store's own timezone, not the server's. */
export async function storeToday(storeId: string): Promise<string> {
  return storeLocalDate(new Date(), await getStoreTimezone(storeId));
}
