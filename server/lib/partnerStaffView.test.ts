import { describe, it, expect } from "vitest";
import { staffListRow, staffDetail, staffDetailWithoutMoneyEvents } from "./partnerStaffView";

const detail = {
  id: "t1", kind: "send", side: "receiver", status: "shipped", createdAt: "2026-01-01", fromOrgName: "A", toOrgName: "B",
  fromStoreName: "A main", toStoreName: "B main", fromStoreId: "s1", toStoreId: "s2", fromOrgId: "o1", toOrgId: "o2", notes: "Fragile",
  agreedTotal: 480, settlementType: "payable", proposedSettlementType: "payable", dueDate: "2026-02-01", idempotencyKey: "k",
  obligation: { id: "ob", amountDue: 480 }, settlements: [{ id: "s", amount: 100 }], partnershipId: "p", createdByUserId: "u",
  items: [{ id: "i1", name: "Widget", sku: "W1", unit: "pc", quantity: 4, confirmedQuantity: null, unitPrice: 120, agreedUnitPrice: 120, unitCostSnapshot: 61, fromInventoryId: "inv", toInventoryId: "inv2", shortfallReason: null, shortfallNote: null }],
  events: [
    { id: "e1", event: "offered", createdAt: "x", orgId: "o1", detail: { agreedTotal: 480, settlementType: "payable" } },
    { id: "e2", event: "settlement_claimed", createdAt: "y", orgId: "o2", detail: { amount: 100 } },
  ],
};

describe("what staff see", () => {
  it("keeps the logistics: who, what, how many, and how it is going", () => {
    const d = staffDetail(detail);
    expect(d).toMatchObject({ id: "t1", status: "shipped", side: "receiver", fromStoreName: "A main", notes: "Fragile" });
    expect(d.items[0]).toEqual({ id: "i1", name: "Widget", sku: "W1", unit: "pc", quantity: 4, confirmedQuantity: null, shortfallReason: null, shortfallNote: null });
  });

  it("never includes a price, a total, terms, a balance or a payment", () => {
    const json = JSON.stringify(staffDetail(detail));
    for (const secret of ["480", "agreedTotal", "settlementType", "dueDate", "obligation", "settlements", "unitPrice", "unitCostSnapshot", "61", "120", "payable", "idempotencyKey", "partnershipId"]) {
      expect(json, secret).not.toContain(secret);
    }
  });

  it("drops the amounts recorded inside timeline events", () => {
    for (const e of staffDetail(detail).events) expect(e).not.toHaveProperty("detail");
  });

  it("can also hide the money events themselves", () => {
    const events = staffDetailWithoutMoneyEvents(detail).events.map((e: any) => e.event);
    expect(events).toEqual(["offered"]);
  });

  it("is an allow-list, so a field added later stays hidden", () => {
    expect(staffDetail({ ...detail, brandNewField: "surprise" })).not.toHaveProperty("brandNewField");
    expect(staffListRow({ ...detail, brandNewField: "surprise" })).not.toHaveProperty("brandNewField");
  });

  it("trims list rows the same way", () => {
    const row = staffListRow(detail);
    expect(row).toMatchObject({ id: "t1", status: "shipped" });
    expect(row).not.toHaveProperty("agreedTotal");
    expect(row).not.toHaveProperty("obligation");
  });
});
