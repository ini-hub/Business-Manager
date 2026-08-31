import { db, type DbExecutor } from "../db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  payrollPeriods,
  payrollEntries,
  payrollDeductions,
  customers,
  creditEntries,
  DEDUCTION_PRIORITY,
  type PayrollDeductionType,
  type PayrollDeduction,
  type CreditEntry,
} from "@shared/schema";
import { getStoreTimezone, toUtcEnd } from "../lib/dateUtils";
import { storage } from "../storage";

/**
 * Recovers a staff member's shop debt out of their salary.
 *
 * Staff are often also customers. When they take a service they usually don't
 * pay at the counter — the understanding is that it comes out of their pay —
 * so the sale is checked out as Credit (Owe) against their linked customer
 * profile (`customers.staff_id`). This service is the bridge that was missing:
 * it proposes those debts as `staff_credit` payroll deductions, and settles
 * them as real repayments when the period is marked paid.
 *
 * Accounting shape this deliberately preserves:
 *   - P&L wage expense stays at raw netPay. The full wage is a cost; a
 *     deduction settles a receivable, it does not reduce wage cost.
 *   - Cash out falls by the deducted amount (the mirror Payroll expense).
 *   - The repayment is written with method `payroll_deduction`, which the
 *     cash-flow statement excludes because it filters on "cash".
 * Net per unit recovered: wage expense flat, cash out −1, receivable −1.
 */

export type DebtLike = { id: string; outstandingBalance: number };

export type Allocation = { creditEntryId: string; amount: number };

/**
 * Splits the pay a staff member has left across their open debts,
 * oldest-first, never taking more than a debt actually carries.
 *
 * `available` is what survives the higher-priority deduction types (tax,
 * penalty, carry-forward, advance recovery). Staff credit is last in
 * DEDUCTION_PRIORITY, so it absorbs any shortfall rather than crowding out a
 * statutory line — which also means take-home floors at zero and this can
 * never push a staff member into deficit or feed carryForwardAmount.
 *
 * Debts that get nothing are omitted rather than returned as zero-amount
 * allocations, so no empty deduction line is ever written.
 */
export function allocateAgainstPay(available: number, debts: DebtLike[]): Allocation[] {
  let remaining = Math.max(0, available);
  const out: Allocation[] = [];

  for (const debt of debts) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Number(debt.outstandingBalance));
    if (take <= 0) continue;
    out.push({ creditEntryId: debt.id, amount: round2(take) });
    remaining = round2(remaining - take);
  }

  return out;
}

/** Money is numeric(12,2); keep allocation arithmetic on that grid. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const STAFF_CREDIT_RANK = DEDUCTION_PRIORITY.indexOf("staff_credit");

/**
 * Does this deduction type get paid out of net pay before staff credit does?
 *
 * An unrecognised type is treated as outranking staff credit: if someone adds
 * a new deduction kind and forgets the priority list, the safe failure is that
 * shop debt waits, not that a statutory line goes unpaid.
 */
function outranksStaffCredit(type: string): boolean {
  const rank = DEDUCTION_PRIORITY.indexOf(type as PayrollDeductionType);
  return rank === -1 || rank < STAFF_CREDIT_RANK;
}

/**
 * The staff-credit lines this period still owes a repayment for, row-locked.
 *
 * Exported so the integration suite can exercise the real query rather than a
 * copy of it — a concurrency test that reasons about a re-typed query proves
 * nothing about the one that actually runs.
 *
 * Two things protect against recovering a debt twice, and they are layered:
 * `repayment_id IS NULL` filters out anything already settled, and `FOR UPDATE`
 * closes the window where a second transaction reads the same not-yet-committed
 * row. The lock only holds inside a transaction, which is why `settle` owns one.
 */
export function selectPendingStaffCreditForUpdate(exec: DbExecutor, periodId: string) {
  return exec.select().from(payrollDeductions).where(and(
    eq(payrollDeductions.periodId, periodId),
    eq(payrollDeductions.type, "staff_credit"),
    eq(payrollDeductions.isWaived, false),
    isNull(payrollDeductions.repaymentId),
  )).for("update");
}

