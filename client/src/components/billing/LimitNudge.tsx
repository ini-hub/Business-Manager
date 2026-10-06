import { useState } from "react";
import { useLocation } from "wouter";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEntitlements } from "@/hooks/useEntitlements";
import { openBilling } from "@/lib/upgrade-prompt";
import { limitNudgeState } from "@/lib/limit-nudge";

type LimitType = "staff_seats" | "customer_count" | "store_count" | "item_count";

const NOUN: Record<LimitType, { one: string; many: string }> = {
  staff_seats: { one: "staff member in this store", many: "staff in this store" },
  customer_count: { one: "customer", many: "customers" },
  store_count: { one: "store", many: "stores" },
  item_count: { one: "item", many: "items" },
};

const dismissKey = (limitType: LimitType, limit: number, state: string) => `limit-nudge:${limitType}:${limit}:${state}`;

/**
 * A quiet banner shown before an org hits a free-tier or plan cap, so the upgrade comes up while there is still
 * room, not as a failed add. Dismissing it hides it for that cap level; moving to "full" or a new cap shows it again.
 */
export function LimitNudge({ limitType }: { limitType: LimitType }) {
  const { staffSeats, customerCount, storeCount, itemCount, isLoading, isError } = useEntitlements();
  const [, navigate] = useLocation();
  const status = { staff_seats: staffSeats, customer_count: customerCount, store_count: storeCount, item_count: itemCount }[limitType];
  const state = isLoading || isError ? "none" : limitNudgeState(status);

  const [dismissed, setDismissed] = useState(() => {
    if (!status) return false;
    try {
      return sessionStorage.getItem(dismissKey(limitType, status.limit, state)) === "1";
    } catch {
      return false;
    }
  });

  if (state === "none" || !status || dismissed) return null;
  const noun = NOUN[limitType];
  const left = status.limit - status.used;
  const text =
    state === "full"
      ? `You've used all ${status.limit} ${noun.many} ${status.trial ? "included in your free trial" : status.tiered ? "your plan covers" : "on the free plan"}. Upgrade to keep adding.`
      : `${status.used} of ${status.limit} ${noun.many} used - ${left} ${left === 1 ? noun.one : noun.many} left before you need to upgrade.`;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-800 dark:bg-amber-950/30" data-testid={`limit-nudge-${limitType}`}>
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <p className="min-w-0 flex-1 text-amber-950 dark:text-amber-100">{text}</p>
      <Button size="sm" variant="outline" className="shrink-0" onClick={() => openBilling(navigate)}>
        View plans
      </Button>
      <button
        type="button"
        className="shrink-0 text-amber-700 hover:text-amber-950 dark:text-amber-300"
        aria-label="Dismiss"
        onClick={() => {
          try {
            sessionStorage.setItem(dismissKey(limitType, status.limit, state), "1");
          } catch {
            // dismissal just won't persist
          }
          setDismissed(true);
        }}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
