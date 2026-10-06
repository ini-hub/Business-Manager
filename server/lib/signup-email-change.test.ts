import { describe, it, expect } from "vitest";
import { checkSignupEmailChange } from "./signup-email-change";

const unverified = { email: "a@x.com", isEmailVerified: false, createdByInvitation: false, managerEmailChangedAt: null };

describe("checkSignupEmailChange", () => {
  it("allows an unverified owner signup to change email", () => {
    expect(checkSignupEmailChange(unverified, "a@x.com", "b@x.com")).toBe("ok");
    expect(checkSignupEmailChange(unverified, "A@x.com", "b@x.com")).toBe("ok");
  });
  it("rejects the same address", () => {
    expect(checkSignupEmailChange(unverified, "a@x.com", "A@X.com")).toBe("same_email");
  });
  it("is not available for verified, invited or manager-repointed accounts", () => {
    expect(checkSignupEmailChange({ ...unverified, isEmailVerified: true }, "a@x.com", "b@x.com")).toBe("not_eligible");
    expect(checkSignupEmailChange({ ...unverified, createdByInvitation: true }, "a@x.com", "b@x.com")).toBe("not_eligible");
    expect(checkSignupEmailChange({ ...unverified, managerEmailChangedAt: new Date() }, "a@x.com", "b@x.com")).toBe("not_eligible");
  });
  it("is not available when the account is missing or the current email does not match", () => {
    expect(checkSignupEmailChange(null, "a@x.com", "b@x.com")).toBe("not_eligible");
    expect(checkSignupEmailChange(unverified, "other@x.com", "b@x.com")).toBe("not_eligible");
  });
});
