import { sql } from "drizzle-orm";
import { db } from "../db";

/**
 * The cash-flow statement's building blocks, summed by the database. The report used to load every checkout,
 * repayment, expense and cash drop in the period and add them up in Node; it now runs four aggregates in
 * parallel and returns only the totals.
 *
 * The rules:
 *  - a cash sale counts its whole charge; a split sale counts the FIRST cash leg stored on its receipt, ONCE,
 *    and the rest of the receipt is non-cash; anything else is non-cash. Voided checkouts are skipped, payment
 *    status is not looked at. A receipt is stored as one row per line and its split legs are copied onto every
 *    one of them; the loops this replaced added that cash leg once per line, which overstated cash (and understated
 *    non-cash) on any multi-line split receipt. It is counted on the receipt's first line only, so the figures are
 *    right for old and new sales alike.
 *  - repayments count when paid in cash, by when they were recorded;
 *  - expenses count by their store-local date, deleted ones and the Payroll category excluded (payroll cash
 *    comes from the ledger); cash expenses and the first cash leg of a split are cash out, the rest non-cash;
 *  - drops count by when they were taken.
 *
 * Instants are passed as ISO strings cast to timestamp: the columns hold naive UTC, and a raw Date parameter is
 * formatted in the server's local zone by the driver.
 */
export interface CashFlowTotals {
  cashSales: number;
  nonCashSales: number;
  cashRepayments: number;
  expensesCashOut: number;
  expensesNonCashOut: number;
  cashDropsTotal: number;
}

/** First cash leg of a split_payments array (0 when there is none), as a SQL expression. */
const firstCashLeg = (column: ReturnType<typeof sql.raw>) => sql`COALESCE((
  SELECT (leg.value ->> 'amount')::numeric
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(${column}) = 'array' THEN ${column} ELSE '[]'::jsonb END) WITH ORDINALITY AS leg(value, position)
  WHERE leg.value ->> 'method' = 'cash'
  ORDER BY leg.position
  LIMIT 1
), 0)`;

export async function getCashFlowTotals(storeId: string, start: Date, end: Date, startDay: string, endDay: string): Promise<CashFlowTotals> {
  const from = start.toISOString();
  const to = end.toISOString();

  const expenseCash = firstCashLeg(sql.raw("e.split_payments"));

  const [sales, repayments, expensesOut, drops] = await Promise.all([
    db.execute(sql`
      WITH lines AS (
        SELECT c.payment_method, c.total_charged, c.split_payments,
               -- the first line of each receipt carries its cash leg; the other lines carry none
               (row_number() OVER (PARTITION BY c.receipt_number ORDER BY c.id) = 1) AS first_line
        FROM checkouts c
        WHERE c.store_id = ${storeId} AND c.is_voided = false
          AND c.created_at >= ${from}::timestamp AND c.created_at <= ${to}::timestamp
      )
      SELECT
        COALESCE(SUM(CASE WHEN l.payment_method = 'cash' THEN l.total_charged
                          WHEN l.payment_method = 'split' AND l.split_payments IS NOT NULL AND l.first_line THEN ${firstCashLeg(sql.raw("l.split_payments"))}
                          ELSE 0 END), 0)::float8 AS cash_sales,
        COALESCE(SUM(CASE WHEN l.payment_method = 'cash' THEN 0
                          WHEN l.payment_method = 'split' AND l.split_payments IS NOT NULL AND l.first_line THEN l.total_charged - ${firstCashLeg(sql.raw("l.split_payments"))}
                          ELSE l.total_charged END), 0)::float8 AS non_cash_sales
      FROM lines l`),
    db.execute(sql`
      SELECT COALESCE(SUM(r.amount_received), 0)::float8 AS cash_repayments
      FROM repayments r
      JOIN credit_entries ce ON ce.id = r.credit_entry_id
      WHERE ce.store_id = ${storeId} AND r.payment_method = 'cash'
        AND r.created_at >= ${from}::timestamp AND r.created_at <= ${to}::timestamp`),
    db.execute(sql`
      SELECT
        COALESCE(SUM(CASE WHEN e.payment_method = 'cash' THEN e.amount
                          WHEN e.payment_method = 'split' AND e.split_payments IS NOT NULL THEN ${expenseCash}
                          ELSE 0 END), 0)::float8 AS cash_out,
        COALESCE(SUM(CASE WHEN e.payment_method = 'cash' THEN 0
                          WHEN e.payment_method = 'split' AND e.split_payments IS NOT NULL THEN e.amount - ${expenseCash}
                          ELSE e.amount END), 0)::float8 AS non_cash_out
      FROM expenses e
      WHERE e.store_id = ${storeId} AND e.is_deleted = false
        AND e.date >= ${startDay} AND e.date <= ${endDay}
        AND (e.category_id IS NULL OR e.category_id NOT IN (
          SELECT id FROM expense_categories WHERE store_id = ${storeId} AND is_system = true AND name = 'Payroll'))`),
    db.execute(sql`
      SELECT COALESCE(SUM(d.amount), 0)::float8 AS drops_total
      FROM cash_drops d
      JOIN cash_register_sessions s ON s.id = d.session_id
      WHERE s.store_id = ${storeId}
        AND d.dropped_at >= ${from}::timestamp AND d.dropped_at <= ${to}::timestamp`),
  ]);

  const one = (result: { rows: Record<string, unknown>[] }) => result.rows[0] ?? {};
  return {
    cashSales: Number(one(sales).cash_sales ?? 0),
    nonCashSales: Number(one(sales).non_cash_sales ?? 0),
    cashRepayments: Number(one(repayments).cash_repayments ?? 0),
    expensesCashOut: Number(one(expensesOut).cash_out ?? 0),
    expensesNonCashOut: Number(one(expensesOut).non_cash_out ?? 0),
    cashDropsTotal: Number(one(drops).drops_total ?? 0),
  };
}
