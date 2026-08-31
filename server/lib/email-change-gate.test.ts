import { describe, it, expect } from "vitest";
import { isManagerEmailChangePending } from "./email-change-gate";

describe("isManagerEmailChangePending", () => {
  it("gates an account whose email a manager just overwrote", () => {
    expect(isManagerEmailChangePending({ managerEmailChangedAt: new Date() })).toBe(true);
    // Timestamps arrive as strings from some query paths.
    expect(isManagerEmailChangePending({ managerEmailChangedAt: "2026-08-30T10:00:00Z" })).toBe(true);
  });

  it("leaves ordinary accounts alone", () => {
    expect(isManagerEmailChangePending({ managerEmailChangedAt: null })).toBe(false);
    expect(isManagerEmailChangePending({})).toBe(false);
  });

  // The regression this predicate exists to avoid. Gating on isEmailVerified
  // would have been the obvious shortcut and would have silently taken password
  // reset away from every legacy row that never verified its email.
  it("does not gate an unverified account that no manager has touched", () => {
    expect(isManagerEmailChangePending({
      managerEmailChangedAt: null,
      ...({ isEmailVerified: false } as any),
    })).toBe(false);
  });
});
