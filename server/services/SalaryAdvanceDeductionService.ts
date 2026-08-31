import { db, type DbExecutor } from "../db";
import { and, eq, inArray, isNull, isNotNull, ne } from "drizzle-orm";
import {
  payrollPeriods,
  payrollEntries,
  payrollDeductions,
  salaryAdvances,
  DEDUCTION_PRIORITY,
  type PayrollDeductionType,
  type SalaryAdvance,
} from "@shared/schema";

/**
 * Recovers a staff member's approved cash advances out of their next payout.
 *
 * Mirrors StaffCreditDeductionService's shape — propose on every payroll
 * calculation, re-clamp, settle atomically at mark-paid — and, since the
 * partial-recovery rework, its allocation logic too: `advance_recovery`
 * self-caps to whatever pay survives higher-priority deductions
 * (allocateAgainstPay below), the same way staff_credit caps itself. That
 * means it never drives take-home negative and never contributes to
 * payroll_entries.carryForwardAmount — an advance too big for one paycheck
 * simply carries its own remaining balance forward on its own row
 * (salaryAdvances.outstandingBalance), re-proposed next period, instead of
 * spilling into the generic per-staff shortfall tax/penalty/etc. use.
 *
 * That's a deliberate reversal of this service's first version, which
 * proposed an advance's full amount uncapped and let the excess become an
 * anonymous carry_forward line. That made an advance's own record say
 * "recovered" the moment it was fully *claimed* against pay, even when only
 * part of it was actually collectible — no way to ask "how much of THIS
 * advance is still outstanding" without cross-referencing a shortfall figure
 * that had already lost the link back to it. outstandingBalance /
 * recoveryStatus exist so that question has a direct answer.
 *
 * Accounting shape: unlike staff credit, an advance is not a receivable being
 * collected from a sale — it's cash the business already paid out mid-period.
 * Recovering it here doesn't touch the P&L a second time; it just reduces
 * this period's cash disbursement by however much of the advance is deducted,
 * because that cash already left in the advance payment itself.
 */

const ADVANCE_RANK = DEDUCTION_PRIORITY.indexOf("advance_recovery");

/**
 * Does this deduction type get paid out of net pay before advance_recovery
 * does? An unrecognised type is treated as outranking it, for the same
 * safe-failure reason StaffCreditDeductionService.outranksStaffCredit gives:
 * if someone adds a new deduction kind and forgets the priority list, the
 * failure should be "advance recovery waits", not "a statutory line doesn't
 * get paid".
 */
function outranksAdvanceRecovery(type: string): boolean {
  const rank = DEDUCTION_PRIORITY.indexOf(type as PayrollDeductionType);
  return rank === -1 || rank < ADVANCE_RANK;
}

/** Money is numeric(12,2); keep amounts on that grid. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type Allocation = { advanceId: string; amount: number };

/**
 * Splits the pay a staff member has left, after higher-priority deductions,
 * across their open advances, oldest-first, never taking more than an
 * advance actually still carries. Structurally identical to
 * StaffCreditDeductionService.allocateAgainstPay — kept as its own small copy
 * rather than a shared import so each service's correctness stays
 * independently readable and neither can regress the other by accident.
 */
export function allocateAgainstPay(available: number, advances: SalaryAdvance[]): Allocation[] {
  let remaining = Math.max(0, available);
  const out: Allocation[] = [];

  for (const advance of advances) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Number(advance.outstandingBalance));
    if (take <= 0) continue;
    out.push({ advanceId: advance.id, amount: round2(take) });
    remaining = round2(remaining - take);
  }

  return out;
}

/**
 * The advance-recovery lines this period still owes a settlement for,
 * row-locked. Exported so the integration suite can exercise the real query.
 *
 * `settled_at IS NULL` filters out anything already recovered; `FOR UPDATE`
 * closes the window where a second transaction reads the same not-yet-
 * committed row. Only rows with a `salary_advance_id` are system-tracked — a
 * manager's free-text `advance_recovery` line has nothing to settle here.
 */
