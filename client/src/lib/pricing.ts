import { useQuery } from "@tanstack/react-query";
import type { PublicPricing } from "@shared/bundles";

export const CATEGORY_LABELS: Record<string, string> = {
  vendor_mgmt: "Vendor Management",
  staff_mgmt: "Staff Management",
  customer_mgmt: "Customer Management",
  financial_mgmt: "Financial Management",
  tax_compliance: "Tax, Compliance & Audit",
  inventory_mgmt: "Inventory Management",
  analytics: "Analytics",
  business_settings: "Business & Settings",
};

export function formatMoney(amount: number, currency = "NGN"): string {
  const symbol = currency === "NGN" ? "₦" : `${currency} `;
  return `${symbol}${Math.round(amount).toLocaleString("en-NG")}`;
}

/** Live bundle and feature prices from the catalog - public, so the landing page can use it signed out. */
export function usePublicPricing() {
  return useQuery<PublicPricing>({ queryKey: ["/api/billing/pricing"], staleTime: 5 * 60 * 1000 });
}

// What someone picked on the landing page, carried across sign-up so the
// in-app checkout opens on it instead of making them choose twice.
const PLAN_CHOICE_KEY = "kowope_plan_choice";

export interface PlanChoice { bundle?: string; features?: string[] }

export function savePlanChoice(choice: PlanChoice | null): void {
  try {
    if (choice) localStorage.setItem(PLAN_CHOICE_KEY, JSON.stringify(choice));
    else localStorage.removeItem(PLAN_CHOICE_KEY);
  } catch {
    // storage blocked - the visitor just picks again in checkout
  }
}

export function readPlanChoice(): PlanChoice | null {
  try {
    const raw = localStorage.getItem(PLAN_CHOICE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return {
      bundle: typeof v?.bundle === "string" ? v.bundle : undefined,
      features: Array.isArray(v?.features) ? v.features.filter((k: unknown): k is string => typeof k === "string") : undefined,
    };
  } catch {
    return null;
  }
}
