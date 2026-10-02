import { describe, it, expect, vi } from "vitest";

vi.mock("../storage", () => ({
  storage: {
    getStore: async (id: string) => ({ id, businessId: "biz1" }),
    getOrganisationMember: async () => ({ id: "m1" }),
    getStaffByUserId: async (_u: string, storeId?: string) =>
      !storeId || storeId === "storeA" ? { id: "s1", storeId: "storeA" } : undefined,
  },
}));
vi.mock("../websocket", () => ({ broadcastDataChange: () => {} }));

import { BaseController } from "./BaseController";

class Probe extends BaseController {
  register() {}
  check(storeId: string, req: any, res: any) {
    return this.checkStoreAccess(storeId, req, res);
  }
}

function mockRes() {
  const res: any = { code: 0, status(c: number) { res.code = c; return res; }, json() { return res; } };
  return res;
}

describe("BaseController.checkStoreAccess", () => {
  const staffReq = { user: { userId: "u1", id: "u1", role: "staff", businessId: "biz1" } };
  const ownerReq = { user: { userId: "u2", id: "u2", role: "owner", businessId: "biz1" } };

  it("denies staff on a store they are not assigned to", async () => {
    const res = mockRes();
    expect(await new Probe().check("storeB", staffReq, res)).toBe(false);
    expect(res.code).toBe(403);
  });

  it("allows staff on their assigned store", async () => {
    expect(await new Probe().check("storeA", staffReq, mockRes())).toBe(true);
  });

  it("still allows owners on any store in their business", async () => {
    expect(await new Probe().check("storeB", ownerReq, mockRes())).toBe(true);
  });
});
