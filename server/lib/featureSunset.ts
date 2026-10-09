import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { featureSunsetReminderLogs, orgFeatureEntitlements } from "@shared/schema";

export interface SunsetState {
  scheduled: boolean;
  /** The paywall date, when a sunset is scheduled. */
  effectiveAt: Date | null;
  /** Businesses with the feature through the one-time free grant, who a new sunset would reach. */
  eligibleOrgs: number;
  /** Businesses already on the notice schedule. */
  scheduledOrgs: number;
}

const onNotice = (featureId: string) =>
  and(
    eq(orgFeatureEntitlements.featureId, featureId),
    eq(orgFeatureEntitlements.status, "pending_removal"),
    eq(orgFeatureEntitlements.source, "grandfathered_sunset"),
  );

const freeGrant = (featureId: string) =>
  and(
    eq(orgFeatureEntitlements.featureId, featureId),
    eq(orgFeatureEntitlements.status, "active"),
    eq(orgFeatureEntitlements.source, "grandfathered"),
  );

export async function getSunsetState(featureId: string): Promise<SunsetState> {
  const [[notice], [eligible]] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int`, at: sql<Date | null>`max(${orgFeatureEntitlements.removalEffectiveAt})` })
      .from(orgFeatureEntitlements)
      .where(onNotice(featureId)),
    db.select({ n: sql<number>`count(*)::int` }).from(orgFeatureEntitlements).where(freeGrant(featureId)),
  ]);
  return {
    scheduled: notice.n > 0,
    effectiveAt: notice.at ? new Date(notice.at) : null,
    eligibleOrgs: eligible.n,
    scheduledOrgs: notice.n,
  };
}

/**
 * Puts every business that has the feature through the free grant on notice until `effectiveAt`. Calling it
 * again moves businesses already on notice to the new date. Reminder dedupe rows are cleared either way, so the
 * 30/7/1-day-and-today notices run against the date that is now in force. Returns how many businesses are on notice.
 */
export async function scheduleSunset(featureId: string, effectiveAt: Date): Promise<number> {
  return db.transaction(async (tx) => {
    const moved = await tx
      .update(orgFeatureEntitlements)
      .set({ status: "pending_removal", source: "grandfathered_sunset", removalEffectiveAt: effectiveAt, updatedAt: new Date() })
      .where(freeGrant(featureId))
      .returning({ id: orgFeatureEntitlements.id });
    const rescheduled = await tx
      .update(orgFeatureEntitlements)
      .set({ removalEffectiveAt: effectiveAt, updatedAt: new Date() })
      .where(onNotice(featureId))
      .returning({ id: orgFeatureEntitlements.id });
    await tx.delete(featureSunsetReminderLogs).where(eq(featureSunsetReminderLogs.featureId, featureId));
    // rescheduled includes the rows just moved (they now match onNotice), so it is the full count.
    return Math.max(rescheduled.length, moved.length);
  });
}

/** Takes businesses off notice: they keep the free grant, as before the sunset was scheduled. Returns how many. */
export async function cancelSunset(featureId: string): Promise<number> {
  return db.transaction(async (tx) => {
    const restored = await tx
      .update(orgFeatureEntitlements)
      .set({ status: "active", source: "grandfathered", removalEffectiveAt: null, updatedAt: new Date() })
      .where(onNotice(featureId))
      .returning({ id: orgFeatureEntitlements.id });
    await tx.delete(featureSunsetReminderLogs).where(eq(featureSunsetReminderLogs.featureId, featureId));
    return restored.length;
  });
}
