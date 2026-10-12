import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { customers, featureCatalog, featureFlags, orgFeatureEntitlements } from "@shared/schema";
import { storage } from "../storage";
import {
  checkCountLimit, getCountLimitStatuses, getOrgEntitlements, grantFeatureEntitlement, invalidateFeatureCatalogCache,
  type CountLimitType,
} from "../lib/entitlements";
import {
  assertTestDatabase, ensureSchema, createFixture, sweepResidue, closePool, type Fixture,
} from "../test-support/integration-db";

/**
 * The same tier rules as the store packs, for the other three caps: staff seats (built-in packs, per store),
 * customers and items (admin-created thresholds, which is how those ladders get their steps). None of these
 * caps has bundled children, so holding a pack must change the cap and nothing else.
 */
let fixtures: Fixture[] = [];
const tempKeys: string[] = [];

async function newFixture() {
  const f = await createFixture();
  fixtures.push(f);
  return f;
}

const grant = (organisationId: string, featureKey: string) =>
  grantFeatureEntitlement({ organisationId, featureKey, source: "admin_grant" });

/** An admin-style threshold (see POST /feature-catalog/threshold): a capped row off the cap's unlimited add-on. */
async function makeThreshold(limitType: CountLimitType, templateKey: string, capacity: number) {
  const key = `itest_${limitType}_${capacity}_${Date.now()}`;
  const [t] = await db.select().from(featureCatalog).where(eq(featureCatalog.key, templateKey));
  const [flag] = await db.insert(featureFlags).values({ name: key, status: "on", description: key, updatedBy: "itest" }).returning();
  await db.insert(featureCatalog).values({
    key, name: key, description: key, category: t.category, tierType: "paid_metered_limit", limitType, freeLimit: t.freeLimit,
    tierCapacity: capacity, priceMonthly: 1, currency: t.currency, section: t.section, permissionModule: t.permissionModule,
    sortOrder: 9000, isActive: true, reviewStatus: "published", flagId: flag.id,
  });
  tempKeys.push(key);
  invalidateFeatureCatalogCache();
  return key;
}

function staffInput(storeId: string, tag: string) {
  return {
    storeId, name: "", firstName: "New", lastName: "Hire",
    email: `hire-${tag}@example.test`, mobileNumber: `0801${tag.slice(-7).padStart(7, "0")}`,
    payPerMonth: 0, staffNumber: "", paymentMethod: "fixed" as const,
  } as any;
}

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
  await sweepResidue();
});

afterEach(async () => {
  for (const f of fixtures) {
    await db.delete(orgFeatureEntitlements).where(eq(orgFeatureEntitlements.organisationId, f.businessId));
    await f.cleanup();
  }
  fixtures = [];
  for (const key of tempKeys.splice(0)) {
    const [row] = await db.select({ id: featureCatalog.id, flagId: featureCatalog.flagId }).from(featureCatalog).where(eq(featureCatalog.key, key));
    if (!row) continue;
    await db.delete(orgFeatureEntitlements).where(eq(orgFeatureEntitlements.featureId, row.id));
    await db.delete(featureCatalog).where(eq(featureCatalog.id, row.id));
    await db.delete(featureFlags).where(eq(featureFlags.id, row.flagId));
  }
  invalidateFeatureCatalogCache();
});

afterAll(async () => {
  await sweepResidue();
  await closePool();
});

describe("staff seat packs", () => {
  it("raises the per-store cap to the pack, blocks past it, and grants nothing else", async () => {
    const f = await newFixture();
    await grant(f.businessId, "staff_seats_5");
    // The fixture holds one seat; the 5-seat pack lets four more in.
    for (let i = 1; i < 5; i++) await storage.createStaff(staffInput(f.storeId, `${Date.now()}${i}`));
    await expect(storage.createStaff(staffInput(f.storeId, `${Date.now()}9`)))
      .rejects.toMatchObject({ limitType: "staff_seats", limit: 5, used: 5 });

    const granted = await getOrgEntitlements(f.businessId);
    expect(granted.has("stock_transfer")).toBe(false);
    expect(granted.has("staff_transfer")).toBe(false);
  });

  it("lets a bigger pack replace the smaller one", async () => {
    const f = await newFixture();
    await grant(f.businessId, "staff_seats_5");
    await grant(f.businessId, "staff_seats_15");
    expect((await checkCountLimit(f.businessId, "staff_seats", 1, f.storeId)).limit).toBe(15);
    await grant(f.businessId, "staff_seats_addon");
    expect((await getCountLimitStatuses(f.businessId, { staffStoreId: f.storeId })).staff_seats.unlimited).toBe(true);
  });
});

describe("customer thresholds", () => {
  it("raises the cap to the threshold and blocks past it", async () => {
    const f = await newFixture();
    const pack = await makeThreshold("customer_count", "customer_capacity_addon", 32);
    const fillers = Array.from({ length: 29 }, (_, i) => ({ storeId: f.storeId, name: `Filler ${i}`, customerNumber: `LP-${Date.now()}-${i}`, address: "" }));
    await db.insert(customers).values(fillers); // fixture has 1, so 30 = the free cap
    await expect(storage.createCustomer({ storeId: f.storeId, name: "Over free", customerNumber: "", address: "" } as any))
      .rejects.toMatchObject({ limitType: "customer_count", limit: 30, used: 30 });

    await grant(f.businessId, pack);
    await storage.createCustomer({ storeId: f.storeId, name: "Thirty one", customerNumber: "", address: "" } as any);
    await storage.createCustomer({ storeId: f.storeId, name: "Thirty two", customerNumber: "", address: "" } as any);
    await expect(storage.createCustomer({ storeId: f.storeId, name: "Thirty three", customerNumber: "", address: "" } as any))
      .rejects.toMatchObject({ limitType: "customer_count", limit: 32, used: 32 });
  });
});

describe("item thresholds", () => {
  it("resolves the cap from the threshold, then from the unlimited add-on", async () => {
    const f = await newFixture();
    const pack = await makeThreshold("item_count", "item_capacity_addon", 120);
    expect((await checkCountLimit(f.businessId, "item_count")).limit).toBe(50);
    await grant(f.businessId, pack);
    expect((await checkCountLimit(f.businessId, "item_count")).limit).toBe(120);
    await grant(f.businessId, "item_capacity_addon");
    expect((await getCountLimitStatuses(f.businessId)).item_count.unlimited).toBe(true);
  });
});
