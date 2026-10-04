import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { featureCatalog, featureFlags, organisations } from "@shared/schema";
import { FEATURES, FREE_FEATURE_KEYS } from "@shared/features";
import { getOrgEntitlements } from "./entitlements";
import { syncFeatureRegistry, syncReportIsClean } from "./featureSync";
import {
  assertTestDatabase, ensureSchema, createFixture, sweepResidue, closePool, type Fixture,
} from "../test-support/integration-db";

/**
 * Registry <-> database contract. Needs migration 0086 on the test database
 * (apply by hand; ensureSchema only checks).
 */

let fixtures: Fixture[] = [];

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
  await sweepResidue();
  await syncFeatureRegistry();
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
