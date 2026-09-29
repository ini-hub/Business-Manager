import { describe, it, expect, vi } from "vitest";

// entitlements.ts imports the pg-backed db at module load; the parts under test
// (CountLimitError, sendPlanLimitError) are pure, so stub the db out.
vi.mock("../db", () => ({ db: {}, pool: {} }));

import { CountLimitError, sendPlanLimitError } from "./entitlements";

function fakeRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (body: unknown) => { res.body = body; return res; };
  return res;
}

describe("CountLimitError", () => {
  it("carries the 402 body the client keys off", () => {
    const err = new CountLimitError("staff_seats", 1, 1);
    expect(err.toBody()).toEqual({
      error: "count_limit_reached",
      limitType: "staff_seats",
      limit: 1,
      used: 1,
      featureKey: "staff_seats_addon",
      message: "You're on the free tier of 1 staff member. Add the staff member add-on to add more.",
    });
  });

  it("explains bulk imports that would overshoot the cap", () => {
    const err = new CountLimitError("customer_count", 50, 40, 25);
    expect(err.message).toBe("Importing 25 customers would exceed your free-tier limit of 50 (40 in use). Add the customer add-on to import more.");
    expect(err.featureKey).toBe("customer_capacity_addon");
  });
});

describe("sendPlanLimitError", () => {
  it("maps CountLimitError to a 402 and reports it handled", () => {
    const res = fakeRes();
    expect(sendPlanLimitError(res, new CountLimitError("store_count", 1, 1))).toBe(true);
    expect(res.statusCode).toBe(402);
    expect(res.body.error).toBe("count_limit_reached");
    expect(res.body.featureKey).toBe("store_addon");
  });

  it("leaves every other error for the caller's own handling", () => {
    const res = fakeRes();
    expect(sendPlanLimitError(res, new Error("boom"))).toBe(false);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBeUndefined();
  });
});
