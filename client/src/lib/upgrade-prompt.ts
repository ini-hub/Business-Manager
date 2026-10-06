/**
 * Plan-limit 402s (server/lib/entitlements.ts) come in two shapes:
 *   { error: "feature_not_purchased", featureKey, featureName, message }
 *   { error: "count_limit_reached", limitType, limit, used, featureKey, message }
 * This module turns either into one structure, and lets a single global dialog
 * (components/billing/UpgradePromptDialog.tsx) react to a blocked action
 * wherever it happened, instead of every page hand-rolling a raw error toast.
 * Framework-free on purpose so it is unit-testable without a DOM.
 */

export type PlanLimitDetails = {
  kind: "feature" | "count";
  message: string;
  featureKey?: string;
  featureName?: string;
  priceMonthly?: number | null;
  currency?: string;
  limitType?: "staff_seats" | "customer_count" | "store_count" | "item_count";
  limit?: number;
  used?: number;
  /** The org is on a paid pack that is full, not on the free tier. */
  tiered?: boolean;
  /** The org is on its free trial, which is held to the free amount. */
  trial?: boolean;
};

/** Parses a 402 response body; null when it isn't a plan-limit error (e.g. some other 402). */
export function toPlanLimitDetails(body: unknown): PlanLimitDetails | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const message = typeof b.message === "string" ? b.message : undefined;
  if (b.error === "feature_not_purchased") {
    return {
      kind: "feature",
      message: message ?? "This isn't included in your plan yet.",
      featureKey: typeof b.featureKey === "string" ? b.featureKey : undefined,
      featureName: typeof b.featureName === "string" ? b.featureName : undefined,
      priceMonthly: typeof b.priceMonthly === "number" ? b.priceMonthly : undefined,
      currency: typeof b.currency === "string" ? b.currency : undefined,
    };
  }
  if (b.error === "count_limit_reached") {
    return {
      kind: "count",
      message: message ?? "You've reached your plan's limit.",
      featureKey: typeof b.featureKey === "string" ? b.featureKey : undefined,
      limitType: b.limitType as PlanLimitDetails["limitType"],
      limit: typeof b.limit === "number" ? b.limit : undefined,
      used: typeof b.used === "number" ? b.used : undefined,
      tiered: b.tiered === true,
      trial: b.trial === true,
    };
  }
  return null;
}

type Listener = (details: PlanLimitDetails) => void;
const listeners = new Set<Listener>();

let lastAnnounced: { message: string; at: number } | null = null;
const DUPLICATE_TOAST_WINDOW_MS = 3_000;

export function subscribeToPlanLimit(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Opens the global upgrade dialog. Called for blocked write requests (see apiRequest). */
export function announcePlanLimit(details: PlanLimitDetails): void {
  lastAnnounced = { message: details.message, at: Date.now() };
  listeners.forEach((listener) => listener(details));
}

/**
 * Pages already catch these errors and toast the server's message. Now that a
 * dialog says the same thing with an upgrade button, that toast is a duplicate,
 * so use-toast drops a toast whose text exactly matches a just-announced limit.
 */
export function isDuplicatePlanLimitToast(description: unknown, now: number = Date.now()): boolean {
  if (!lastAnnounced || typeof description !== "string") return false;
  return description === lastAnnounced.message && now - lastAnnounced.at < DUPLICATE_TOAST_WINDOW_MS;
}

const LIMIT_NOUN = { staff_seats: "staff member", customer_count: "customer", store_count: "store", item_count: "item" } as const;

/** Same wording as the server's CountLimitError, for gates that know they're at the cap before any request is sent. */
export function countLimitMessage(limitType: keyof typeof LIMIT_NOUN, limit: number, tiered = false, trial = false): string {
  const noun = LIMIT_NOUN[limitType];
  // Same wording as the server: seats are per store and the owner never uses one.
  const scope = limitType === "staff_seats" ? " per store (the owner doesn't count)" : "";
  if (trial) return `You're on the free trial, which includes ${limit} ${noun}${limit === 1 ? "" : "s"}${scope}. Upgrade to get more.`;
  if (tiered) return `Your plan covers up to ${limit} ${noun}${limit === 1 ? "" : "s"}${scope}. Move up to a bigger plan to add more.`;
  return `You're on the free tier of ${limit} ${noun}${limit === 1 ? "" : "s"}${scope}. Add the ${noun} add-on to add more.`;
}

/** Title for the dialog: names the feature, or the cap that was hit. */
export function upgradeTitle(details: PlanLimitDetails): string {
  if (details.kind === "feature") return `Unlock ${details.featureName ?? "this feature"}`;
  const noun = details.limitType === "staff_seats" ? "staff" : details.limitType === "store_count" ? "stores" : details.limitType === "item_count" ? "items" : "customers";
  if (details.trial) return `You've reached your free trial's ${noun} limit`;
  return details.tiered ? `You've reached your plan's ${noun} limit` : `You've reached your free ${noun} limit`;
}

/**
 * Sends the user to billing, remembering where they were so checkout returns
 * them here (billing-callback.tsx reads billing_return_to). sessionStorage can
 * throw in locked-down browser contexts, in which case the default return is fine.
 */
export function openBilling(navigate: (to: string) => void): void {
  try {
    sessionStorage.setItem("billing_return_to", window.location.pathname + window.location.search);
  } catch {
    // fall back to billing-callback.tsx's default
  }
  navigate("/settings/billing");
}

/** Test helper: clears module state between tests. */
export function __resetUpgradePromptForTests(): void {
  listeners.clear();
  lastAnnounced = null;
}
