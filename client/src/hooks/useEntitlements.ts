import { useQuery } from "@tanstack/react-query";
import { findGatedScreen } from "@shared/gateRules";
import { gatedFeatureForScreen } from "@shared/features";
import type { PermissionModule } from "@shared/permissionModules";

type CountLimitStatus = { limit: number; used: number; unlimited: boolean };

type EntitlementsResponse = {
  features: string[];
  // Subset of `features` actually purchased (or free) - excludes anything
  // that's only present because the org is trialing (blanket-granted).
  purchasedFeatures: string[];
  // Screens that need a feature: the code baseline plus rules a super admin added in
  // the console. "admin" rules also require the feature's Settings > Roles module.
  screenGates?: { pattern: string; featureKey: string; module: PermissionModule | null; source: "code" | "admin" }[];
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
  const { data, isLoading, isError, refetch } = useQuery<EntitlementsResponse>({
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
    // The feature a client path needs, or null. Falls back to the code baseline until the
    // server's list has loaded.
    gatedFeatureFor: (path: string): string | null =>
      data?.screenGates ? findGatedScreen(path, data.screenGates) : gatedFeatureForScreen(path),
    // The module an admin-defined screen rule additionally needs, or null.
    gatedModuleFor: (path: string): PermissionModule | null => {
      const gates = data?.screenGates?.filter((g) => g.source === "admin") ?? [];
      const key = findGatedScreen(path, gates);
      return key ? gates.find((g) => g.featureKey === key)?.module ?? null : null;
    },
    entitledKeys: data?.features ?? [],
    purchasedKeys: data?.purchasedFeatures ?? [],
    staffSeats: data?.limits.staff_seats,
    customerCount: data?.limits.customer_count,
    storeCount: data?.limits.store_count,
    isLoading,
    // A failed fetch is not the same as "no features" - callers must not show the upgrade lock for it.
    isError,
    refetch,
  };
}
