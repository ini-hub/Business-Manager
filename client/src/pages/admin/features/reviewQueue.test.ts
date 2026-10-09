import { describe, it, expect } from "vitest";
import { missingForPublish, missingSentence, toPublishPayload, type QueueItem } from "./reviewQueue";

const item = (over: Partial<QueueItem>): QueueItem => ({
  id: "1", name: "Stores: up to 3", tier: "paid_metered_limit", included: true, monthly: "", gatePending: true, gateChecked: false, ...over,
});

describe("missingForPublish", () => {
  it("lists prices before gate confirmations, matching the footer", () => {
    const m = missingForPublish([item({ id: "1", name: "A" }), item({ id: "2", name: "B", monthly: "4000" })]);
    expect(m).toEqual(["price A", "confirm gating for A", "confirm gating for B"]);
    expect(missingSentence(m)).toBe("To publish, price A, confirm gating for A, confirm gating for B.");
  });

  it("ignores excluded items and free or in-bundle ones", () => {
    expect(missingForPublish([item({ included: false })])).toEqual([]);
    expect(missingForPublish([item({ tier: "bundle_child", gatePending: false })])).toEqual([]);
  });

  it("is empty when everything is ready", () => {
    expect(missingForPublish([item({ monthly: "2500", gateChecked: true })])).toEqual([]);
    expect(missingSentence([])).toBe("");
  });

  it("rejects a negative or non-numeric price", () => {
    expect(missingForPublish([item({ monthly: "-1", gatePending: false })])).toEqual(["price Stores: up to 3"]);
    expect(missingForPublish([item({ monthly: "abc", gatePending: false })])).toEqual(["price Stores: up to 3"]);
  });
});

describe("toPublishPayload", () => {
  it("sends only included items with numeric prices and the gate confirmation", () => {
    const payload = toPublishPayload([
      { ...item({ monthly: "2500", gateChecked: true }), annual: "" },
      { ...item({ id: "2", included: false }), annual: "" },
      { ...item({ id: "3", tier: "bundle_child", gatePending: false }), annual: "" },
    ]);
    expect(payload).toEqual([
      { id: "1", priceMonthly: 2500, priceAnnual: null, gateConfirmed: true },
      { id: "3", priceMonthly: null, priceAnnual: null, gateConfirmed: true },
    ]);
  });
});
