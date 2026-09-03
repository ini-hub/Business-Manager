import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { db } from "../db";
import { eq, inArray } from "drizzle-orm";
import { users, organisationMembers, staff, staffContracts, staffContractVersions, staffContractSignatures } from "@shared/schema";
import { storage } from "../storage";
import { staffContractService } from "./StaffContractService";
import {
  assertTestDatabase, ensureSchema, createFixture, sweepResidue, closePool, type Fixture,
} from "../test-support/integration-db";

/**
 * These properties live in the database, not in a pure function: that
 * replacing a not-yet-signed contract never mutates the version a staff
 * member may already be looking at, that a signature is refused without both
 * consent booleans, and that computeContractStatus reads the linked
 * membership rather than just the contract row - see its docstring in
 * StaffContractService for why that single rule covers both branch C of
 * StaffInviteService and a contract attached after the fact.
 */

let fixtures: Fixture[] = [];
const touchedUserIds = new Set<string>();

async function newFixture() {
  const f = await createFixture();
  fixtures.push(f);
  return f;
}

/** Links the fixture's staff row to a fresh platform user, optionally with a membership. */
async function linkUser(f: Fixture, memberStatus?: "pending" | "partial" | "active") {
  const [user] = await db.insert(users).values({
    email: `contract-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
    name: "Ada Test",
    passwordHash: "x",
  }).returning();
  touchedUserIds.add(user.id);
  await db.update(staff).set({ userId: user.id }).where(eq(staff.id, f.staffId));
  if (memberStatus) {
    await storage.createOrganisationMember({
      userId: user.id,
      organisationId: f.businessId,
      role: "staff",
      status: memberStatus,
      ...(memberStatus === "active" ? { activatedAt: new Date() } : {}),
    } as any);
  }
  return user;
}

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
  await sweepResidue();
});

afterEach(async () => {
  // Contract rows reference both staff and users, so they must be torn down
  // before either - Fixture.cleanup deletes the staff row, and the block
  // below deletes the users this suite minted.
  for (const f of fixtures) {
    const [contract] = await db.select().from(staffContracts).where(eq(staffContracts.staffId, f.staffId));
    if (contract) {
      await db.delete(staffContractSignatures).where(eq(staffContractSignatures.staffContractId, contract.id));
      await db.update(staffContracts).set({ currentVersionId: null }).where(eq(staffContracts.id, contract.id));
      await db.delete(staffContractVersions).where(eq(staffContractVersions.staffContractId, contract.id));
      await db.delete(staffContracts).where(eq(staffContracts.id, contract.id));
    }
  }

  const ids = Array.from(touchedUserIds);
  if (ids.length) {
    await db.update(staff).set({ userId: null }).where(inArray(staff.userId, ids));
    await db.delete(organisationMembers).where(inArray(organisationMembers.userId, ids));
    await db.delete(users).where(inArray(users.id, ids));
  }
  touchedUserIds.clear();

  for (const f of fixtures) await f.cleanup();
  fixtures = [];
});

afterAll(async () => {
  await sweepResidue();
  await closePool();
});

describe("attaching a contract", () => {
  it("creates version 1, pending_signature, on first attach", async () => {
    const f = await newFixture();
    const user = await linkUser(f);

    const outcome = await staffContractService.attachContract({
      staffId: f.staffId,
      createdByUserId: user.id,
      input: { contractType: "text", contentText: "Welcome aboard. Salary: 100,000/month." },
    });

    expect(outcome.kind).toBe("attached");
    if (outcome.kind !== "attached") throw new Error("unreachable");
    expect(outcome.version.versionNumber).toBe(1);
    expect(outcome.contract.status).toBe("pending_signature");
    expect(outcome.contract.currentVersionId).toBe(outcome.version.id);
  });

  it("replacing a not-yet-signed contract supersedes the old version without mutating it", async () => {
    const f = await newFixture();
    const user = await linkUser(f);

    const first = await staffContractService.attachContract({
      staffId: f.staffId, createdByUserId: user.id,
      input: { contractType: "text", contentText: "Draft one." },
    });
    if (first.kind !== "attached") throw new Error("unreachable");

    const second = await staffContractService.attachContract({
      staffId: f.staffId, createdByUserId: user.id,
      input: { contractType: "text", contentText: "Corrected version." },
    });
    expect(second.kind).toBe("replaced");
    if (second.kind !== "replaced") throw new Error("unreachable");
    expect(second.version.versionNumber).toBe(2);
    expect(second.contract.currentVersionId).toBe(second.version.id);

    const staleVersion = await db.select().from(staffContractVersions)
      .where(eq(staffContractVersions.id, first.version.id));
    // The original row is untouched content-wise, only stamped as superseded.
    expect(staleVersion[0].contentText).toBe("Draft one.");
    expect(staleVersion[0].supersededAt).not.toBeNull();
  });

  it("refuses to replace a contract that has already been signed", async () => {
    const f = await newFixture();
    const user = await linkUser(f);
    const attached = await staffContractService.attachContract({
      staffId: f.staffId, createdByUserId: user.id,
      input: { contractType: "text", contentText: "Terms." },
    });
    if (attached.kind !== "attached") throw new Error("unreachable");

    const signed = await staffContractService.sign({
      staffContractId: attached.contract.id, staffId: f.staffId, userId: user.id,
      typedFullName: "Ada Test", affirmedReadAndAgree: true, consentedElectronicSignature: true,
      ipAddress: "127.0.0.1", userAgent: "vitest",
    });
    expect(signed.kind).toBe("signed");

    const secondAttempt = await staffContractService.attachContract({
      staffId: f.staffId, createdByUserId: user.id,
      input: { contractType: "text", contentText: "Trying to change it after the fact." },
    });
    expect(secondAttempt.kind).toBe("refused_already_signed");
  });
});

describe("signing", () => {
  it("refuses without both the read-and-agree and e-signature consent booleans", async () => {
    const f = await newFixture();
    const user = await linkUser(f);
    const attached = await staffContractService.attachContract({
      staffId: f.staffId, createdByUserId: user.id,
      input: { contractType: "text", contentText: "Terms." },
    });
    if (attached.kind !== "attached") throw new Error("unreachable");

    const outcome = await staffContractService.sign({
      staffContractId: attached.contract.id, staffId: f.staffId, userId: user.id,
      typedFullName: "Ada Test", affirmedReadAndAgree: true, consentedElectronicSignature: false,
      ipAddress: "127.0.0.1", userAgent: "vitest",
    });
    expect(outcome.kind).toBe("not_pending");

    const contract = await staffContractService.getContractByStaffId(f.staffId);
    expect(contract!.status).toBe("pending_signature");
  });

  it("refuses a typed name that doesn't match the staff record, without signing", async () => {
    const f = await newFixture(); // fixture's staff.name is "Ada Test"
    const user = await linkUser(f);
    const attached = await staffContractService.attachContract({
      staffId: f.staffId, createdByUserId: user.id,
      input: { contractType: "text", contentText: "Terms." },
    });
    if (attached.kind !== "attached") throw new Error("unreachable");

    const outcome = await staffContractService.sign({
      staffContractId: attached.contract.id, staffId: f.staffId, userId: user.id,
      typedFullName: "Someone Else", affirmedReadAndAgree: true, consentedElectronicSignature: true,
      ipAddress: "127.0.0.1", userAgent: "vitest",
    });
    expect(outcome.kind).toBe("name_mismatch");

    const contract = await staffContractService.getContractByStaffId(f.staffId);
    expect(contract!.status).toBe("pending_signature");
    expect(await staffContractService.getSignatureForContract(attached.contract.id)).toBeUndefined();
  });

  it("accepts a typed name that only differs by case or whitespace", async () => {
    const f = await newFixture(); // fixture's staff.name is "Ada Test"
    const user = await linkUser(f);
    const attached = await staffContractService.attachContract({
      staffId: f.staffId, createdByUserId: user.id,
      input: { contractType: "text", contentText: "Terms." },
    });
    if (attached.kind !== "attached") throw new Error("unreachable");

    const outcome = await staffContractService.sign({
      staffContractId: attached.contract.id, staffId: f.staffId, userId: user.id,
      typedFullName: "  ada   TEST  ", affirmedReadAndAgree: true, consentedElectronicSignature: true,
      ipAddress: "127.0.0.1", userAgent: "vitest",
    });
    expect(outcome.kind).toBe("signed");
  });

  it("records the audit trail and the version's hash at the moment of signing", async () => {
    const f = await newFixture();
    const user = await linkUser(f);
    const attached = await staffContractService.attachContract({
      staffId: f.staffId, createdByUserId: user.id,
      input: { contractType: "text", contentText: "Terms." },
    });
    if (attached.kind !== "attached") throw new Error("unreachable");

    const outcome = await staffContractService.sign({
      staffContractId: attached.contract.id, staffId: f.staffId, userId: user.id,
      typedFullName: "Ada Test", affirmedReadAndAgree: true, consentedElectronicSignature: true,
      ipAddress: "10.0.0.5", userAgent: "vitest-agent",
    });
    expect(outcome.kind).toBe("signed");
    if (outcome.kind !== "signed") throw new Error("unreachable");
    expect(outcome.signature.contentHashAtSigning).toBe(attached.version.contentHash);
    expect(outcome.signature.ipAddress).toBe("10.0.0.5");
    expect(outcome.contract.status).toBe("signed");
  });
});

describe("declining", () => {
  it("records the decline without touching organisation membership", async () => {
    const f = await newFixture();
    const user = await linkUser(f, "pending");
    const attached = await staffContractService.attachContract({
      staffId: f.staffId, createdByUserId: user.id,
      input: { contractType: "text", contentText: "Terms." },
    });
    if (attached.kind !== "attached") throw new Error("unreachable");

    const outcome = await staffContractService.decline({
      staffContractId: attached.contract.id, staffName: "Ada Test", businessName: "Test Co",
      reason: "Salary too low", ipAddress: "127.0.0.1", userAgent: "vitest",
    });
    expect(outcome.kind).toBe("declined");
    if (outcome.kind !== "declined") throw new Error("unreachable");
    expect(outcome.contract.declinedReason).toBe("Salary too low");

    const member = await storage.getOrganisationMember(user.id, f.businessId);
    expect(member!.status).toBe("pending");
  });
});

describe("contract status projection", () => {
  it("reports none when no contract was ever attached", async () => {
    const f = await newFixture();
    expect(await staffContractService.computeContractStatus({ id: f.staffId, userId: null }, f.businessId)).toBe("none");
  });

  it("reports pending_signature while the linked member has not activated yet", async () => {
    const f = await newFixture();
    const user = await linkUser(f, "pending");
    await staffContractService.attachContract({
      staffId: f.staffId, createdByUserId: user.id,
      input: { contractType: "text", contentText: "Terms." },
    });
    const status = await staffContractService.computeContractStatus({ id: f.staffId, userId: user.id }, f.businessId);
    expect(status).toBe("pending_signature");
  });

  it("reports not_applicable_existing_account once the member is already active - branch C has no password step to gate", async () => {
    const f = await newFixture();
    const user = await linkUser(f, "active");
    await staffContractService.attachContract({
      staffId: f.staffId, createdByUserId: user.id,
      input: { contractType: "text", contentText: "Terms." },
    });
    const status = await staffContractService.computeContractStatus({ id: f.staffId, userId: user.id }, f.businessId);
    expect(status).toBe("not_applicable_existing_account");
  });

  it("reports signed regardless of membership status", async () => {
    const f = await newFixture();
    const user = await linkUser(f, "pending");
    const attached = await staffContractService.attachContract({
      staffId: f.staffId, createdByUserId: user.id,
      input: { contractType: "text", contentText: "Terms." },
    });
    if (attached.kind !== "attached") throw new Error("unreachable");
    await staffContractService.sign({
      staffContractId: attached.contract.id, staffId: f.staffId, userId: user.id,
      typedFullName: "Ada Test", affirmedReadAndAgree: true, consentedElectronicSignature: true,
      ipAddress: "127.0.0.1", userAgent: "vitest",
    });
    const status = await staffContractService.computeContractStatus({ id: f.staffId, userId: user.id }, f.businessId);
    expect(status).toBe("signed");
  });

  it("batches a whole page of staff in one call, same as computeContractStatus per row - GET /api/staff's list handler", async () => {
    const noneFixture = await newFixture();
    const pendingFixture = await newFixture();
    const pendingUser = await linkUser(pendingFixture, "pending");
    await staffContractService.attachContract({
      staffId: pendingFixture.staffId, createdByUserId: pendingUser.id,
      input: { contractType: "text", contentText: "Terms." },
    });

    const rows = [
      { id: noneFixture.staffId, userId: null },
      { id: pendingFixture.staffId, userId: pendingUser.id },
    ];
    // Both fixtures share the same organisation? No - each newFixture() makes
    // its own business, so the batch call is scoped to pendingFixture's
    // business; noneFixture's row still resolves correctly (no contract at
    // all, independent of organisationId).
    const statuses = await staffContractService.computeContractStatuses(rows, pendingFixture.businessId);
    expect(statuses.get(noneFixture.staffId)).toBe("none");
    expect(statuses.get(pendingFixture.staffId)).toBe("pending_signature");
  });
});

describe("re-sign enforcement for already-active staff", () => {
  it("flips an active member back to contract_pending", async () => {
    const f = await newFixture();
    const user = await linkUser(f, "active");

    const applied = await staffContractService.requireSignatureForActiveMember(user.id, f.businessId);
    expect(applied).toBe(true);

    const member = await storage.getOrganisationMember(user.id, f.businessId);
    expect(member!.status).toBe("contract_pending");

    // Same rule computeContractStatus already had - once the member is no
    // longer active, a pending_signature contract reports as genuinely
    // pending, not not_applicable_existing_account.
    await staffContractService.attachContract({
      staffId: f.staffId, createdByUserId: user.id,
      input: { contractType: "text", contentText: "Revised terms." },
    });
    const status = await staffContractService.computeContractStatus({ id: f.staffId, userId: user.id }, f.businessId);
    expect(status).toBe("pending_signature");
  });

  it("is a no-op for a member who isn't active yet - onboarding already gates them", async () => {
    const f = await newFixture();
    const user = await linkUser(f, "pending");

    const applied = await staffContractService.requireSignatureForActiveMember(user.id, f.businessId);
    expect(applied).toBe(false);

    const member = await storage.getOrganisationMember(user.id, f.businessId);
    expect(member!.status).toBe("pending"); // untouched
  });

  it("is a no-op when there's no membership at all", async () => {
    const f = await newFixture();
    const applied = await staffContractService.requireSignatureForActiveMember("no-such-user-id", f.businessId);
    expect(applied).toBe(false);
  });
});

describe("version history", () => {
  it("lists every version newest-first, marks the current one, and preserves prior content untouched", async () => {
    const f = await newFixture();
    const user = await linkUser(f);

    const v1 = await staffContractService.attachContract({
      staffId: f.staffId, createdByUserId: user.id,
      input: { contractType: "text", contentText: "Draft one." },
    });
    if (v1.kind !== "attached") throw new Error("unreachable");

    const v2 = await staffContractService.attachContract({
      staffId: f.staffId, createdByUserId: user.id,
      input: { contractType: "text", contentText: "Corrected version." },
    });
    if (v2.kind !== "replaced") throw new Error("unreachable");

    const history = await staffContractService.getVersionHistory(v1.contract.id);
    expect(history).toHaveLength(2);
    expect(history.map(h => h.versionNumber)).toEqual([2, 1]); // newest first

    const current = history.find(h => h.versionNumber === 2)!;
    const prior = history.find(h => h.versionNumber === 1)!;
    expect(current.isCurrent).toBe(true);
    expect(current.contentText).toBe("Corrected version.");
    expect(prior.isCurrent).toBe(false);
    expect(prior.contentText).toBe("Draft one."); // never mutated by the replace
    expect(prior.supersededAt).not.toBeNull();
    expect(current.supersededAt).toBeNull();
    expect(current.createdByName).toBeTruthy();
  });

  it("returns an empty list for a staff member with no contract at all", async () => {
    const f = await newFixture();
    const history = await staffContractService.getVersionHistory(f.staffId); // no staff_contracts row exists under this id
    expect(history).toEqual([]);
  });
});
