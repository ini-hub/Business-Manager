import { useQuery } from "@tanstack/react-query";
import { findGatedScreen } from "@shared/gateRules";
import { gatedFeatureForScreen } from "@shared/features";
import type { PermissionModule } from "@shared/permissionModules";
import type { SidebarLayout } from "@shared/sidebarLayout";
import { useOptionalStore } from "@/lib/store-context";

type CountLimitStatus = { limit: number; used: number; unlimited: boolean; tiered?: boolean; trial?: boolean; usedByStore?: Record<string, number> };

type EntitlementsResponse = {
  features: string[];
  // Subset of `features` actually purchased (or free) - excludes anything
  // that's only present because the org is trialing (blanket-granted).
  purchasedFeatures: string[];
  // Screens that need a feature: the code baseline plus rules a super admin added in
  // the console. "admin" rules also require the feature's Settings > Roles module.
  screenGates?: { pattern: string; featureKey: string; module: PermissionModule | null; source: "code" | "admin" }[];
  // Super-admin sidebar layout; null/absent means the built-in default.
  sidebarLayout?: SidebarLayout | null;
  // trial -> grace -> soft_locked countdown (server/lib/trial.ts getOrgLifecycle).
  lifecycle?: { state: "trialing" | "grace" | "soft_locked" | "ok" | "suspended"; graceEndsAt: string | null; trialEndsAt: string | null; graceDays: number };
  // Flag off / deactivated: hide these everywhere (nav, buttons, tabs).
  disabledFeatures?: string[];
  // Cost of every visible-but-unpaid feature, for "X costs ₦N/month" prompts.
  featurePrices?: Record<string, FeaturePrice>;
  limits: {
    staff_seats: CountLimitStatus;
    customer_count: CountLimitStatus;
    store_count: CountLimitStatus;
    item_count?: CountLimitStatus;
  };
};

export type FeaturePrice = { name: string; monthly: number | null; annual: number | null; currency: string; viaFeatureKey?: string };

/** "₦2,000/month", or null when no price is set yet. */
export function formatPrice(price: Pick<FeaturePrice, "monthly" | "currency"> | undefined): string | null {
  if (!price || price.monthly == null) return null;
  const symbol = price.currency === "NGN" ? "₦" : `${price.currency} `;
  return `${symbol}${price.monthly.toLocaleString("en-NG")}/month`;
}

/**
 * Which purchased features and free-tier limits this org currently has -
 * mirrors the useAuth/trial query-hook pattern (small pure predicates over a
 * query, not a heavyweight context provider). Feeds gated nav items, form
 * sections, and "Add staff/customer" buttons so they hide or disable
 * themselves and show an upgrade CTA instead of surfacing a raw 402 from the
 * server's requireFeature/requireCountLimit gates.
 */
export function useEntitlements() {
  const storeId = useOptionalStore()?.currentStore?.id;
  const { data, isLoading, isError, refetch } = useQuery<EntitlementsResponse>({
    queryKey: ["/api/entitlements"],
    staleTime: 60_000, // purchases/removals are user-initiated and invalidate this key directly, no need to poll
  });

  return {
    hasFeature: (featureKey: string) => !!data?.features.includes(featureKey),
    // Flag off: the feature must not be rendered at all.
    isDisabled: (featureKey: string) => !!data?.disabledFeatures?.includes(featureKey),
    // Visible but unpaid: render it, but any action opens the priced upgrade prompt.
    isLocked: (featureKey: string) => !!data && !data.features.includes(featureKey) && !data.disabledFeatures?.includes(featureKey),
    priceFor: (featureKey: string): FeaturePrice | undefined => data?.featurePrices?.[featureKey],
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
    sidebarLayout: data?.sidebarLayout ?? null,
    lifecycle: data?.lifecycle,
    entitledKeys: data?.features ?? [],
    purchasedKeys: data?.purchasedFeatures ?? [],
    // Seats are per store (owner excluded): show the store in view, or the busiest one for "all stores".
    staffSeats: data?.limits.staff_seats && {
      ...data.limits.staff_seats,
      used: storeId && storeId !== "all" ? data.limits.staff_seats.usedByStore?.[storeId] ?? 0 : data.limits.staff_seats.used,
    },
    customerCount: data?.limits.customer_count,
    storeCount: data?.limits.store_count,
    itemCount: data?.limits.item_count,
    isLoading,
    // A failed fetch is not the same as "no features" - callers must not show the upgrade lock for it.
    isError,
    refetch,
  };
}
