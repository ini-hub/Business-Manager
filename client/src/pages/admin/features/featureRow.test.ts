import { describe, it, expect } from "vitest";
import { toFeatureRows, tileCounts, filterRows, priceLabel, rolloutOf } from "./featureRow";

const catalog = [
  { id: "1", key: "customer_insights", name: "Customer Insights", tierType: "paid_flat", priceMonthly: "2500", currency: "NGN", isActive: true, reviewStatus: "published" },
  { id: "2", key: "store_pack_3", name: "Stores: up to 3", tierType: "paid_metered_limit", priceMonthly: null, currency: "NGN", isActive: false, reviewStatus: "pending_review", freeLimit: 1 },
  { id: "3", key: "edit_store", name: "Edit Store", tierType: "free", isActive: false, reviewStatus: "published" },
  { id: "4", key: "vendor_details", name: "Vendors", tierType: "bundle_child", isActive: true, reviewStatus: "published" },
];
const flags = [
  { name: "customer_insights", status: "scoped", scopedOrgIds: JSON.stringify(["a", "b"]) },
  { name: "store_pack_3", status: "off" },
  { name: "edit_store", status: "by_plan" },
];

describe("featureRow", () => {
  const rows = toFeatureRows(catalog, flags);

  it("derives state from review status and activity", () => {
    expect(rows.map((r) => r.state)).toEqual(["live", "needs_review", "inactive", "live"]);
  });

  it("derives rollout, treating by_plan and a missing flag as On", () => {
    expect(rows.map((r) => r.rollout)).toEqual(["scoped", "off", "on", "on"]);
    expect(rolloutOf("by_plan")).toBe("on");
  });

  it("counts scoped orgs from a JSON string or an array", () => {
    expect(rows[0].scopedCount).toBe(2);
    const arr = toFeatureRows([catalog[0]], [{ name: "customer_insights", status: "scoped", scopedOrgIds: ["x"] }]);
    expect(arr[0].scopedCount).toBe(1);
    const bad = toFeatureRows([catalog[0]], [{ name: "customer_insights", status: "scoped", scopedOrgIds: "not json" }]);
    expect(bad[0].scopedCount).toBe(0);
  });

  it("counts tiles", () => {
    expect(tileCounts(rows)).toMatchObject({ all: 4, live: 2, needs_review: 1, inactive: 1, scoped: 1 });
  });

  it("filters by tile, tier, rollout and text together", () => {
    const base = { q: "", tile: "all", section: "all", tier: "all", rollout: "all" } as const;
    expect(filterRows(rows, { ...base, tile: "needs_review" }).map((r) => r.key)).toEqual(["store_pack_3"]);
    expect(filterRows(rows, { ...base, tier: "free" }).map((r) => r.key)).toEqual(["edit_store"]);
    expect(filterRows(rows, { ...base, rollout: "scoped" }).map((r) => r.key)).toEqual(["customer_insights"]);
    expect(filterRows(rows, { ...base, q: " STORE " }).map((r) => r.key)).toEqual(["store_pack_3", "edit_store"]);
  });

  it("labels prices by tier", () => {
    expect(rows.map(priceLabel)).toEqual(["₦2,500/mo", "Not priced yet", "No charge", "Priced with its bundle"]);
  });
});