export class StaffCreditDeductionService {
  /**
   * Rewrites this period's `staff_credit` proposals from the current state of
   * the Borrow Book and the current net pay.
   *
   * Safe and cheap to call repeatedly — it is invoked after every payroll
   * calculation and after any manual deduction changes, so that the residual
   * cap re-adjusts. Never touches a waived line (the manager's decision has to
   * survive the recalculation that fires on every sale) or an already-settled
   * one.
   */
  async syncProposals(periodId: string): Promise<void> {
    const [period] = await db.select().from(payrollPeriods).where(eq(payrollPeriods.id, periodId));
    if (!period) return;
    // A paid period is closed: its deductions are settled against real
    // repayments and must never be rewritten.
    if (period.status === "paid") return;

    const entries = await db.select().from(payrollEntries).where(eq(payrollEntries.periodId, periodId));
    if (entries.length === 0) return;

    const tz = await getStoreTimezone(period.storeId);
    const asOf = toUtcEnd(period.endDate, tz);

    // Resolve each staff member's linked customer profile. customers.staff_id
    // has no FK and no store guard, so a link pointing at another store's
    // customer is discarded rather than trusted.
    const staffIds = entries.map(e => e.staffId);
    const linked = await db
      .select({ id: customers.id, staffId: customers.staffId })
      .from(customers)
      .where(and(
        eq(customers.storeId, period.storeId),
        inArray(customers.staffId, staffIds),
      ));

    // A staff member should have at most one linked profile — the link
    // endpoint enforces it — but nothing in the schema guarantees it, so
    // collect every match rather than silently ignoring a duplicate's debt.
    const customersByStaff = new Map<string, string[]>();
    for (const c of linked) {
      if (!c.staffId) continue;
      if (!customersByStaff.has(c.staffId)) customersByStaff.set(c.staffId, []);
      customersByStaff.get(c.staffId)!.push(c.id);
    }

    const existing = await db.select().from(payrollDeductions).where(eq(payrollDeductions.periodId, periodId));

    const openDebts = await storage.creditRepo.getOpenEntriesForCustomers(
      period.storeId,
      Array.from(customersByStaff.values()).flat(),
      asOf,
    );
    const debtsByCustomer = new Map<string, CreditEntry[]>();
    for (const d of openDebts) {
      if (!debtsByCustomer.has(d.customerId)) debtsByCustomer.set(d.customerId, []);
      debtsByCustomer.get(d.customerId)!.push(d);
    }

    for (const entry of entries) {
      const mine = existing.filter(d => d.staffId === entry.staffId);
      const staffCreditRows = mine.filter(d => d.type === "staff_credit");

      // Rows already settled or explicitly waived are fixed points: they are
      // neither rewritten nor counted as claimable pay.
      const frozen = new Map<string, PayrollDeduction>();
      for (const r of staffCreditRows) {
        if (r.creditEntryId && (r.repaymentId || r.isWaived)) frozen.set(r.creditEntryId, r);
      }

      // Everything ranked above staff credit claims net pay first.
      const higherPriority = mine
        .filter(d => outranksStaffCredit(d.type) && !d.isWaived)
        .reduce((sum, d) => sum + Number(d.amount), 0);
      const settledStaffCredit = staffCreditRows
        .filter(d => d.repaymentId)
        .reduce((sum, d) => sum + Number(d.amount), 0);

      const available = round2(Math.max(0, (entry.netPay || 0) - higherPriority - settledStaffCredit));

      // Re-sort after flattening: the sweep returns oldest-first per query,
      // but merging two profiles' debts would otherwise interleave them out of
      // age order and recover a newer debt ahead of an older one.
      const candidates = (customersByStaff.get(entry.staffId) ?? [])
        .flatMap(cid => debtsByCustomer.get(cid) ?? [])
        .filter(d => !frozen.has(d.id))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

      const allocations = allocateAgainstPay(available, candidates);
      const allocByCredit = new Map(allocations.map(a => [a.creditEntryId, a.amount]));

      // Drop proposals that no longer earn a place: debt settled in cash since
      // the last sync, checkout voided, staff unlinked, or squeezed out by a
      // manual deduction added after the proposal was made.
      const stale = staffCreditRows.filter(
        r => !r.repaymentId && !r.isWaived && (!r.creditEntryId || !allocByCredit.has(r.creditEntryId)),
      );
      if (stale.length > 0) {
        await db.delete(payrollDeductions).where(inArray(payrollDeductions.id, stale.map(r => r.id)));
      }

      for (const alloc of allocations) {
        const debt = candidates.find(d => d.id === alloc.creditEntryId)!;
        const row = staffCreditRows.find(r => r.creditEntryId === alloc.creditEntryId && !r.repaymentId && !r.isWaived);
        const label = this.labelFor(debt);

        if (row) {
          if (Number(row.amount) !== alloc.amount || row.label !== label) {
            // The extra repaymentId guard closes a narrow race: `row` came
            // from a snapshot read at the top of this call, so a concurrent
            // settle() (mark-paid running at the exact same moment, e.g.
            // triggered by an unrelated sale's recalculation) could have
            // settled this exact row in between. Without the guard this
            // write would silently succeed anyway and overwrite a
            // just-settled amount; with it, a settled row simply no longer
            // matches and the write becomes a no-op.
            await db.update(payrollDeductions)
              .set({ amount: alloc.amount, label })
              .where(and(eq(payrollDeductions.id, row.id), isNull(payrollDeductions.repaymentId)));
          }
        } else {
          await db.insert(payrollDeductions).values({
            periodId,
            storeId: period.storeId,
            staffId: entry.staffId,
            type: "staff_credit",
            label,
            amount: alloc.amount,
            creditEntryId: alloc.creditEntryId,
          }).onConflictDoNothing();
        }
      }
    }
  }

