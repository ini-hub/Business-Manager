import { PURCHASABLE_TIERS, validateBundleSelection, type CatalogEntry } from "@shared/bundles";
import type { BusinessStructure } from "@shared/schema/_helpers";

/**
 * The starting point for the three per-business-structure bundles (migration 0133),
 * taken from the feature matrix: what a solo owner, a business with staff and a
 * multi-store business use day to day ("Core" rows).
 *
 * These are CANDIDATES, not a promise. The feature catalog in each environment
 * is admin-managed (a feature can be free, bundled under a parent, inactive or
 * unpriced), so resolveSeedBundle() keeps only what is actually sold on its own
 * right now and reports the rest. Admins can refine the result in Super Admin >
 * Bundles; prices are deliberately not set here (see scripts/seed-structure-bundles.ts).
 */
export interface StructureBundleSpec {
  structure: BusinessStructure;
  name: string;
  tagline: string;
  candidateKeys: string[];
  sortOrder: number;
}

const SOLO = ["credit_sale", "inventory_audit", "financial_management"];
const WITH_STAFF = [
  ...SOLO,
  "purchase_management", "customer_analytics", "analytics_explorer", "payment_collection",
  "attendance_management", "staff_seats_5",
];
const MULTI_STORE = [
  ...WITH_STAFF.filter((k) => k !== "staff_seats_5"),
  "staff_seats_15", "staff_performance_tracking", "store_pack_3", "stock_transfer", "staff_transfer",
];

export const STRUCTURE_BUNDLE_SPECS: StructureBundleSpec[] = [
  { structure: "solo", name: "Solo", tagline: "For a one-person business", candidateKeys: SOLO, sortOrder: 100 },
  { structure: "with_staff", name: "With Staff", tagline: "For a business with employees", candidateKeys: WITH_STAFF, sortOrder: 110 },
  { structure: "multi_store", name: "Multi-Store", tagline: "For businesses with more than one location", candidateKeys: MULTI_STORE, sortOrder: 120 },
];

export interface SeedResolution {
  featureKeys: string[];
  /** Candidates left out, with the reason an admin can act on. */
  skipped: { key: string; reason: string }[];
  /** Sold features pulled in because a member depends on them. */
  addedAsDependency: string[];
  /** Non-empty means the bundle must not be written. */
  problems: string[];
}

const isSold = (e: CatalogEntry | undefined): e is CatalogEntry =>
  !!e && e.isActive && PURCHASABLE_TIERS.includes(e.tierType);

export function resolveSeedBundle(candidateKeys: readonly string[], catalog: readonly CatalogEntry[]): SeedResolution {
  const byKey = new Map(catalog.map((c) => [c.key, c]));
  const skipped: SeedResolution["skipped"] = [];
  const chosen = new Set<string>();

  for (const key of candidateKeys) {
    const e = byKey.get(key);
    if (!e) skipped.push({ key, reason: "not in the feature catalog" });
    else if (!e.isActive) skipped.push({ key, reason: "inactive (not published yet?)" });
    else if (!PURCHASABLE_TIERS.includes(e.tierType)) skipped.push({ key, reason: `not sold on its own (${e.tierType})` });
    else chosen.add(key);
  }

  // A member whose sold dependency is inactive can never be bought in full - drop it
  // rather than write a bundle checkout would reject.
  let changed = true;
  while (changed) {
    changed = false;
    Array.from(chosen).forEach((key) => {
      const blocked = (byKey.get(key)?.dependsOn ?? []).find((d) => {
        const de = byKey.get(d);
        return de && PURCHASABLE_TIERS.includes(de.tierType) && !de.isActive;
      });
      if (blocked) { chosen.delete(key); skipped.push({ key, reason: `needs "${blocked}", which is inactive` }); changed = true; }
    });
  }

  // Pull in sold dependencies so the bundle can actually be bought in full.
  const addedAsDependency: string[] = [];
  const queue = Array.from(chosen);
  while (queue.length) {
    const key = queue.pop()!;
    for (const d of byKey.get(key)?.dependsOn ?? []) {
      if (chosen.has(d) || !isSold(byKey.get(d))) continue;
      chosen.add(d);
      addedAsDependency.push(d);
      queue.push(d);
    }
  }

  const featureKeys = Array.from(chosen);
  const problems = featureKeys.length === 0 ? ["No candidate feature is sold on its own in this catalog."] : validateBundleSelection(featureKeys, catalog);
  return { featureKeys, skipped, addedAsDependency, problems };
}
