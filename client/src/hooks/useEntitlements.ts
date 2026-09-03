import { useQuery } from "@tanstack/react-query";

export type CountLimitStatus = { limit: number; used: number; unlimited: boolean };

type EntitlementsResponse = {
  features: string[];
  // Subset of `features` actually purchased (or free) - excludes anything
  // that's only present because the org is trialing (blanket-granted).
  purchasedFeatures: string[];
  limits: {
    staff_seats: CountLimitStatus;
    customer_count: CountLimitStatus;
    store_count: CountLimitStatus;
  };
};

/**
 * Which purchased features and free-tier limits this org currently has -
 * mirrors the useAuth/trial query-hook pattern (small pure predicates over a
 * query, not a heavyweight context provider). Feeds gated nav items, form
 * sections, and "Add staff/customer" buttons so they hide or disable
 * themselves and show an upgrade CTA instead of surfacing a raw 402 from the
 * server's requireFeature/requireCountLimit gates.
 */
export function useEntitlements() {
  const { data, isLoading } = useQuery<EntitlementsResponse>({
    queryKey: ["/api/entitlements"],
    staleTime: 60_000, // purchases/removals are user-initiated and invalidate this key directly, no need to poll
  });

  return {
    hasFeature: (featureKey: string) => !!data?.features.includes(featureKey),
    // Actually purchased (or free) - not just granted for the moment by a
    // trial. Use this, not hasFeature, to decide whether a "Remove" action
    // or a buy checkbox makes sense (client/src/components/billing/FeatureAddOns.tsx).
    isPurchased: (featureKey: string) => !!data?.purchasedFeatures.includes(featureKey),
    // Raw lists, for callers that need to diff a selection against current
    // state rather than check one key at a time (the Renew/Update
    // subscription checklist in FeatureAddOns.tsx).
    entitledKeys: data?.features ?? [],
    purchasedKeys: data?.purchasedFeatures ?? [],
    staffSeats: data?.limits.staff_seats,
    customerCount: data?.limits.customer_count,
    storeCount: data?.limits.store_count,
    isLoading,
  };
}
