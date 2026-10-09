import crypto from "crypto";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { db } from "../db";
import { eq, inArray, sql } from "drizzle-orm";
import { users, organisationMembers, staff, staffContracts, staffContractVersions, staffContractSignatures } from "@shared/schema";
import { storage } from "../storage";
import { staffContractService, contractStagingPrefix } from "./StaffContractService";
import { objectStorage } from "../lib/objectStorage";

// No real bucket or scanner from a test; each test spies on objectStorage itself.
vi.mock("../lib/malwareScan", () => ({ scanBuffer: vi.fn(async () => ({ clean: true })) }));
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
async function linkUser(f: Fixture, memberStatus?: "pending" | "partial" | "active" | "profile_pending") {
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
      // 0123's append-only triggers refuse these deletes unless the
      // transaction-local purge switch is on.
      await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.allow_contract_purge', 'on', true)`);
        await tx.delete(staffContractSignatures).where(eq(staffContractSignatures.staffContractId, contract.id));
        await tx.update(staffContracts).set({ currentVersionId: null }).where(eq(staffContracts.id, contract.id));
        await tx.delete(staffContractVersions).where(eq(staffContractVersions.staffContractId, contract.id));
        await tx.delete(staffContracts).where(eq(staffContracts.id, contract.id));
      });
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
      businessId: f.businessId,
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
      staffId: f.staffId, businessId: f.businessId, createdByUserId: user.id,
      input: { contractType: "text", contentText: "Draft one." },
    });
    if (first.kind !== "attached") throw new Error("unreachable");

    const second = await staffContractService.attachContract({
      staffId: f.staffId, businessId: f.businessId, createdByUserId: user.id,
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
      staffId: f.staffId, businessId: f.businessId, createdByUserId: user.id,
      input: { contractType: "text", contentText: "Terms." },
    });
    if (attached.kind !== "attached") throw new Error("unreachable");

    const signed = await staffContractService.sign({
      staffContractId: attached.contract.id, versionId: attached.version.id, staffId: f.staffId, userId: user.id,
      typedFullName: "Ada Test", affirmedReadAndAgree: true, consentedElectronicSignature: true,
      ipAddress: "127.0.0.1", userAgent: "vitest",
    });
    expect(signed.kind).toBe("signed");

    const secondAttempt = await staffContractService.attachContract({
      staffId: f.staffId, businessId: f.businessId, createdByUserId: user.id,
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
      staffId: f.staffId, businessId: f.businessId, createdByUserId: user.id,
      input: { contractType: "text", contentText: "Terms." },
    });
    if (attached.kind !== "attached") throw new Error("unreachable");

    const outcome = await staffContractService.sign({
      staffContractId: attached.contract.id, versionId: attached.version.id, staffId: f.staffId, userId: user.id,
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
      staffId: f.staffId, businessId: f.businessId, createdByUserId: user.id,
      input: { contractType: "text", contentText: "Terms." },
    });
    if (attached.kind !== "attached") throw new Error("unreachable");

    const outcome = await staffContractService.sign({
      staffContractId: attached.contract.id, versionId: attached.version.id, staffId: f.staffId, userId: user.id,
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
      staffId: f.staffId, businessId: f.businessId, createdByUserId: user.id,
      input: { contractType: "text", contentText: "Terms." },
    });
    if (attached.kind !== "attached") throw new Error("unreachable");

    const outcome = await staffContractService.sign({
      staffContractId: attached.contract.id, versionId: attached.version.id, staffId: f.staffId, userId: user.id,
      typedFullName: "  ada   TEST  ", affirmedReadAndAgree: true, consentedElectronicSignature: true,
      ipAddress: "127.0.0.1", userAgent: "vitest",
    });
    expect(outcome.kind).toBe("signed");
  });

  it("records the audit trail and the version's hash at the moment of signing", async () => {
    const f = await newFixture();
    const user = await linkUser(f);
    const attached = await staffContractService.attachContract({
      staffId: f.staffId, businessId: f.businessId, createdByUserId: user.id,
      input: { contractType: "text", contentText: "Terms." },
    });
    if (attached.kind !== "attached") throw new Error("unreachable");

    const outcome = await staffContractService.sign({
      staffContractId: attached.contract.id, versionId: attached.version.id, staffId: f.staffId, userId: user.id,
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

describe("amending a signed contract", () => {
  const signArgs = (c: { contract: { id: string }; version: { id: string } }, f: Fixture, userId: string) => ({
    staffContractId: c.contract.id, versionId: c.version.id, staffId: f.staffId, userId,
    typedFullName: "Ada Test", affirmedReadAndAgree: true as const, consentedElectronicSignature: true as const,
    ipAddress: "127.0.0.1", userAgent: "vitest",
  });

  it("adds a new version, keeps the old signature, and needs a fresh signature", async () => {
    const f = await newFixture();
    const user = await linkUser(f);
    const v1 = await staffContractService.attachContract({
      staffId: f.staffId, businessId: f.businessId, createdByUserId: user.id,
      input: { contractType: "text", contentText: "Salary 100." },
    });
    if (v1.kind !== "attached") throw new Error("unreachable");
    expect((await staffContractService.sign(signArgs(v1, f, user.id))).kind).toBe("signed");

    const refused = await staffContractService.attachContract({
      staffId: f.staffId, businessId: f.businessId, createdByUserId: user.id,
      input: { contractType: "text", contentText: "Salary 120." },
    });
    expect(refused.kind).toBe("refused_already_signed");

    const amended = await staffContractService.attachContract({
      staffId: f.staffId, businessId: f.businessId, createdByUserId: user.id, amend: true,
      input: { contractType: "text", contentText: "Salary 120." },
    });
    expect(amended.kind).toBe("amended");
    if (amended.kind !== "amended") throw new Error("unreachable");
    expect(amended.version.versionNumber).toBe(2);
    expect(amended.contract.status).toBe("pending_signature");
    expect(await staffContractService.isAwaitingResignature(amended.contract)).toBe(true);

    // The first signature is untouched and still points at v1.
    const sigs = await db.select().from(staffContractSignatures)
      .where(eq(staffContractSignatures.staffContractId, v1.contract.id));
    expect(sigs).toHaveLength(1);
    expect(sigs[0].staffContractVersionId).toBe(v1.version.id);

    // Signing the stale v1 id is refused; signing v2 works and adds a second signature.
    expect((await staffContractService.sign(signArgs(v1, f, user.id))).kind).toBe("version_changed");
    expect((await staffContractService.sign(signArgs(amended, f, user.id))).kind).toBe("signed");
    const both = await db.select().from(staffContractSignatures)
      .where(eq(staffContractSignatures.staffContractId, v1.contract.id));
    expect(both).toHaveLength(2);

    const history = await staffContractService.getVersionHistory(v1.contract.id);
    expect(history.map(h => [h.versionNumber, !!h.signedAt])).toEqual([[2, true], [1, true]]);
  });

  it("a first-time pending contract is not an amendment", async () => {
    const f = await newFixture();
    const user = await linkUser(f);
    const v1 = await staffContractService.attachContract({
      staffId: f.staffId, businessId: f.businessId, createdByUserId: user.id,
      input: { contractType: "text", contentText: "Terms." },
    });
    if (v1.kind !== "attached") throw new Error("unreachable");
    expect(await staffContractService.isAwaitingResignature(v1.contract)).toBe(false);
  });

  it("replacing a declined contract clears the stale decline details", async () => {
    const f = await newFixture();
    const user = await linkUser(f, "pending");
    const v1 = await staffContractService.attachContract({
      staffId: f.staffId, businessId: f.businessId, createdByUserId: user.id,
      input: { contractType: "text", contentText: "Terms." },
    });
    if (v1.kind !== "attached") throw new Error("unreachable");
    await staffContractService.decline({
      staffContractId: v1.contract.id, versionId: v1.version.id, staffName: "Ada Test", businessName: "Test Co",
      reason: "No", ipAddress: "127.0.0.1", userAgent: "vitest",
    });
    const replaced = await staffContractService.attachContract({
      staffId: f.staffId, businessId: f.businessId, createdByUserId: user.id,
      input: { contractType: "text", contentText: "Better terms." },
    });
    if (replaced.kind !== "replaced") throw new Error("unreachable");
    expect(replaced.contract.status).toBe("pending_signature");
    expect(replaced.contract.declinedReason).toBeNull();
    expect(replaced.contract.declinedAt).toBeNull();
    expect(replaced.contract.declinedIp).toBeNull();
  });

  it("also requires a re-signature from a member who is mid-way through their HR profile", async () => {
    const f = await newFixture();
    const user = await linkUser(f, "profile_pending");
    expect(await staffContractService.requireSignatureForActiveMember(user.id, f.businessId)).toBe(true);
    const member = await storage.getOrganisationMember(user.id, f.businessId);
    expect(member!.status).toBe("contract_pending");
  });
});

describe("staff self-service copy and name matching", () => {
  it("shows a staff member only the versions they signed, never a pending amendment", async () => {
    const f = await newFixture();
    const user = await linkUser(f);
    const v1 = await staffContractService.attachContract({
      staffId: f.staffId, businessId: f.businessId, createdByUserId: user.id,
      input: { contractType: "text", contentText: "Signed terms." },
    });
    if (v1.kind !== "attached") throw new Error("unreachable");
    expect((await staffContractService.getSignedCopiesForStaff(f.staffId)).copies).toHaveLength(0);

    await staffContractService.sign({
      staffContractId: v1.contract.id, versionId: v1.version.id, staffId: f.staffId, userId: user.id,
      typedFullName: "Ada Test", affirmedReadAndAgree: true, consentedElectronicSignature: true,
      ipAddress: "127.0.0.1", userAgent: "vitest",
    });
    await staffContractService.attachContract({
      staffId: f.staffId, businessId: f.businessId, createdByUserId: user.id, amend: true,
      input: { contractType: "text", contentText: "Unsigned draft amendment." },
    });

    const mine = await staffContractService.getSignedCopiesForStaff(f.staffId);
    expect(mine.awaitingResignature).toBe(true);
    expect(mine.copies).toHaveLength(1);
    expect(mine.copies[0].contentText).toBe("Signed terms.");
    expect(mine.copies[0].isCurrent).toBe(false);
    expect(JSON.stringify(mine)).not.toContain("Unsigned draft amendment.");
  });

  it("returns nothing for a staff member with no contract", async () => {
    const f = await newFixture();
    const mine = await staffContractService.getSignedCopiesForStaff(f.staffId);
    expect(mine).toEqual({ contractStatus: "none", awaitingResignature: false, copies: [] });
  });

  it("matches a name whether accents are typed precomposed or decomposed", async () => {
    const f = await newFixture();
    const user = await linkUser(f);
    await db.update(staff).set({ name: "Jos\u00e9 Alvarez" }).where(eq(staff.id, f.staffId)); // precomposed é
    const v1 = await staffContractService.attachContract({
      staffId: f.staffId, businessId: f.businessId, createdByUserId: user.id,
      input: { contractType: "text", contentText: "Terms." },
    });
    if (v1.kind !== "attached") throw new Error("unreachable");
    const outcome = await staffContractService.sign({
      staffContractId: v1.contract.id, versionId: v1.version.id, staffId: f.staffId, userId: user.id,
      typedFullName: "Jose\u0301 Alvarez", // e + combining acute
      affirmedReadAndAgree: true, consentedElectronicSignature: true,
      ipAddress: "127.0.0.1", userAgent: "vitest",
    });
    expect(outcome.kind).toBe("signed");
  });
});

describe("append-only records", () => {
  async function signedFixture() {
    const f = await newFixture();
    const user = await linkUser(f);
    const attached = await staffContractService.attachContract({
      staffId: f.staffId, businessId: f.businessId, createdByUserId: user.id,
      input: { contractType: "text", contentText: "Terms." },
    });
    if (attached.kind !== "attached") throw new Error("unreachable");
    const signed = await staffContractService.sign({
      staffContractId: attached.contract.id, versionId: attached.version.id, staffId: f.staffId, userId: user.id,
      typedFullName: "Ada Test", affirmedReadAndAgree: true, consentedElectronicSignature: true,
      ipAddress: "127.0.0.1", userAgent: "vitest",
    });
    if (signed.kind !== "signed") throw new Error("unreachable");
    return { attached, signed };
  }

  it("refuses to update or delete a signature", async () => {
    const { signed } = await signedFixture();
    await expect(db.update(staffContractSignatures).set({ typedFullName: "Forged" })
      .where(eq(staffContractSignatures.id, signed.signature.id))).rejects.toThrow();
    await expect(db.delete(staffContractSignatures)
      .where(eq(staffContractSignatures.id, signed.signature.id))).rejects.toThrow();
  });

  it("refuses to edit or delete a version's content but still allows superseding it", async () => {
    const { attached } = await signedFixture();
    await expect(db.update(staffContractVersions).set({ contentText: "Edited after signing" })
      .where(eq(staffContractVersions.id, attached.version.id))).rejects.toThrow();
    await expect(db.update(staffContractVersions).set({ contentHash: "x" })
      .where(eq(staffContractVersions.id, attached.version.id))).rejects.toThrow();
    await expect(db.delete(staffContractVersions)
      .where(eq(staffContractVersions.id, attached.version.id))).rejects.toThrow();
    await expect(db.update(staffContractVersions).set({ supersededAt: new Date() })
      .where(eq(staffContractVersions.id, attached.version.id))).resolves.toBeDefined();
  });
});

describe("file contracts", () => {
  const bytes = Buffer.from("%PDF-1.4 fake contract bytes");
  const fileInput = (storageKey: string) => ({
    contractType: "file" as const, storageKey, fileMimeType: "application/pdf",
    fileSizeBytes: bytes.length, fileOriginalName: "contract.pdf",
  });

  it("rejects a storage key outside the caller's business prefix before touching storage", async () => {
    const f = await newFixture();
    const user = await linkUser(f);
    const head = vi.spyOn(objectStorage, "headObject");
    const del = vi.spyOn(objectStorage, "deleteObject");
    const get = vi.spyOn(objectStorage, "getObjectBuffer");
    try {
      for (const key of [
        "staff-contracts/pending/some-other-business/1-abc-contract.pdf",
        "staff-contracts/active/some-other-business/1-abc-contract.pdf",
        `${contractStagingPrefix(f.businessId)}../other/contract.pdf`,
      ]) {
        const outcome = await staffContractService.attachContract({
          staffId: f.staffId, businessId: f.businessId, createdByUserId: user.id, input: fileInput(key),
        });
        expect(outcome.kind).toBe("invalid");
      }
      expect(head).not.toHaveBeenCalled();
      expect(get).not.toHaveBeenCalled();
      expect(del).not.toHaveBeenCalled();
      expect(await staffContractService.getContractByStaffId(f.staffId)).toBeUndefined();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("hashes the actual file bytes and moves the object to its permanent key", async () => {
    const f = await newFixture();
    const user = await linkUser(f);
    const key = `${contractStagingPrefix(f.businessId)}1-abc-contract.pdf`;
    vi.spyOn(objectStorage, "headObject").mockResolvedValue({ contentType: "application/pdf", contentLength: bytes.length, etag: '"etag"' });
    vi.spyOn(objectStorage, "getObjectBuffer").mockResolvedValue(bytes);
    const copy = vi.spyOn(objectStorage, "copyObject").mockResolvedValue(undefined);
    vi.spyOn(objectStorage, "deleteObject").mockResolvedValue(undefined);
    try {
      const outcome = await staffContractService.attachContract({
        staffId: f.staffId, businessId: f.businessId, createdByUserId: user.id, input: fileInput(key),
      });
      expect(outcome.kind).toBe("attached");
      if (outcome.kind !== "attached") throw new Error("unreachable");
      expect(outcome.version.contentHash).toBe(crypto.createHash("sha256").update(bytes).digest("hex"));
      expect(outcome.version.storageKey).toBe(key.replace("/pending/", "/active/"));
      expect(copy).toHaveBeenCalledWith(key, outcome.version.storageKey);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("signing races and stale versions", () => {
  it("refuses to sign a version that was replaced while the signer was reading it", async () => {
    const f = await newFixture();
    const user = await linkUser(f);
    const v1 = await staffContractService.attachContract({
      staffId: f.staffId, businessId: f.businessId, createdByUserId: user.id,
      input: { contractType: "text", contentText: "Terms v1." },
    });
    if (v1.kind !== "attached") throw new Error("unreachable");
    await staffContractService.attachContract({
      staffId: f.staffId, businessId: f.businessId, createdByUserId: user.id,
      input: { contractType: "text", contentText: "Terms v2." },
    });

    const outcome = await staffContractService.sign({
      staffContractId: v1.contract.id, versionId: v1.version.id, staffId: f.staffId, userId: user.id,
      typedFullName: "Ada Test", affirmedReadAndAgree: true, consentedElectronicSignature: true,
      ipAddress: "127.0.0.1", userAgent: "vitest",
    });
    expect(outcome.kind).toBe("version_changed");
    expect(await staffContractService.getSignatureForContract(v1.contract.id)).toBeUndefined();
    expect((await staffContractService.getContractByStaffId(f.staffId))!.status).toBe("pending_signature");
  });

  it("refuses to decline a stale version", async () => {
    const f = await newFixture();
    const user = await linkUser(f);
    const v1 = await staffContractService.attachContract({
      staffId: f.staffId, businessId: f.businessId, createdByUserId: user.id,
      input: { contractType: "text", contentText: "Terms v1." },
    });
    if (v1.kind !== "attached") throw new Error("unreachable");
    await staffContractService.attachContract({
      staffId: f.staffId, businessId: f.businessId, createdByUserId: user.id,
      input: { contractType: "text", contentText: "Terms v2." },
    });
    const outcome = await staffContractService.decline({
      staffContractId: v1.contract.id, versionId: v1.version.id, staffName: "Ada Test", businessName: "Test Co",
      ipAddress: "127.0.0.1", userAgent: "vitest",
    });
    expect(outcome.kind).toBe("version_changed");
    expect((await staffContractService.getContractByStaffId(f.staffId))!.status).toBe("pending_signature");
  });

  it("concurrent signs produce exactly one signature row", async () => {
    const f = await newFixture();
    const user = await linkUser(f);
    const attached = await staffContractService.attachContract({
      staffId: f.staffId, businessId: f.businessId, createdByUserId: user.id,
      input: { contractType: "text", contentText: "Terms." },
    });
    if (attached.kind !== "attached") throw new Error("unreachable");
    const signOnce = () => staffContractService.sign({
      staffContractId: attached.contract.id, versionId: attached.version.id, staffId: f.staffId, userId: user.id,
      typedFullName: "Ada Test", affirmedReadAndAgree: true, consentedElectronicSignature: true,
      ipAddress: "127.0.0.1", userAgent: "vitest",
    });
    const outcomes = await Promise.all([signOnce(), signOnce(), signOnce()]);
    expect(outcomes.filter(o => o.kind === "signed")).toHaveLength(1);
    const rows = await db.select().from(staffContractSignatures)
      .where(eq(staffContractSignatures.staffContractId, attached.contract.id));
    expect(rows).toHaveLength(1);
  });

  it("a concurrent sign and decline resolve to exactly one outcome", async () => {
    const f = await newFixture();
    const user = await linkUser(f);
    const attached = await staffContractService.attachContract({
      staffId: f.staffId, businessId: f.businessId, createdByUserId: user.id,
      input: { contractType: "text", contentText: "Terms." },
    });
    if (attached.kind !== "attached") throw new Error("unreachable");
    const [signed, declined] = await Promise.all([
      staffContractService.sign({
        staffContractId: attached.contract.id, versionId: attached.version.id, staffId: f.staffId, userId: user.id,
        typedFullName: "Ada Test", affirmedReadAndAgree: true, consentedElectronicSignature: true,
        ipAddress: "127.0.0.1", userAgent: "vitest",
      }),
      staffContractService.decline({
        staffContractId: attached.contract.id, versionId: attached.version.id, staffName: "Ada Test", businessName: "Test Co",
        ipAddress: "127.0.0.1", userAgent: "vitest",
      }),
    ]);
    expect([signed.kind === "signed", declined.kind === "declined"].filter(Boolean)).toHaveLength(1);
    const final = (await staffContractService.getContractByStaffId(f.staffId))!;
    expect(final.status).toBe(signed.kind === "signed" ? "signed" : "declined");
  });
});

describe("declining", () => {
  it("records the decline without touching organisation membership", async () => {
    const f = await newFixture();
    const user = await linkUser(f, "pending");
    const attached = await staffContractService.attachContract({
      staffId: f.staffId, businessId: f.businessId, createdByUserId: user.id,
      input: { contractType: "text", contentText: "Terms." },
    });
    if (attached.kind !== "attached") throw new Error("unreachable");

    const outcome = await staffContractService.decline({
      staffContractId: attached.contract.id, versionId: attached.version.id, staffName: "Ada Test", businessName: "Test Co",
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
      staffId: f.staffId, businessId: f.businessId, createdByUserId: user.id,
      input: { contractType: "text", contentText: "Terms." },
    });
    const status = await staffContractService.computeContractStatus({ id: f.staffId, userId: user.id }, f.businessId);
    expect(status).toBe("pending_signature");
  });

  it("reports not_applicable_existing_account once the member is already active - branch C has no password step to gate", async () => {
    const f = await newFixture();
    const user = await linkUser(f, "active");
    await staffContractService.attachContract({
      staffId: f.staffId, businessId: f.businessId, createdByUserId: user.id,
      input: { contractType: "text", contentText: "Terms." },
    });
    const status = await staffContractService.computeContractStatus({ id: f.staffId, userId: user.id }, f.businessId);
    expect(status).toBe("not_applicable_existing_account");
  });

  it("reports signed regardless of membership status", async () => {
    const f = await newFixture();
    const user = await linkUser(f, "pending");
    const attached = await staffContractService.attachContract({
      staffId: f.staffId, businessId: f.businessId, createdByUserId: user.id,
      input: { contractType: "text", contentText: "Terms." },
    });
    if (attached.kind !== "attached") throw new Error("unreachable");
    await staffContractService.sign({
      staffContractId: attached.contract.id, versionId: attached.version.id, staffId: f.staffId, userId: user.id,
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
      staffId: pendingFixture.staffId, businessId: pendingFixture.businessId, createdByUserId: pendingUser.id,
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
      staffId: f.staffId, businessId: f.businessId, createdByUserId: user.id,
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
      staffId: f.staffId, businessId: f.businessId, createdByUserId: user.id,
      input: { contractType: "text", contentText: "Draft one." },
    });
    if (v1.kind !== "attached") throw new Error("unreachable");

    const v2 = await staffContractService.attachContract({
      staffId: f.staffId, businessId: f.businessId, createdByUserId: user.id,
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
