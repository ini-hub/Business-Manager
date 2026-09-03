import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { db } from "../db";
import { eq, sql } from "drizzle-orm";
import { organisations, supportThreads, users, superAdmins } from "@shared/schema";
import { reactivateOrganisation, autoResolveSuspensionThreads } from "./organisations";
import {
  assertTestDatabase, ensureSchema, createFixture, sweepResidue, closePool, type Fixture,
} from "../test-support/integration-db";

/**
 * Pins the two helpers behind "resolving a suspension-reason support thread
 * must say something concrete about the business's actual suspension state"
 * (see server/routes-admin.ts's reactivate-and-resolve / close-upheld
 * endpoints): reactivateOrganisation is the single place org.status actually
 * flips back to active, and autoResolveSuspensionThreads is what keeps a
 * thread from dangling "open" after that happens - whichever entry point
 * (standalone reactivate, or the thread's own "Reactivate & Resolve") got
 * there first.
 */

let fixtures: Fixture[] = [];
const userIds: string[] = [];
const adminIds: string[] = [];
const threadIds: string[] = [];

async function newFixture() {
  const f = await createFixture();
  fixtures.push(f);
  return f;
}

async function suspend(businessId: string, reason: string) {
  await db.update(organisations)
    .set({ status: "suspended", suspensionReason: reason, suspendedAt: new Date() })
    .where(eq(organisations.id, businessId));
}

async function makeUser() {
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const [user] = await db.insert(users).values({ name: "Owner Test", email: `owner-${tag}@example.test` }).returning();
  userIds.push(user.id);
  return user.id;
}

async function makeAdmin() {
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const [admin] = await db.insert(superAdmins).values({
    name: "Admin Test",
    email: `admin-${tag}@example.test`,
    passwordHash: "not-a-real-hash",
  }).returning();
  adminIds.push(admin.id);
  return admin.id;
}

async function makeThread(businessId: string, userId: string, reason: string, status: "open" | "resolved" = "open") {
  const [thread] = await db.insert(supportThreads).values({ organisationId: businessId, createdByUserId: userId, reason, status }).returning();
  threadIds.push(thread.id);
  return thread;
}

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
  await sweepResidue();
});

afterEach(async () => {
  for (const id of threadIds) {
    await db.execute(sql`DELETE FROM support_thread_messages WHERE thread_id = ${id}`);
    await db.delete(supportThreads).where(eq(supportThreads.id, id));
  }
  threadIds.length = 0;
  for (const id of userIds) await db.delete(users).where(eq(users.id, id));
  userIds.length = 0;
  for (const id of adminIds) await db.delete(superAdmins).where(eq(superAdmins.id, id));
  adminIds.length = 0;
  for (const f of fixtures) await f.cleanup();
  fixtures = [];
});

afterAll(async () => {
  await sweepResidue();
  await closePool();
});

describe("reactivateOrganisation", () => {
  it("flips status/suspensionReason/suspendedAt back to active", async () => {
    const f = await newFixture();
    await suspend(f.businessId, "policy_violation");

    const org = await reactivateOrganisation(f.businessId, "Appeal accepted");

    expect(org?.status).toBe("active");
    expect(org?.suspensionReason).toBeNull();
    expect(org?.suspendedAt).toBeNull();
    expect(org?.suspensionNote).toBe("Appeal accepted");
  });
});

describe("autoResolveSuspensionThreads", () => {
  it("resolves only open genuine-suspension-reason threads for the org, leaving a general-reason thread untouched", async () => {
    const f = await newFixture();
    await suspend(f.businessId, "fraudulent_activity");
    // Two distinct users - the partial unique index only allows one open
    // thread per *user*, not per org, so a second staff member at the same
    // suspended org can have their own concurrent open thread.
    const ownerUserId = await makeUser();
    const staffUserId = await makeUser();
    const adminId = await makeAdmin();

    const suspensionThread = await makeThread(f.businessId, ownerUserId, "fraudulent_activity");
    const generalThread = await makeThread(f.businessId, staffUserId, "general");

    await autoResolveSuspensionThreads(f.businessId, adminId);

    const [resolved] = await db.select().from(supportThreads).where(eq(supportThreads.id, suspensionThread.id));
    expect(resolved.status).toBe("resolved");
    expect(resolved.resolutionOutcome).toBe("reactivated");
    expect(resolved.resolvedByAdminId).toBe(adminId);

    const [untouched] = await db.select().from(supportThreads).where(eq(supportThreads.id, generalThread.id));
    expect(untouched.status).toBe("open");
    expect(untouched.resolutionOutcome).toBeNull();
  });

  it("is a no-op the second time - already-resolved threads are excluded", async () => {
    const f = await newFixture();
    await suspend(f.businessId, "other");
    const userId = await makeUser();
    const adminId = await makeAdmin();
    const thread = await makeThread(f.businessId, userId, "other");

    await autoResolveSuspensionThreads(f.businessId, adminId);
    const [firstPass] = await db.select().from(supportThreads).where(eq(supportThreads.id, thread.id));

    await expect(autoResolveSuspensionThreads(f.businessId, adminId)).resolves.not.toThrow();
    const [secondPass] = await db.select().from(supportThreads).where(eq(supportThreads.id, thread.id));

    expect(secondPass.resolvedAt?.getTime()).toBe(firstPass.resolvedAt?.getTime());
  });
});
