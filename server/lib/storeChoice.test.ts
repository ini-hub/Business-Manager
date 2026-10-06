import { describe, it, expect } from "vitest";
import { planStoreChoice } from "./storeChoice";

const stores = [
  { id: "a", isMain: true },
  { id: "b", isMain: false },
  { id: "c", isMain: false },
];

describe("planStoreChoice", () => {
  it("archives the stores that are not kept and leaves main alone when it is kept", () => {
    expect(planStoreChoice(stores, ["a"], 1)).toEqual({ ok: true, archiveIds: ["b", "c"], newMainId: null });
    expect(planStoreChoice(stores, ["a", "c"], 2)).toEqual({ ok: true, archiveIds: ["b"], newMainId: null });
  });

  it("hands main to a kept store when the main store is not kept", () => {
    expect(planStoreChoice(stores, ["b"], 1)).toEqual({ ok: true, archiveIds: ["a", "c"], newMainId: "b" });
  });

  it("rejects picks that don't fit the plan", () => {
    expect(planStoreChoice(stores, [], 1)).toMatchObject({ ok: false, error: "Keep at least one store." });
    expect(planStoreChoice(stores, ["a", "b"], 1)).toMatchObject({ ok: false, error: expect.stringContaining("up to 1") });
    expect(planStoreChoice(stores, ["zzz"], 1)).toMatchObject({ ok: false, error: expect.stringContaining("currently active") });
  });

  it("does nothing when everything already fits", () => {
    expect(planStoreChoice(stores, ["a"], 3)).toMatchObject({ ok: false });
    expect(planStoreChoice([stores[0]], ["a"], 1)).toMatchObject({ ok: false });
  });

  it("ignores duplicate ids", () => {
    expect(planStoreChoice(stores, ["a", "a"], 1)).toEqual({ ok: true, archiveIds: ["b", "c"], newMainId: null });
  });
});
