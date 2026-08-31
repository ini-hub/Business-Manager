import { describe, it, expect } from "vitest";
import { StaffInviteService, type EmailChangePlanInput } from "./StaffInviteService";

const service = new StaffInviteService();

const linked = (over: Partial<EmailChangePlanInput["linkedUser"]> = {}) => ({
  id: "user-1",
  createdByInvitation: true,
  activationCodeUsed: false,
  lastLoginAt: null,
  ...over,
}) as EmailChangePlanInput["linkedUser"];

const plan = (over: Partial<EmailChangePlanInput> = {}) =>
  service.planStaffEmailChange({
    staffUserId: "user-1",
    linkedUser: linked(),
    linkedMemberStatus: "pending",
    newEmailOwnerId: null,
    linkedOrgCount: 1,
    linkedIsOwner: false,
    linkedIsRequester: false,
    ...over,
  });

describe("planStaffEmailChange", () => {
  // Row 1 / 5: no login account behind this staff row yet.
  it("invites from scratch when the staff row has no linked account", () => {
    expect(plan({ staffUserId: null, linkedUser: null })).toEqual({ action: "invite" });
    // Even if the address already belongs to somebody - inviteStaff picks the
    // attach branch from there.
    expect(plan({ staffUserId: null, linkedUser: null, newEmailOwnerId: "other" }))
      .toEqual({ action: "invite" });
  });

  // Row 2: the headline case. A typo'd invitation nobody has claimed.
  it("re-invites when the invitation is still outstanding", () => {
    expect(plan()).toEqual({ action: "reinvite" });
    // A membership that reached "partial" is still mid-activation.
    expect(plan({ linkedMemberStatus: "partial" })).toEqual({ action: "reinvite" });
  });

  // Row 3: the accepted-risk overwrite. Any one of the three signals is enough.
  it("overwrites and demands verification once the account is in use", () => {
    expect(plan({ linkedMemberStatus: "active" })).toEqual({ action: "overwrite_and_verify" });
    expect(plan({ linkedUser: linked({ activationCodeUsed: true }) }))
      .toEqual({ action: "overwrite_and_verify" });
    expect(plan({ linkedUser: linked({ lastLoginAt: new Date() }) }))
      .toEqual({ action: "overwrite_and_verify" });
  });

  // Row 4: staff.email had drifted from users.email. Nothing to send.
  it("just syncs when the address is already the linked account's own", () => {
    expect(plan({ newEmailOwnerId: "user-1" })).toEqual({ action: "sync" });
    // Even for an active account: this is not a change of credential.
    expect(plan({ newEmailOwnerId: "user-1", linkedMemberStatus: "active" }))
      .toEqual({ action: "sync" });
  });

  // Row 6: the corrected address belongs to a real account and what we would
  // abandon is a never-claimed placeholder.
  it("relinks onto the real account when the current link is disposable", () => {
    expect(plan({ newEmailOwnerId: "other-user" })).toEqual({ action: "relink" });
  });

  // Row 7: refuse rather than move a staff row off a real login.
  it("refuses to abandon an account somebody has actually used", () => {
    const used = plan({ newEmailOwnerId: "other-user", linkedUser: linked({ activationCodeUsed: true }) });
    expect(used.action).toBe("refuse");

    const loggedIn = plan({ newEmailOwnerId: "other-user", linkedUser: linked({ lastLoginAt: new Date() }) });
    expect(loggedIn.action).toBe("refuse");

    const selfSignedUp = plan({ newEmailOwnerId: "other-user", linkedUser: linked({ createdByInvitation: false }) });
    expect(selfSignedUp.action).toBe("refuse");

    const activeMember = plan({ newEmailOwnerId: "other-user", linkedMemberStatus: "active" });
    expect(activeMember.action).toBe("refuse");

    // Belongs to a second business, so it is not ours to discard.
    const multiOrg = plan({ newEmailOwnerId: "other-user", linkedOrgCount: 2 });
    expect(multiOrg.action).toBe("refuse");
  });

  // Row 8: the cross-business hijack rail. Without this, a manager at business
  // A could repoint the login of somebody who also works at business B.
  it("refuses to touch a login that reaches beyond this business", () => {
    expect(plan({ linkedOrgCount: 2 }).action).toBe("refuse");
    expect(plan({ linkedIsOwner: true }).action).toBe("refuse");
    expect(plan({ linkedIsRequester: true }).action).toBe("refuse");
    // ...and that holds for an already-activated account too, so the rail
    // cannot be stepped around by activating first.
    expect(plan({ linkedOrgCount: 2, linkedMemberStatus: "active" }).action).toBe("refuse");
  });

  it("gives every refusal something the manager can act on", () => {
    for (const input of [{ linkedOrgCount: 2 }, { linkedIsOwner: true }, { newEmailOwnerId: "o", linkedUser: linked({ lastLoginAt: new Date() }) }]) {
      const result = plan(input as Partial<EmailChangePlanInput>);
      expect(result.action).toBe("refuse");
      if (result.action === "refuse") {
        expect(result.message.length).toBeGreaterThan(20);
        expect(result.reason).toBeTruthy();
      }
    }
  });
});
