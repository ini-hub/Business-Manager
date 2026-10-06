import { useEntitlements } from "@/hooks/useEntitlements";
import { announcePlanLimit, countLimitMessage } from "@/lib/upgrade-prompt";

type LimitType = "staff_seats" | "customer_count" | "store_count" | "item_count";

/**
 * Runs an "add new X" action unless the free-tier cap is already met, in which case it opens the upgrade prompt
 * instead - before the user fills in a form the server would only reject. The server stays the source of truth;
 * while entitlements are loading or failed this lets the action through.
 */
export function useCountLimitGuard(limitType: LimitType) {
  const { staffSeats, customerCount, storeCount, itemCount, isLoading, isError } = useEntitlements();
  const status = { staff_seats: staffSeats, customer_count: customerCount, store_count: storeCount, item_count: itemCount }[limitType];
  const atCap = !isLoading && !isError && !!status && !status.unlimited && status.used >= status.limit;

  return (action: () => void) => {
    if (atCap && status) announcePlanLimit({ kind: "count", limitType, limit: status.limit, tiered: status.tiered, trial: status.trial, message: countLimitMessage(limitType, status.limit, status.tiered, status.trial) });
    else action();
  };
}
