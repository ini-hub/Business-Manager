import { db } from "../db";
import { eq } from "drizzle-orm";
import { platformConfig } from "@shared/schema";
import { TRIAL_DAYS } from "./trial";

/**
 * Platform-operator-level settings (shared/schema/platform.ts's platformConfig
 * key/value table) - not scoped to any business. Small and generic on
 * purpose: today's only consumer is trial length, but new admin-configurable
 * platform settings can reuse get/setPlatformConfigValue without a schema
 * change.
 */

export async function getPlatformConfigValue<T>(key: string): Promise<T | undefined> {
  const [row] = await db.select().from(platformConfig).where(eq(platformConfig.key, key)).limit(1);
  return row ? (row.value as T) : undefined;
}

export async function setPlatformConfigValue(key: string, value: unknown, updatedBy?: string): Promise<void> {
  await db
    .insert(platformConfig)
    .values({ key, value: value as any, updatedBy })
    .onConflictDoUpdate({
      target: platformConfig.key,
      set: { value: value as any, updatedBy, updatedAt: new Date() },
    });
}

/**
 * The trial length new signups get, admin-configurable from Platform
 * Settings (requirements plan §2). Falls back to the TRIAL_DAYS constant if
 * no admin has ever set one - so nothing changes for existing deployments
 * until an admin actively opts in. Per the confirmed decision, changing this
 * only affects orgs signing up afterward - trialEndsAt is fixed once at
 * signup and never recalculated for an org already mid-trial.
 */
export async function getConfiguredTrialDays(): Promise<number> {
  const value = await getPlatformConfigValue<number>("trial_days");
  const days = typeof value === "number" && value > 0 ? value : TRIAL_DAYS;
  return days;
}