export function selectPendingAdvanceRecoveryForUpdate(exec: DbExecutor, periodId: string) {
  return exec.select().from(payrollDeductions).where(and(
    eq(payrollDeductions.periodId, periodId),
    eq(payrollDeductions.type, "advance_recovery"),
    eq(payrollDeductions.isWaived, false),
    isNull(payrollDeductions.settledAt),
    isNotNull(payrollDeductions.salaryAdvanceId),
  )).for("update");
}

export class SalaryAdvanceDeductionService {
  /**
   * Rewrites this period's `advance_recovery` proposals from the current
   * state of `salary_advances`.
   *
   * Safe and cheap to call repeatedly — invoked after every payroll
   * calculation and after any manual deduction change, mirroring
   * StaffCreditDeductionService.syncProposals. Never touches a waived line or
   * one already settled, and never touches a manager's free-text
   * `advance_recovery` line (no `salaryAdvanceId`).
   */
  async syncProposals(periodId: string): Promise<void> {
    const [period] = await db.select().from(payrollPeriods).where(eq(payrollPeriods.id, periodId));
    if (!period) return;
    // A paid period is closed: its deductions are settled and must never be
    // rewritten.
    if (period.status === "paid") return;

    const entries = await db.select().from(payrollEntries).where(eq(payrollEntries.periodId, periodId));
    if (entries.length === 0) return;

    const staffIds = entries.map(e => e.staffId);

    // Candidates: approved, still owing a balance, and either unreserved or
    // already reserved to *this* period. `recoveredPeriodId` doubles as a
    // reservation the moment a proposal is written (below), so a second open
    // period for the same store can't also propose the same remaining
    // balance.
    const openAdvances = await db.select().from(salaryAdvances).where(and(
      eq(salaryAdvances.storeId, period.storeId),
      inArray(salaryAdvances.staffId, staffIds),
      eq(salaryAdvances.status, "approved"),
      ne(salaryAdvances.recoveryStatus, "recovered"),
    ));
    const candidatesByStaff = new Map<string, SalaryAdvance[]>();
    for (const a of openAdvances) {
      if (a.recoveredPeriodId && a.recoveredPeriodId !== periodId) continue; // reserved elsewhere
      if (!candidatesByStaff.has(a.staffId)) candidatesByStaff.set(a.staffId, []);
      candidatesByStaff.get(a.staffId)!.push(a);
    }
    for (const list of Array.from(candidatesByStaff.values())) {
      list.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.getTime() - b.createdAt.getTime());
    }

    const existing = await db.select().from(payrollDeductions).where(eq(payrollDeductions.periodId, periodId));

