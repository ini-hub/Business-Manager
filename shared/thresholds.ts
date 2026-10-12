/**
 * Cap thresholds: paid steps above a feature's free cap ("Stores: up to 3"). An admin adds one as a capped
 * catalog row; the limit logic already reads capped tiers from the catalog (see LimitTier in features.ts), so a
 * threshold created here behaves exactly like a built-in pack. The same planner runs on the client (preview) and
 * the server (validation), so what the admin is shown is what gets created.
 */

import { LIMITS, LIMIT_TYPES, isLimitType, type LimitType } from "./limits";

export type CapType = LimitType;

export interface CapMeta {
  label: string;
  /** What the limit counts, after "Up to N". */
  unit: string;
  keyPrefix: string;
  describe: (limit: number) => string;
}

export const CAPS = Object.fromEntries(
  LIMIT_TYPES.map((t) => [t, { label: LIMITS[t].capLabel, unit: LIMITS[t].capUnit, keyPrefix: LIMITS[t].keyPrefix, describe: LIMITS[t].describe }]),
) as Record<CapType, CapMeta>;

export const CAP_ORDER: readonly CapType[] = LIMIT_TYPES;

export const isCapType = isLimitType;

/** One step on a cap's ladder, free cap first. */
export interface LadderStep {
  key: string;
  name: string;
  /** Total the step allows; null is the unlimited add-on. */
  capacity: number | null;
  priceMonthly: number | null;
  state: "live" | "needs_review" | "inactive";
}

export interface ThresholdPlan {
  key: string;
  name: string;
  description: string;
  problems: string[];
  /** The steps either side of the new one, for "sits between X and Y". */
  below: LadderStep | null;
  above: LadderStep | null;
}

export function planThreshold(args: {
  cap: CapType;
  limit: number;
  freeLimit: number;
  ladder: readonly LadderStep[];
  existingKeys: ReadonlySet<string>;
}): ThresholdPlan {
  const { cap, limit, freeLimit, ladder, existingKeys } = args;
  const meta = CAPS[cap];
  const key = `${meta.keyPrefix}_${limit}`;
  const problems: string[] = [];

  if (!Number.isInteger(limit) || limit < 2) problems.push("The limit must be a whole number of 2 or more.");
  else if (limit <= freeLimit) problems.push(`The limit must be above the free cap of ${freeLimit}.`);
  const sameLimit = ladder.find((s) => s.capacity === limit);
  if (sameLimit) problems.push(`"${sameLimit.name}" already offers a limit of ${limit}.`);
  else if (existingKeys.has(key)) problems.push(`The key ${key} is already taken.`);

  const finite = ladder.filter((s) => s.capacity !== null).sort((a, b) => (a.capacity as number) - (b.capacity as number));
  const below = [...finite].reverse().find((s) => (s.capacity as number) < limit) ?? null;
  const above = finite.find((s) => (s.capacity as number) > limit) ?? ladder.find((s) => s.capacity === null) ?? null;

  return { key, name: `${meta.label}: up to ${limit}`, description: meta.describe(limit), problems, below, above };
}

/** A price outside its neighbours' prices is probably a typo, but it is the admin's call, so it only warns. */
export function priceWarning(price: number | null, below: LadderStep | null, above: LadderStep | null): string | null {
  if (price == null) return null;
  if (below?.priceMonthly != null && price < below.priceMonthly) return `Cheaper than ${below.name} (${below.priceMonthly.toLocaleString()}/mo), which allows less.`;
  if (above?.priceMonthly != null && price > above.priceMonthly) return `Dearer than ${above.name} (${above.priceMonthly.toLocaleString()}/mo), which allows more.`;
  return null;
}
