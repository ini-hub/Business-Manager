import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { db } from "../db";
import { eq, inArray } from "drizzle-orm";
import { users, organisationMembers, staff, pendingEmails } from "@shared/schema";
import { storage } from "../storage";
import { staffInviteService } from "./StaffInviteService";
import {
  assertTestDatabase, ensureSchema, createFixture, sweepResidue, closePool, type Fixture,
} from "../test-support/integration-db";

/**
 * The properties here cannot be observed from pure functions: they are about
 * what the database actually holds after an invitation is corrected. The
 * headline case - a mistyped address, fixed later - used to leave the invite
 * stranded with no route back for either side, so each block pins one of the
 * facts that stops it recurring.
 *
 * Email delivery is asynchronous, so pending_emails is the observation point.
 */

let fixtures: Fixture[] = [];
const touchedUserIds = new Set<string>();
const sentTo = new Set<string>();

async function newFixture() {
  const f = await createFixture();
  fixtures.push(f);
  return f;
}

/** Invites the fixture's staff member at `email`, as POST /api/staff does. */
async function invite(f: Fixture, email: string) {
  const row = await storage.getStaff(f.staffId);
  await db.update(staff).set({ email }).where(eq(staff.id, f.staffId));
  sentTo.add(email);
  const outcome = await staffInviteService.inviteStaff({
    staff: { ...row!, email } as any,
    businessId: f.businessId,
    email,
    role: "staff",
    reason: "create",
    respectCooldown: false,
    allowRelink: false,
  });
  if ("userId" in outcome) touchedUserIds.add(outcome.userId);
  return outcome;
}

const userFor = async (staffId: string) => {
  const row = await storage.getStaff(staffId);
  return row?.userId ? await storage.getUser(row.userId) : undefined;
};

const memberFor = async (userId: string, businessId: string) =>
  storage.getOrganisationMember(userId, businessId);

const mailsTo = async (address: string) =>
  db.select().from(pendingEmails).where(eq(pendingEmails.to, address));

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
  await sweepResidue();
});

afterEach(async () => {
  // destroyStore does not know about users/organisation_members, so the
  // accounts these tests mint have to be swept here.
  const ids = Array.from(touchedUserIds);
  if (ids.length) {
    await db.update(staff).set({ userId: null }).where(inArray(staff.userId, ids));
    await db.delete(organisationMembers).where(inArray(organisationMembers.userId, ids));
    await db.delete(users).where(inArray(users.id, ids));
  }
  for (const address of Array.from(sentTo)) {
    await db.delete(pendingEmails).where(eq(pendingEmails.to, address));
  }
  touchedUserIds.clear();
  sentTo.clear();
  for (const f of fixtures) await f.cleanup();
  fixtures = [];
});

afterAll(async () => {
  await sweepResidue();
  await closePool();
});

