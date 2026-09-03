type TrialFields = { status: string | null | undefined; trialEndsAt: string | Date | null | undefined };

/**
 * Mirrors server/lib/trial.ts. True only for organisations created after the
 * trial system shipped and still inside their trial window - every organisation
 * that existed before this shipped has status "active" and trialEndsAt = null,
 * so this is always false for them.
 *
 * Accepts plain string dates too (not just `Date`), since API responses are
 * JSON - `trialEndsAt` is only ever a real Date instance on the server.
 */
export function isOrgTrialing(business: TrialFields | null | undefined): boolean {
  if (!business) return false;
  return business.status === "trialing" && !!business.trialEndsAt && new Date(business.trialEndsAt) > new Date();
}

/**
 * Calendar-day distance to trialEndsAt (both sides truncated to midnight), not a
 * raw ms/24h ceiling - this is what lets it read 0 ("ends today") while the trial
 * is still technically active for a few more hours, matching the "today" stage
 * used by server/services/TrialReminderService.ts for the same countdown.
 */
export function trialDaysRemaining(business: Pick<TrialFields, "trialEndsAt"> | null | undefined): number {
  if (!business?.trialEndsAt) return 0;
  const end = new Date(business.trialEndsAt);
  end.setHours(0, 0, 0, 0);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const days = Math.round((end.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
  return Math.max(0, days);
}

/**
 * Whether the app should be locked for this org right now. Mirrors
 * server/lib/trial.ts's getOrgAccessState: only an admin-suspended org locks
 * the whole app. A trial simply ending, with nothing purchased, is NOT a
 * lock - the org falls back to the free tier via the per-feature entitlement
 * gates (useEntitlements/FeatureGate), same as any other non-paying org.
 */
export function isOrgLocked(business: TrialFields | null | undefined): boolean {
  if (!business) return false;
  return business.status === "suspended";
}
