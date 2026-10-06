import { Link } from "wouter";
import { isOrgTrialing, trialDaysRemaining } from "@/lib/trial";
import type { Business } from "@shared/schema";
import { useEntitlements } from "@/hooks/useEntitlements";

/** True once a "trialing" org's window has passed with nothing purchased - not locked (see lib/trial.ts's isOrgLocked), just past the countdown. */
function isTrialJustExpired(business: Business | null | undefined): boolean {
  if (!business || business.status !== "trialing" || !business.trialEndsAt) return false;
  return new Date(business.trialEndsAt) <= new Date();
}

/**
 * Owner-only, non-blocking. Two states: still counting down (gets visually
 * more urgent inside the last 3 days, matching the 3-day/2-day/today email
 * reminders in server/services/TrialReminderService.ts), or just expired -
 * a quiet reminder that paid features are gone, not a warning that the app
 * itself is about to lock (it doesn't, per the requirements plan).
 */
export function TrialBanner({ business }: { business: Business | null | undefined }) {
  const { lifecycle } = useEntitlements();

  // Grace: full access still, with a countdown to the soft lock (free tier; nothing is deleted).
  if (lifecycle?.state === "grace" && lifecycle.graceEndsAt) {
    const days = Math.max(0, Math.ceil((new Date(lifecycle.graceEndsAt).getTime() - Date.now()) / 86_400_000));
    return (
      <Link
        href="/settings/billing"
        data-testid="link-grace-banner"
        className="flex items-center gap-2 rounded-full bg-destructive/10 px-3 py-1 text-xs font-semibold text-destructive hover:bg-destructive/20 transition-colors animate-pulse"
      >
        {days === 0 ? "Grace period ends today" : `${days} ${days === 1 ? "day" : "days"} of grace left`} · Subscribe to keep paid features
      </Link>
    );
  }
  if (lifecycle?.state === "soft_locked") {
    return (
      <Link
        href="/settings/billing"
        data-testid="link-soft-lock-banner"
        className="flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/80 transition-colors"
      >
        Free plan · over-limit records are read-only · Upgrade to restore everything
      </Link>
    );
  }

  if (isOrgTrialing(business)) {
    const daysLeft = trialDaysRemaining(business);
    const isUrgent = daysLeft <= 3;

    const label =
      daysLeft === 0
        ? "Trial ends today · Subscribe Now"
        : `${daysLeft} ${daysLeft === 1 ? "day" : "days"} left in your trial · Subscribe Now`;

    return (
      <Link
        href="/settings/billing"
        data-testid="link-trial-banner"
        className={
          isUrgent
            ? "flex items-center gap-2 rounded-full bg-destructive/10 px-3 py-1 text-xs font-semibold text-destructive hover:bg-destructive/20 transition-colors animate-pulse"
            : "hidden sm:flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
        }
      >
        {label}
      </Link>
    );
  }

  if (isTrialJustExpired(business)) {
    return (
      <Link
        href="/settings/billing"
        data-testid="link-trial-banner"
        className="flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/80 transition-colors"
      >
        <span className="sm:hidden">Free plan</span>
        <span className="hidden sm:inline">You're on the free plan · Add features any time</span>
      </Link>
    );
  }

  return null;
}
