import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { db } from "../db";
import { eq, inArray, sql } from "drizzle-orm";
import {
  staff, stores, users, customers, staffStoreAssignments, attendanceRecords, attendanceRetroRequests,
} from "@shared/schema";
import { staffMergeService, MERGE_COVERED_COLUMNS } from "./StaffMergeService";
import {
  assertTestDatabase, ensureSchema, createFixture, closePool, type Fixture,
} from "../test-support/integration-db";

/**
 * Folding two staff rows for the same person into one (see StaffMergeService). The fixture's staff row
 * is the survivor (homed at the fixture store); the duplicate is homed at a second store of the same business.
 * No sweepResidue(): the shared test DB can hold another run's live fixtures, so this file removes only
 * what it creates.
 */

let fixtures: Fixture[] = [];
let extraStoreIds: string[] = [];
let userIds: string[] = [];
let seq = 0;

type World = {
  f: Fixture;
  store2: string;
  userId: string;
  loserId: string;
  survivorId: string;
};

async function world(opts: { loserPay?: number } = {}): Promise<World> {
  const f = await createFixture();
  fixtures.push(f);
  const tag = `${Date.now()}-${++seq}`;
  const [store2] = await db.insert(stores).values({
    businessId: f.businessId, name: `Merge Branch ${tag}`, code: `MB${String(Date.now()).slice(-6)}${seq}`, timezone: "Africa/Lagos",
  }).returning();
  extraStoreIds.push(store2.id);
  const [u] = await db.insert(users).values({
    email: `merge-${tag}@example.test`, password: "x", name: "Merge Person",
  } as any).returning();
  userIds.push(u.id);
  await db.update(staff).set({ userId: u.id }).where(eq(staff.id, f.staffId));
  const [loser] = await db.insert(staff).values({
    storeId: store2.id, userId: u.id, name: "Merge Person", firstName: "Merge", lastName: "Person",
    email: `merge-dup-${tag}@example.test`, staffNumber: `MB-${tag}`, mobileNumber: `0801${String(Date.now()).slice(-7)}`,
    payPerMonth: opts.loserPay ?? 120_000, paymentMethod: "fixed", overridePaymentMethod: true,
  }).returning();
  await db.insert(staffStoreAssignments).values({
    staffId: loser.id, storeId: store2.id, staffNumber: loser.staffNumber, role: loser.role,
  });
  return { f, store2: store2.id, userId: u.id, loserId: loser.id, survivorId: f.staffId };
}

const merge = (w: World, extra: Record<string, unknown> = {}) =>
  staffMergeService.merge({ survivorId: w.survivorId, loserId: w.loserId, businessId: w.f.businessId, ...extra });

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
});

afterEach(async () => {
  // Rows that point at the duplicate (or survivor) in the extra stores go first, then the stores.
  if (extraStoreIds.length) {
    await db.update(stores).set({ managerStaffId: null }).where(inArray(stores.id, extraStoreIds));
    await db.delete(attendanceRetroRequests).where(inArray(attendanceRetroRequests.storeId, extraStoreIds));
    await db.delete(attendanceRecords).where(inArray(attendanceRecords.storeId, extraStoreIds));
    await db.delete(customers).where(inArray(customers.storeId, extraStoreIds));
    await db.delete(staffStoreAssignments).where(inArray(staffStoreAssignments.storeId, extraStoreIds));
    await db.delete(staff).where(inArray(staff.storeId, extraStoreIds));
  }
  for (const f of fixtures) {
    await db.delete(attendanceRetroRequests).where(eq(attendanceRetroRequests.storeId, f.storeId));
    await db.delete(attendanceRecords).where(eq(attendanceRecords.storeId, f.storeId));
  }
  if (extraStoreIds.length) await db.delete(stores).where(inArray(stores.id, extraStoreIds));
  for (const f of fixtures) await f.cleanup();
  for (const id of userIds) await db.update(staff).set({ userId: null }).where(eq(staff.userId, id));
  for (const id of userIds) await db.delete(users).where(eq(users.id, id));
  fixtures = []; extraStoreIds = []; userIds = [];
});

afterAll(async () => {
  await closePool();
});

