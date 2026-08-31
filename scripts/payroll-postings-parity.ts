/**
 * Payroll postings reconciliation gate.
 *
 * `payroll_postings` is payroll's new canonical record in the books. Nothing
 * reads it for reporting yet — this gate is what decides whether it has earned
 * the right to. It runs against real data and compares the ledger with the
 * figures the existing code produces today.
 *
 * Modelled on scripts/analytics-parity.ts: not a unit test, because it needs a
 * real database and whatever shapes that database actually contains. Exits
 * non-zero on any mismatch so CI can gate on it.
 *
 * The checks:
 *   P1  every paid period has postings
 *   P2  the accounting identity closes per period:
 *         wages − deductions + deferred = cash out
 *   P3  wage_expense for a period equals the sum of its entries' netPay
 *   P4  cash_out for a period equals the mirror expense row it replaces
 *   P5  over all time, wage_expense per store equals getPaidPayrollExpenses
 *   P6  for periods inside a single month, month-scoped wage_expense equals
 *       what the current P&L reports for that month
 *
 * P6 is deliberately restricted to non-straddling periods. For a period that
 * crosses a month boundary the two are EXPECTED to differ — that is the bug
 * being fixed, and those periods are reported separately as "corrected".
 */

import { pool, db } from "../server/db";
import { sql } from "drizzle-orm";
import { storage } from "../server/storage";
import { postingsBalance, POSTING_ACCOUNTS } from "../server/services/PayrollPostingService";

const MONEY_TOLERANCE = 0.01;

type Failure = { check: string; store: string; detail: string };

const failures: Failure[] = [];
const corrected: string[] = [];
let comparisons = 0;

function near(a: number, b: number, tol = MONEY_TOLERANCE): boolean {
  return Math.abs(a - b) <= tol;
}

const fmt = (n: number) => n.toFixed(2).padStart(14);

function straddlesMonth(startDate: string, endDate: string): boolean {
  return startDate.slice(0, 7) !== endDate.slice(0, 7);
}

