import { describe, it, expect } from "vitest";
import { formatHistory, type HistoryEntry } from "./historyFormat";

const entry = (action: string, details: any, extra: Partial<HistoryEntry> = {}): HistoryEntry => ({ id: "1", action, adminEmail: "a@x.com", createdAt: "2026-10-09T10:00:00Z", details, ...extra });

describe("formatHistory", () => {
  it("shows rollout before and after with the scope size", () => {
    expect(formatHistory(entry("toggle_feature_flag", { before: { status: "on" }, status: "scoped", scopedOrgIds: ["a", "b"] }))).toEqual({ title: "Rollout changed", detail: "on → scoped (2 businesses)" });
  });

  it("falls back to the new status when there is no before (older entries)", () => {
    expect(formatHistory(entry("toggle_feature_flag", { status: "off" })).detail).toBe("off");
  });

  it("shows only the price and sales fields that changed", () => {
    const line = formatHistory(entry("update_feature_catalog_pricing", { before: { priceMonthly: 2500, priceAnnual: 25000 }, changed: { priceMonthly: 3000 } }));
    expect(line.detail).toBe("monthly 2,500 → 3,000");
  });

  it("reads old pricing entries, where after was only the patch", () => {
    const line = formatHistory(entry("update_feature_catalog_pricing", { before: { priceMonthly: 100 }, after: { priceMonthly: 200, isActive: false } }));
    expect(line.detail).toBe("monthly 100 → 200, sold to businesses: off");
  });

  it("names the business and reason on a revoke", () => {
    expect(formatHistory(entry("admin_revoke_feature", { organisationId: "o1", reason: "Chargeback" }, { organisationName: "Arewa" }))).toEqual({ title: "Revoked from a business", detail: "Arewa: Chargeback" });
  });

  it("humanises an action it does not know", () => {
    expect(formatHistory(entry("some_new_action", null)).title).toBe("Some new action");
  });
});
