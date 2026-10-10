import { describe, it, expect } from "vitest";
import {
  policyFromBusiness, maskCustomer, maskDocumentContacts, isPhoneLikeQuery,
  stripMaskedValues, maskFigureBody, maskContactBody, FIGURE_RULES, MASK_TEXT,
} from "./dataMasking";

const biz = { maskContactRoles: ["staff", "cashier"], maskFiguresRoles: ["staff"] };

describe("policyFromBusiness", () => {
  it("never masks owner or manager", () => {
    expect(policyFromBusiness({ role: "owner" }, biz)).toEqual({ contact: false, figures: false });
    expect(policyFromBusiness({ role: "manager" }, biz)).toEqual({ contact: false, figures: false });
  });
  it("masks per listed role", () => {
    expect(policyFromBusiness({ role: "staff" }, biz)).toEqual({ contact: true, figures: true });
    expect(policyFromBusiness({ role: "cashier" }, biz)).toEqual({ contact: true, figures: false });
    expect(policyFromBusiness({ role: "supervisor" }, biz)).toEqual({ contact: false, figures: false });
  });
  it("masks nothing by default (empty lists) and fails closed with no business", () => {
    expect(policyFromBusiness({ role: "staff" }, { maskContactRoles: [], maskFiguresRoles: [] })).toEqual({ contact: false, figures: false });
    expect(policyFromBusiness({ role: "staff" }, undefined)).toEqual({ contact: true, figures: true });
  });
});

describe("contact masking", () => {
  it("masks customer phone and address but keeps name and id", () => {
    const out = maskCustomer({ id: "c1", name: "Ada", mobileNumber: "0803", address: "1 Road" });
    expect(out).toEqual({ id: "c1", name: "Ada", mobileNumber: MASK_TEXT, address: MASK_TEXT });
  });
  it("masks customer and staff rows embedded in a receipt", () => {
    const out: any = maskDocumentContacts({
      customer: { mobileNumber: "1" }, leadStaff: { email: "a@b.c" },
      items: [{ leadStaff: { mobileNumber: "2" } }], checkout: { staff: { email: "x@y.z" } },
    });
    expect(out.customer.mobileNumber).toBe(MASK_TEXT);
    expect(out.leadStaff.email).toBe(MASK_TEXT);
    expect(out.items[0].leadStaff.mobileNumber).toBe(MASK_TEXT);
    expect(out.checkout.staff.email).toBe(MASK_TEXT);
  });
  it("detects phone-like searches and strips placeholders from writes", () => {
    expect(isPhoneLikeQuery("0803")).toBe(true);
    expect(isPhoneLikeQuery("Ada")).toBe(false);
    expect(stripMaskedValues({ name: "Ada", phone: MASK_TEXT })).toEqual({ name: "Ada" });
  });
});

describe("figure masking", () => {
  const rule = (path: string) => FIGURE_RULES.find((r) => r.pattern.test(path))!;
  it("zeroes only the named dashboard figures", () => {
    const out: any = maskFigureBody({ totalRevenue: 5, totalCustomers: 3, revenueMix: { services: 1, products: 2 } }, rule("/dashboard/stats"));
    expect(out).toEqual({ totalRevenue: 0, totalCustomers: 3, revenueMix: { services: 0, products: 0 } });
  });
  it("zeroes every number but keeps pagination and strings", () => {
    const out: any = maskFigureBody({ data: [{ id: "a", amount: 9 }], pagination: { total: 4 } }, rule("/credit/ledger"));
    expect(out).toEqual({ data: [{ id: "a", amount: 0 }], pagination: { total: 4 } });
  });
  it("zeroes cost price but leaves selling price", () => {
    const out: any = maskFigureBody([{ costPrice: 5, sellingPrice: 9 }], rule("/inventory"));
    expect(out).toEqual([{ costPrice: 0, sellingPrice: 9 }]);
  });
});

describe("maskContactBody", () => {
  it("masks embedded customer/vendor/staff rows at any depth and leaves other addresses alone", () => {
    const out: any = maskContactBody({
      data: [{ id: "b1", address: "Store road", customer: { name: "Ada", mobileNumber: "080" }, leadStaff: { email: "a@b.c" } }],
      vendor: { name: "V", phone: "1", email: "v@x.y" },
      topOwing: [{ name: "Z", phone: "9" }],
    });
    expect(out.data[0].address).toBe("Store road");
    expect(out.data[0].customer).toEqual({ name: "Ada", mobileNumber: MASK_TEXT });
    expect(out.data[0].leadStaff.email).toBe(MASK_TEXT);
    expect(out.vendor).toEqual({ name: "V", phone: MASK_TEXT, email: MASK_TEXT });
    expect(out.topOwing[0].phone).toBe(MASK_TEXT);
  });
});
