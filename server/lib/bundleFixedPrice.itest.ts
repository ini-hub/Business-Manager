import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { db } from "../db";
import { eq, inArray } from "drizzle-orm";
import { pricingBundles, featureCatalog } from "@shared/schema";
import { priceSelection, priceIncrement } from "@shared/bundles";
import { getPricingBundles, getPublicPricing, discountBreakdownLine } from "./pricing";
import { assertTestDatabase, ensureSchema, closePool } from "../test-support/integration-db";

/**
 * Pins the admin fixed-price override on pricing bundles (migration 0133): the
 * per-cycle price the checkout and renewal paths read, what the public pricing
 * endpoint exposes, and the one-active-bundle-per-business-type guarantee.
 */

const keys: string[] = [];
let seq = 0;

async function addBundle(values: Partial<typeof pricingBundles.$inferInsert> & { featureKeys: string[] }) {
  const key = `itest-fixed-${Date.now()}-${seq++}`;
  keys.push(key);
  const [row] = await db.insert(pricingBundles).values({ key, name: `ITest ${key}`, ...values }).returning();
  return row;
}

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
});

afterEach(async () => {
  if (keys.length) await db.delete(pricingBundles).where(inArray(pricingBundles.key, keys.splice(0)));
});

afterAll(async () => {
  await closePool();
});

describe("fixed bundle price", () => {
  it("resolves the fixed price for the cycle being billed", async () => {
    const b = await addBundle({ featureKeys: ["a", "b"], discountPct: 10, fixedPriceMonthly: 1500, fixedPriceAnnual: null });
    const monthly = (await getPricingBundles("monthly")).find((x) => x.key === b.key)!;
    const annual = (await getPricingBundles("annual")).find((x) => x.key === b.key)!;
    expect(monthly.fixedPrice).toBe(1500);
    expect(annual.fixedPrice).toBeNull();

    // Subscribe path: the fixed price replaces the member total, and the receipt line sums back to the charge.
    const priceOf = (k: string) => ({ a: 1000, b: 2000 }[k] ?? 0);
    const inc = priceIncrement([], ["a", "b"], priceOf, [monthly]);
    expect(inc.total).toBe(1500);
    const line = discountBreakdownLine([monthly], inc);
    expect(line).toEqual({ key: `bundle_discount:${b.key}`, name: `${monthly.name} bundle discount`, price: -1500 });
    expect(inc.subtotal + line!.price).toBe(inc.total);

    // Renewal path (priceSelection over held features) gives the same number.
    expect(priceSelection(["a", "b"], priceOf, [monthly]).total).toBe(1500);
    // Annual has no fixed price, so the % discount applies there.
    expect(priceSelection(["a", "b"], priceOf, [annual]).total).toBe(2700);
  });

  it("exposes fixed price and business type on the public pricing for sellable members", async () => {
    const sellable = await db.select().from(featureCatalog).where(eq(featureCatalog.isActive, true));
    const members = sellable.filter((f) => ["paid_flat", "paid_metered_limit", "bundle_parent"].includes(f.tierType)).slice(0, 2).map((f) => f.key);
    if (members.length === 0) return; // empty catalog in this DB - nothing sellable to bundle
    const b = await addBundle({ featureKeys: members, fixedPriceMonthly: 0, fixedPriceAnnual: 0, businessStructure: "solo" });
    const pub = (await getPublicPricing()).bundles.find((x) => x.key === b.key);
    expect(pub).toBeDefined();
    expect(pub!.businessStructure).toBe("solo");
    expect(pub!.fixedPriceMonthly).toBe(0);
    expect(pub!.priceMonthly).toBe(0);
    expect(pub!.priceAnnual).toBe(0);
  });

  it("allows only one active bundle per business type", async () => {
    await addBundle({ featureKeys: ["a"], businessStructure: "multi_store" });
    await expect(addBundle({ featureKeys: ["b"], businessStructure: "multi_store" })).rejects.toThrow();
    // An inactive one for the same type is fine.
    await expect(addBundle({ featureKeys: ["b"], businessStructure: "multi_store", isActive: false })).resolves.toBeDefined();
  });
});