  /**
   * A staff member's debt moved outside payroll — a cash repayment at the
   * counter, or a write-off — so every open period's proposals are now stale.
   *
   * Without this, a part payment on a credit sale never reached payroll: the
   * period kept proposing a deduction for money already collected, and only
   * self-corrected at mark-paid (where `settle` re-clamps) or on the next
   * recalculation. Managers saw, and could act on, a figure that was wrong.
   *
   * Paid periods are skipped — `syncProposals` refuses them anyway, since their
   * deductions are settled against real repayments and must never be rewritten.
   *
   * Callers treat this as best-effort: the repayment has already committed by
   * the time it runs, so a failure here must not fail their response.
   */
  async syncOpenPeriodsForCustomer(storeId: string, customerId: string): Promise<void> {
    // Only staff debt feeds payroll. An ordinary customer's repayment has no
    // proposal to re-clamp, so this costs one indexed lookup and stops.
    const [customer] = await db
      .select({ staffId: customers.staffId })
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.storeId, storeId)));
    if (!customer?.staffId) return;

    const periods = await storage.getPayrollPeriods(storeId);
    for (const period of periods) {
      if (period.status === "paid") continue;
      await this.syncProposals(period.id);
    }
  }

  /**
   * Turns this period's proposals into real repayments. Call after a final
   * syncProposals, so the amounts settled are the ones the manager saw.
   *
   * Owns its transaction rather than accepting one. The `FOR UPDATE` below is
   * what stops two concurrent mark-paid requests from each writing a repayment
   * for the same debt, and a row lock only holds for the life of a
   * transaction — taken on the pool directly it would be released immediately
   * and silently buy nothing. Making the transaction internal means no caller
   * can accidentally strip that protection.
   */
  async settle(periodId: string): Promise<void> {
    await db.transaction(async (exec) => {
      await this.settleWithin(exec, periodId);
    });
  }

  private async settleWithin(exec: DbExecutor, periodId: string): Promise<void> {
    const [period] = await exec.select().from(payrollPeriods).where(eq(payrollPeriods.id, periodId));
    if (!period) return;

    const pending = await selectPendingStaffCreditForUpdate(exec, periodId);

    for (const deduction of pending) {
      if (!deduction.creditEntryId) continue;

      // Re-read under the transaction and clamp again. The debt may have been
      // paid down in cash between the manager approving the period and this
      // running; recovering more than is outstanding would create a credit
      // balance out of thin air.
      const [debt] = await exec.select().from(creditEntries)
        .where(eq(creditEntries.id, deduction.creditEntryId));
      if (!debt) continue;

      const amount = round2(Math.min(Number(deduction.amount), Number(debt.outstandingBalance)));

      if (amount <= 0) {
        // Nothing left to recover — zero the line so the payslip and the cash
        // total agree with what actually happened.
        await exec.update(payrollDeductions).set({ amount: 0 })
          .where(eq(payrollDeductions.id, deduction.id));
        continue;
      }

      const repayment = await storage.creditRepo.applyRepayment(exec, {
        creditEntryId: deduction.creditEntryId,
        amountReceived: amount,
        paymentMethod: "payroll_deduction",
        notes: `Deducted from payroll ${period.startDate} – ${period.endDate}`,
        // No counter staff recorded this — it was withheld from payroll.
        recordedByStaffId: null,
      });

      await exec.update(payrollDeductions)
        .set({ amount, repaymentId: repayment.id })
        .where(eq(payrollDeductions.id, deduction.id));
    }
  }

  private labelFor(debt: CreditEntry): string {
    // credit_entries.description already reads "Checkout Receipt #1042" for
    // POS-originated debt; fall back for manually created entries.
    return debt.description
      ? `Staff credit — ${debt.description}`
      : "Staff credit — outstanding balance";
  }
}

export const staffCreditDeductionService = new StaffCreditDeductionService();
