import { describe, it, expect } from "vitest";
import { diffStructure } from "./featureSync";
import type { FeatureDef } from "@shared/features";

const def: FeatureDef = {
  key: "store_addon", name: "Additional Store / Branch", description: "Each store beyond the first free one.",
  module: "Settings", category: "business_settings", tier: "paid_metered_limit", freeLimit: 1, limitType: "store_count",
  price: { monthly: 5000, annual: 50000 }, active: true, sortOrder: 250,
};

const row = {
  name: def.name, description: def.description, category: def.category, tierType: "paid_metered_limit",
  freeLimit: 1, limitType: "store_count", sortOrder: 250, permissionModule: "Settings",
};

describe("diffStructure", () => {
  it("reports nothing when the row already matches the registry", () => {
    expect(diffStructure(def, row)).toEqual([]);
  });

  it("flags the tier/limit drift that migration 0083 had to repair by hand", () => {
    expect(diffStructure(def, { ...row, tierType: "paid_flat", freeLimit: null, limitType: null }).sort())
      .toEqual(["freeLimit", "limitType", "tierType"]);
  });

  it("treats an absent optional limit as null", () => {
    const free: FeatureDef = { ...def, tier: "free", freeLimit: undefined, limitType: undefined };
    expect(diffStructure(free, { ...row, tierType: "free", freeLimit: null, limitType: null })).toEqual([]);
  });
});
