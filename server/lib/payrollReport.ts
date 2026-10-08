import { splitPeriod } from "@shared/payroll-take-home";

interface ReportPeriod {
  id: string;
  periodType: string;
  startDate: string;
  endDate: string;
  status: string;
  paidAt: Date | null;
}
interface ReportEntry { periodId: string; staffId: string; grossCommission: number | null; totalTransport: number | null; netPay: number | null }
interface ReportDeduction { periodId: string; staffId: string; amount: number | string }

/**
 * One row per payroll period for the payroll report: head count, commission, transport, deductions, gross and
 * take-home. Takes every period's people and deductions already loaded (two queries for the whole store), and
 * groups them here. Per-period maths is unchanged: take-home is floored per person (splitPeriod), so it is not
 * net pay minus deductions - one person's surplus cannot absorb another's shortfall.
 *
 * Entries should arrive highest net pay first, as the per-period read returned them, so totals accumulate in
 * the same order.
 */
export function buildPayrollReport(periods: ReportPeriod[], entries: ReportEntry[], deductions: ReportDeduction[]) {
  const entriesByPeriod = new Map<string, ReportEntry[]>();
  for (const e of entries) {
    const list = entriesByPeriod.get(e.periodId);
    if (list) list.push(e); else entriesByPeriod.set(e.periodId, [e]);
  }
  const deductionsByPeriod = new Map<string, ReportDeduction[]>();
  for (const d of deductions) {
    const list = deductionsByPeriod.get(d.periodId);
    if (list) list.push(d); else deductionsByPeriod.set(d.periodId, [d]);
  }

  return periods.map((p) => {
    const periodEntries = entriesByPeriod.get(p.id) ?? [];
    const totalGross = periodEntries.reduce((s, e) => s + (e.grossCommission || 0), 0);
    const totalTransport = periodEntries.reduce((s, e) => s + (e.totalTransport || 0), 0);
    const { totalGross: totalNet, totalDeductions, totalTakeHome, totalShortfall } =
      splitPeriod(periodEntries, deductionsByPeriod.get(p.id) ?? []);
    return {
      id: p.id, periodType: p.periodType, startDate: p.startDate, endDate: p.endDate,
      status: p.status, staffCount: periodEntries.length,
      totalGrossCommission: totalGross, totalTransport, totalDeductions,
      totalNetPay: totalNet, totalTakeHome, totalShortfall, paidAt: p.paidAt,
    };
  });
}
