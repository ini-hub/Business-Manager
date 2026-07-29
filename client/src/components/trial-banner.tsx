import { Link } from "wouter";
import { isOrgTrialing, trialDaysRemaining } from "@/lib/trial";
import type { Business } from "@shared/schema";

/**
 * Owner-only, non-blocking - only ever renders for a "trialing" org still inside its window.
 * Gets visually more urgent inside the last 3 days (matches the 3-day/2-day/today
 * email reminders in server/services/TrialReminderService.ts) so the CTA escalates
 * alongside them instead of staying a quiet, easy-to-ignore pill the whole trial.
 */
export function TrialBanner({ business }: { business: Business | null | undefined }) {
  if (!isOrgTrialing(business)) return null;
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
          ? "flex items-center gap-1.5 rounded-full bg-destructive/10 px-3 py-1 text-xs font-semibold text-destructive hover:bg-destructive/20 transition-colors animate-pulse"
          : "hidden sm:flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
      }
    >
      {label}
    </Link>
  );
}
