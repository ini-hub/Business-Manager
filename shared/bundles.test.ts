import { describe, it, expect } from "vitest";
import { priceSelection, priceIncrement, validateBundleSelection, deriveBullets, slugifyBundleKey, bundleForCycle, replaceChildrenWithParents, type CatalogEntry } from "./bundles";

const entry = (key: string, over: Partial<CatalogEntry> = {}): CatalogEntry => ({ key, name: key.toUpperCase(), isActive: true, tierType: "paid_flat", dependsOn: [], ...over });

describe("validateBundleSelection", () => {
  const catalog = [
    entry("a"),
    entry("b", { dependsOn: ["a"] }),
    entry("free_dep", { tierType: "free" }),
    entry("c", { dependsOn: ["free_dep"] }),
    entry("off", { isActive: false }),
    entry("child", { tierType: "bundle_child" }),
    entry("parent", { tierType: "bundle_parent" }),
  ];

  it("accepts a self-sufficient set", () => {
    expect(validateBundleSelection(["a", "b", "parent"], catalog)).toEqual([]);
  });
  it("ignores free dependencies, which are always there", () => {
    expect(validateBundleSelection(["c"], catalog)).toEqual([]);
  });
  it("rejects a member whose sold dependency is missing", () => {
    expect(validateBundleSelection(["b"], catalog)).toEqual(['"B" needs "A" in the bundle too.']);
  });
  it("rejects empty, unknown, inactive, bundle-child and repeated members", () => {
    expect(validateBundleSelection([], catalog)).toHaveLength(1);
    expect(validateBundleSelection(["nope"], catalog)[0]).toMatch(/not in the feature catalog/);
    expect(validateBundleSelection(["off"], catalog)[0]).toMatch(/inactive/);
    expect(validateBundleSelection(["child"], catalog)[0]).toMatch(/not sold on its own/);
    expect(validateBundleSelection(["a", "a"], catalog)[0]).toMatch(/twice/);
  });
});

describe("deriveBullets", () => {
  const nameOf = (k: string) => k.toUpperCase();
  const small = { key: "small", name: "Small", featureKeys: ["a", "b"] };
  const big = { key: "big", name: "Big", featureKeys: ["a", "b", "c", "d"] };

  it("lists a standalone bundle's features", () => {
    expect(deriveBullets(small, [small, big], nameOf)).toEqual(["A", "B"]);
  });
  it("says 'Everything in' the largest bundle it contains, then only what is new", () => {
    expect(deriveBullets(big, [small, big], nameOf)).toEqual(["Everything in Small", "C", "D"]);
  });
  it("caps the list and says how many more", () => {
    const wide = { key: "w", name: "W", featureKeys: ["a", "b", "c", "d", "e", "f"] };
    expect(deriveBullets(wide, [wide], nameOf)).toEqual(["A", "B", "C", "D", "and 2 more"]);
  });
});

describe("slugifyBundleKey", () => {
  it("makes a url-safe slug", () => {
    expect(slugifyBundleKey("  Growth & Scale! ")).toBe("growth-scale");
    expect(slugifyBundleKey("???")).toBe("");
  });
});

describe("priceSelection", () => {
  const price = (k: string) => ({ a: 1000, b: 2000, c: 3000, x: 500 }[k] ?? 0);
  const small = { key: "small", name: "Small", featureKeys: ["a", "b"], discountPct: 10 };
  const big = { key: "big", name: "Big", featureKeys: ["a", "b", "c"], discountPct: 20 };

  it("is a plain sum when no bundle is complete", () => {
    expect(priceSelection(["a", "c"], price, [small, big])).toEqual({ subtotal: 4000, discount: 0, total: 4000, bundleKey: null });
  });

  it("discounts only the bundle's own members, not extras", () => {
    const r = priceSelection(["a", "b", "x"], price, [small, big]);
    expect(r).toEqual({ subtotal: 3500, discount: 300, total: 3200, bundleKey: "small" });
  });

  it("never stacks nested bundles - best one wins", () => {
    const r = priceSelection(["a", "b", "c"], price, [small, big]);
    expect(r.bundleKey).toBe("big");
    expect(r.discount).toBe(1200);
  });

  it("loses the discount the moment a member is removed", () => {
    expect(priceSelection(["a", "b", "c"], price, [big]).discount).toBeGreaterThan(0);
    expect(priceSelection(["a", "b"], price, [big]).discount).toBe(0);
  });

  it("ignores zero-percent bundles", () => {
    expect(priceSelection(["a", "b"], price, [{ ...small, discountPct: 0 }]).discount).toBe(0);
  });
});

