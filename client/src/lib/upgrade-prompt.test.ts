import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  __resetUpgradePromptForTests, announcePlanLimit, isDuplicatePlanLimitToast,
  subscribeToPlanLimit, toPlanLimitDetails, upgradeTitle,
} from "./upgrade-prompt";

beforeEach(() => __resetUpgradePromptForTests());

describe("toPlanLimitDetails", () => {
  it("parses a feature_not_purchased 402", () => {
    expect(toPlanLimitDetails({ error: "feature_not_purchased", featureKey: "credit_sale", featureName: "Credit Sale", message: "Needs the add-on." }))
      .toEqual({ kind: "feature", message: "Needs the add-on.", featureKey: "credit_sale", featureName: "Credit Sale" });
  });

  it("parses a count_limit_reached 402", () => {
    expect(toPlanLimitDetails({ error: "count_limit_reached", limitType: "staff_seats", limit: 1, used: 1, featureKey: "staff_seats_addon", message: "Free tier of 1." }))
      .toEqual({ kind: "count", message: "Free tier of 1.", featureKey: "staff_seats_addon", limitType: "staff_seats", limit: 1, used: 1, tiered: false, trial: false });
    expect(toPlanLimitDetails({ error: "count_limit_reached", limitType: "staff_seats", limit: 5, used: 5, tiered: true, message: "Full." })?.tiered).toBe(true);
  });

  it("returns null for anything else so unrelated 402s aren't mislabelled", () => {
    expect(toPlanLimitDetails({ error: "payment_required" })).toBeNull();
    expect(toPlanLimitDetails(null)).toBeNull();
    expect(toPlanLimitDetails("nope")).toBeNull();
  });
});

describe("announcePlanLimit", () => {
  it("notifies subscribers and stops after unsubscribe", () => {
    const fn = vi.fn();
    const off = subscribeToPlanLimit(fn);
    announcePlanLimit({ kind: "feature", message: "m" });
    off();
    announcePlanLimit({ kind: "feature", message: "m2" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("flags only a matching, recent toast as a duplicate", () => {
    announcePlanLimit({ kind: "count", message: "You're on the free tier of 1 staff member per store (the owner doesn't count)." });
    expect(isDuplicatePlanLimitToast("You're on the free tier of 1 staff member per store (the owner doesn't count).")).toBe(true);
    expect(isDuplicatePlanLimitToast("Something else failed.")).toBe(false);
    expect(isDuplicatePlanLimitToast("You're on the free tier of 1 staff member per store (the owner doesn't count).", Date.now() + 10_000)).toBe(false);
  });
});

describe("upgradeTitle", () => {
  it("names the feature or the capped resource", () => {
    expect(upgradeTitle({ kind: "feature", message: "", featureName: "Credit Sale" })).toBe("Unlock Credit Sale");
    expect(upgradeTitle({ kind: "count", message: "", limitType: "store_count" })).toBe("You've reached your free stores limit");
    expect(upgradeTitle({ kind: "count", message: "", limitType: "customer_count" })).toBe("You've reached your free customers limit");
  });
});

describe("countLimitMessage", () => {
  it("names the plan, not the free tier, for a paid pack", async () => {
    const { countLimitMessage } = await import("./upgrade-prompt");
    expect(countLimitMessage("staff_seats", 5, true)).toBe("Your plan covers up to 5 staff members per store (the owner doesn't count). Move up to a bigger plan to add more.");
  });

  it("tells a trial it is a trial and to upgrade", async () => {
    const { countLimitMessage } = await import("./upgrade-prompt");
    expect(countLimitMessage("staff_seats", 2, false, true)).toBe("You're on the free trial, which includes 2 staff members per store (the owner doesn't count). Upgrade to get more.");
    expect(toPlanLimitDetails({ error: "count_limit_reached", limitType: "customer_count", limit: 30, used: 30, trial: true, message: "x" })?.trial).toBe(true);
  });

  it("matches the server's wording, singular and plural", async () => {
    const { countLimitMessage } = await import("./upgrade-prompt");
    expect(countLimitMessage("staff_seats", 1)).toBe("You're on the free tier of 1 staff member per store (the owner doesn't count). Add the staff member add-on to add more.");
    expect(countLimitMessage("customer_count", 50)).toBe("You're on the free tier of 50 customers. Add the customer add-on to add more.");
  });
});
