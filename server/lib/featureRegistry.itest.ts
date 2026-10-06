import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { db } from "../db";
import { and, eq } from "drizzle-orm";
import { featureCatalog, featureFlags, orgFeatureEntitlements, organisations } from "@shared/schema";
import { FEATURES, FREE_FEATURE_KEYS, getFeatureDef } from "@shared/features";
import { getOrgEntitlements } from "./entitlements";
import { publishFeature, syncFeatureRegistry, syncReportIsClean } from "./featureSync";
import {
  assertTestDatabase, ensureSchema, createFixture, sweepResidue, closePool, type Fixture,
} from "../test-support/integration-db";

/**
 * Registry <-> database contract. Needs migration 0086 on the test database
 * (apply by hand; ensureSchema only checks).
 */

const PROBE_KEY = "zz_launch_review_probe";
let fixtures: Fixture[] = [];

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
  await sweepResidue();
  // This database stands in for a fully published catalog: publish whatever an earlier sync left pending review.
  await syncFeatureRegistry({ publishNew: true });
  for (const row of await db.select().from(featureCatalog).where(eq(featureCatalog.reviewStatus, "pending_review"))) {
    if (row.key !== PROBE_KEY) await publishFeature(row.id);
  }
});

afterEach(async () => {
  await db.update(featureFlags).set({ status: "on" }).where(eq(featureFlags.name, "credit_sale"));
  for (const f of fixtures) await f.cleanup();
  fixtures = [];
});

afterAll(async () => {
  await sweepResidue();
  await closePool();
});

async function trialingOrg() {
  const f = await createFixture();
  fixtures.push(f);
  await db
    .update(organisations)
    .set({ status: "trialing", trialEndsAt: new Date(Date.now() + 7 * 864e5) })
    .where(eq(organisations.id, f.businessId));
  return f;
}

describe("feature registry sync", () => {
  it("is idempotent: a second run changes nothing", async () => {
    expect(syncReportIsClean(await syncFeatureRegistry())).toBe(true);
  });

  it("gives every registry feature a catalog row that owns a flag named after its key", async () => {
    const rows = await db
      .select({ key: featureCatalog.key, flagName: featureFlags.name })
      .from(featureCatalog)
      .innerJoin(featureFlags, eq(featureFlags.id, featureCatalog.flagId));
    const flagByKey = new Map(rows.map((r) => [r.key, r.flagName]));
    for (const f of FEATURES) expect(flagByKey.get(f.key), f.key).toBe(f.key);
  });
});

describe("trial entitlements", () => {
  it("grants a trialing org every free feature and every active paid feature", async () => {
    const f = await trialingOrg();
    const granted = await getOrgEntitlements(f.businessId);
    for (const key of FREE_FEATURE_KEYS) expect(granted.has(key), key).toBe(true);
    for (const def of FEATURES.filter((d) => d.active)) expect(granted.has(def.key), def.key).toBe(true);
  });

  it("keeps a flag set to off off, even during a trial", async () => {
    const f = await trialingOrg();
    await db.update(featureFlags).set({ status: "off" }).where(eq(featureFlags.name, "credit_sale"));
    const granted = await getOrgEntitlements(f.businessId);
    expect(granted.has("credit_sale")).toBe(false);
    expect(granted.has("sales_module")).toBe(true);
  });

  it("gives a post-trial org exactly the free features", async () => {
    const f = await createFixture();
    fixtures.push(f);
    const granted = await getOrgEntitlements(f.businessId);
    for (const key of FREE_FEATURE_KEYS) expect(granted.has(key), key).toBe(true);
    expect(granted.has("credit_sale")).toBe(false);
    expect(granted.has("financial_management")).toBe(false);
  });
});

describe("launch review", () => {
  const KEY = PROBE_KEY;
  const def = {
    key: KEY, section: "management", module: "Inventory & Catalog", name: "Launch probe", description: "test",
    category: "analytics", tier: "paid_flat", active: true, sortOrder: 9999, price: { monthly: 1000, annual: 10000 },
    grandfather: true, coveredBy: "test",
  } as unknown as (typeof FEATURES)[number];

  async function purge() {
    const [row] = await db.select().from(featureCatalog).where(eq(featureCatalog.key, KEY));
    if (!row) return;
    await db.delete(orgFeatureEntitlements).where(eq(orgFeatureEntitlements.featureId, row.id));
    await db.delete(featureCatalog).where(eq(featureCatalog.id, row.id));
    await db.delete(featureFlags).where(eq(featureFlags.name, KEY));
  }
  beforeAll(purge);
  afterAll(purge);

  it("creates a priced feature inactive and ungranted, then publishing takes it live and grants it once", async () => {
    const f = await createFixture();
    fixtures.push(f);
    const report = await syncFeatureRegistry({ features: [...FEATURES, def] });
    expect(report.pendingReview).toEqual([KEY]);
    expect(report.grandfathered.map((g) => g.key)).not.toContain(KEY);

    const [row] = await db.select().from(featureCatalog).where(eq(featureCatalog.key, KEY));
    expect(row.isActive).toBe(false);
    expect(row.reviewStatus).toBe("pending_review");
    const before = await db.select().from(orgFeatureEntitlements).where(eq(orgFeatureEntitlements.featureId, row.id));
    expect(before).toHaveLength(0);

    // A later sync leaves it pending and untouched.
    const again = await syncFeatureRegistry({ features: [...FEATURES, def] });
    expect(again.pendingReview).toEqual([]);
    expect((await db.select().from(featureCatalog).where(eq(featureCatalog.key, KEY)))[0].isActive).toBe(false);

    const published = await publishFeature(row.id, { priceMonthly: 2500 }, (k) => (k === KEY ? def : getFeatureDef(k)));
    expect(published?.feature.isActive).toBe(true);
    expect(published?.feature.reviewStatus).toBe("published");
    expect(published?.feature.priceMonthly).toBe(2500);
    expect(published?.grandfathered).toBeGreaterThan(0);
    const granted = await db.select().from(orgFeatureEntitlements).where(and(eq(orgFeatureEntitlements.featureId, row.id), eq(orgFeatureEntitlements.organisationId, f.businessId)));
    expect(granted).toHaveLength(1);

    // Publishing twice does nothing.
    expect(await publishFeature(row.id)).toBeNull();

    // The grant above reaches every organisation, including the fixture; remove it before the fixture is.
    await purge();
  });
});