    for (const entry of entries) {
      const mine = existing.filter(d => d.staffId === entry.staffId);
      const advanceRows = mine.filter(d => d.type === "advance_recovery" && d.salaryAdvanceId);
      const candidates = candidatesByStaff.get(entry.staffId) ?? [];
      const candidateIds = new Set(candidates.map(a => a.id));

      // Rows already settled or waived are fixed points: never rewritten, and
      // their advance is excluded from re-proposal even if it still shows up
      // in the candidate list for some reason.
      const frozen = new Map(advanceRows.filter(r => r.settledAt || r.isWaived).map(r => [r.salaryAdvanceId!, r]));

      // Everything ranked above advance_recovery claims net pay first — the
      // same headroom logic staff_credit uses one priority slot later.
      const higherPriority = mine
        .filter(d => outranksAdvanceRecovery(d.type) && !d.isWaived)
        .reduce((sum, d) => sum + Number(d.amount), 0);
      const settledAdvance = advanceRows
        .filter(d => d.settledAt)
        .reduce((sum, d) => sum + Number(d.amount), 0);

      const available = round2(Math.max(0, (entry.netPay || 0) - higherPriority - settledAdvance));

      const liveCandidates = candidates.filter(a => !frozen.has(a.id));

      // Drop proposals whose advance no longer earns a place: recovered
      // (elsewhere) or rejected since the last sync, or reserved away to
      // another period. (Never a settled/waived row — those aren't in
      // candidates in the first place, since the query above excludes
      // recoveryStatus = 'recovered', and a waived row keeps its place
      // regardless of the candidate list.)
      const stale = advanceRows.filter(r => !r.settledAt && !r.isWaived && !candidateIds.has(r.salaryAdvanceId!));
      if (stale.length > 0) {
        await db.delete(payrollDeductions).where(inArray(payrollDeductions.id, stale.map(r => r.id)));
        // Release the reservation for any advance this period no longer
        // proposes, but only if nothing else (i.e. settlement) claimed it
        // since — never clobber a recovery that already happened.
        const releaseIds = stale.map(d => d.salaryAdvanceId!).filter(Boolean);
        if (releaseIds.length > 0) {
          await db.update(salaryAdvances)
            .set({ recoveredPeriodId: null })
            .where(and(
              inArray(salaryAdvances.id, releaseIds),
              ne(salaryAdvances.recoveryStatus, "recovered"),
              eq(salaryAdvances.recoveredPeriodId, periodId),
            ));
        }
      }

      const allocations = allocateAgainstPay(available, liveCandidates);

      for (const alloc of allocations) {
        const advance = liveCandidates.find(a => a.id === alloc.advanceId)!;
        const label = this.labelFor(advance);
        const row = advanceRows.find(r => r.salaryAdvanceId === alloc.advanceId && !r.settledAt && !r.isWaived);

        if (row) {
          if (Number(row.amount) !== alloc.amount || row.label !== label) {
            // The extra settledAt guard closes a narrow race: `row` came from
            // a snapshot read at the top of this call, so a concurrent
            // settle() (mark-paid running at the exact same moment, e.g.
            // triggered by an unrelated sale's recalculation) could have
            // settled this exact row in between. Without the guard this
            // write would silently succeed anyway and overwrite a
            // just-settled amount; with it, a settled row simply no longer
            // matches and the write becomes a no-op.
            await db.update(payrollDeductions)
              .set({ amount: alloc.amount, label })
              .where(and(eq(payrollDeductions.id, row.id), isNull(payrollDeductions.settledAt)));
          }
        } else {
          await db.insert(payrollDeductions).values({
            periodId,
            storeId: period.storeId,
            staffId: entry.staffId,
            type: "advance_recovery",
            label,
            amount: alloc.amount,
            salaryAdvanceId: advance.id,
          }).onConflictDoNothing();

          // Reserve the advance to this period so a second open period can't
          // also propose it. Only reserve if still unreserved — idempotent
          // across repeated syncs.
          if (!advance.recoveredPeriodId) {
            await db.update(salaryAdvances)
              .set({ recoveredPeriodId: periodId })
              .where(and(eq(salaryAdvances.id, advance.id), isNull(salaryAdvances.recoveredPeriodId)));
          }
        }
      }
    }
  }

  /**
   * Frees an advance reserved to an open period that's never getting paid or
   * deleted — the manual escape hatch for the "locked away indefinitely"
   * problem the reservation otherwise has no timeout for.
   *
   * Deletes the stale proposal directly rather than calling syncProposals on
   * the reserved period: that would just see the advance is still approved,
   * unrecovered, and now unreserved, and re-claim it right back — a
   * self-defeating no-op. Whichever period (or the manual /recover override)
   * asks next gets to claim the freed balance.
   */
  async releaseReservation(advanceId: string): Promise<void> {
    await db.transaction(async (tx) => {
      const [advance] = await tx.select().from(salaryAdvances)
        .where(eq(salaryAdvances.id, advanceId))
        .for("update");
      if (!advance || !advance.recoveredPeriodId || advance.recoveryStatus === "recovered") return;

      const reservedPeriodId = advance.recoveredPeriodId;
      // Shouldn't happen — settle() always clears the reservation on its way
      // out, one way or the other — but a paid period is immutable, so
      // refuse rather than delete from one on the strength of an assumption.
      const [reservedPeriod] = await tx.select().from(payrollPeriods).where(eq(payrollPeriods.id, reservedPeriodId));
      if (reservedPeriod?.status === "paid") return;

      await tx.update(salaryAdvances)
        .set({ recoveredPeriodId: null })
        .where(eq(salaryAdvances.id, advanceId));

      // Only the unsettled proposal on the released period — never touch a
      // waived line (a manager's own decision to keep for the record) or,
      // in principle, a settled one (shouldn't exist while recoveredPeriodId
      // was still set to it and recoveryStatus wasn't "recovered", but the
      // guard costs nothing).
      await tx.delete(payrollDeductions).where(and(
        eq(payrollDeductions.salaryAdvanceId, advanceId),
        eq(payrollDeductions.periodId, reservedPeriodId),
        eq(payrollDeductions.isWaived, false),
        isNull(payrollDeductions.settledAt),
      ));
    });
  }

  /**
   * Turns this period's proposals into real recoveries. Call after a final
   * syncProposals, so the amounts settled are the ones the manager saw.
   *
   * Owns its transaction rather than accepting one — same reasoning as
   * StaffCreditDeductionService.settle: the row lock only holds for the life
   * of a transaction, and an internal transaction means no caller can
   * accidentally strip that protection.
   */
  async settle(periodId: string): Promise<void> {
    await db.transaction(async (exec) => {
      await this.settleWithin(exec, periodId);
    });
  }

  private async settleWithin(exec: DbExecutor, periodId: string): Promise<void> {
    const [period] = await exec.select().from(payrollPeriods).where(eq(payrollPeriods.id, periodId));
    if (!period) return;

    const pending = await selectPendingAdvanceRecoveryForUpdate(exec, periodId);

    for (const deduction of pending) {
      if (!deduction.salaryAdvanceId) continue;

      // Re-read under the transaction and clamp again. The balance may have
      // shrunk since the manager approved the period — a manual recovery
      // (repaid in cash, written off) may have run between sync and here.
      const [advance] = await exec.select().from(salaryAdvances)
        .where(eq(salaryAdvances.id, deduction.salaryAdvanceId))
        .for("update");
      if (!advance) continue;

      const amount = round2(Math.min(Number(deduction.amount), Number(advance.outstandingBalance)));

      if (amount <= 0) {
        // Nothing left to recover — zero the line so the payslip and the
        // cash total agree with what actually happened, same as staff
        // credit's equivalent branch.
        await exec.update(payrollDeductions).set({ amount: 0, settledAt: new Date() })
          .where(eq(payrollDeductions.id, deduction.id));
        continue;
      }

      const nextOutstanding = round2(Math.max(0, Number(advance.outstandingBalance) - amount));
      const nextStatus = nextOutstanding <= 0 ? "recovered" : "partial";

      await exec.update(salaryAdvances)
        .set({
          outstandingBalance: nextOutstanding,
          recoveryStatus: nextStatus,
          isRecovered: nextStatus === "recovered",
          // Recovered: this period is the permanent record of completion.
          // Still partial: release the reservation so the next open period
          // can pick up and re-propose the remainder.
          recoveredPeriodId: nextStatus === "recovered" ? periodId : null,
        })
        .where(eq(salaryAdvances.id, advance.id));

      await exec.update(payrollDeductions)
        .set({ amount, settledAt: new Date() })
        .where(eq(payrollDeductions.id, deduction.id));
    }
  }

  private labelFor(advance: SalaryAdvance): string {
    return advance.notes
      ? `Advance recovery — ${advance.notes}`
      : `Advance recovery — ${advance.date}`;
  }
}

export const salaryAdvanceDeductionService = new SalaryAdvanceDeductionService();
