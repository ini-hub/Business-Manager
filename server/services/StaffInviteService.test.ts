import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../storage", () => ({ storage: {
  getBusinessById: vi.fn(), getUserByIdentifier: vi.fn(), getUser: vi.fn(),
  createUser: vi.fn(), updateUser: vi.fn(), updateStaff: vi.fn(),
  getOrganisationMember: vi.fn(), createOrganisationMember: vi.fn(),
  updateOrganisationMemberStatus: vi.fn(), deleteOrganisationMember: vi.fn(),
  getOrganisationsByUserId: vi.fn(), getStaffByUserId: vi.fn(), getAllStaffByUserId: vi.fn(), getStore: vi.fn(),
  getInviteProjection: vi.fn(),
} }));
vi.mock("../email", () => ({ sendActivationEmail: vi.fn(), sendAddedToOrgEmail: vi.fn() }));
vi.mock("../db", () => {
  // Run transaction bodies against a stub that records the writes, so the
  // service's real control flow is exercised without a database.
  const writes: any[] = [];
  const tx = {
    insert: (table: any) => ({ values: (v: any) => { writes.push({ op: "insert", table, v }); return { returning: async () => [{ id: "new-user", ...v }] }; } }),
    update: (table: any) => ({ set: (v: any) => ({ where: async () => { writes.push({ op: "update", table, v }); } }) }),
    delete: (table: any) => ({ where: async () => { writes.push({ op: "delete", table }); } }),
  };
  return { db: { __writes: writes, transaction: async (fn: any) => fn(tx) } };
});

import { StaffInviteService, type InviteParams } from "./StaffInviteService";
import { storage } from "../storage";
import { sendActivationEmail, sendAddedToOrgEmail } from "../email";
import { db } from "../db";

const service = new StaffInviteService();
const S = storage as any;

const staffRow = (over: any = {}) => ({
  id: "staff-1", storeId: "store-1", staffNumber: "EXB-001", name: "Jane Test",
  email: "jane@example.com", userId: null, isArchived: false, role: "staff", ...over,
});

const params = (over: Partial<InviteParams> = {}): InviteParams => ({
  staff: staffRow() as any, businessId: "biz-1", email: "jane@example.com",
  role: "staff", reason: "create", respectCooldown: false, allowRelink: false, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  (db as any).__writes.length = 0;
  S.getBusinessById.mockResolvedValue({ id: "biz-1", name: "Acme Salon" });
  S.getUserByIdentifier.mockResolvedValue(undefined);
  S.getOrganisationMember.mockResolvedValue(undefined);
  S.getOrganisationsByUserId.mockResolvedValue([{ organisationId: "biz-1" }]);
  S.getStaffByUserId.mockResolvedValue(undefined);
  S.getAllStaffByUserId.mockResolvedValue([]);
  S.getStore.mockResolvedValue({ id: "store-9", businessId: "biz-9" });
  S.updateUser.mockResolvedValue({});
  S.updateStaff.mockResolvedValue({});
});

describe("inviteStaff - guards", () => {
  it("does nothing without an email, a business, or an active staff row", async () => {
    expect(await service.inviteStaff(params({ email: "" }))).toEqual({ kind: "skipped", reason: "no_email" });
    expect(await service.inviteStaff(params({ businessId: null }))).toEqual({ kind: "skipped", reason: "no_business" });
    expect(await service.inviteStaff(params({ staff: staffRow({ isArchived: true }) as any })))
      .toEqual({ kind: "skipped", reason: "archived" });
    expect(sendActivationEmail).not.toHaveBeenCalled();
  });
});

