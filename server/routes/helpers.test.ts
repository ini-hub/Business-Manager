import { describe, it, expect, vi, beforeEach } from "vitest";

const getPayrollPeriods = vi.fn();
const calculatePayrollForPeriod = vi.fn();

vi.mock("../storage", () => ({
  storage: {
    getPayrollPeriods: (...a: unknown[]) => getPayrollPeriods(...a),
    calculatePayrollForPeriod: (...a: unknown[]) => calculatePayrollForPeriod(...a),
  },
}));
vi.mock("../websocket", () => ({ broadcastDataChange: vi.fn() }));

import { triggerAutoRecalculate } from "./helpers";

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
