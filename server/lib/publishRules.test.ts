import { describe, it, expect } from "vitest";
import { grandfatherApplies, isAdminThreshold, sunsetDateProblem, sunsetTierProblem } from "./publishRules";

describe("grandfatherApplies", () => {
  it("needs the registry flag and a priced tier", () => {
    expect(grandfatherApplies({ grandfather: true }, "paid_flat")).toBe(true);
    expect(grandfatherApplies({ grandfather: true }, "paid_metered_limit")).toBe(true);
    expect(grandfatherApplies({ grandfather: true }, "free")).toBe(false);
    expect(grandfatherApplies({ grandfather: true }, "bundle_child")).toBe(false);
    expect(grandfatherApplies({ grandfather: false }, "paid_flat")).toBe(false);
    expect(grandfatherApplies(undefined, "paid_flat")).toBe(false);
  });
});

describe("sunset rules", () => {
  const now = new Date("2026-10-09T10:00:00Z");

  it("rejects free and in-bundle features", () => {
    expect(sunsetTierProblem("free")).toMatch(/priced/);
    expect(sunsetTierProblem("bundle_child")).toMatch(/priced/);
    expect(sunsetTierProblem("paid_flat")).toBeNull();
  });

  it("requires a real date at least 30 days out", () => {
    expect(sunsetDateProblem(undefined, now).error).toMatch(/required/);
    expect(sunsetDateProblem("nope", now).error).toMatch(/valid date/);
    expect(sunsetDateProblem("2026-11-01", now).error).toMatch(/30 days/);
    const ok = sunsetDateProblem("2026-12-31", now);
    expect(ok.error).toBeNull();
    expect(ok.date?.toISOString().slice(0, 10)).toBe("2026-12-31");
  });
});

describe("isAdminThreshold", () => {
  it("is a capped tier with a limit type and a capacity", () => {
    expect(isAdminThreshold({ tierType: "paid_metered_limit", limitType: "store_count", tierCapacity: 5 })).toBe(true);
    expect(isAdminThreshold({ tierType: "paid_metered_limit", limitType: "store_count", tierCapacity: null })).toBe(false);
    expect(isAdminThreshold({ tierType: "paid_metered_limit", limitType: null, tierCapacity: 5 })).toBe(false);
    expect(isAdminThreshold({ tierType: "paid_flat", limitType: "store_count", tierCapacity: 5 })).toBe(false);
  });
});
