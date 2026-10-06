import { describe, it, expect } from "vitest";
import { getOrgLifecycle } from "./trial";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-10-05T12:00:00Z");
const at = (days: number) => new Date(now.getTime() + days * DAY);

describe("getOrgLifecycle", () => {
  it("is trialing inside the trial window", () => {
    expect(getOrgLifecycle({ status: "trialing", trialEndsAt: at(3) }, 7, now).state).toBe("trialing");
  });

  it("gives 7 days of grace after the trial ends, then soft-locks", () => {
    const grace = getOrgLifecycle({ status: "trialing", trialEndsAt: at(-2) }, 7, now);
    expect(grace.state).toBe("grace");
    expect(grace.graceEndsAt?.toISOString()).toBe(at(5).toISOString());
    expect(getOrgLifecycle({ status: "trialing", trialEndsAt: at(-8) }, 7, now).state).toBe("soft_locked");
  });

  it("honours the configured grace length", () => {
    expect(getOrgLifecycle({ status: "trialing", trialEndsAt: at(-8) }, 14, now).state).toBe("grace");
    expect(getOrgLifecycle({ status: "trialing", trialEndsAt: at(-1) }, 0, now).state).toBe("soft_locked");
  });

  it("uses graceEndsAt for a failed renewal (no suspension)", () => {
    expect(getOrgLifecycle({ status: "active", trialEndsAt: null, graceEndsAt: at(4) }, 7, now).state).toBe("grace");
    expect(getOrgLifecycle({ status: "active", trialEndsAt: null, graceEndsAt: at(-1) }, 7, now).state).toBe("soft_locked");
  });

  it("leaves grandfathered orgs alone and keeps admin suspension separate", () => {
    expect(getOrgLifecycle({ status: "active", trialEndsAt: null }, 7, now).state).toBe("ok");
    expect(getOrgLifecycle({ status: "suspended", trialEndsAt: null }, 7, now).state).toBe("suspended");
  });
});
