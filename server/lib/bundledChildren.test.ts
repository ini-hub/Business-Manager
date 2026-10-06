import { describe, it, expect, vi } from "vitest";

vi.mock("../db", () => ({ db: {} }));

import { computePurchasedGrant, resolveFeaturePrice } from "./entitlements";
import type { FeatureCatalog } from "@shared/schema";

const row = (id: string, key: string, over: Partial<FeatureCatalog> = {}): FeatureCatalog =>
  ({
    id, key, name: key, description: null, category: "x", tierType: "paid_flat", priceMonthly: null, priceAnnual: null, currency: "NGN",
    parentFeatureId: null, freeLimit: null, limitType: null, tierCapacity: null, flagId: "f", permissionModule: null, section: null,
    groupParentFeatureId: null, isActive: true, sortOrder: 0, createdAt: new Date(), updatedAt: new Date(), ...over,
  }) as FeatureCatalog;

// Store packs: unlimited carries the transfers as children; the smaller packs carry them through the shared limit.
const unlimited = row("u", "store_addon", { tierType: "paid_metered_limit", limitType: "store_count", freeLimit: 1, priceMonthly: 5000 as any });
const pack3 = row("p3", "store_pack_3", { tierType: "paid_metered_limit", limitType: "store_count", freeLimit: 1, tierCapacity: 3, priceMonthly: 2500 as any });
const pack10 = row("p10", "store_pack_10", { tierType: "paid_metered_limit", limitType: "store_count", freeLimit: 1, tierCapacity: 10, priceMonthly: 4000 as any });
const stock = row("st", "stock_transfer", { tierType: "bundle_child", parentFeatureId: "u" });
const staffMove = row("sf", "staff_transfer", { tierType: "bundle_child", parentFeatureId: "u" });
const seats = row("s5", "staff_seats_5", { tierType: "paid_metered_limit", limitType: "staff_seats", freeLimit: 2, tierCapacity: 5 });
const catalog = [unlimited, pack3, pack10, stock, staffMove, seats];
const held = (...ids: string[]) => ids.map((featureId) => ({ featureId, status: "active", removalEffectiveAt: null }));

describe("children carried by a capped add-on", () => {
  it("grants the transfers with the unlimited add-on", () => {
    const g = computePurchasedGrant(catalog, held("u"), new Set());
    expect(g.has("stock_transfer")).toBe(true);
    expect(g.has("staff_transfer")).toBe(true);
  });

  it("grants them with any smaller pack of the same limit too", () => {
    for (const id of ["p3", "p10"]) {
      const g = computePurchasedGrant(catalog, held(id), new Set());
      expect(g.has("stock_transfer"), id).toBe(true);
      expect(g.has("staff_transfer"), id).toBe(true);
    }
  });

  it("does not grant them to a pack of a different limit, or to nobody", () => {
    expect(computePurchasedGrant(catalog, held("s5"), new Set()).has("stock_transfer")).toBe(false);
    expect(computePurchasedGrant(catalog, [], new Set()).has("stock_transfer")).toBe(false);
  });

  it("lets the kill-switch beat the grant", () => {
    expect(computePurchasedGrant(catalog, held("u"), new Set(["stock_transfer"])).has("stock_transfer")).toBe(false);
  });
});

describe("quoting a bundled child", () => {
  it("quotes the cheapest pack that includes it", () => {
    const price = resolveFeaturePrice(stock, catalog);
    expect(price.monthly).toBe(2500);
    expect(price.viaFeatureKey).toBe("store_pack_3");
  });

  it("ignores inactive or unpriced packs", () => {
    const cheaperOff = catalog.map((r) => (r.key === "store_pack_3" ? { ...r, isActive: false } : r));
    expect(resolveFeaturePrice(stock, cheaperOff).viaFeatureKey).toBe("store_pack_10");
  });

  it("still quotes the parent for an ordinary bundle child", () => {
    const bundle = row("b", "purchase_management", { tierType: "bundle_parent", priceMonthly: 4500 as any });
    const child = row("c", "vendor_details", { tierType: "bundle_child", parentFeatureId: "b" });
    const price = resolveFeaturePrice(child, [bundle, child]);
    expect(price.monthly).toBe(4500);
    expect(price.viaFeatureKey).toBe("purchase_management");
  });
});
