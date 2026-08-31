import { db, type DbExecutor } from "../db";
import { eq, and, gte, lte, inArray } from "drizzle-orm";
import {
  payrollPostings,
  payrollEntries,
  payrollPeriods,
  type PayrollPeriod,
  type SalaryAdvance,
} from "@shared/schema";
import { storage } from "../storage";
import { round2, splitPay, deductionsByStaff } from "@shared/payroll-take-home";

/**
 * Payroll's door into the P&L.
 *
 * Payroll cost used to have no canonical record. Every consumer re-derived it
 * from `payroll_entries` with its own status predicate and its own date
 * convention, so the P&L, the Explorer cube and the cash-flow statement each
 * gave a different answer for the same payroll run — and a run straddling a
 * month boundary was counted in full in *both* months.
 *
 * A paid period now posts a small set of immutable lines here, and consumers
 * read those. This is the same "one door into the P&L" invariant the
 * Consumables module already runs on (see SupplyCostingService) — the pattern
 * that exists to stop the same naira being counted twice.
 *
 * The accounts:
 *   wage_expense         gross earnings — the accrual figure, split across
 *                        calendar months so a straddling period lands where
 *                        it was earned
 *   cash_out             what actually left the business at settlement (net
 *                        of deductions), one row per period
 *   advance_disbursement what left the business when a salary advance was
 *                        handed out, one row per advance, periodId NULL
 *                        (disbursed before any period exists). Cash-flow
 *                        reads this alongside cash_out (getCashOut); the P&L
 *                        deliberately never reads it — an advance is a cash-
 *                        timing event, not a cost, and wage_expense already
 *                        recognises the full gross pay at settlement
 *                        regardless of any advance taken during the period.
 *   deduction:*          why wage_expense and cash_out differ, one line per
 *                        deduction type
 *
 * Per period: Σ wage_expense − Σ deduction:* + carry-forward deferral = Σ cash_out.
 * Across an advance's lifecycle: Σ advance_disbursement + Σ cash_out already
 * nets to exactly the staff member's total compensation — deduction:
 * advance_recovery is what makes that true, by reducing settlement cash_out
 * for money that already left as the disbursement.
 */

export const POSTING_ACCOUNTS = {
  wageExpense: "wage_expense",
  cashOut: "cash_out",
  /** A salary advance handed out — see the class doc above. */
  advanceDisbursement: "advance_disbursement",
  /** Deduction types are namespaced, e.g. "deduction:staff_credit". */
  deductionPrefix: "deduction:",
  /** Deductions that exceeded a staff member's pay and were carried forward. */
  carryForward: "carry_forward_deferred",
} as const;

export type PostingSlice = { effectiveDate: string; amount: number };

const MS_PER_DAY = 86_400_000;

/** Parses YYYY-MM-DD as a UTC instant, so no local timezone can shift the day. */
function utcDay(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function toIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Splits a period's cost across the calendar months it spans, by day count.
 *
 * This is the piece the old shape could not express at all. `getPaidPayrollExpenses`
 * selects periods by an overlap test and then adds the *whole* period total, so a
 * run from 31 Aug to 13 Sep was reported in full in August and again in full in
 * September. There was nowhere to put "the one day that belongs to August" —
 * here there is.
 *
 * Each slice is dated its own last day, so the cost lands inside the month that
 * earned it. Rounding remainder goes to the final slice, which keeps the slices
 * summing to exactly the total rather than drifting a kobo per month.
 */
export function splitAcrossMonths(startDate: string, endDate: string, total: number): PostingSlice[] {
  const start = utcDay(startDate);
  const end = utcDay(endDate);
  if (end < start) return [];

  const totalDays = Math.round((end - start) / MS_PER_DAY) + 1;

  // Walk month by month, clamping each month's window to the period.
  const spans: { lastDay: string; days: number }[] = [];
  let cursor = start;
  while (cursor <= end) {
    const d = new Date(cursor);
    const monthEnd = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0);
    const sliceEnd = Math.min(monthEnd, end);
    spans.push({
      lastDay: toIso(sliceEnd),
      days: Math.round((sliceEnd - cursor) / MS_PER_DAY) + 1,
    });
    cursor = sliceEnd + MS_PER_DAY;
  }

  if (spans.length === 1) return [{ effectiveDate: spans[0].lastDay, amount: round2(total) }];

  const out: PostingSlice[] = [];
  let allocated = 0;
  for (let i = 0; i < spans.length; i++) {
    const isLast = i === spans.length - 1;
    const amount = isLast
      ? round2(total - allocated)
      : round2((total * spans[i].days) / totalDays);
    allocated = round2(allocated + amount);
    out.push({ effectiveDate: spans[i].lastDay, amount });
  }
  return out;
}

