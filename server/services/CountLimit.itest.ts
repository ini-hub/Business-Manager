import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { db } from "../db";
import { and, count, eq } from "drizzle-orm";
import { customers, organisations, orgFeatureEntitlements } from "@shared/schema";
import { storage } from "../storage";
import { CountLimitError, grantFeatureEntitlement } from "../lib/entitlements";
import { getFeatureDef } from "@shared/features";
import {
  assertTestDatabase, ensureSchema, createFixture, sweepResidue, closePool, type Fixture,
} from "../test-support/integration-db";

/**
 * The free-tier caps (staff seats per store, customers, 1 store) are enforced inside the
 * storage layer, in the same transaction as the write, so every create /
 * restore / bulk path is covered by construction. An org already over the cap
 * keeps its rows and is only blocked from adding more.
 *
 * createFixture makes an org with status 'active' and no trialEndsAt, i.e. a
 * post-trial free-tier org, with exactly 1 staff, 1 store and 1 customer.
 *
 * The caps are read from the feature registry, so changing a free tier there cannot silently stale these tests.
 */
const STAFF_CAP = getFeatureDef("staff_seats_addon")!.freeLimit!;
const CUSTOMER_CAP = getFeatureDef("customer_capacity_addon")!.freeLimit!;

let fixtures: Fixture[] = [];

async function newFixture() {
  const f = await createFixture();
  fixtures.push(f);
  return f;
}

function staffInput(storeId: string, tag: string) {
  return {
    storeId, name: "", firstName: "New", lastName: "Hire",
    email: `hire-${tag}@example.test`, mobileNumber: `0801${tag.slice(-7).padStart(7, "0")}`,
    payPerMonth: 0, staffNumber: "", paymentMethod: "fixed" as const,
  } as any;
}

/** Hires until the store sits exactly at its seat cap (the fixture already holds one seat). */
async function fillStaffToCap(f: Fixture, tag: string) {
  for (let i = 1; i < STAFF_CAP; i++) await storage.createStaff(staffInput(f.storeId, `${tag}${i}`));
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
});

afterAll(async () => {
  await sweepResidue();
  await closePool();
});

describe("staff seat cap", () => {
  it("blocks a hire past the free seat cap with a typed 402 error", async () => {
    const f = await newFixture();
    await fillStaffToCap(f, `${Date.now()}1`);
    const err = await storage.createStaff(staffInput(f.storeId, `${Date.now()}9`)).catch((e) => e);
    expect(err).toBeInstanceOf(CountLimitError);
    expect(err.toBody()).toMatchObject({ error: "count_limit_reached", limitType: "staff_seats", limit: STAFF_CAP, used: STAFF_CAP, featureKey: "staff_seats_addon" });
  });

  it("frees the seat when a staff member is archived, and blocks restoring them past the cap", async () => {
    const f = await newFixture();
    await storage.archiveStaff(f.staffId);
    // Archiving freed their seat, so the store can be filled to the cap again with new hires.
    for (let i = 0; i < STAFF_CAP; i++) {
      const hire = await storage.createStaff(staffInput(f.storeId, `${Date.now()}2${i}`));
      expect(hire.id).toBeTruthy();
    }

    // Restoring the archived original would put the store one seat over the cap.
    await expect(storage.restoreStaff(f.staffId)).rejects.toBeInstanceOf(CountLimitError);
    expect((await storage.getStaff(f.staffId))?.isArchived).toBe(true);
  });

  it("restoring a staff member who isn't archived is a no-op, not a limit hit", async () => {
    const f = await newFixture();
    const restored = await storage.restoreStaff(f.staffId);
    expect(restored?.isArchived).toBe(false);
  });

  it("lets the org add staff once the seat add-on is granted", async () => {
    const f = await newFixture();
    await grantFeatureEntitlement({ organisationId: f.businessId, featureKey: "staff_seats_addon", source: "admin_grant" });
    const hire = await storage.createStaff(staffInput(f.storeId, `${Date.now()}3`));
    expect(hire.id).toBeTruthy();
  });
});

