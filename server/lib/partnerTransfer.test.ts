import { describe, it, expect } from "vitest";
import {
  nextStatus, PartnerRuleError, sideOf, transferValue, receiveOutcome, planObligation,
  canChangeSettlement, obligationStatus, maxSettleable, unreconciledQty, partnerBalance, awaiting,
} from "./partnerTransfer";

describe("nextStatus", () => {
  it("walks the happy path with the right party at each step", () => {
    expect(nextStatus("accept", "offered", "receiver")).toBe("accepted");
    expect(nextStatus("ship", "accepted", "sender")).toBe("shipped");
    expect(nextStatus("receive", "shipped", "receiver")).toBe("received");
    expect(nextStatus("close", "received", "sender")).toBe("closed");
  });

  it("stops the wrong party acting", () => {
    expect(() => nextStatus("accept", "offered", "sender")).toThrow(PartnerRuleError);
    expect(() => nextStatus("ship", "accepted", "receiver")).toThrow(PartnerRuleError);
  });

  it("stops actions from the wrong state, e.g. cancelling after shipping", () => {
    expect(() => nextStatus("cancel", "shipped", "sender")).toThrow(PartnerRuleError);
    expect(() => nextStatus("ship", "offered", "sender")).toThrow(PartnerRuleError);
  });
});

describe("nextStatus for a request", () => {
  it("is answered by the supplier, not the requester", () => {
    expect(nextStatus("accept", "requested", "sender", "request")).toBe("accepted");
    expect(nextStatus("reject", "requested", "sender", "request")).toBe("rejected");
    expect(() => nextStatus("accept", "requested", "receiver", "request")).toThrow(PartnerRuleError);
  });

  it("lets the requester withdraw only until the supplier takes it on", () => {
    expect(nextStatus("cancel", "requested", "receiver", "request")).toBe("cancelled");
    expect(() => nextStatus("cancel", "accepted", "receiver", "request")).toThrow(PartnerRuleError);
    expect(nextStatus("cancel", "accepted", "sender", "request")).toBe("cancelled");
  });

  it("runs the same as a send once accepted", () => {
    expect(nextStatus("ship", "accepted", "sender", "request")).toBe("shipped");
    expect(nextStatus("receive", "shipped", "receiver", "request")).toBe("received");
  });

  it("does not let a send be answered by its own sender", () => {
    expect(() => nextStatus("accept", "offered", "sender", "send")).toThrow(PartnerRuleError);
    expect(() => nextStatus("accept", "requested", "sender", "send")).toThrow(PartnerRuleError);
  });
});

describe("awaiting", () => {
  it("says whose turn it is", () => {
    expect(awaiting("offered", "send")).toBe("receiver");
    expect(awaiting("requested", "request")).toBe("sender");
    expect(awaiting("shipped", "send")).toBe("receiver");
    expect(awaiting("closed", "send")).toBeNull();
  });
});

describe("sideOf", () => {
  const t = { fromOrgId: "a", toOrgId: "b" };
  it("identifies parties and rejects outsiders", () => {
    expect(sideOf("a", t)).toBe("sender");
    expect(sideOf("b", t)).toBe("receiver");
    expect(sideOf("c", t)).toBeNull();
  });
});

describe("transferValue", () => {
  const lines = [
    { quantity: 10, confirmedQuantity: 8, unitCostSnapshot: 100, agreedUnitPrice: 120 },
    { quantity: 5, confirmedQuantity: 5, unitCostSnapshot: 40, agreedUnitPrice: null },
  ];
  it("prices offered quantity at agreed price, falling back to sender cost", () => {
    expect(transferValue(lines, "offered")).toBe(10 * 120 + 5 * 40);
  });
  it("prices only what was confirmed once received", () => {
    expect(transferValue(lines, "confirmed")).toBe(8 * 120 + 5 * 40);
  });
  it("treats unconfirmed lines as zero", () => {
    expect(transferValue([{ quantity: 3, unitCostSnapshot: 10 }], "confirmed")).toBe(0);
  });
});

describe("receiveOutcome", () => {
  it("is received when everything arrived", () => {
    expect(receiveOutcome([{ id: "1", quantity: 5, confirmed: 5 }])).toEqual({ status: "received", shortfall: [] });
  });
  it("is disputed with the shortfall when something is missing", () => {
    expect(receiveOutcome([{ id: "1", quantity: 5, confirmed: 3 }, { id: "2", quantity: 2, confirmed: 2 }]))
      .toEqual({ status: "disputed", shortfall: [{ id: "1", quantity: 2 }] });
  });
  it("refuses over-receipt and negatives", () => {
    expect(() => receiveOutcome([{ id: "1", quantity: 5, confirmed: 6 }])).toThrow(PartnerRuleError);
    expect(() => receiveOutcome([{ id: "1", quantity: 5, confirmed: -1 }])).toThrow(PartnerRuleError);
  });
  it("handles fractional quantities without float drift", () => {
    expect(receiveOutcome([{ id: "1", quantity: 0.3, confirmed: 0.1 + 0.2 }]).status).toBe("received");
  });
});

describe("planObligation", () => {
  const lines = [{ quantity: 4, confirmedQuantity: 4, unitCostSnapshot: 50, agreedUnitPrice: 75 }];
  it("creates nothing while the settlement is undecided", () => {
    expect(planObligation("none", lines)).toBeNull();
  });
  it("is money for payable and goods for return in kind, at confirmed value", () => {
    expect(planObligation("payable", lines)).toEqual({ kind: "money", amountDue: 300 });
    expect(planObligation("return_in_kind", lines)).toEqual({ kind: "goods", amountDue: 300 });
  });
  it("creates nothing when nothing was received", () => {
    expect(planObligation("payable", [{ quantity: 4, confirmedQuantity: 0, unitCostSnapshot: 50 }])).toBeNull();
  });
});

describe("settlement rules", () => {
  it("allows changing terms only from none or before any settlement", () => {
    expect(canChangeSettlement("none", 0)).toBe(true);
    expect(canChangeSettlement("payable", 0)).toBe(true);
    expect(canChangeSettlement("payable", 100)).toBe(false);
  });
  it("settles at or above the amount due, and never goes negative on what is left", () => {
    expect(obligationStatus(300, 299.99)).toBe("open");
    expect(obligationStatus(300, 300)).toBe("settled");
    expect(obligationStatus(300, 0, true)).toBe("waived");
    expect(maxSettleable(300, 120.5)).toBe(179.5);
    expect(maxSettleable(300, 400)).toBe(0);
  });
});

describe("reconciliation", () => {
  it("is zero when every shipped unit is received, in transit, or recorded as shortfall", () => {
    expect(unreconciledQty({ shipped: 10, received: 6, inTransit: 2, shortfall: 2 })).toBe(0);
  });
  it("exposes units that vanished", () => {
    expect(unreconciledQty({ shipped: 10, received: 6, inTransit: 2, shortfall: 1 })).toBe(1);
  });
});

describe("partnerBalance", () => {
  const obs = [
    { creditorOrgId: "me", debtorOrgId: "p", amountDue: 500, amountSettled: 200, status: "open" },
    { creditorOrgId: "p", debtorOrgId: "me", amountDue: 120, amountSettled: 0, status: "open" },
    { creditorOrgId: "p", debtorOrgId: "me", amountDue: 999, amountSettled: 999, status: "settled" },
  ];
  it("nets what they owe me against what I owe them, ignoring closed obligations", () => {
    expect(partnerBalance("me", obs)).toBe(180);
    expect(partnerBalance("p", obs)).toBe(-180);
  });
});
