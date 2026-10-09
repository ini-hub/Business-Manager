import { describe, it, expect, vi, beforeEach } from "vitest";

const getPayrollPeriods = vi.fn();
const calculatePayrollForPeriod = vi.fn();
const getUser = vi.fn();
const getStores = vi.fn();
const getStaffByUserId = vi.fn();

vi.mock("../storage", () => ({
  storage: {
    getPayrollPeriods: (...a: unknown[]) => getPayrollPeriods(...a),
    calculatePayrollForPeriod: (...a: unknown[]) => calculatePayrollForPeriod(...a),
    getUser: (...a: unknown[]) => getUser(...a),
    getStores: (...a: unknown[]) => getStores(...a),
    getStaffByUserId: (...a: unknown[]) => getStaffByUserId(...a),
  },
}));
vi.mock("../websocket", () => ({ broadcastDataChange: vi.fn() }));

import { triggerAutoRecalculate, resolveAccessibleStoreIds } from "./helpers";

const pending = { id: "p1", status: "pending", startDate: "2026-10-01", endDate: "2026-10-31" };

describe("triggerAutoRecalculate", () => {
  beforeEach(() => {
    getPayrollPeriods.mockReset();
    calculatePayrollForPeriod.mockReset();
    getPayrollPeriods.mockResolvedValue([pending]);
  });

  it("collapses a burst of requests into one run plus a single follow-up", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    calculatePayrollForPeriod.mockImplementationOnce(() => gate).mockResolvedValue(undefined);

    const first = triggerAutoRecalculate("s1", "2026-10-08");
    // Ten more sales land while the first recalculation is still running.
    const rest = Array.from({ length: 10 }, () => triggerAutoRecalculate("s1", "2026-10-08"));
    release();
    await Promise.all([first, ...rest]);

    expect(calculatePayrollForPeriod).toHaveBeenCalledTimes(2);
  });

  it("runs independently per store and date", async () => {
    await Promise.all([
      triggerAutoRecalculate("s1", "2026-10-08"),
      triggerAutoRecalculate("s2", "2026-10-08"),
      triggerAutoRecalculate("s1", "2026-10-09"),
    ]);
    expect(calculatePayrollForPeriod).toHaveBeenCalledTimes(3);
  });

  it("does nothing when no pending period covers the date", async () => {
    await triggerAutoRecalculate("s1", "2027-01-01");
    expect(calculatePayrollForPeriod).not.toHaveBeenCalled();
  });

  it("allows a fresh run once the previous one has finished, and survives a failing run", async () => {
    calculatePayrollForPeriod.mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined);
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await triggerAutoRecalculate("s1", "2026-10-08");
    await triggerAutoRecalculate("s1", "2026-10-08");
    expect(calculatePayrollForPeriod).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});

describe("resolveAccessibleStoreIds", () => {
  const request = (user: Record<string, unknown>) => ({ user }) as any;

  beforeEach(() => {
    getUser.mockReset();
    getStores.mockReset();
    getStaffByUserId.mockReset();
    getUser.mockResolvedValue({ id: "u1", businessId: "b1" });
    getStores.mockResolvedValue([{ id: "s1" }, { id: "s2" }, { id: "s3" }]);
  });

  it("looks the user and their stores up once per request, however many tiles ask", async () => {
    const req = request({ id: "u1", role: "owner", businessId: "b1" });
    const results = await Promise.all(Array.from({ length: 12 }, () => resolveAccessibleStoreIds(req, ["s1", "s9"])));
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(getStores).toHaveBeenCalledTimes(1);
    for (const r of results) expect(r).toEqual({ storeIds: ["s1"], dropped: ["s9"] });
  });

  it("returns every accessible store when none are asked for, and keeps requests separate", async () => {
    const first = await resolveAccessibleStoreIds(request({ id: "u1", role: "manager", businessId: "b1" }));
    expect(first).toEqual({ storeIds: ["s1", "s2", "s3"], dropped: [] });
    getStores.mockResolvedValue([{ id: "s1" }]);
    const second = await resolveAccessibleStoreIds(request({ id: "u1", role: "manager", businessId: "b1" }));
    expect(second.storeIds).toEqual(["s1"]); // a new request re-reads (the short cache is off under test)
  });

  it("pins staff to their own store and never reuses another staff member's answer", async () => {
    getStaffByUserId.mockResolvedValue({ storeId: "s2" });
    const staffReq = request({ id: "u1", role: "staff", businessId: "b1" });
    expect((await resolveAccessibleStoreIds(staffReq)).storeIds).toEqual(["s2"]);
    getStaffByUserId.mockResolvedValue(undefined);
    expect((await resolveAccessibleStoreIds(request({ id: "u1", role: "staff", businessId: "b1" }))).storeIds).toEqual([]);
  });
});
