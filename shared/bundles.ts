/**
 * Plan bundles (admin-managed, table pricing_bundles): a convenience grouping
 * of catalog features, NOT a separate product. A bundle owns no price of its own and grants nothing itself - the
 * feature catalog stays the only thing sold and entitled. A bundle is just
 * "this set of features, discounted when you hold all of it".
 *
 * Because the discount is derived from the features actually held, adding or
 * removing a feature at checkout needs no special casing: drop one member and
 * the set is no longer a full bundle, so the discount stops applying at the
 * next charge. Landing page, in-app checkout, /subscribe and renewal all call
 * priceSelection(), so a displayed price and a charged price cannot drift.
 */

export interface PricingBundle {
  key: string;
  name: string;
  /** Purchasable catalog keys (paid_flat / paid_metered_limit / bundle_parent). */
  featureKeys: readonly string[];
  /** Percent off the sum of the members' catalog prices. */
  discountPct: number;
}

export interface SelectionPrice {
  subtotal: number;
  discount: number;
  total: number;
  /** The bundle whose discount was applied, if the selection holds one in full. */
  bundleKey: string | null;
}

const round = (n: number) => Math.round(n);

/**
 * Prices a set of features. At most one bundle discount applies - the best one
 * among bundles fully contained in the selection - so nested bundles (Growth
 * contains Starter) never stack. Features outside that bundle bill at list.
 */
export function priceSelection(
  selected: Iterable<string>,
  priceOf: (key: string) => number,
  bundles: readonly PricingBundle[],
): SelectionPrice {
  const set = new Set(Array.from(selected));
  let subtotal = 0;
  set.forEach((key) => { subtotal += priceOf(key); });

  let best: { key: string; discount: number } | null = null;
  for (const b of bundles) {
    if (b.discountPct <= 0 || b.featureKeys.length === 0) continue;
    if (!b.featureKeys.every((k) => set.has(k))) continue;
    const memberTotal = b.featureKeys.reduce((sum, k) => sum + priceOf(k), 0);
    const discount = round((memberTotal * b.discountPct) / 100);
    if (!best || discount > best.discount) best = { key: b.key, discount };
  }

  const discount = best?.discount ?? 0;
  return { subtotal, discount, total: subtotal - discount, bundleKey: best?.key ?? null };
}

/**
 * What a checkout should charge now: the price of (already held + newly added)
 * minus the price of what is already held. Pricing the delta, not the new
 * features alone, is what lets someone complete a bundle by adding its last
 * missing piece and still get the discount.
 */
export function priceIncrement(
  held: Iterable<string>,
  added: Iterable<string>,
  priceOf: (key: string) => number,
  bundles: readonly PricingBundle[],
): SelectionPrice {
  const heldSet = new Set(Array.from(held));
  const addedSet = Array.from(new Set(Array.from(added))).filter((k) => !heldSet.has(k));
  const before = priceSelection(heldSet, priceOf, bundles);
  const after = priceSelection(Array.from(heldSet).concat(addedSet), priceOf, bundles);
  const subtotal = addedSet.reduce((sum, k) => sum + priceOf(k), 0);
  const total = Math.max(0, after.total - before.total);
  return { subtotal, discount: Math.max(0, subtotal - total), total, bundleKey: after.bundleKey };
}

export const PURCHASABLE_TIERS: readonly string[] = ["paid_flat", "paid_metered_limit", "bundle_parent"];

export function slugifyBundleKey(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

export interface CatalogEntry { key: string; name: string; isActive: boolean; tierType: string; dependsOn: string[] }

/**
 * Checks a proposed member list against the catalog: every member must exist,
 * be active and be sold on its own, and every sold feature a member depends on
 * must be in the list too (otherwise the bundle could not actually be bought
 * in full - checkout rejects a feature whose dependency is missing).
 * Returns human-readable problems; empty means valid.
 */
export function validateBundleSelection(featureKeys: readonly string[], catalog: readonly CatalogEntry[]): string[] {
  const byKey = new Map(catalog.map((c) => [c.key, c]));
  const chosen = new Set(featureKeys);
  const problems: string[] = [];
  if (chosen.size === 0) return ["A bundle needs at least one feature."];
  if (chosen.size !== featureKeys.length) problems.push("A feature is listed twice.");
  chosen.forEach((key) => {
    const f = byKey.get(key);
    if (!f) { problems.push(`"${key}" is not in the feature catalog.`); return; }
    if (!f.isActive) problems.push(`"${f.name}" is inactive.`);
    if (!PURCHASABLE_TIERS.includes(f.tierType)) problems.push(`"${f.name}" is not sold on its own, so it cannot be in a bundle.`);
    for (const dep of f.dependsOn) {
      const d = byKey.get(dep);
      if (d && PURCHASABLE_TIERS.includes(d.tierType) && !chosen.has(dep)) problems.push(`"${f.name}" needs "${d.name}" in the bundle too.`);
    }
  });
  return problems;
}

/**
 * Landing bullets for a bundle with none written by hand: "Everything in X"
 * for the largest other bundle it fully contains, then the names of what it
 * adds beyond that, capped so the card stays short.
 */
export function deriveBullets(
  bundle: { key: string; featureKeys: readonly string[] },
  all: readonly { key: string; name: string; featureKeys: readonly string[] }[],
  nameOf: (featureKey: string) => string,
  max = 4,
): string[] {
  const mine = new Set(bundle.featureKeys);
  const inner = all
    .filter((o) => o.key !== bundle.key && o.featureKeys.length > 0 && o.featureKeys.length < mine.size && o.featureKeys.every((k) => mine.has(k)))
    .sort((a, b) => b.featureKeys.length - a.featureKeys.length)[0];
  const covered = new Set(inner?.featureKeys ?? []);
  const extra = bundle.featureKeys.filter((k) => !covered.has(k)).map(nameOf);
  const shown = extra.slice(0, max);
  const out = inner ? [`Everything in ${inner.name}`] : [];
  out.push(...shown);
  if (extra.length > shown.length) out.push(`and ${extra.length - shown.length} more`);
  return out;
}

/** Shape of GET /api/billing/pricing - what the landing page and checkout price from. */
export interface PublicPricing {
  currency: string;
  /** Length of the free trial, so landing CTAs never hardcode it. */
  trialDays: number;
  features: {
    key: string; name: string; description: string | null; category: string; tierType: string;
    /** Sold features this one needs bought alongside it. */
    dependsOn: string[];
    priceMonthly: number; priceAnnual: number;
  }[];
  bundles: {
    key: string; name: string; tagline: string; featured: boolean; discountPct: number;
    /** Hand-written, or derived from the members when none were written. */
    bullets: string[];
    /** Landing shows only these; checkout offers every active bundle. */
    showOnLanding: boolean;
    featureKeys: string[];
    listMonthly: number; priceMonthly: number; listAnnual: number; priceAnnual: number;
  }[];
}
