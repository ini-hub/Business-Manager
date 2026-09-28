import { describe, it, expect } from "vitest";
import { pickOptedInCustomerIds, type OptInEvent } from "./whatsappOptIn";

const at = (isoMinutesAgo: number) => new Date(Date.now() - isoMinutesAgo * 60_000);

describe("pickOptedInCustomerIds", () => {
  it("includes a customer whose latest event is opt_in", () => {
    const events: OptInEvent[] = [{ customerId: "c1", event: "opt_in", createdAt: at(5) }];
    expect(pickOptedInCustomerIds(["c1"], events)).toEqual(["c1"]);
  });

  it("excludes a customer whose latest event is opt_out", () => {
    const events: OptInEvent[] = [{ customerId: "c1", event: "opt_out", createdAt: at(5) }];
    expect(pickOptedInCustomerIds(["c1"], events)).toEqual([]);
  });

  it("excludes a customer with no opt-in event at all", () => {
    expect(pickOptedInCustomerIds(["c1"], [])).toEqual([]);
  });

  // The most important case: a customer who opted in, then later opted out,
  // must not be re-included just because an opt_in row still exists in history.
  it("uses the most recent event when a customer has opted in then out", () => {
    const events: OptInEvent[] = [
      { customerId: "c1", event: "opt_out", createdAt: at(1) }, // newest
      { customerId: "c1", event: "opt_in", createdAt: at(10) }, // oldest
    ];
    expect(pickOptedInCustomerIds(["c1"], events)).toEqual([]);
  });

  // And the reverse: opted out, then re-subscribed (START) later.
  it("re-includes a customer who opted out then back in", () => {
    const events: OptInEvent[] = [
      { customerId: "c1", event: "opt_in", createdAt: at(1) }, // newest
      { customerId: "c1", event: "opt_out", createdAt: at(10) }, // oldest
    ];
    expect(pickOptedInCustomerIds(["c1"], events)).toEqual(["c1"]);
  });

  it("filters a mixed batch, preserving the input order of survivors", () => {
    const events: OptInEvent[] = [
      { customerId: "c1", event: "opt_in", createdAt: at(1) },
      { customerId: "c2", event: "opt_out", createdAt: at(1) },
      { customerId: "c3", event: "opt_in", createdAt: at(1) },
    ];
    expect(pickOptedInCustomerIds(["c1", "c2", "c3"], events)).toEqual(["c1", "c3"]);
  });

  it("returns nothing for an empty customer list", () => {
    expect(pickOptedInCustomerIds([], [])).toEqual([]);
  });
});
