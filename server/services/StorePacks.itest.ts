import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { db } from "../db";
import { and, eq, inArray } from "drizzle-orm";
import { featureCatalog, orgFeatureEntitlements } from "@shared/schema";
import { storage } from "../storage";
import {
  checkCountLimit, getCountLimitStatuses, getOrgEntitlements, grantFeatureEntitlement, scheduleFeatureRemoval,
} from "../lib/entitlements";
import {
  assertTestDatabase, ensureSchema, createFixture, sweepResidue, closePool, type Fixture,
} from "../test-support/integration-db";

/**
 * Store packs (Stores: up to 3 / up to 10) and the unlimited Additional Store add-on share one limit.
 * Each carries Stock Transfers and Staff Transfers; the cap is the largest tier in force, and a pack
 * scheduled for removal keeps its cap and its features until the deadline, then both go together.
 */
let fixtures: Fixture[] = [];
const extraStores: string[] = [];

async function newFixture() {
  const f = await createFixture();
  fixtures.push(f);
  return f;
}

let seq = 0;
function storeInput(businessId: string) {
  const n = `${Date.now()}${seq++}`;
  return { businessId, name: `Pack store ${n}`, code: `P${n.slice(-7)}`, timezone: "Africa/Lagos" } as any;
}

async function openStore(businessId: string) {
  const s = await storage.createStore(storeInput(businessId));
  extraStores.push(s.id);
  return s;
}

const grant = (organisationId: string, featureKey: string) =>
  grantFeatureEntitlement({ organisationId, featureKey, source: "admin_grant" });

async function rowFor(organisationId: string, key: string) {
  const [row] = await db
    .select({ status: orgFeatureEntitlements.status })
    .from(orgFeatureEntitlements)
    .innerJoin(featureCatalog, eq(orgFeatureEntitlements.featureId, featureCatalog.id))
    .where(and(eq(orgFeatureEntitlements.organisationId, organisationId), eq(featureCatalog.key, key)));
  return row?.status;
}

/** Moves a scheduled removal's deadline, so a test can sit inside or past the grace period. */
async function setDeadline(organisationId: string, key: string, at: Date) {
  const ids = await db.select({ id: featureCatalog.id }).from(featureCatalog).where(eq(featureCatalog.key, key));
  await db.update(orgFeatureEntitlements)
    .set({ removalEffectiveAt: at })
    .where(and(eq(orgFeatureEntitlements.organisationId, organisationId), inArray(orgFeatureEntitlements.featureId, ids.map((i) => i.id))));
}

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
  await sweepResidue();
});

afterEach(async () => {
  for (const id of extraStores.splice(0)) await storage.deleteStore(id).catch(() => undefined);
  for (const f of fixtures) {
    await db.delete(orgFeatureEntitlements).where(eq(orgFeatureEntitlements.organisationId, f.businessId));
    await f.cleanup();
  }
  fixtures = [];
});

afterAll(async () => {
  await sweepResidue();
  await closePool();
});

describe("store packs", () => {
  it("lets 'up to 3' open two more stores and blocks the next, with the transfers granted", async () => {
    const f = await newFixture();
    await grant(f.businessId, "store_pack_3");
    await openStore(f.businessId);
    await openStore(f.businessId);
    await expect(storage.createStore(storeInput(f.businessId))).rejects.toMatchObject({ limitType: "store_count", limit: 3, used: 3 });

    const granted = await getOrgEntitlements(f.businessId);
    expect(granted.has("stock_transfer")).toBe(true);
    expect(granted.has("staff_transfer")).toBe(true);
  });

  it("grants the transfers for every tier, and not for a free org", async () => {
    const free = await newFixture();
    expect((await getOrgEntitlements(free.businessId)).has("stock_transfer")).toBe(false);
    for (const key of ["store_pack_3", "store_pack_10", "store_addon"]) {
      const f = await newFixture();
      await grant(f.businessId, key);
      const granted = await getOrgEntitlements(f.businessId);
      expect(granted.has("stock_transfer"), key).toBe(true);
      expect(granted.has("staff_transfer"), key).toBe(true);
    }
  });

  it("replaces the smaller pack when a bigger one is bought, and the unlimited add-on lifts the cap", async () => {
    const f = await newFixture();
    await grant(f.businessId, "store_pack_3");
    await grant(f.businessId, "store_pack_10");
    expect(await rowFor(f.businessId, "store_pack_3")).toBe("removed");
    expect((await checkCountLimit(f.businessId, "store_count")).limit).toBe(10);

    await grant(f.businessId, "store_addon");
    expect(await rowFor(f.businessId, "store_pack_10")).toBe("removed");
    const status = (await getCountLimitStatuses(f.businessId)).store_count;
    expect(status.unlimited).toBe(true);
  });

  it("keeps the cap with the features while a removal is in its grace period, then drops both", async () => {
    const f = await newFixture();
    await grant(f.businessId, "store_pack_3");
    const inAWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    expect(await scheduleFeatureRemoval(f.businessId, "store_pack_3", inAWeek)).toEqual({ ok: true });

    // In grace: both read paths agree with the feature grant.
    expect((await checkCountLimit(f.businessId, "store_count")).limit).toBe(3);
    expect((await getCountLimitStatuses(f.businessId)).store_count.limit).toBe(3);
    expect((await getOrgEntitlements(f.businessId)).has("stock_transfer")).toBe(true);

    // Past the deadline: the cap falls back to the free store and the transfers go with it.
    await setDeadline(f.businessId, "store_pack_3", new Date(Date.now() - 60 * 1000));
    expect((await checkCountLimit(f.businessId, "store_count")).limit).toBe(1);
    expect((await getCountLimitStatuses(f.businessId)).store_count.limit).toBe(1);
    expect((await getOrgEntitlements(f.businessId)).has("stock_transfer")).toBe(false);
  });
});
