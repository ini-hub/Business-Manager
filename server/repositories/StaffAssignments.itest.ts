import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { staff, staffStoreAssignments, users } from "@shared/schema";
import { storage } from "../storage";
import {
  assertTestDatabase, ensureSchema, createFixture, closePool, type Fixture,
} from "../test-support/integration-db";

/**
 * staff.id is the person, staff.store_id the home store, and
 * staff_store_assignments the authority for where they may work (migration 0129).
 * These pin the dual-write and the lookups that the access layer builds on.
 */

let fixtures: Fixture[] = [];
const userIds: string[] = [];

async function newFixture() {
  const f = await createFixture();
  fixtures.push(f);
  return f;
}

let mobileSeq = 0;
// Fixtures share one mobile number and staff_store_mobile_unique is per store, so a staff row
// that changes store (or a second hire) needs its own.
function uniqueMobile() {
  return `080${String(Date.now()).slice(-6)}${String(++mobileSeq).padStart(2, "0")}`;
}

async function assign(staffId: string, storeId: string, staffNumber: string) {
  await db.insert(staffStoreAssignments).values({ staffId, storeId, staffNumber });
}

async function assignmentsOf(staffId: string) {
  return db.select().from(staffStoreAssignments).where(eq(staffStoreAssignments.staffId, staffId));
}

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
  // No sweepResidue(): the shared test DB may hold another run's live fixtures, and this
  // file removes only what it creates.
});

afterEach(async () => {
  for (const f of fixtures) await f.cleanup();
  fixtures = [];
  for (const id of userIds.splice(0)) await db.delete(users).where(eq(users.id, id));
});

afterAll(async () => {
  await closePool();
});

describe("staff store assignments", () => {
  it("createStaff writes a home assignment that mirrors the staff row", async () => {
    const f = await newFixture();
    const created = await storage.createStaff({
      storeId: f.storeId,
      firstName: "New",
      lastName: "Hire",
      email: `hire-${Date.now()}@example.test`,
      mobileNumber: uniqueMobile(),
      payPerMonth: 50_000,
      role: "staff",
      paymentMethod: "fixed",
      countryCode: "+234",
    } as any);
    const rows = await assignmentsOf(created.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ storeId: f.storeId, staffNumber: created.staffNumber, role: "staff", isArchived: false });
  });

  it("fixture and assignedStoreIds expose the home store, and an extra assignment widens it", async () => {
    const a = await newFixture();
    const b = await newFixture();
    expect(await storage.assignedStoreIds(a.staffId)).toEqual([a.storeId]);
    await assign(a.staffId, b.storeId, `X-${Date.now()}`);
    expect((await storage.assignedStoreIds(a.staffId)).sort()).toEqual([a.storeId, b.storeId].sort());
  });

  it("assignedStoreIdsForUser unions assignments and falls back to the home store; archived assignment drops out", async () => {
    const a = await newFixture();
    const b = await newFixture();
    const [u] = await db.insert(users).values({
      email: `assign-${Date.now()}@example.test`,
      password: "x",
      name: "Multi Store",
    } as any).returning();
    userIds.push(u.id);
    await db.update(staff).set({ userId: u.id }).where(eq(staff.id, a.staffId));
    await assign(a.staffId, b.storeId, `X-${Date.now()}`);
    expect((await storage.assignedStoreIdsForUser(u.id)).sort()).toEqual([a.storeId, b.storeId].sort());

    await db.update(staffStoreAssignments).set({ isArchived: true })
      .where(and(eq(staffStoreAssignments.staffId, a.staffId), eq(staffStoreAssignments.storeId, b.storeId)));
    expect(await storage.assignedStoreIdsForUser(u.id)).toEqual([a.storeId]);

    // A staff row with no assignment at all still resolves to its home store.
    await db.delete(staffStoreAssignments).where(eq(staffStoreAssignments.staffId, a.staffId));
    expect(await storage.assignedStoreIdsForUser(u.id)).toEqual([a.storeId]);

    // getStaffForUserInStore resolves the row at the home store and, once assigned, at the other store.
    expect((await storage.getStaffForUserInStore(u.id, a.storeId))?.id).toBe(a.staffId);
    expect(await storage.getStaffForUserInStore(u.id, b.storeId)).toBeUndefined();
    await assign(a.staffId, b.storeId, `Y-${Date.now()}`);
    expect((await storage.getStaffForUserInStore(u.id, b.storeId))?.id).toBe(a.staffId);
  });

  it("updateStaff mirrors number and role; archive/restore mirror isArchived on the home assignment", async () => {
    const f = await newFixture();
    await storage.updateStaff(f.staffId, { role: "manager" });
    expect((await assignmentsOf(f.staffId))[0].role).toBe("manager");
    await storage.archiveStaff(f.staffId);
    expect((await assignmentsOf(f.staffId))[0].isArchived).toBe(true);
    await storage.restoreStaff(f.staffId);
    expect((await assignmentsOf(f.staffId))[0].isArchived).toBe(false);
  });

  it("transferStaff moves the home assignment and numbers it in the target store's sequence", async () => {
    const a = await newFixture();
    const b = await newFixture();
    await db.update(staff).set({ mobileNumber: uniqueMobile() }).where(eq(staff.id, a.staffId));
    const moved = await storage.transferStaff(a.staffId, b.storeId);
    expect(moved?.storeId).toBe(b.storeId);
    const rows = await assignmentsOf(a.staffId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ storeId: b.storeId, staffNumber: moved!.staffNumber });
  });

  it("transfer to a store the person is already assigned to keeps that number and drops the old store", async () => {
    const a = await newFixture();
    const b = await newFixture();
    await assign(a.staffId, b.storeId, `EXTRA-${Date.now()}`);
    const [extra] = (await assignmentsOf(a.staffId)).filter((r) => r.storeId === b.storeId);
    await db.update(staff).set({ mobileNumber: uniqueMobile() }).where(eq(staff.id, a.staffId));
    const moved = await storage.transferStaff(a.staffId, b.storeId);
    expect(moved?.staffNumber).toBe(extra.staffNumber);
    const rows = await assignmentsOf(a.staffId);
    expect(rows.map((r) => r.storeId)).toEqual([b.storeId]);
  });

  it("number allocation skips numbers held by assignments of people homed elsewhere", async () => {
    const a = await newFixture();
    const b = await newFixture();
    const [store] = await db.query.stores.findMany({ where: (s, { eq: e }) => e(s.id, b.storeId) });
    await assign(a.staffId, b.storeId, `${store.code}-001`);
    const created = await storage.createStaff({
      storeId: b.storeId, firstName: "N", lastName: "H", email: `nh-${Date.now()}@example.test`,
      mobileNumber: uniqueMobile(), payPerMonth: 0, role: "staff", paymentMethod: "fixed", countryCode: "+234",
    } as any);
    expect(created.staffNumber).toBe(`${store.code}-002`);
  });
});