async function main() {
  console.log("Payroll postings reconciliation");
  console.log("=".repeat(70));

  const stores = await db.execute(sql`
    SELECT id, name FROM stores WHERE is_active = true ORDER BY name`);

  if (stores.rows.length === 0) {
    console.log("No active stores; nothing to reconcile.");
    await pool.end();
    process.exit(0);
  }

  for (const store of stores.rows as { id: string; name: string }[]) {
    const periods = await db.execute(sql`
      SELECT id, start_date, end_date, status
        FROM payroll_periods
       WHERE store_id = ${store.id} AND status = 'paid'
       ORDER BY start_date`);

    if (periods.rows.length === 0) {
      console.log(`- ${store.name}: no paid periods, skipped`);
      continue;
    }

    let straddling = 0;

    for (const p of periods.rows as any[]) {
      const postings = await db.execute(sql`
        SELECT account, effective_date, amount::numeric AS amount
          FROM payroll_postings WHERE period_id = ${p.id}`);

      const lines = (postings.rows as any[]).map(r => ({
        account: r.account as string,
        effectiveDate: r.effective_date as string,
        amount: Number(r.amount),
      }));

      const label = `${p.start_date}..${p.end_date}`;

      // P1 — a paid period must have posted.
      const [{ gross }] = (await db.execute(sql`
        SELECT COALESCE(SUM(net_pay), 0)::numeric AS gross
          FROM payroll_entries WHERE period_id = ${p.id}`)).rows as any[];
      const grossNetPay = Number(gross);

      if (lines.length === 0) {
        if (grossNetPay !== 0) {
          failures.push({ check: "P1 missing postings", store: store.name, detail: label });
        }
        continue;
      }

      // P2 — the identity closes.
      comparisons++;
      const balance = postingsBalance(lines);
      if (!balance.balanced) {
        failures.push({
          check: "P2 identity", store: store.name,
          detail: `${label} off by ${balance.delta}`,
        });
      }

      // P3 — wage expense is the period's gross pay, however it was sliced.
      comparisons++;
      const wages = lines
        .filter(l => l.account === POSTING_ACCOUNTS.wageExpense)
        .reduce((s, l) => s + l.amount, 0);
      if (!near(wages, grossNetPay)) {
        failures.push({
          check: "P3 wages vs entries", store: store.name,
          detail: `${label} postings=${fmt(wages)} entries=${fmt(grossNetPay)}`,
        });
      }

      // P4 — cash out matches the mirror expense row it is due to replace.
      const mirror = await db.execute(sql`
        SELECT COALESCE(SUM(e.amount), 0)::numeric AS amount
          FROM expenses e
          JOIN expense_categories ec ON ec.id = e.category_id
         WHERE e.store_id = ${store.id}
           AND e.is_deleted = false
           AND ec.is_system = true AND ec.name = 'Payroll'
           AND e.title = ${`Payroll — ${p.start_date} to ${p.end_date}`}`);
      const mirrorAmount = Number((mirror.rows[0] as any).amount);
      const cashOut = lines
        .filter(l => l.account === POSTING_ACCOUNTS.cashOut)
        .reduce((s, l) => s + l.amount, 0);
      if (mirrorAmount > 0) {
        comparisons++;
        if (!near(cashOut, mirrorAmount)) {
          failures.push({
            check: "P4 cash vs mirror", store: store.name,
            detail: `${label} postings=${fmt(cashOut)} mirror=${fmt(mirrorAmount)}`,
          });
        }
      }

      // P6 — for a period inside one month, the ledger and today's P&L agree.
      if (straddlesMonth(p.start_date, p.end_date)) {
        straddling++;
        corrected.push(`${store.name}: ${label}`);
      } else {
        comparisons++;
        const month = p.start_date.slice(0, 7);
        const monthStart = `${month}-01`;
        const monthEnd = new Date(Date.UTC(
          Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
        const legacy = await storage.getPaidPayrollExpenses(store.id, monthStart, monthEnd);
        const legacyForPeriod = legacy
          .filter(l => l.label.includes(new Date(p.start_date).toLocaleDateString()))
          .reduce((s, l) => s + l.amount, 0);
        if (legacyForPeriod > 0 && !near(wages, legacyForPeriod)) {
          failures.push({
            check: "P6 month parity", store: store.name,
            detail: `${label} postings=${fmt(wages)} legacy=${fmt(legacyForPeriod)}`,
          });
        }
      }
    }

    // P5 — over all time the two must agree exactly, because the legacy
    // overlap test counts each period once when the window covers everything.
    comparisons++;
    const allWages = await db.execute(sql`
      SELECT COALESCE(SUM(amount), 0)::numeric AS total
        FROM payroll_postings
       WHERE store_id = ${store.id} AND account = ${POSTING_ACCOUNTS.wageExpense}`);
    const postedTotal = Number((allWages.rows[0] as any).total);
    const legacyAll = await storage.getPaidPayrollExpenses(store.id, "1900-01-01", "2999-12-31");
    const legacyTotal = legacyAll.reduce((s, l) => s + l.amount, 0);
    if (!near(postedTotal, legacyTotal)) {
      failures.push({
        check: "P5 all-time wages", store: store.name,
        detail: `postings=${fmt(postedTotal)} legacy=${fmt(legacyTotal)}`,
      });
    }

    console.log(
      `- ${store.name}: ${periods.rows.length} paid period(s), ` +
      `${straddling} straddling a month boundary`
    );
  }

  console.log("=".repeat(70));

  if (corrected.length > 0) {
    console.log(`\n${corrected.length} period(s) straddle a month boundary.`);
    console.log("These are the runs the legacy P&L reports in FULL in both months;");
    console.log("the ledger splits them by day. A difference here is the fix working.");
    for (const c of corrected) console.log(`  · ${c}`);
  }

  console.log();
  if (failures.length > 0) {
    for (const f of failures) {
      console.log(`FAIL  [${f.check}]  ${f.store}  ${f.detail}`);
    }
    console.log(`\n${comparisons} comparisons, ${failures.length} failing.`);
    console.log("Postings gate FAILED.");
    await pool.end();
    process.exit(1);
  }

  console.log(`${comparisons} comparisons, 0 failing.`);
  console.log("Postings gate PASSED. The ledger agrees with the books it replaces.");
  await pool.end();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("Postings gate crashed:", e);
  await pool.end().catch(() => {});
  process.exit(1);
});
