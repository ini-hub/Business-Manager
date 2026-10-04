import { describe, it, expect, vi, beforeEach } from "vitest";

let business: { staffOwnTransactionsOnly: boolean } | undefined;
const staffByStore: Record<string, string> = {};
vi.mock("../storage", () => ({
  storage: {
    getBusinessById: vi.fn(async () => business),
    getStaffByUserId: vi.fn(async (_userId: string, storeId: string) => (staffByStore[storeId] ? { id: staffByStore[storeId] } : undefined)),
  },
}));

let customRoleHasCustomers = false;
vi.mock("./permissions", () => ({ hasModulePermission: vi.fn(async () => customRoleHasCustomers) }));

import {
  canViewCustomerSpend, checkoutInScope, filterToScope, requireCustomerSpendAccess, resolveTransactionScope,
} from "./transactionAccess";

beforeEach(() => {
  business = { staffOwnTransactionsOnly: true };
  for (const k of Object.keys(staffByStore)) delete staffByStore[k];
  customRoleHasCustomers = false;
});

describe("canViewCustomerSpend", () => {
  it("allows owner and manager", async () => {
    expect(await canViewCustomerSpend({ role: "owner" })).toBe(true);
    expect(await canViewCustomerSpend({ role: "manager" })).toBe(true);
  });

  it("denies the built-in staff role even though it holds the Customers module", async () => {
    customRoleHasCustomers = true;
    expect(await canViewCustomerSpend({ role: "staff" })).toBe(false);
  });

  it("allows a custom role only when it holds the Customers module", async () => {
    customRoleHasCustomers = true;
    expect(await canViewCustomerSpend({ role: "supervisor", businessId: "b1" })).toBe(true);
    customRoleHasCustomers = false;
    expect(await canViewCustomerSpend({ role: "supervisor", businessId: "b1" })).toBe(false);
  });

  it("denies a missing user or role", async () => {
    expect(await canViewCustomerSpend(undefined)).toBe(false);
    expect(await canViewCustomerSpend({})).toBe(false);
  });
});

describe("requireCustomerSpendAccess", () => {
  function run(user: unknown) {
    const res: any = { statusCode: 200, body: undefined };
    res.status = (c: number) => { res.statusCode = c; return res; };
    res.json = (b: unknown) => { res.body = b; return res; };
    const next = vi.fn();
    return requireCustomerSpendAccess({ user } as any, res, next).then(() => ({ res, next }));
  }

  it("returns 403 for staff and calls next for a manager", async () => {
    const denied = await run({ role: "staff" });
    expect(denied.res.statusCode).toBe(403);
    expect(denied.next).not.toHaveBeenCalled();

    const allowed = await run({ role: "manager" });
    expect(allowed.next).toHaveBeenCalledOnce();
  });
});

describe("checkoutInScope", () => {
  const ids = new Set(["s1"]);
  it("matches processor, lead, assisting and merged-receipt staff", () => {
    expect(checkoutInScope({ staffId: "s1" }, ids)).toBe(true);
    expect(checkoutInScope({ staffId: "x", leadStaffId: "s1" }, ids)).toBe(true);
    expect(checkoutInScope({ staffId: "x", assistingStaff2Id: "s1" }, ids)).toBe(true);
    expect(checkoutInScope({ staffId: "x", serviceStaffIds: ["y", "s1"] }, ids)).toBe(true);
  });

  it("does not match someone else's checkout, a missing checkout, or an empty scope", () => {
    expect(checkoutInScope({ staffId: "x", leadStaffId: "y" }, ids)).toBe(false);
    expect(checkoutInScope(null, ids)).toBe(false);
    expect(checkoutInScope({ staffId: "s1" }, new Set())).toBe(false);
  });
});

describe("resolveTransactionScope", () => {
  it("is unrestricted for owner and manager", async () => {
    expect(await resolveTransactionScope({ role: "owner", businessId: "b1" }, ["st1"])).toBeNull();
    expect(await resolveTransactionScope({ role: "manager", businessId: "b1" }, ["st1"])).toBeNull();
  });

  it("scopes staff to their own staff ids across stores", async () => {
    staffByStore.st1 = "s1";
    staffByStore.st2 = "s2";
    const scope = await resolveTransactionScope({ id: "u1", role: "staff", businessId: "b1" }, ["st1", "st2", "st3"]);
    expect(Array.from(scope!).sort()).toEqual(["s1", "s2"]);
  });

  it("scopes custom roles too", async () => {
    staffByStore.st1 = "s1";
    const scope = await resolveTransactionScope({ id: "u1", role: "supervisor", businessId: "b1" }, ["st1"]);
    expect(Array.from(scope!)).toEqual(["s1"]);
  });

  it("is unrestricted when the business turned the setting off", async () => {
    business = { staffOwnTransactionsOnly: false };
    expect(await resolveTransactionScope({ id: "u1", role: "staff", businessId: "b1" }, ["st1"])).toBeNull();
  });

  it("fails closed: no staff record or no user id means seeing nothing", async () => {
    expect((await resolveTransactionScope({ id: "u1", role: "staff", businessId: "b1" }, ["st1"]))!.size).toBe(0);
    staffByStore.st1 = "s1";
    expect((await resolveTransactionScope({ role: "staff", businessId: "b1" }, ["st1"]))!.size).toBe(0);
  });

  it("keeps the restriction on when the business row is missing", async () => {
    business = undefined;
    staffByStore.st1 = "s1";
    expect(Array.from((await resolveTransactionScope({ id: "u1", role: "staff", businessId: "b1" }, ["st1"]))!)).toEqual(["s1"]);
  });
});

describe("filterToScope", () => {
  const txs = [{ id: "a", checkout: { staffId: "s1" } }, { id: "b", checkout: { staffId: "s2" } }];
  it("keeps everything when unrestricted and only own rows otherwise", () => {
    expect(filterToScope(txs, null)).toHaveLength(2);
    expect(filterToScope(txs, new Set(["s1"])).map((t) => t.id)).toEqual(["a"]);
    expect(filterToScope(txs, new Set())).toEqual([]);
  });
});
