import { describe, it, expect } from "vitest";
import { LIMITS, LIMIT_TYPES, isLimitType, limitScopeNote } from "./limits";
import { FEATURES, duplicateLimitTiers, REGISTRY_LIMIT_TIERS } from "./features";
import { CAPS, CAP_ORDER } from "./thresholds";

/**
 * Guards the "add a cap in one place" rule: every cap named in shared/limits.ts has its unlimited add-on in the feature
 * registry with the same free limit, and nothing in the registry or the threshold planner refers to a cap that
 * is not named here.
 */
describe("limit registry", () => {
  it("has an unlimited add-on in the feature registry for every cap, with matching free limit", () => {
    for (const type of LIMIT_TYPES) {
      const meta = LIMITS[type];
      const def = FEATURES.find((f) => f.key === meta.unlimitedFeatureKey);
      expect(def, `${type}: ${meta.unlimitedFeatureKey} is not in the feature registry`).toBeDefined();
      expect(def!.tier, type).toBe("paid_metered_limit");
      expect(def!.limitType, type).toBe(type);
      expect(def!.tierCapacity, `${type}: the unlimited add-on must have no tierCapacity`).toBeUndefined();
      expect(def!.freeLimit, `${type}: free limit drifted from LIMITS.defaultFree`).toBe(meta.defaultFree);
    }
  });

  it("names every capped feature's cap", () => {
    for (const f of FEATURES) {
      if (f.tier !== "paid_metered_limit") continue;
      expect(isLimitType(f.limitType), `${f.key} has limitType ${String(f.limitType)}`).toBe(true);
    }
    expect(duplicateLimitTiers(REGISTRY_LIMIT_TIERS)).toEqual([]);
  });

  it("gives the threshold planner every cap, with distinct key prefixes", () => {
    expect([...CAP_ORDER]).toEqual([...LIMIT_TYPES]);
    const prefixes = new Set<string>();
    for (const type of LIMIT_TYPES) {
      expect(CAPS[type].describe(7), type).toContain("7");
      prefixes.add(CAPS[type].keyPrefix);
    }
    expect(prefixes.size).toBe(LIMIT_TYPES.length);
  });

  it("scopes only staff seats per store", () => {
    expect(LIMIT_TYPES.filter((t) => LIMITS[t].perStore)).toEqual(["staff_seats"]);
    expect(limitScopeNote("staff_seats")).toMatch(/per store/);
    expect(limitScopeNote("store_count")).toBe("");
  });
});
