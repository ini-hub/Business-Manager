import { db } from "../db";
import { eq } from "drizzle-orm";
import { featureCatalog, featureDependencies, pricingBundles, type FeatureCatalog, type PricingBundleRow } from "@shared/schema";
import {
  PURCHASABLE_TIERS, deriveBullets, priceSelection, replaceChildrenWithParents, validateBundleSelection,
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

/** The admin fixed price for a cycle, or null when none is set (then discountPct applies). */
function fixedPriceFor(r: PricingBundleRow, cycle: BillingCycle): number | null {
  const v = cycle === "annual" ? r.fixedPriceAnnual : r.fixedPriceMonthly;
  return v == null ? null : Number(v);
}

function toPricingBundle(r: PricingBundleRow, cycle: BillingCycle): PricingBundle {
  return {
    key: r.key, name: r.name, featureKeys: r.featureKeys ?? [], discountPct: Number(r.discountPct) || 0,
    fixedPrice: fixedPriceFor(r, cycle), businessStructure: r.businessStructure ?? null,
  };
}

/** Active bundles, in display order - what checkout and renewal price against, for one billing cycle. */
export async function getPricingBundles(cycle: BillingCycle = "monthly"): Promise<PricingBundle[]> {
  const rows = await db.select().from(pricingBundles).where(eq(pricingBundles.isActive, true)).orderBy(pricingBundles.sortOrder);
  return rows.map((r) => toPricingBundle(r, cycle));
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

/** child feature key -> parent feature key, for every bundle_child in the catalog. */
export async function loadChildParentMap(): Promise<Map<string, string>> {
  const rows = await db.select({
    id: featureCatalog.id, key: featureCatalog.key, tierType: featureCatalog.tierType, parentFeatureId: featureCatalog.parentFeatureId,
  }).from(featureCatalog);
  const keyById = new Map(rows.map((r) => [r.id, r.key]));
  const out = new Map<string, string>();
  for (const r of rows) {
    const parent = r.tierType === "bundle_child" && r.parentFeatureId ? keyById.get(r.parentFeatureId) : undefined;
    if (parent) out.set(r.key, parent);
  }
  return out;
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
    const pbMonthly = toPricingBundle(b, "monthly");
    const pbAnnual = toPricingBundle(b, "annual");
    const pb = pbMonthly;
    const monthly = priceSelection(pb.featureKeys, (k) => catalogPrice(byKey.get(k)!, "monthly"), [pbMonthly]);
    const annual = priceSelection(pb.featureKeys, (k) => catalogPrice(byKey.get(k)!, "annual"), [pbAnnual]);
    const written = (b.bullets ?? []).filter((x) => x.trim());
    return {
      key: b.key, name: b.name, tagline: b.tagline, featured: b.featured, discountPct: pb.discountPct,
      businessStructure: b.businessStructure ?? null,
      fixedPriceMonthly: pbMonthly.fixedPrice ?? null,
      fixedPriceAnnual: pbAnnual.fixedPrice ?? null,
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

/** A proposed member list with any bundle child swapped for the parent that carries it. */
export async function normalizeBundleMembers(featureKeys: string[]): Promise<string[]> {
  return replaceChildrenWithParents(featureKeys, await loadChildParentMap());
}