describe("store cap", () => {
  it("blocks a second store and blocks reactivating an archived one past the cap", async () => {
    const f = await newFixture();
    const input = { businessId: f.businessId, name: `Extra ${Date.now()}`, code: `X${String(Date.now()).slice(-6)}`, timezone: "Africa/Lagos" } as any;
    await expect(storage.createStore(input)).rejects.toMatchObject({ limitType: "store_count", limit: 1, used: 1 });

    // Archive the original, open a replacement, then try to bring the original back.
    await storage.archiveStore(f.storeId);
    const replacement = await storage.createStore(input);
    try {
      await expect(storage.restoreStore(f.storeId)).rejects.toBeInstanceOf(CountLimitError);
    } finally {
      await storage.deleteStore(replacement.id);
    }
  });
});

describe("customer cap", () => {
  async function fillCustomers(f: Fixture, total: number) {
    const rows = Array.from({ length: total - 1 }, (_, i) => ({
      storeId: f.storeId, name: `Filler ${i}`, customerNumber: `F-${Date.now()}-${i}`, address: "",
    }));
    await db.insert(customers).values(rows);
  }

  it("blocks the customer past the cap, and restore, but existing rows stay untouched", async () => {
    const f = await newFixture();
    await fillCustomers(f, CUSTOMER_CAP); // fixture already has 1, so CUSTOMER_CAP active in total

    await expect(storage.createCustomer({ storeId: f.storeId, name: "One too many", customerNumber: "", address: "" } as any))
      .rejects.toMatchObject({ limitType: "customer_count", limit: CUSTOMER_CAP, used: CUSTOMER_CAP });

    // Archive one, add a replacement, restoring would overshoot.
    await storage.archiveCustomer(f.customerId);
    await storage.createCustomer({ storeId: f.storeId, name: "Replacement", customerNumber: "", address: "" } as any);
    await expect(storage.restoreCustomer(f.customerId)).rejects.toBeInstanceOf(CountLimitError);

    const [{ active }] = await db
      .select({ active: count() })
      .from(customers)
      .where(and(eq(customers.storeId, f.storeId), eq(customers.isArchived, false)));
    expect(Number(active)).toBe(CUSTOMER_CAP);
  });

  it("keeps an over-limit org's data and only blocks additions (downgrade policy)", async () => {
    const f = await newFixture();
    await fillCustomers(f, CUSTOMER_CAP + 10); // e.g. built up during the trial
    expect(await storage.getCustomer(f.customerId)).toBeDefined();
    await expect(storage.createCustomer({ storeId: f.storeId, name: "More", customerNumber: "", address: "" } as any))
      .rejects.toBeInstanceOf(CountLimitError);
  });
});

describe("trial and purchase bypass", () => {
  it("doesn't limit an org that is still inside its trial", async () => {
    const f = await newFixture();
    await db.update(organisations)
      .set({ status: "trialing", trialEndsAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000) })
      .where(eq(organisations.id, f.businessId));
    const hire = await storage.createStaff(staffInput(f.storeId, `${Date.now()}4`));
    expect(hire.id).toBeTruthy();
  });

  it("limits the same org once the trial has ended", async () => {
    const f = await newFixture();
    await fillStaffToCap(f, `${Date.now()}5`);
    await db.update(organisations)
      .set({ status: "trialing", trialEndsAt: new Date(Date.now() - 60 * 1000) })
      .where(eq(organisations.id, f.businessId));
    await expect(storage.createStaff(staffInput(f.storeId, `${Date.now()}5`))).rejects.toBeInstanceOf(CountLimitError);
  });

  it("serialises concurrent creates so only one gets the last free slot", async () => {
    const f = await newFixture();
    await fillStaffToCap(f, `${Date.now()}6`);
    await storage.archiveStaff(f.staffId); // frees one seat: exactly one slot open
    const tag = `${Date.now()}`;
    const results = await Promise.allSettled([
      storage.createStaff(staffInput(f.storeId, `${tag}6`)),
      storage.createStaff(staffInput(f.storeId, `${tag}7`)),
      storage.createStaff(staffInput(f.storeId, `${tag}8`)),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected" && (r as PromiseRejectedResult).reason instanceof CountLimitError)).toHaveLength(2);
    // Fill + three advisory-lock-serialised creates: more round trips than the 60s default allows on a remote DB.
  }, 180_000);
});
