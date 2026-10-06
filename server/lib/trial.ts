import type { Organisation, Subscription } from "@shared/schema";

/** Length of the free trial granted to a brand-new organisation at signup. */
export const TRIAL_DAYS = 14;

/**
 * `days` defaults to the TRIAL_DAYS constant but is normally passed
 * explicitly by callers via getConfiguredTrialDays() (server/lib/
 * platformConfig.ts) so an admin-configured trial length applies to new
 * signups without this function needing to know about the config table.
 */
export function computeTrialEndsAt(from: Date = new Date(), days: number = TRIAL_DAYS): Date {
  const end = new Date(from);
  end.setDate(end.getDate() + days);
  return end;
}

/**
 * True only for organisations created after the trial system shipped and still
 * inside their trial window. Every organisation that existed before this shipped
 * has status "active" and trial_ends_at = null, so this is always false for them -
 * that's what keeps their behavior unchanged.
 */
export function isOrgTrialing(org: Pick<Organisation, "status" | "trialEndsAt">): boolean {
  return org.status === "trialing" && !!org.trialEndsAt && new Date(org.trialEndsAt) > new Date();
}

/** True once trialEndsAt has passed for an org still marked "trialing" (i.e. needs the lazy-expiry flip). */
export function isTrialExpired(org: Pick<Organisation, "status" | "trialEndsAt">): boolean {
  return org.status === "trialing" && !!org.trialEndsAt && new Date(org.trialEndsAt) <= new Date();
}

/** Days of full access after a trial (or a failed renewal) before the soft lock. Admin-configurable (platform_config "grace_days"). */
export const GRACE_DAYS = 7;

export type OrgLifecycle = "trialing" | "grace" | "soft_locked" | "ok" | "suspended";

type LifecycleOrg = Pick<Organisation, "status" | "trialEndsAt"> & { graceEndsAt?: Date | string | null };

/**
 * Where an org is in trial -> grace -> soft lock. Derived from timestamps, so it
 * needs no cron:
 *   trialing    inside the trial window
 *   grace       trial ended (or a renewal failed) less than `graceDays` ago: full access, countdown banner
 *   soft_locked grace is over: free tier only, nothing deleted, checkout/exports stay open
 *   suspended   admin suspension (fraud/ToS)
 * Anything else is "ok" (including grandfathered orgs with no trial).
 */
export function getOrgLifecycle(org: LifecycleOrg, graceDays: number = GRACE_DAYS, now: Date = new Date()): { state: OrgLifecycle; graceEndsAt: Date | null } {
  if (org.status === "suspended") return { state: "suspended", graceEndsAt: null };
  if (org.graceEndsAt) {
    const end = new Date(org.graceEndsAt);
    return { state: end > now ? "grace" : "soft_locked", graceEndsAt: end };
  }
  if (org.status === "trialing" && org.trialEndsAt) {
    const trialEnd = new Date(org.trialEndsAt);
    if (trialEnd > now) return { state: "trialing", graceEndsAt: null };
    const end = new Date(trialEnd.getTime() + graceDays * 24 * 60 * 60 * 1000);
    return { state: end > now ? "grace" : "soft_locked", graceEndsAt: end };
  }
  return { state: "ok", graceEndsAt: null };
}

/**
 * Whether the org can use the app normally right now. Only an admin-suspended
 * org (fraud/ToS/non-payment - see server/lib/billing.ts's
 * maybeProcessDueRenewal, which sets this on a failed renewal charge) locks
 * the whole app. A trial ending on its own, with nothing purchased, is NOT a
 * whole-org lock: the per-feature gates (requireFeature/requireCountLimit in
 * server/lib/entitlements.ts) already take over at that point and fall the
 * org back to exactly the free tier, same as any other non-paying org -
 * that's the intended landing state, not something to additionally block at
 * the API level. (Before this, getOrgEntitlements grants every active
 * feature outright while the trial is still running - see
 * isOrgCurrentlyTrialing - so "trial ends" is genuinely the only transition,
 * not a second gate stacked on top of a whole-org lock.)
 */
export function getOrgAccessState(
  org: Pick<Organisation, "status" | "trialEndsAt">,
  _subscription: Pick<Subscription, "status"> | null
): "ok" | "locked" {
  if (org.status === "suspended") return "locked";
  return "ok";
}