describe("a mistyped invitation, corrected", () => {
  it("re-points the same account and re-issues the code, rather than stranding it", async () => {
    const f = await newFixture();
    const typo = `jane-${Date.now()}@gmial.test`;
    const fixed = `jane-${Date.now()}@gmail.test`;

    expect((await invite(f, typo)).kind).toBe("activation_sent");

    const before = await userFor(f.staffId);
    expect(before!.email).toBe(typo);
    expect(before!.activationCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(before!.activationCodeUsed).toBe(false);
    expect((await memberFor(before!.id, f.businessId))!.status).toBe("pending");
    expect(await mailsTo(typo)).toHaveLength(1);
    expect(await staffInviteService.computeInviteStatus(
      { id: f.staffId, userId: before!.id }, f.businessId)).toBe("pending");

    // What PATCH /api/staff/:id does for a pending invite.
    sentTo.add(fixed);
    await storage.updateUser(before!.id, { email: fixed, isEmailVerified: false });
    const outcome = await staffInviteService.inviteStaff({
      staff: { ...(await storage.getStaff(f.staffId))!, email: fixed } as any,
      businessId: f.businessId, email: fixed, role: "staff",
      reason: "email_change", respectCooldown: false, allowRelink: false,
    });
    expect(outcome.kind).toBe("activation_sent");
    // ...and the staff row itself, which PATCH writes last.
    await db.update(staff).set({ email: fixed }).where(eq(staff.id, f.staffId));

    const after = await userFor(f.staffId);
    expect(after!.id).toBe(before!.id);
    expect(after!.email).toBe(fixed);
    // A fresh code, still unused, still 48h out.
    expect(after!.activationCode).not.toBe(before!.activationCode);
    expect(after!.activationCodeUsed).toBe(false);
    const hoursOut = (new Date(after!.activationCodeExpiry!).getTime() - Date.now()) / 3_600_000;
    expect(hoursOut).toBeGreaterThan(47);
    expect(hoursOut).toBeLessThanOrEqual(48);

    // The correction must not fork a second account for the same person.
    const both = await db.select().from(users).where(inArray(users.email, [typo, fixed]));
    expect(both).toHaveLength(1);

    expect(await mailsTo(fixed)).toHaveLength(1);
    expect((await memberFor(after!.id, f.businessId))!.status).toBe("pending");
    expect((await storage.getStaff(f.staffId))!.email).toBe(fixed);
  });

  it("becomes reachable by the invitee's own resend only after the fix", async () => {
    const f = await newFixture();
    const typo = `bob-${Date.now()}@gmial.test`;
    const fixed = `bob-${Date.now()}@gmail.test`;
    await invite(f, typo);

    // This is the dead end the bug produced: /api/auth/resend-activation looks
    // the account up by the identifier typed in, and users.email is the typo.
    expect(await storage.getUserByIdentifier(fixed)).toBeUndefined();

    sentTo.add(fixed);
    const user = await userFor(f.staffId);
    await storage.updateUser(user!.id, { email: fixed });

    const found = await storage.getUserByIdentifier(fixed);
    expect(found?.id).toBe(user!.id);
  });
});

describe("invitation lifecycle", () => {
  it("tracks pending -> partial -> active as the invitee works through it", async () => {
    const f = await newFixture();
    const email = `lifecycle-${Date.now()}@example.test`;
    await invite(f, email);

    const user = await userFor(f.staffId);
    const status = () => staffInviteService.computeInviteStatus(
      { id: f.staffId, userId: user!.id }, f.businessId);
    expect(await status()).toBe("pending");

    // What activateHandler writes once the code checks out.
    const member = await memberFor(user!.id, f.businessId);
    await storage.updateUser(user!.id, { activationCodeUsed: true, activationCode: null });
    await storage.updateOrganisationMemberStatus(member!.id, "partial");
    expect(await status()).toBe("partial");

    // ...and what set-activated-password writes.
    await storage.updateOrganisationMemberStatus(member!.id, "active", new Date());
    expect(await status()).toBe("active");
  });

  it("refuses to resend to somebody already activated", async () => {
    const f = await newFixture();
    const email = `done-${Date.now()}@example.test`;
    await invite(f, email);
    const user = await userFor(f.staffId);
    const member = await memberFor(user!.id, f.businessId);
    await storage.updateOrganisationMemberStatus(member!.id, "active", new Date());

    const before = (await storage.getUser(user!.id))!.activationCode;
    const outcome = await staffInviteService.inviteStaff({
      staff: (await storage.getStaff(f.staffId))! as any,
      businessId: f.businessId, email, role: "staff",
      reason: "manual_resend", respectCooldown: true, allowRelink: false,
    });
    expect(outcome.kind).toBe("already_active");
    // No new code minted, no extra mail queued.
    expect((await storage.getUser(user!.id))!.activationCode).toBe(before);
    expect(await mailsTo(email)).toHaveLength(1);
  });

  it("stops a mailbox being flooded, at three sends an hour", async () => {
    const f = await newFixture();
    const email = `flood-${Date.now()}@example.test`;
    await invite(f, email);

    const results: string[] = [];
    for (let i = 0; i < 4; i++) {
      const outcome = await staffInviteService.inviteStaff({
        staff: (await storage.getStaff(f.staffId))! as any,
        businessId: f.businessId, email, role: "staff",
        reason: "manual_resend", respectCooldown: true, allowRelink: false,
      });
      results.push(outcome.kind);
    }
    expect(results).toEqual(["activation_sent", "activation_sent", "activation_sent", "cooldown"]);
    // One from the invite plus three resends - the fourth sent nothing.
    expect(await mailsTo(email)).toHaveLength(4);
  });

  it("refuses to resend once the member already has a password (contract_pending) - regression for the decline-bypass", async () => {
    // A contract_pending member is blocked on their staff_contracts row, not
    // their activation code (which is already used) - resending used to
    // silently re-arm the code anyway, which combined with
    // set-activated-password's old pending_signature-only check let a
    // DECLINED contract be walked straight back into a real session. See
    // server/routes.ts's set-activated-password for the other half of this
    // fix.
    const f = await newFixture();
    const email = `contract-pending-resend-${Date.now()}@example.test`;
    await invite(f, email);
    const user = await userFor(f.staffId);
    const member = await memberFor(user!.id, f.businessId);
    await storage.updateUser(user!.id, { activationCodeUsed: true, activationCode: null });
    await storage.updateOrganisationMemberStatus(member!.id, "contract_pending");

    const before = (await storage.getUser(user!.id))!.activationCode;
    const outcome = await staffInviteService.inviteStaff({
      staff: (await storage.getStaff(f.staffId))! as any,
      businessId: f.businessId, email, role: "staff",
      reason: "manual_resend", respectCooldown: true, allowRelink: false,
    });
    expect(outcome).toEqual({ kind: "contract_pending_not_applicable", userId: user!.id });

    // No code re-armed, no mail queued beyond the original invite.
    expect((await storage.getUser(user!.id))!.activationCode).toBe(before);
    expect((await storage.getUser(user!.id))!.activationCodeUsed).toBe(true);
    expect(await mailsTo(email)).toHaveLength(1);
    expect((await memberFor(user!.id, f.businessId))!.status).toBe("contract_pending");
  });
});

describe("relinking onto a real account", () => {
  it("frees the mistyped address instead of parking it on a dead row", async () => {
    const f = await newFixture();
    const typo = `carol-${Date.now()}@gmial.test`;
    const real = `carol-${Date.now()}@gmail.test`;
    await invite(f, typo);
    const placeholder = await userFor(f.staffId);

    // The corrected address turns out to already have an account.
    sentTo.add(real);
    const [other] = await db.insert(users).values({
      email: real, name: "Carol", passwordHash: "x", activationCodeUsed: true,
    }).returning();
    touchedUserIds.add(other.id);

    const outcome = await staffInviteService.inviteStaff({
      staff: { ...(await storage.getStaff(f.staffId))!, email: real } as any,
      businessId: f.businessId, email: real, role: "staff",
      reason: "email_change", respectCooldown: false, allowRelink: true,
    });
    expect(outcome).toMatchObject({ kind: "relinked", userId: other.id, retiredUserId: placeholder!.id });

    const retired = await storage.getUser(placeholder!.id);
    expect(retired!.email).toBeNull();
    expect(retired!.status).toBe("deactivated");
    expect(await memberFor(placeholder!.id, f.businessId)).toBeUndefined();
    expect((await storage.getStaff(f.staffId))!.userId).toBe(other.id);

    // users_email_unique is global: the address must be reusable, or a typo
    // would poison it for the whole platform forever.
    const [reused] = await db.insert(users).values({ email: typo, name: "Someone else" }).returning();
    touchedUserIds.add(reused.id);
    expect(reused.email).toBe(typo);
  });

  it("leaves everything untouched when the address belongs to a used account", async () => {
    const f = await newFixture();
    const mine = `dave-${Date.now()}@example.test`;
    const theirs = `erin-${Date.now()}@example.test`;
    await invite(f, mine);
    const placeholder = await userFor(f.staffId);
    // Somebody has actually signed in with this one.
    await storage.updateUser(placeholder!.id, { lastLoginAt: new Date() });

    const [other] = await db.insert(users).values({ email: theirs, name: "Erin" }).returning();
    touchedUserIds.add(other.id);

    const outcome = await staffInviteService.inviteStaff({
      staff: { ...(await storage.getStaff(f.staffId))!, email: theirs } as any,
      businessId: f.businessId, email: theirs, role: "staff",
      reason: "email_change", respectCooldown: false, allowRelink: true,
    });
    expect(outcome).toEqual({ kind: "conflict", reason: "email_belongs_to_active_account" });

    expect((await storage.getStaff(f.staffId))!.userId).toBe(placeholder!.id);
    expect((await storage.getUser(placeholder!.id))!.email).toBe(mine);
    expect((await storage.getUser(other.id))!.email).toBe(theirs);
  });
});

describe("inviteStatus projection", () => {
  it("reads a whole page of staff in one query", async () => {
    const f = await newFixture();
    await invite(f, `page-${Date.now()}@example.test`);
    const user = await userFor(f.staffId);

    const rows = [{ id: f.staffId, userId: user!.id }, { id: "no-account", userId: null }];
    const statuses = await staffInviteService.computeInviteStatuses(rows, f.businessId);
    expect(statuses.get(f.staffId)).toBe("pending");
    expect(statuses.get("no-account")).toBe("none");
  });
});
