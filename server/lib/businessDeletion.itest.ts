import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import { eq, sql } from "drizzle-orm";
import { organisations, stores, staff, customers, businessDeletionFeedback, organisationMembers, users } from "@shared/schema";
import { deleteBusinessByOwner, purgeBusiness, restoreBusiness, BusinessDeletionError } from "./businessDeletion";
import { assertTestDatabase, ensureSchema, createFixture, sweepResidue, closePool, type Fixture } from "../test-support/integration-db";

let fx: Fixture;
let ownerId: string;
let bizName: string;

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
  fx = await createFixture();
  bizName = (await db.select().from(organisations).where(eq(organisations.id, fx.businessId)))[0].name;
  const [owner] = await db.insert(users).values({ email: `owner-${Date.now()}@example.test`, name: "Owner" } as any).returning();
  ownerId = owner.id;
  await db.insert(organisationMembers).values({ userId: ownerId, organisationId: fx.businessId, role: "owner", status: "active" } as any);
});

afterAll(async () => {
  await db.delete(businessDeletionFeedback).where(eq(businessDeletionFeedback.organisationId, fx.businessId));
  await db.execute(sql`DELETE FROM organisation_members WHERE user_id = ${ownerId}`);
  await db.execute(sql`DELETE FROM users WHERE id = ${ownerId}`);
  await sweepResidue();
  await closePool();
});

const input = (name: string) => ({ confirmName: name, reasons: ["too_expensive" as const], details: "pricey" });

describe("business deletion", () => {
  it("refuses a wrong confirmation name", async () => {
    await expect(deleteBusinessByOwner(fx.businessId, ownerId, input("nope"))).rejects.toBeInstanceOf(BusinessDeletionError);
  });

  it("refuses to purge a business that isn't deleted", async () => {
    await expect(purgeBusiness(fx.businessId)).rejects.toMatchObject({ status: 409 });
  });

  it("soft-deletes, keeps the data, records feedback, hides it from the owner's list", async () => {
    await deleteBusinessByOwner(fx.businessId, ownerId, input(bizName));
    const [org] = await db.select().from(organisations).where(eq(organisations.id, fx.businessId));
    expect(org.deletedAt).not.toBeNull();
    expect(org.deletedByUserId).toBe(ownerId);
    expect((await db.select().from(stores).where(eq(stores.businessId, fx.businessId))).length).toBeGreaterThan(0);
    expect((await db.select().from(businessDeletionFeedback).where(eq(businessDeletionFeedback.organisationId, fx.businessId))).length).toBe(1);
    const { storage } = await import("../storage");
    expect((await storage.getOrganisationsByUserId(ownerId)).find((o: any) => o.id === fx.businessId)).toBeUndefined();
  });

  it("restore brings it back", async () => {
    await restoreBusiness(fx.businessId);
    const [org] = await db.select().from(organisations).where(eq(organisations.id, fx.businessId));
    expect(org.deletedAt).toBeNull();
    await deleteBusinessByOwner(fx.businessId, ownerId, input(bizName));
  });

  it("purges the business and everything under it, but keeps the feedback", async () => {
    const result = await purgeBusiness(fx.businessId);
    expect(result.tablesTouched).toBeGreaterThan(3);
    expect(await db.select().from(organisations).where(eq(organisations.id, fx.businessId))).toHaveLength(0);
    expect(await db.select().from(stores).where(eq(stores.businessId, fx.businessId))).toHaveLength(0);
    expect(await db.select().from(staff).where(eq(staff.storeId, fx.storeId))).toHaveLength(0);
    expect(await db.select().from(customers).where(eq(customers.storeId, fx.storeId))).toHaveLength(0);
    expect((await db.select().from(businessDeletionFeedback).where(eq(businessDeletionFeedback.organisationId, fx.businessId))).length).toBe(2); // one per deletion: deleted, restored, deleted again
  });
});
