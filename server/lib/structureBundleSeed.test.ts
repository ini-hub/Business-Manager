import { describe, it, expect } from "vitest";
import { resolveSeedBundle, STRUCTURE_BUNDLE_SPECS } from "./structureBundleSeed";
import type { CatalogEntry } from "@shared/bundles";

const e = (key: string, over: Partial<CatalogEntry> = {}): CatalogEntry =>
  ({ key, name: key, isActive: true, tierType: "paid_flat", dependsOn: [], ...over });

describe("resolveSeedBundle", () => {
  it("keeps sold features and reports why the rest were left out", () => {
    const r = resolveSeedBundle(["a", "free", "off", "gone", "kid"], [
      e("a"), e("free", { tierType: "free" }), e("off", { isActive: false }), e("kid", { tierType: "bundle_child" }),
    ]);
    expect(r.featureKeys).toEqual(["a"]);
    expect(r.problems).toEqual([]);
    expect(Object.fromEntries(r.skipped.map((s) => [s.key, s.reason]))).toMatchObject({
      free: expect.stringContaining("not sold on its own"),
      off: expect.stringContaining("inactive"),
      gone: expect.stringContaining("not in the feature catalog"),
      kid: expect.stringContaining("not sold on its own"),
    });
  });

  it("adds sold dependencies, not free ones", () => {
    const r = resolveSeedBundle(["a"], [e("a", { dependsOn: ["dep", "base"] }), e("dep"), e("base", { tierType: "free" })]);
    expect(r.featureKeys.sort()).toEqual(["a", "dep"]);
    expect(r.addedAsDependency).toEqual(["dep"]);
    expect(r.problems).toEqual([]);
  });

  it("drops a member whose sold dependency is inactive instead of writing an unbuyable bundle", () => {
    const r = resolveSeedBundle(["a", "b"], [e("a", { dependsOn: ["dep"] }), e("b"), e("dep", { isActive: false })]);
    expect(r.featureKeys).toEqual(["b"]);
    expect(r.skipped.find((s) => s.key === "a")?.reason).toContain("inactive");
    expect(r.problems).toEqual([]);
  });

  it("reports a problem when nothing is sold", () => {
    expect(resolveSeedBundle(["x"], []).problems).toHaveLength(1);
  });

  it("defines exactly one bundle per business structure", () => {
    expect(STRUCTURE_BUNDLE_SPECS.map((s) => s.structure).sort()).toEqual(["multi_store", "solo", "with_staff"]);
  });
});
