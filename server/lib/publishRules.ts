import type { FeatureDef } from "@shared/features";

/** Tiers that carry no price of their own, so nothing is grandfathered or sunset for them. */
const UNPRICED_TIERS = ["free", "bundle_child"];

/**
 * Publishing a feature grants it free to every existing organisation when the registry says it used to be
 * free (`grandfather`) and the feature is priced. Used by publishFeature and by the impact preview, so the
 * number an admin sees before publishing is the number that is granted.
 */
export function grandfatherApplies(def: Pick<FeatureDef, "grandfather"> | undefined, tierType: string): boolean {
  return !!def?.grandfather && !UNPRICED_TIERS.includes(tierType);
}

/** A sunset moves free users behind a paywall, so it only makes sense for a priced feature. */
export function sunsetTierProblem(tierType: string): string | null {
  return UNPRICED_TIERS.includes(tierType) ? "Only a priced feature can be moved behind the paywall." : null;
}

export const SUNSET_MIN_NOTICE_DAYS = 30;

/** The paywall date must leave businesses real notice. `now` is injectable for tests. */
export function sunsetDateProblem(input: unknown, now: Date = new Date()): { date: Date | null; error: string | null } {
  if (!input) return { date: null, error: "paywallEffectiveAt is required." };
  const date = new Date(input as string);
  if (Number.isNaN(date.getTime())) return { date: null, error: "paywallEffectiveAt must be a valid date." };
  const min = new Date(now);
  min.setDate(min.getDate() + SUNSET_MIN_NOTICE_DAYS);
  if (date < min) return { date: null, error: "The paywall date must be at least 30 days out, so affected businesses get real notice." };
  return { date, error: null };
}

/**
 * A capped tier with a capacity that is not in the registry is a cap threshold an admin added in the catalog.
 * Nothing marks it in the table: the shape is the marker, and the limit logic treats it like a built-in pack.
 */
export function isAdminThreshold(row: { tierType: string; limitType: string | null; tierCapacity: number | null }): boolean {
  return row.tierType === "paid_metered_limit" && !!row.limitType && row.tierCapacity != null;
}
