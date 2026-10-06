import { db } from "../db";
import { eq } from "drizzle-orm";
import { featureCatalog, featureDependencies, pricingBundles, type FeatureCatalog, type PricingBundleRow } from "@shared/schema";
import {
  PURCHASABLE_TIERS, deriveBullets, priceSelection, validateBundleSelection,
  type CatalogEntry, type PricingBundle, type PublicPricing, type SelectionPrice,
} from "@shared/bundles";
import { getConfiguredTrialDays } from "./platformConfig";

/**
 * Bundles are a pricing convenience over the feature catalog, never a thing
 * that is granted or sold itself - see shared/bundles.ts. This is the server's
 * single place that turns the admin-managed bundle rows into charges, so
 * /subscribe and renewal cannot disagree with what the landing page and
 * checkout showed.
 */

export type BillingCycle = "monthly" | "annual";

export function catalogPrice(row: Pick<FeatureCatalog, "priceMonthly" | "priceAnnual">, cycle: BillingCycle): number {
  return Number(cycle === "annual" ? row.priceAnnual : row.priceMonthly) || 0;
}

function toPricingBundle(r: PricingBundleRow): PricingBundle {
  return { key: r.key, name: r.name, featureKeys: r.featureKeys ?? [], discountPct: Number(r.discountPct) || 0 };
}

/** Active bundles, in display order - what checkout and renewal price against. */
export async function getPricingBundles(): Promise<PricingBundle[]> {
  const rows = await db.select().from(pricingBundles).where(eq(pricingBundles.isActive, true)).orderBy(pricingBundles.sortOrder);
  return rows.map(toPricingBundle);
}

/** The catalog as bundle validation needs it: status, tier and sold dependencies per feature. */
export async function loadCatalogEntries(): Promise<CatalogEntry[]> {
  const rows = await db.select().from(featureCatalog);
  const deps = await db.select().from(featureDependencies);
  const keyById = new Map(rows.map((r) => [r.id, r.key]));
  return rows.map((r) => ({
    key: r.key,
    name: r.name,
    isActive: r.isActive,
    tierType: r.tierType,
    dependsOn: deps.filter((d) => d.featureId === r.id).map((d) => keyById.get(d.dependsOnFeatureId)).filter((k): k is string => !!k),
  }));
}

/** Problems with a proposed member list (empty = valid). */
export async function validateBundleMembers(featureKeys: string[]): Promise<string[]> {
  return validateBundleSelection(featureKeys, await loadCatalogEntries());
}

/** The line item a bundle discount appears as on a payment record - negative, so lines still sum to the charge. */
export function discountBreakdownLine(bundles: readonly PricingBundle[], result: SelectionPrice): { key: string; name: string; price: number } | null {
  if (!result.bundleKey || result.discount <= 0) return null;
  const name = bundles.find((b) => b.key === result.bundleKey)?.name ?? "Bundle";
  return { key: `bundle_discount:${result.bundleKey}`, name: `${name} bundle discount`, price: -result.discount };
}

/**
 * Everything the public pricing section and the custom builder need. A bundle
 * with any member that is inactive or unpriced cannot be bought in full, so it
 * is left out rather than shown at a price nobody could actually get.
 */
export async function getPublicPricing(): Promise<PublicPricing> {
  const rows = await db.select().from(featureCatalog).where(eq(featureCatalog.isActive, true)).orderBy(featureCatalog.sortOrder);
  const sellable = rows.filter((r) => PURCHASABLE_TIERS.includes(r.tierType));
  const byKey = new Map(sellable.map((r) => [r.key, r]));
  const entries = await loadCatalogEntries();
  const depsByKey = new Map(entries.map((e) => [e.key, e.dependsOn]));

  const bundleRows = (await db.select().from(pricingBundles).where(eq(pricingBundles.isActive, true)).orderBy(pricingBundles.sortOrder))
    .filter((b) => b.featureKeys.length > 0 && b.featureKeys.every((k) => byKey.has(k)));
  const forBullets = bundleRows.map((b) => ({ key: b.key, name: b.name, featureKeys: b.featureKeys }));
  const nameOf = (k: string) => byKey.get(k)?.name ?? k;

  const bundles: PublicPricing["bundles"] = bundleRows.map((b) => {
    const pb = toPricingBundle(b);
    const monthly = priceSelection(pb.featureKeys, (k) => catalogPrice(byKey.get(k)!, "monthly"), [pb]);
    const annual = priceSelection(pb.featureKeys, (k) => catalogPrice(byKey.get(k)!, "annual"), [pb]);
    const written = (b.bullets ?? []).filter((x) => x.trim());
    return {
      key: b.key, name: b.name, tagline: b.tagline, featured: b.featured, discountPct: pb.discountPct,
      bullets: written.length > 0 ? written : deriveBullets(pb, forBullets, nameOf),
      showOnLanding: b.showOnLanding,
      featureKeys: [...pb.featureKeys],
      listMonthly: monthly.subtotal, priceMonthly: monthly.total, listAnnual: annual.subtotal, priceAnnual: annual.total,
    };
  });

  return {
    currency: sellable[0]?.currency ?? "NGN",
    trialDays: await getConfiguredTrialDays(),
    features: sellable.map((r) => ({
      key: r.key, name: r.name, description: r.description ?? null, category: r.category, tierType: r.tierType,
      // Only dependencies that are themselves sold - free ones are always there.
      dependsOn: (depsByKey.get(r.key) ?? []).filter((d) => byKey.has(d)),
      priceMonthly: catalogPrice(r, "monthly"), priceAnnual: catalogPrice(r, "annual"),
    })),
    bundles,
  };
}
