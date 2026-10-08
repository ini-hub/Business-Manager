import { describe, it, expect } from "vitest";
import { buildPayrollReport } from "./payrollReport";
import { splitPeriod } from "@shared/payroll-take-home";

const period = (id: string, status = "paid") => ({ id, periodType: "monthly", startDate: "2026-01-01", endDate: "2026-01-31", status, paidAt: null });

describe("buildPayrollReport", () => {
  it("reproduces the per-period calculation for every period, grouping the store's rows", () => {
    const periods = [period("p1"), period("p2", "pending"), period("p3", "approved")];
    const entries = [
      { periodId: "p1", staffId: "a", grossCommission: 60000, totalTransport: 5000, netPay: 65000 },
      { periodId: "p2", staffId: "a", grossCommission: 10000, totalTransport: 0, netPay: 10000 },
      { periodId: "p1", staffId: "b", grossCommission: 20000, totalTransport: 1000, netPay: 21000 },
      { periodId: "p1", staffId: "c", grossCommission: 0, totalTransport: 0, netPay: null },
    ];
    // Staff b owes more than they earned (a shortfall that must not be offset by a's surplus).
    const deductions = [
      { periodId: "p1", staffId: "b", amount: "30000" },
      { periodId: "p1", staffId: "a", amount: 5000 },
      { periodId: "p2", staffId: "a", amount: 2500 },
    ];
    const got = buildPayrollReport(periods, entries, deductions);

    for (const p of periods) {
      const own = entries.filter((e) => e.periodId === p.id);
      const want = splitPeriod(own, deductions.filter((d) => d.periodId === p.id));
      const row = got.find((r) => r.id === p.id)!;
      expect(row.staffCount).toBe(own.length);
      expect(row.totalGrossCommission).toBe(own.reduce((s, e) => s + (e.grossCommission || 0), 0));
      expect(row.totalTransport).toBe(own.reduce((s, e) => s + (e.totalTransport || 0), 0));
      expect(row.totalNetPay).toBe(want.totalGross);
      expect(row.totalDeductions).toBe(want.totalDeductions);
      expect(row.totalTakeHome).toBe(want.totalTakeHome);
      expect(row.totalShortfall).toBe(want.totalShortfall);
    }
    // p1: a takes home 60000, b is short 9000 (earned 21000, owes 30000), so take-home is not net minus deductions.
    const p1 = got[0];
    expect(p1.totalShortfall).toBe(9000);
    expect(p1.totalTakeHome).toBe(60000);
  });

  it("keeps empty periods and the input order", () => {
    const got = buildPayrollReport([period("x"), period("y")], [], []);
    expect(got.map((r) => r.id)).toEqual(["x", "y"]);
    expect(got.every((r) => r.staffCount === 0 && r.totalTakeHome === 0)).toBe(true);
  });
});
