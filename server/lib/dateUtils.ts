import { fromZonedTime } from "date-fns-tz";
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