describe("priceIncrement", () => {
  const price = (k: string) => ({ a: 1000, b: 2000, c: 3000 }[k] ?? 0);
  const bundle = { key: "abc", name: "ABC", featureKeys: ["a", "b", "c"], discountPct: 10 };

  it("charges list price for an add-on that completes nothing", () => {
    expect(priceIncrement([], ["a"], price, [bundle]).total).toBe(1000);
  });

  it("gives the discount to whoever completes the bundle", () => {
    const r = priceIncrement(["a", "b"], ["c"], price, [bundle]);
    // Full set is 6000 - 600 = 5400; held pair was already paid at 3000.
    expect(r.total).toBe(2400);
    expect(r.bundleKey).toBe("abc");
  });

  it("ignores features that are already held", () => {
    expect(priceIncrement(["a"], ["a"], price, [bundle]).total).toBe(0);
  });

  it("never goes negative", () => {
    expect(priceIncrement(["a", "b", "c"], [], price, [bundle]).total).toBe(0);
  });
});

describe("fixed bundle price (admin override)", () => {
  const price: Record<string, number> = { a: 1000, b: 2000, c: 3000, x: 500 };
  const priceOf = (k: string) => price[k] ?? 0;
  const solo = { key: "solo", name: "Solo", featureKeys: ["a", "b"], discountPct: 10, fixedPrice: 2000 };

  it("charges the fixed price for the members, extras at list", () => {
    const r = priceSelection(["a", "b", "x"], priceOf, [solo]);
    expect(r.total).toBe(2000 + 500);
    expect(r.discount).toBe(1000);
    expect(r.bundleKey).toBe("solo");
  });

  it("applies with a 0% discount - the fixed price alone is enough", () => {
    const r = priceSelection(["a", "b"], priceOf, [{ ...solo, discountPct: 0 }]);
    expect(r.total).toBe(2000);
  });

  it("never charges above list", () => {
    const r = priceSelection(["a", "b"], priceOf, [{ ...solo, fixedPrice: 9999 }]);
    expect(r.total).toBe(3000);
    expect(r.discount).toBe(0);
  });

  it("falls back to the percentage when no fixed price is set", () => {
    const r = priceSelection(["a", "b"], priceOf, [{ ...solo, fixedPrice: null }]);
    expect(r.total).toBe(2700);
  });

  it("does not apply until every member is held", () => {
    expect(priceSelection(["a"], priceOf, [solo]).total).toBe(1000);
  });

  it("completing the bundle charges the difference to the fixed price", () => {
    const r = priceIncrement(["a"], ["b"], priceOf, [solo]);
    expect(r.total).toBe(1000);
  });

  it("allows a free (0) fixed price", () => {
    expect(priceSelection(["a", "b"], priceOf, [{ ...solo, fixedPrice: 0 }]).total).toBe(0);
  });

  it("bundleForCycle picks the price for the cycle", () => {
    const pub = { key: "solo", name: "Solo", featureKeys: ["a", "b"], discountPct: 0, fixedPriceMonthly: 2000, fixedPriceAnnual: null, businessStructure: "solo" };
    expect(bundleForCycle(pub, "monthly").fixedPrice).toBe(2000);
    expect(bundleForCycle(pub, "annual").fixedPrice).toBeNull();
  });
});

describe("replaceChildrenWithParents", () => {
  const parentOf = new Map([["stock_transfer", "store_addon"], ["staff_transfer", "store_addon"]]);
  it("swaps a child for its parent in place and de-duplicates", () => {
    expect(replaceChildrenWithParents(["a", "stock_transfer", "store_addon", "staff_transfer", "b"], parentOf))
      .toEqual(["a", "store_addon", "b"]);
  });
  it("adds the parent when only the child was listed", () => {
    expect(replaceChildrenWithParents(["stock_transfer"], parentOf)).toEqual(["store_addon"]);
  });
  it("leaves ordinary keys alone", () => {
    expect(replaceChildrenWithParents(["a", "b"], parentOf)).toEqual(["a", "b"]);
  });
});