export type PostingLine = {
  account: string;
  effectiveDate: string;
  amount: number;
  /** Null only for lines that genuinely belong to no one. */
  staffId: string | null;
};

/**
 * The full set of lines a period posts, as a pure function of its figures.
 *
 * Kept separate from the write so the arithmetic is unit-testable and so the
 * backfill and the live path cannot drift apart — both build lines here.
 *
 * Lines are per staff member. Netting across people would be wrong anyway:
 * take-home floors at zero individually, so one person's surplus can never
 * absorb another's shortfall.
 */
export function buildPostings(input: {
  startDate: string;
  endDate: string;
  entries: { staffId: string; netPay: number }[];
  deductions: { staffId: string; type: string; amount: number }[];
}): PostingLine[] {
  const { startDate, endDate, entries, deductions } = input;
  const lines: PostingLine[] = [];

  const deductedByStaff = deductionsByStaff(deductions);

  for (const entry of entries) {
    // `entry.netPay` is the pre-deduction figure; cash and the deferral both
    // come from the shared split so this ledger and the payroll screens can
    // never disagree about what was actually paid.
    const { grossPay, takeHomePay, shortfall } = splitPay(
      entry.netPay || 0,
      deductedByStaff.get(entry.staffId) ?? 0,
    );

    // Wage expense is gross and belongs to the months the work happened in.
    if (grossPay !== 0) {
      for (const slice of splitAcrossMonths(startDate, endDate, grossPay)) {
        if (slice.amount !== 0) {
          lines.push({
            account: POSTING_ACCOUNTS.wageExpense,
            effectiveDate: slice.effectiveDate,
            amount: slice.amount,
            staffId: entry.staffId,
          });
        }
      }
    }

    // Cash out and the deferral are settlement events: they happen when the
    // period is paid, so they carry the end date rather than being spread.
    if (takeHomePay !== 0) {
      lines.push({
        account: POSTING_ACCOUNTS.cashOut, effectiveDate: endDate, amount: takeHomePay, staffId: entry.staffId,
      });
    }

    if (shortfall !== 0) {
      lines.push({
        account: POSTING_ACCOUNTS.carryForward, effectiveDate: endDate, amount: shortfall, staffId: entry.staffId,
      });
    }
  }

  // One line per staff member per deduction type, explaining the gap between
  // that person's gross and their cash.
  const byStaffType = new Map<string, number>();
  for (const d of deductions) {
    const key = `${d.staffId}\u0000${POSTING_ACCOUNTS.deductionPrefix}${d.type}`;
    byStaffType.set(key, round2((byStaffType.get(key) ?? 0) + Number(d.amount)));
  }
  for (const [key, amount] of Array.from(byStaffType.entries())) {
    if (amount === 0) continue;
    const [staffId, account] = key.split("\u0000");
    lines.push({ account, effectiveDate: endDate, amount, staffId });
  }

  return lines;
}

/** A staff member whose lines fail the identity, and by how much. */
export type PostingImbalance = { staffId: string | null; delta: number };

