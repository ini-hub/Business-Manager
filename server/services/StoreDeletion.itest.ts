import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { customers, stores, staff } from "@shared/schema";
import { storage } from "../storage";
import {
  assertTestDatabase, ensureSchema, createFixture, sweepResidue, type Fixture,
} from "../test-support/integration-db";

/**
 * Permanent store delete: staff never block (they go with the store); customers
 * and any history do. createFixture gives 1 store, 1 staff, 1 customer.
 */
let fixtures: Fixture[] = [];

async function newFixture() {
  const f = await createFixture();
  fixtures.push(f);
  return f;
}

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
  await sweepResidue();
});

afterEach(async () => {
  for (const f of fixtures) await f.cleanup();
  fixtures = [];
});

describe("store deletion blockers", () => {
  it("reports customers but never staff", async () => {
    const f = await newFixture();
    const blockers = await storage.getStoreDeletionBlockers(f.storeId);
    expect(blockers.map((b) => b.table)).toContain("customers");
    expect(blockers.map((b) => b.table)).not.toContain("staff");
  });

  it("deletes a store that only has staff and a zero-stock setup", async () => {
    const f = await newFixture();
    await db.delete(customers).where(eq(customers.storeId, f.storeId));
    expect(await storage.getStoreDeletionBlockers(f.storeId)).toEqual([]);

    expect(await storage.deleteStore(f.storeId)).toBe(true);
    expect(await db.select().from(stores).where(eq(stores.id, f.storeId))).toHaveLength(0);
    expect(await db.select().from(staff).where(eq(staff.storeId, f.storeId))).toHaveLength(0);
  });
});
