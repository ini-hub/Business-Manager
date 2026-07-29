import type { Organisation, Subscription } from "@shared/schema";

/** Length of the free trial granted to a brand-new organisation at signup. */
export const TRIAL_DAYS = 14;

export function computeTrialEndsAt(from: Date = new Date()): Date {
  const end = new Date(from);
  end.setDate(end.getDate() + TRIAL_DAYS);
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

/**
 * Whether the org can use the app normally right now. Everything that isn't
 * "trialing" or "suspended" (i.e. every pre-existing organisation) is always "ok" -
 * this function only ever restricts orgs created by the new trial flow.
 *
 * Both a suspended org (admin-initiated, e.g. fraud/ToS/non-payment) and a
 * trial-expired org without an active subscription are locked immediately -
 * no grace period. A soft grace window undermines the incentive to convert,
 * so the countdown to expiry is instead surfaced ahead of time via
 * TrialReminderService (email at 3 days / 2 days / today) and the in-app
 * trial banner, not by quietly extending access past trialEndsAt.
 */
export function getOrgAccessState(
  org: Pick<Organisation, "status" | "trialEndsAt">,
  subscription: Pick<Subscription, "status"> | null
): "ok" | "locked" {
  if (org.status === "suspended") return "locked";
  if (org.status === "trialing") {
    if (!isTrialExpired(org)) return "ok";
    if (subscription?.status === "active") return "ok";
    return "locked";
  }
  return "ok";
}