describe("staff merge", () => {
  it("covers every foreign key that references staff.id (add new tables to StaffMergeService)", async () => {
    const { rows } = await db.execute(sql`
      SELECT cl.relname || '.' || a.attname AS ref
      FROM pg_constraint con
      JOIN pg_class cl ON cl.oid = con.conrelid
      JOIN pg_class cf ON cf.oid = con.confrelid
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY(con.conkey)
      WHERE con.contype = 'f' AND cf.relname = 'staff'`);
    const missing = (rows as Array<{ ref: string }>).map((r) => r.ref).filter((r) => !MERGE_COVERED_COLUMNS.includes(r));
    expect(missing).toEqual([]);
  });

  it("dry run reports what would move and changes nothing", async () => {
    const w = await world({ loserPay: 120_000 });
    await db.insert(attendanceRecords).values({ storeId: w.store2, staffId: w.loserId, date: "2026-10-01", status: "present" });

    const report = await merge(w, { dryRun: true });
    expect(report.ok).toBe(true);
    expect(report.dryRun).toBe(true);
    expect(report.moved["attendance_records.staff_id"]).toBe(1);

    expect((await db.select().from(staff).where(eq(staff.id, w.loserId))).length).toBe(1);
    const rec = await db.select().from(attendanceRecords).where(eq(attendanceRecords.storeId, w.store2));
    expect(rec[0].staffId).toBe(w.loserId);
  });

  it("moves history, soft references and the store assignment onto the survivor and removes the duplicate", async () => {
    const w = await world({ loserPay: 120_000 });
    await db.insert(attendanceRecords).values({ storeId: w.store2, staffId: w.loserId, date: "2026-10-01", status: "present" });
    const [cust] = await db.insert(customers).values({
      storeId: w.store2, name: "Staff Customer", customerNumber: `MC-${Date.now()}`, address: "", staffId: w.loserId,
    }).returning();
    await db.update(stores).set({ managerStaffId: w.loserId }).where(eq(stores.id, w.store2));

    const report = await merge(w);
    expect(report.ok).toBe(true);
    expect(report.loser?.id).toBe(w.loserId);

    expect(await db.select().from(staff).where(eq(staff.id, w.loserId))).toHaveLength(0);
    const [rec] = await db.select().from(attendanceRecords).where(eq(attendanceRecords.storeId, w.store2));
    expect(rec.staffId).toBe(w.survivorId);
    const [c] = await db.select().from(customers).where(eq(customers.id, cust.id));
    expect(c.staffId).toBe(w.survivorId);
    const [s2] = await db.select().from(stores).where(eq(stores.id, w.store2));
    expect(s2.managerStaffId).toBe(w.survivorId);

    const assignments = await db.select().from(staffStoreAssignments).where(eq(staffStoreAssignments.staffId, w.survivorId));
    expect(assignments.map((a) => a.storeId).sort()).toEqual([w.f.storeId, w.store2].sort());
    const [survivor] = await db.select().from(staff).where(eq(staff.id, w.survivorId));
    expect(survivor.storeId).toBe(w.f.storeId); // home store unchanged
  });

  it("refuses when pay differs until the caller picks a side, then keeps the chosen pay", async () => {
    const w = await world({ loserPay: 200_000 });
    const refused = await merge(w);
    expect(refused.ok).toBe(false);
    expect(refused.conflicts.map((c) => c.code)).toContain("pay_differs");
    expect(refused.payDifferences).toContain("pay_per_month");
    expect(await db.select().from(staff).where(eq(staff.id, w.loserId))).toHaveLength(1);

    const done = await merge(w, { payFrom: "loser" });
    expect(done.ok).toBe(true);
    const [survivor] = await db.select().from(staff).where(eq(staff.id, w.survivorId));
    expect(survivor.payPerMonth).toBe(200_000);
  });

  it("refuses, changing nothing, when both people have the same history slot", async () => {
    const w = await world();
    const when = new Date();
    await db.insert(attendanceRetroRequests).values([
      { storeId: w.f.storeId, staffId: w.survivorId, date: "2026-10-02", requestedAt: when, reason: "a" },
      { storeId: w.store2, staffId: w.loserId, date: "2026-10-02", requestedAt: when, reason: "b" },
    ]);
    const report = await merge(w);
    expect(report.ok).toBe(false);
    expect(report.conflicts.some((c) => c.code === "history_conflict")).toBe(true);
    expect(await db.select().from(staff).where(eq(staff.id, w.loserId))).toHaveLength(1);
    const [still] = await db.select().from(attendanceRetroRequests).where(eq(attendanceRetroRequests.storeId, w.store2));
    expect(still.staffId).toBe(w.loserId);
  });

  it("refuses records that are not the same login, or are assigned to the same store", async () => {
    const w = await world();
    const [other] = await db.insert(users).values({
      email: `other-${Date.now()}@example.test`, password: "x", name: "Someone Else",
    } as any).returning();
    userIds.push(other.id);
    await db.update(staff).set({ userId: other.id }).where(eq(staff.id, w.loserId));
    const diff = await merge(w);
    expect(diff.ok).toBe(false);
    expect(diff.conflicts.map((c) => c.code)).toContain("different_person");

    await db.update(staff).set({ userId: w.userId }).where(eq(staff.id, w.loserId));
    await db.insert(staffStoreAssignments).values({
      staffId: w.survivorId, storeId: w.store2, staffNumber: `SH-${Date.now()}`,
    });
    const shared = await merge(w);
    expect(shared.ok).toBe(false);
    expect(shared.conflicts.map((c) => c.code)).toContain("shared_store");
  });

  it("findCandidates groups people with several staff rows in the business", async () => {
    const w = await world();
    const groups = await staffMergeService.findCandidates(w.f.businessId);
    expect(groups).toHaveLength(1);
    expect(groups[0].userId).toBe(w.userId);
    expect(groups[0].members.map((m: any) => m.id).sort()).toEqual([w.survivorId, w.loserId].sort());
  });
});