/**
 * Every staff member whose lines break the identity, worst first.
 *
 * Grouped by staff rather than summed across the period, because a period-wide
 * sum cannot see the error this module exists to prevent. Take-home floors at
 * zero per person, so one member's overstated cash and another's understated
 * cash cancel to a period delta of exactly zero while both people's ledgers are
 * wrong — precisely the "one person's surplus absorbing another's shortfall"
 * that buildPostings is written to avoid. Anything a period-wide check passes
 * and this one rejects was genuinely misstated.
 *
 * Lines with no staff member are checked as their own group: buildPostings never
 * emits one, so a null here is itself an anomaly worth surfacing.
 */
export function postingsImbalances(lines: PostingLine[]): PostingImbalance[] {
  const byStaff = new Map<string | null, PostingLine[]>();
  for (const line of lines) {
    const group = byStaff.get(line.staffId);
    if (group) group.push(line);
    else byStaff.set(line.staffId, [line]);
  }

  const out: PostingImbalance[] = [];
  for (const [staffId, group] of Array.from(byStaff.entries())) {
    const sum = (pred: (l: PostingLine) => boolean) =>
      round2(group.filter(pred).reduce((s, l) => s + l.amount, 0));

    const wages = sum(l => l.account === POSTING_ACCOUNTS.wageExpense);
    const cash = sum(l => l.account === POSTING_ACCOUNTS.cashOut);
    const deductions = sum(l => l.account.startsWith(POSTING_ACCOUNTS.deductionPrefix));
    const deferred = sum(l => l.account === POSTING_ACCOUNTS.carryForward);

    const delta = round2(wages - deductions + deferred - cash);
    if (Math.abs(delta) >= 0.005) out.push({ staffId, delta });
  }

  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

/**
 * The identity every posted period must satisfy.
 *
 * gross wages, less what was withheld, plus what could not be withheld because
 * pay ran out, equals the cash that left. Asserted by the reconciliation gate
 * and the tests; a violation means the ledger is lying about a payroll run.
 *
 * Holds per staff member — see postingsImbalances. `delta` reports the worst
 * single person rather than the period net, so the figure names a gap someone
 * actually has instead of one two cancelling errors could flatter to zero.
 */
export function postingsBalance(lines: PostingLine[]): { balanced: boolean; delta: number } {
  const imbalances = postingsImbalances(lines);
  if (imbalances.length === 0) return { balanced: true, delta: 0 };
  return { balanced: false, delta: imbalances[0].delta };
}

export class PayrollPostingService {
  /**
   * Writes (or rewrites) a period's postings.
   *
   * Replaces the whole set for the period rather than patching it: a period's
   * postings are a pure function of its final figures, so recomputing is always
   * correct and makes the operation idempotent under a retried mark-paid.
   */
  async postPeriod(exec: DbExecutor, periodId: string): Promise<PostingLine[]> {
    const [period] = await exec.select().from(payrollPeriods).where(eq(payrollPeriods.id, periodId));
    if (!period) return [];

    const entries = await exec.select().from(payrollEntries).where(eq(payrollEntries.periodId, periodId));
    // Waived lines never came out of anyone's pay, so they must not appear here.
    const deductions = await storage.getPayrollDeductions(periodId);

    const lines = buildPostings({
      startDate: period.startDate,
      endDate: period.endDate,
      entries: entries.map(e => ({ staffId: e.staffId, netPay: Number(e.netPay || 0) })),
      deductions: deductions.map(d => ({ staffId: d.staffId, type: d.type, amount: Number(d.amount) })),
    });

    const imbalances = postingsImbalances(lines);
    if (imbalances.length > 0) {
      // Named per staff member: "off by 5000" across a run gives nobody a place
      // to start, and a period net can read zero while two people are wrong.
      const detail = imbalances.map(i => `${i.staffId ?? "(no staff)"} off by ${i.delta}`).join(", ");
      throw new Error(
        `Payroll postings for period ${periodId} do not balance (${detail}). ` +
        `Refusing to post a ledger that misstates the run.`
      );
    }

    await exec.delete(payrollPostings).where(eq(payrollPostings.periodId, periodId));
    if (lines.length > 0) {
      await exec.insert(payrollPostings).values(lines.map(l => ({
        periodId,
        storeId: period.storeId,
        staffId: l.staffId,
        account: l.account,
        effectiveDate: l.effectiveDate,
        amount: l.amount,
      })));
    }
    return lines;
  }

  /** Convenience wrapper for callers with no transaction of their own. */
  async postPeriodStandalone(periodId: string): Promise<PostingLine[]> {
    return db.transaction(async (tx) => this.postPeriod(tx, periodId));
  }

  /** Wage expense recognised in a date window — the P&L's figure. */
  async getWageExpense(storeId: string, startDate?: string, endDate?: string): Promise<number> {
    const rows = await this.query(storeId, POSTING_ACCOUNTS.wageExpense, startDate, endDate);
    return round2(rows.reduce((s, r) => s + Number(r.amount), 0));
  }

  /**
   * Payroll cash that left the business in a window — the cash statement's
   * figure. Sums cash_out (period settlements) AND advance_disbursement
   * (advances handed out) together: both are real cash leaving on the day
   * they're dated, and deduction:advance_recovery already keeps the total
   * from double-counting by reducing cash_out for whatever a settlement
   * recovers of an earlier disbursement.
   */
  async getCashOut(storeId: string, startDate?: string, endDate?: string): Promise<number> {
    const rows = await this.queryAccounts(
      storeId, [POSTING_ACCOUNTS.cashOut, POSTING_ACCOUNTS.advanceDisbursement], startDate, endDate,
    );
    return round2(rows.reduce((s, r) => s + Number(r.amount), 0));
  }

  /**
   * Books a salary advance's disbursement — the one write this module makes
   * outside a payroll period. `.onConflictDoNothing()` on the unique index
   * makes a retried call idempotent, the same way postPeriod's
   * delete-and-replace makes a retried mark-paid idempotent.
   */
  async postAdvanceDisbursement(exec: DbExecutor, advance: SalaryAdvance): Promise<void> {
    await exec.insert(payrollPostings).values({
      periodId: null,
      storeId: advance.storeId,
      staffId: advance.staffId,
      account: POSTING_ACCOUNTS.advanceDisbursement,
      effectiveDate: advance.date,
      amount: Number(advance.amount),
      salaryAdvanceId: advance.id,
    }).onConflictDoNothing();
  }

  /**
   * Reverses a disbursement posting — an advance rejected or deleted never
   * happened, cash-wise. Never called for a genuinely recovered advance:
   * recovery only ever reduces cash_out via deduction:advance_recovery at
   * settlement, it never touches this posting.
   */
  async reverseAdvanceDisbursement(exec: DbExecutor, advanceId: string): Promise<void> {
    await exec.delete(payrollPostings).where(eq(payrollPostings.salaryAdvanceId, advanceId));
  }

  private async query(storeId: string, account: string, startDate?: string, endDate?: string) {
    return this.queryAccounts(storeId, [account], startDate, endDate);
  }

  private async queryAccounts(storeId: string, accounts: string[], startDate?: string, endDate?: string) {
    const conditions: any[] = [
      eq(payrollPostings.storeId, storeId),
      inArray(payrollPostings.account, accounts),
    ];
    // effective_date is text YYYY-MM-DD, which sorts lexicographically, so a
    // plain string comparison is a correct date range here.
    if (startDate) conditions.push(gte(payrollPostings.effectiveDate, startDate));
    if (endDate) conditions.push(lte(payrollPostings.effectiveDate, endDate));
    return db.select().from(payrollPostings).where(and(...conditions));
  }
}

export const payrollPostingService = new PayrollPostingService();
