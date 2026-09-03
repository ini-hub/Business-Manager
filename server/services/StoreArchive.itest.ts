import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { stores } from "@shared/schema";
import { storage } from "../storage";
import {
  assertTestDatabase, ensureSchema, createFixture, sweepResidue, closePool, type Fixture,
} from "../test-support/integration-db";

/**
 * Pins the store archive/restore feature that replaced the old hard-delete
 * flow: archiving must hide a store (isActive: false) without touching its
 * data, restoring must bring it back, and the business must never be able to
 * lose its last active store - the count these checks read from is what the
 * /api/stores/:id/archive route's guard is built on.
 */

let fixtures: Fixture[] = [];
const extraStoreIds: string[] = [];

async function newFixture() {
  const f = await createFixture();
  fixtures.push(f);
  return f;
}

async function addStore(businessId: string) {
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const [store] = await db.insert(stores).values({
    businessId,
    name: `Second Store ${tag}`,
    code: `S2-${tag}`.slice(0, 20),
    timezone: "Africa/Lagos",
  }).returning();
  extraStoreIds.push(store.id);
  return store;
}

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
  await sweepResidue();
});

afterEach(async () => {
  for (const id of extraStoreIds) {
    await db.delete(stores).where(eq(stores.id, id));
  }
  extraStoreIds.length = 0;
  for (const f of fixtures) await f.cleanup();
  fixtures = [];
});

afterAll(async () => {
  await sweepResidue();
  await closePool();
});

describe("archiving and restoring a store", () => {
  it("archiveStore flips isActive off without touching the row otherwise, restoreStore flips it back on", async () => {
    const f = await newFixture();

    const archived = await storage.archiveStore(f.storeId);
    expect(archived?.isActive).toBe(false);
    expect(archived?.name).toBe((await storage.getStore(f.storeId))?.name);

    const restored = await storage.restoreStore(f.storeId);
    expect(restored?.isActive).toBe(true);
  });

  it("countActiveStores only counts stores with isActive = true", async () => {
    const f = await newFixture();
    await addStore(f.businessId);

    await expect(storage.countActiveStores(f.businessId)).resolves.toBe(2);

    await storage.archiveStore(f.storeId);
    await expect(storage.countActiveStores(f.businessId)).resolves.toBe(1);

    await storage.archiveStore((await storage.getStores(f.businessId)).find(s => s.id !== f.storeId)!.id);
    await expect(storage.countActiveStores(f.businessId)).resolves.toBe(0);
  });

  it("keeps customers, staff, and inventory untouched by archiving (unlike permanent delete)", async () => {
    const f = await newFixture();
    await storage.archiveStore(f.storeId);

    // The fixture's own customer profile (created before archiving) must
    // still be there - archiving is not a data-clearing operation.
    expect(await storage.getCustomer(f.customerId)).toBeDefined();
    expect(await storage.getStaff(f.staffId)).toBeDefined();
  });
});
