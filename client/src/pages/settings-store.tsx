import { useSearch, Redirect } from "wouter";

// Every former tab here now has its own route + breadcrumb (store-details.tsx,
// attendance.tsx, credit-sales.tsx, payment-integrations.tsx, promotions.tsx,
// taxes-compliance.tsx, bulk-operations.tsx) - see the Settings Screen
// Restructure follow-up. This map is what makes /settings/store-settings
// itself, and any bookmarked ?tab=... link into it, still land somewhere
// real instead of 404ing - the same job the old ?tab= redirect already did
// for /settings/taxes and /settings/promotions, just generalized to every tab.
const TAB_ROUTES: Record<string, string> = {
  details: "/settings/store-details",
  attendance: "/settings/attendance",
  "credit-sales": "/settings/credit-sales",
  payments: "/settings/payment-integrations",
  promotions: "/settings/promotions",
  taxes: "/settings/taxes",
  bulk: "/settings/bulk-operations",
};

/**
 * Settings scoped to whichever store is currently active app-wide - no
 * content of its own anymore, purely a redirect into the dedicated route for
 * whichever tab an old link/bookmark named.
 */
export default function SettingsStorePage() {
  const search = useSearch();
  const requestedTab = new URLSearchParams(search).get("tab");
  const target = (requestedTab && TAB_ROUTES[requestedTab]) || TAB_ROUTES.details;
  return <Redirect to={target} />;
}
