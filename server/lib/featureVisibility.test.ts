import { describe, it, expect } from "vitest";
import { computeDisabledKeys, explainVisibility, type VisibilityRow } from "./featureVisibility";

const row = (id: string, key: string, isActive = true, parentFeatureId: string | null = null): VisibilityRow => ({ id, key, isActive, parentFeatureId });

describe("computeDisabledKeys", () => {
  it("hides flag-off and inactive features, and children of hidden parents", () => {
    const catalog = [row("1", "parent"), row("2", "child", true, "1"), row("3", "inactive", false), row("4", "other")];
    expect([...computeDisabledKeys(catalog, new Set(["parent"]))].sort()).toEqual(["child", "inactive", "parent"]);
  });
});

describe("explainVisibility", () => {
  const parent = row("1", "stores_management");
  const child = row("2", "store_pack_3", false, "1");
  const catalog = [parent, child];

  it("explains a pending feature whose flag is off", () => {
    const r = explainVisibility({ feature: child, catalog, flagStatusByKey: new Map([["store_pack_3", "off"]]), scopedCount: 0 });
    expect(r.status).toBe("hidden");
    expect(r.checks.map((c) => [c.id, c.result])).toEqual([["active", "blocks"], ["flag", "blocks"], ["parent", "pass"], ["dependencies", "pass"]]);
    expect(r.checks[2].detail).toBe("stores_management is visible");
  });

  it("blames the parent when the parent is hidden", () => {
    const active = { ...child, isActive: true };
    const r = explainVisibility({ feature: active, catalog: [parent, active], flagStatusByKey: new Map([["stores_management", "off"]]), scopedCount: 0 });
    expect(r.status).toBe("hidden");
    expect(r.checks.find((c) => c.id === "parent")).toMatchObject({ result: "blocks", detail: "stores_management is hidden" });
  });

  it("reports scoped as visible to the listed businesses only", () => {
    const live = row("3", "x");
    const r = explainVisibility({ feature: live, catalog: [live], flagStatusByKey: new Map([["x", "scoped"]]), scopedCount: 2 });
    expect(r.status).toBe("scoped");
    expect(r.checks[1]).toMatchObject({ result: "note", detail: "Scoped to 2 businesses" });
  });

  it("treats a missing flag and legacy by_plan as On", () => {
    const live = row("3", "x");
    expect(explainVisibility({ feature: live, catalog: [live], flagStatusByKey: new Map(), scopedCount: 0 }).status).toBe("visible");
    expect(explainVisibility({ feature: live, catalog: [live], flagStatusByKey: new Map([["x", "by_plan"]]), scopedCount: 0 }).status).toBe("visible");
  });
});
