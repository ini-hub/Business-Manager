import { describe, it, expect } from "vitest";
import { FEATURES, launchesForReview } from "@shared/features";

describe("launchesForReview", () => {
  it("sends priced features to review and lets free and bundled ones go live", () => {
    expect(launchesForReview({ tier: "paid_flat", active: true })).toBe(true);
    expect(launchesForReview({ tier: "paid_metered_limit", active: true })).toBe(true);
    expect(launchesForReview({ tier: "bundle_parent", active: true })).toBe(true);
    expect(launchesForReview({ tier: "free", active: true })).toBe(false);
    expect(launchesForReview({ tier: "bundle_child", active: true })).toBe(false);
  });

  it("honours an explicit launch value either way", () => {
    expect(launchesForReview({ tier: "free", active: true, launch: "review" })).toBe(true);
    expect(launchesForReview({ tier: "paid_flat", active: true, launch: "live" })).toBe(false);
  });

  it("has nothing to review on a feature already declared inactive", () => {
    expect(launchesForReview({ tier: "paid_flat", active: false })).toBe(false);
  });

  it("never marks a free feature for review by default", () => {
    for (const def of FEATURES.filter((d) => d.tier === "free" && !d.launch)) expect(launchesForReview(def), def.key).toBe(false);
  });
});
