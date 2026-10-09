import { describe, it, expect } from "vitest";
import { planThreshold, priceWarning, type LadderStep } from "./thresholds";

const step = (key: string, name: string, capacity: number | null, priceMonthly: number | null): LadderStep => ({ key, name, capacity, priceMonthly, state: "live" });
const ladder = [
  step("store_pack_3", "Stores: up to 3", 3, 2500),
  step("store_pack_10", "Stores: up to 10", 10, 4000),
  step("store_addon", "Additional Store / Branch", null, 5000),
];
const base = { cap: "store_count" as const, freeLimit: 1, ladder, existingKeys: new Set(ladder.map((s) => s.key)) };

describe("planThreshold", () => {
  it("names the key, name and description from the cap", () => {
    const p = planThreshold({ ...base, limit: 5 });
    expect(p.problems).toEqual([]);
    expect(p.key).toBe("store_pack_5");
    expect(p.name).toBe("Stores: up to 5");
    expect(p.description).toMatch(/Up to 5 stores in total/);
  });

  it("finds the neighbours, falling back to the unlimited add-on above the top", () => {
    const mid = planThreshold({ ...base, limit: 5 });
    expect([mid.below?.key, mid.above?.key]).toEqual(["store_pack_3", "store_pack_10"]);
    const top = planThreshold({ ...base, limit: 20 });
    expect([top.below?.key, top.above?.key]).toEqual(["store_pack_10", "store_addon"]);
  });

  it("refuses a limit that is too small, not above the free cap, or already offered", () => {
    expect(planThreshold({ ...base, limit: 1 }).problems[0]).toMatch(/2 or more/);
    expect(planThreshold({ ...base, freeLimit: 4, limit: 3 }).problems.join(" ")).toMatch(/above the free cap of 4/);
    expect(planThreshold({ ...base, limit: 3 }).problems[0]).toMatch(/"Stores: up to 3" already offers a limit of 3/);
    expect(planThreshold({ ...base, limit: 2.5 }).problems[0]).toMatch(/whole number/);
  });

  it("refuses a key that is already used by a different capacity", () => {
    const p = planThreshold({ ...base, limit: 7, existingKeys: new Set([...base.existingKeys, "store_pack_7"]) });
    expect(p.problems[0]).toMatch(/already taken/);
  });
});

describe("priceWarning", () => {
  const [a, b] = ladder;
  it("warns only when outside the neighbours", () => {
    expect(priceWarning(3000, a, b)).toBeNull();
    expect(priceWarning(2000, a, b)).toMatch(/Cheaper than Stores: up to 3/);
    expect(priceWarning(4500, a, b)).toMatch(/Dearer than Stores: up to 10/);
    expect(priceWarning(null, a, b)).toBeNull();
    expect(priceWarning(100, null, null)).toBeNull();
  });
});
