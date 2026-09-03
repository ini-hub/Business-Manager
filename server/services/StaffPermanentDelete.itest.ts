import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { staff, stores, salaryAdvances } from "@shared/schema";
import { storage } from "../storage";
import {
  assertTestDatabase, ensureSchema, createFixture, sweepResidue, closePool, type Fixture,
} from "../test-support/integration-db";

/**
 * Pins the fix for DELETE /api/staff/:id/permanent: it used to re-archive
 * instead of deleting (`isArchived: true` on a row that was already archived),
 * so it always reported success while leaving the row in place, and its only
 * dependent-data check covered checkouts. These tests observe the actual row
 * and the broadened hasStaffHistory check, not just a return value.
 */

let fixtures: Fixture[] = [];

async function newFixture() {
  const f = await createFixture();
  fixtures.push(f);
  return f;
}

/**
 * A staff row in the fixture's store with none of createFixture's extras
 * (notably: no linked customer profile) - the "nothing references this"
 * baseline the clean-delete case needs.
 */
async function bareStaff(f: Fixture, overrides: Partial<typeof staff.$inferInsert> = {}) {
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const [row] = await db.insert(staff).values({
    storeId: f.storeId,
    name: "Bare Staff",
    email: `bare-${tag}@example.test`,
    staffNumber: `BARE-${tag}`,
    mobileNumber: "08010000000",
    payPerMonth: 0,
    paymentMethod: "fixed",
    isArchived: true,
    ...overrides,
  }).returning();
  return row;
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

afterAll(async () => {
  await sweepResidue();
  await closePool();
});

describe("hasStaffHistory / deleteStaff", () => {
  it("finds no history for a staff row nothing points at, and deleteStaff actually removes it", async () => {
    const f = await newFixture();
    const clean = await bareStaff(f);

    await expect(storage.hasStaffHistory(clean.id)).resolves.toBe(false);

    const deleted = await storage.deleteStaff(clean.id);
    expect(deleted).toBe(true);

    expect(await storage.getStaff(clean.id)).toBeUndefined();
  });

  it("clears a store's managerStaffId when that manager is permanently deleted", async () => {
    const f = await newFixture();
    const manager = await bareStaff(f);
    await db.update(stores).set({ managerStaffId: manager.id }).where(eq(stores.id, f.storeId));

    await storage.deleteStaff(manager.id);

    const [store] = await db.select().from(stores).where(eq(stores.id, f.storeId));
    expect(store.managerStaffId).toBeNull();
  });

  it("reports history for a staff member with a linked customer profile, and leaves the row in place", async () => {
    const f = await newFixture();
    // createFixture links its customer profile via customers.staffId.
    await expect(storage.hasStaffHistory(f.staffId)).resolves.toBe(true);

    // Mirrors the route: it must not call deleteStaff when history exists.
    expect(await storage.getStaff(f.staffId)).toBeDefined();
  });

  it("reports history for a staff member with payroll history (a salary advance)", async () => {
    const f = await newFixture();
    const withAdvance = await bareStaff(f);
    await db.insert(salaryAdvances).values({
      storeId: f.storeId,
      staffId: withAdvance.id,
      amount: 10_000,
      outstandingBalance: 10_000,
      date: "2099-01-05",
      status: "approved",
      recoveryStatus: "unrecovered",
      isRecovered: false,
    });

    await expect(storage.hasStaffHistory(withAdvance.id)).resolves.toBe(true);
  });
});
