import { describe, it, expect } from "vitest";
import { buildFeatureTree, filterFeatureTree, subtreeKeys, type TreeInput } from "./featureTree";
import { FEATURES, type FeatureDef } from "./features";

const f = (key: string, section: string | null, groupParent: string | null, sortOrder: number): TreeInput => ({ key, section, groupParent, sortOrder });

describe("buildFeatureTree", () => {
  it("nests children under their parent, sorted, grouped by section", () => {
    const tree = buildFeatureTree([
      f("b_child", "management", "a", 3), f("a", "management", null, 1), f("a_child", "management", "a", 2), f("s", "sales", null, 9),
    ]);
    expect(tree.map((s) => [s.section, s.count])).toEqual([["management", 3], ["sales", 1]]);
    expect(tree[0].roots[0].children.map((c) => c.item.key)).toEqual(["a_child", "b_child"]);
  });

  it("keeps a cross-section child under its parent", () => {
    const tree = buildFeatureTree([f("credit", "sales", null, 1), f("reminders", "settings_store", "credit", 2)]);
    expect(tree.map((s) => s.section)).toEqual(["sales"]);
    expect(tree[0].count).toBe(2);
  });

  it("never drops a feature: missing parents, cycles and unknown sections surface as roots", () => {
    const tree = buildFeatureTree([f("x", "management", "nope", 1), f("c1", "sales", "c2", 2), f("c2", "sales", "c1", 3), f("z", null, null, 4)]);
    const keys = tree.flatMap((s) => s.roots.flatMap(subtreeKeys));
    expect(keys.sort()).toEqual(["c1", "c2", "x", "z"]);
    expect(tree.at(-1)?.section).toBe("other");
  });

  it("places every real registry feature exactly once", () => {
    const items = (FEATURES as readonly FeatureDef[]).map((d) => f(d.key, d.section, d.groupParent ?? null, d.sortOrder));
    const keys = buildFeatureTree(items).flatMap((s) => s.roots.flatMap(subtreeKeys));
    expect(keys.length).toBe(items.length);
    expect(new Set(keys).size).toBe(items.length);
  });
});

describe("filterFeatureTree", () => {
  const tree = buildFeatureTree([f("a", "management", null, 1), f("a1", "management", "a", 2), f("a2", "management", "a", 3), f("b", "sales", null, 4)]);

  it("keeps matching nodes with their ancestors", () => {
    const out = filterFeatureTree(tree, (i) => i.key === "a2");
    expect(out.flatMap((s) => s.roots.flatMap(subtreeKeys))).toEqual(["a", "a2"]);
  });

  it("keeps the whole subtree of a matching parent and drops empty sections", () => {
    const out = filterFeatureTree(tree, (i) => i.key === "a");
    expect(out.map((s) => s.section)).toEqual(["management"]);
    expect(out[0].count).toBe(3);
  });
});