describe("inviteStaff - new invitee", () => {
  it("creates the account, membership and link in one transaction, then mails the code", async () => {
    const out = await service.inviteStaff(params());
    expect(out.kind).toBe("activation_sent");

    const writes = (db as any).__writes;
    expect(writes.filter((w: any) => w.op === "insert")).toHaveLength(2); // user + membership
    const user = writes[0].v;
    expect(user.email).toBe("jane@example.com");
    expect(user.createdByInvitation).toBe(true);
    expect(user.activationCodeUsed).toBe(false);
    expect(user.activationCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    // Both password columns get the placeholder - a null in either reads as
    // "no password set", which would let the account be claimed without a code.
    expect(user.password).toBeTruthy();
    expect(user.passwordHash).toBe(user.password);
    expect(writes[1].v).toMatchObject({ status: "pending", staffId: "EXB-001" });

    expect(sendActivationEmail).toHaveBeenCalledOnce();
    expect(vi.mocked(sendActivationEmail).mock.calls[0][0]).toBe("jane@example.com");
    expect(vi.mocked(sendActivationEmail).mock.calls[0][4]).toBe(user.activationCode);
  });

  it("reports a failure to queue without undoing the invitation itself", async () => {
    vi.mocked(sendActivationEmail).mockRejectedValueOnce(new Error("db down"));
    const out = await service.inviteStaff(params());
    // The account exists; only the mail did not get queued, and resend is the
    // fix for that - so the rows must stay.
    expect(out).toMatchObject({ kind: "failed" });
    expect((db as any).__writes.filter((w: any) => w.op === "insert")).toHaveLength(2);
  });
});

describe("inviteStaff - idempotency", () => {
  it("rotates the code on a repeat call without creating a second account", async () => {
    const user = { id: "user-1", email: "jane@example.com", activationCode: "AAAA-BBBB",
      activationCodeUsed: false, resendAttempts: 0, resendWindowStart: null };
    S.getUserByIdentifier.mockResolvedValue(user);
    S.getOrganisationMember.mockResolvedValue({ id: "m1", status: "pending" });

    const out = await service.inviteStaff(params({ staff: staffRow({ userId: "user-1" }) as any }));
    expect(out).toEqual({ kind: "activation_sent", userId: "user-1" });
    expect(S.createUser).not.toHaveBeenCalled();
    expect(S.createOrganisationMember).not.toHaveBeenCalled();

    const written = S.updateUser.mock.calls[0][1];
    expect(written.activationCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(written.activationCode).not.toBe("AAAA-BBBB");
    expect(written.activationCodeUsed).toBe(false);
  });

  it("repairs a membership that was never written", async () => {
    S.getUserByIdentifier.mockResolvedValue({ id: "user-1", activationCodeUsed: false });
    S.getOrganisationMember.mockResolvedValue(undefined);
    S.createOrganisationMember.mockResolvedValue({ id: "m1", status: "pending" });

    const out = await service.inviteStaff(params({ staff: staffRow({ userId: "user-1" }) as any }));
    expect(S.createOrganisationMember).toHaveBeenCalledOnce();
    expect(out.kind).toBe("activation_sent");
  });

  it("treats a concurrent membership insert as success, not an error", async () => {
    S.getUserByIdentifier.mockResolvedValue({ id: "user-1", activationCodeUsed: false });
    S.getOrganisationMember
      .mockResolvedValueOnce(undefined)                       // the check
      .mockResolvedValue({ id: "m1", status: "pending" });    // after the race
    S.createOrganisationMember.mockRejectedValue(
      Object.assign(new Error("dup"), { code: "23505", constraint: "org_member_user_org_unique" }));

    const out = await service.inviteStaff(params({ staff: staffRow({ userId: "user-1" }) as any }));
    expect(out.kind).toBe("activation_sent");
  });

  it("sends nothing to somebody who has already activated", async () => {
    S.getUserByIdentifier.mockResolvedValue({ id: "user-1", activationCodeUsed: true });
    S.getOrganisationMember.mockResolvedValue({ id: "m1", status: "active" });

    const out = await service.inviteStaff(params({ staff: staffRow({ userId: "user-1" }) as any }));
    expect(out).toEqual({ kind: "already_active", userId: "user-1" });
    expect(sendActivationEmail).not.toHaveBeenCalled();
    expect(S.updateUser).not.toHaveBeenCalled();
  });

  it("sends a partial member back to the start rather than stranding them mid-flow", async () => {
    S.getUserByIdentifier.mockResolvedValue({ id: "user-1", activationCodeUsed: false });
    S.getOrganisationMember.mockResolvedValue({ id: "m1", status: "partial" });

    await service.inviteStaff(params({ staff: staffRow({ userId: "user-1" }) as any }));
    // Their verified code was just invalidated, so the membership must follow.
    expect(S.updateOrganisationMemberStatus).toHaveBeenCalledWith("m1", "pending");
  });
});

describe("inviteStaff - resend cooldown", () => {
  const onCooldown = {
    id: "user-1", activationCodeUsed: false,
    resendAttempts: 3, resendWindowStart: new Date(),
  };

  it("refuses a manual resend once the mailbox has had its three per hour", async () => {
    S.getUserByIdentifier.mockResolvedValue(onCooldown);
    S.getOrganisationMember.mockResolvedValue({ id: "m1", status: "pending" });

    const out = await service.inviteStaff(params({
      staff: staffRow({ userId: "user-1" }) as any, reason: "manual_resend", respectCooldown: true,
    }));
    expect(out.kind).toBe("cooldown");
    expect(S.updateUser).not.toHaveBeenCalled();
    expect(sendActivationEmail).not.toHaveBeenCalled();
  });

  it("still fixes a typo'd address on cooldown, and resets the counter", async () => {
    // The counter belongs to the OLD address. Letting it block the correction
    // would leave the invitation stranded for an hour for no reason.
    S.getUserByIdentifier.mockResolvedValue(onCooldown);
    S.getOrganisationMember.mockResolvedValue({ id: "m1", status: "pending" });

    const out = await service.inviteStaff(params({
      staff: staffRow({ userId: "user-1" }) as any, reason: "email_change", respectCooldown: false,
    }));
    expect(out.kind).toBe("activation_sent");
    expect(S.updateUser.mock.calls[0][1]).toMatchObject({ resendAttempts: 0, resendWindowStart: null });
    expect(sendActivationEmail).toHaveBeenCalledOnce();
  });
});

describe("inviteStaff - existing platform user", () => {
  it("attaches an unlinked staff row to the account that owns the address", async () => {
    S.getUserByIdentifier.mockResolvedValue({ id: "other-user", email: "jane@example.com" });
    S.createOrganisationMember.mockResolvedValue({ id: "m1", status: "active" });

    const out = await service.inviteStaff(params());
    expect(out).toEqual({ kind: "added_to_existing_user", userId: "other-user", existingLinks: [] });
    // They already have a password - an activation code would be nonsense.
    expect(sendAddedToOrgEmail).toHaveBeenCalledOnce();
    expect(sendActivationEmail).not.toHaveBeenCalled();
    expect(S.updateStaff).toHaveBeenCalledWith("staff-1", { userId: "other-user" });
  });

  it("surfaces the account's other staff links instead of blocking the attach", async () => {
    S.getUserByIdentifier.mockResolvedValue({ id: "other-user", email: "jane@example.com" });
    S.createOrganisationMember.mockResolvedValue({ id: "m1", status: "active" });
    S.getAllStaffByUserId.mockResolvedValue([
      { id: "staff-9", storeId: "store-9", name: "Jane at Ikeja Branch" },
    ]);

    const out = await service.inviteStaff(params());
    // Still links - matching by email can't distinguish "same person, second
    // job" from "manager typo'd someone else's address", so this stays
    // permissive - but the caller now gets enough to warn the manager.
    expect(out).toEqual({
      kind: "added_to_existing_user",
      userId: "other-user",
      existingLinks: [{ staffId: "staff-9", storeId: "store-9", businessId: "biz-9", name: "Jane at Ikeja Branch" }],
    });
    expect(S.updateStaff).toHaveBeenCalledWith("staff-1", { userId: "other-user" });
  });

  it("refuses to move a linked staff row unless relinking was asked for", async () => {
    S.getUserByIdentifier.mockResolvedValue({ id: "other-user" });
    const out = await service.inviteStaff(params({
      staff: staffRow({ userId: "user-1" }) as any, allowRelink: false,
    }));
    expect(out).toEqual({ kind: "conflict", reason: "email_belongs_to_active_account" });
    expect(S.updateStaff).not.toHaveBeenCalled();
  });

  it("frees the mistyped address when it retires a placeholder", async () => {
    S.getUserByIdentifier.mockResolvedValue({ id: "other-user" });
    S.getUser.mockResolvedValue({
      id: "placeholder", email: "jane@gmial.com",
      createdByInvitation: true, activationCodeUsed: false, lastLoginAt: null,
    });
    S.getOrganisationMember
      .mockResolvedValueOnce({ id: "m-old", status: "pending" })  // isDisposablePlaceholder
      .mockResolvedValueOnce({ id: "m-old", status: "pending" })  // the stale row
      .mockResolvedValueOnce(undefined);                          // target has none yet

    S.getAllStaffByUserId.mockResolvedValue([
      { id: "staff-9", storeId: "store-9", name: "Jane at Ikeja Branch" },
    ]);

    const out = await service.inviteStaff(params({
      staff: staffRow({ userId: "placeholder" }) as any, allowRelink: true,
    }));
    expect(out).toMatchObject({
      kind: "relinked", userId: "other-user", retiredUserId: "placeholder",
      existingLinks: [{ staffId: "staff-9", storeId: "store-9", businessId: "biz-9", name: "Jane at Ikeja Branch" }],
    });

    const writes = (db as any).__writes;
    expect(writes.some((w: any) => w.op === "delete")).toBe(true);
    // users_email_unique is global: parking the typo on a dead row would block
    // that address from ever being used again.
    const neutralised = writes.find((w: any) => w.op === "update" && w.v.status === "deactivated");
    expect(neutralised.v).toMatchObject({ email: null, phone: null, activationCodeUsed: true });
  });

  it("will not discard an account that reaches into another business", async () => {
    S.getUserByIdentifier.mockResolvedValue({ id: "other-user" });
    S.getUser.mockResolvedValue({
      id: "placeholder", createdByInvitation: true, activationCodeUsed: false, lastLoginAt: null,
    });
    S.getOrganisationMember.mockResolvedValue({ id: "m-old", status: "pending" });
    S.getOrganisationsByUserId.mockResolvedValue([{ organisationId: "biz-1" }, { organisationId: "biz-2" }]);

    const out = await service.inviteStaff(params({
      staff: staffRow({ userId: "placeholder" }) as any, allowRelink: true,
    }));
    expect(out.kind).toBe("conflict");
  });
});

describe("computeInviteStatuses", () => {
  it("reads the whole page in a single query", async () => {
    S.getInviteProjection.mockResolvedValue([
      { userId: "u-pending", memberStatus: "pending", createdByInvitation: true, activationCodeUsed: false, lastLoginAt: null },
      { userId: "u-partial", memberStatus: "partial", createdByInvitation: true, activationCodeUsed: true, lastLoginAt: null },
      { userId: "u-active", memberStatus: "active", createdByInvitation: false, activationCodeUsed: true, lastLoginAt: new Date() },
      // An invitation that crashed between creating the account and its
      // membership. Still outstanding; resend repairs the missing row.
      { userId: "u-orphan", memberStatus: null, createdByInvitation: true, activationCodeUsed: false, lastLoginAt: null },
      { userId: "u-stray", memberStatus: null, createdByInvitation: false, activationCodeUsed: false, lastLoginAt: null },
    ]);

    const statuses = await service.computeInviteStatuses([
      { id: "s1", userId: "u-pending" }, { id: "s2", userId: "u-partial" },
      { id: "s3", userId: "u-active" }, { id: "s4", userId: null },
      { id: "s5", userId: "u-orphan" }, { id: "s6", userId: "u-stray" },
    ], "biz-1");

    expect(S.getInviteProjection).toHaveBeenCalledOnce();
    expect(Object.fromEntries(statuses)).toEqual({
      s1: "pending", s2: "partial", s3: "active", s4: "none", s5: "pending", s6: "none",
    });
  });

  it("skips the query entirely when no staff row has an account", async () => {
    const statuses = await service.computeInviteStatuses([{ id: "s1", userId: null }], "biz-1");
    expect(S.getInviteProjection).not.toHaveBeenCalled();
    expect(statuses.get("s1")).toBe("none");
  });
});
