import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { customers, inventory, organisations, staff, stores } from "@shared/schema";
import { getCountLimitStatus, type CountLimitType } from "./entitlements";
import { getOwnerContact } from "./billing";

export interface OverCapRow {
  organisationId: string;
  name: string;
  status: string;
  used: number;
  limit: number;
  /** How many beyond the cap: used - limit (0 when exactly at it). */
  over: number;
  tiered: boolean;
  trial: boolean;
  ownerName: string | null;
  ownerEmail: string | null;
}

/** Biggest overshoot first, then the larger org: the order to approach them in. */
export function rankOverCap<T extends { over: number; used: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.over - a.over || b.used - a.used);
}

/**
 * Live usage per organisation for one limit, with the same filters as countUsed in entitlements.ts. Only a
 * pre-filter: every org it returns is checked again with getCountLimitStatus, which is the authority (trials,
 * purchased tiers and soft locks all live there).
 */
async function usageByOrganisation(limitType: CountLimitType): Promise<Map<string, number>> {
  const rows =
    limitType === "staff_seats"
      ? await db.select({ org: stores.businessId, c: sql<number>`count(*)::int` }).from(staff).innerJoin(stores, eq(staff.storeId, stores.id)).where(eq(staff.isArchived, false)).groupBy(stores.businessId)
      : limitType === "customer_count"
        ? await db.select({ org: stores.businessId, c: sql<number>`count(*)::int` }).from(customers).innerJoin(stores, eq(customers.storeId, stores.id)).where(eq(customers.isArchived, false)).groupBy(stores.businessId)
        : limitType === "item_count"
          ? await db
              .select({ org: stores.businessId, c: sql<number>`count(*)::int` })
              .from(inventory)
              .innerJoin(stores, eq(inventory.storeId, stores.id))
              .where(and(eq(inventory.isDeleted, false), sql`${inventory.type} in ('product','service')`))
              .groupBy(stores.businessId)
          : await db.select({ org: stores.businessId, c: sql<number>`count(*)::int` }).from(stores).where(eq(stores.isActive, true)).groupBy(stores.businessId);
  return new Map(rows.filter((r) => r.org).map((r) => [r.org as string, r.c]));
}

/** Businesses past their cap for one limit, with who to contact. Read-only: it sends and changes nothing. */
export async function getOverCapReport(limitType: CountLimitType): Promise<OverCapRow[]> {
  const usage = await usageByOrganisation(limitType);
  const orgs = await db.select({ id: organisations.id, name: organisations.name, status: organisations.status }).from(organisations).where(isNull(organisations.deletedAt));

  const rows: OverCapRow[] = [];
  for (const org of orgs) {
    // Cheap skip: an org with no usage can't be over any cap.
    if (!usage.get(org.id)) continue;
    const status = await getCountLimitStatus(org.id, limitType);
    if (status.unlimited || status.used <= status.limit) continue;
    const owner = await getOwnerContact(org.id);
    rows.push({
      organisationId: org.id,
      name: org.name,
      status: org.status,
      used: status.used,
      limit: status.limit,
      over: status.used - status.limit,
      tiered: status.tiered,
      trial: status.trial,
      ownerName: owner?.name ?? null,
      ownerEmail: owner?.email ?? null,
    });
  }
  return rankOverCap(rows);
}
