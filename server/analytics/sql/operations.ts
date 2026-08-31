/**
 * Analytics Explorer — SQL bindings for the non-sales domains.
 *
 * The point of these cubes is cross-domain comparison: "did staffing track
 * revenue", "is the expense ratio drifting per store". They therefore all expose
 * the conformed {date, store} pair, and the people-shaped ones also expose staff.
 *
 * Watch the time column KIND. expenses.date, attendance_records.date and
 * payroll_periods.start_date are `text` 'YYYY-MM-DD' already written in
 * store-local wall clock; declaring them `local_date_text` is what stops the
 * compiler applying a timezone conversion that would shift them by a day.
 */

import { sql } from "drizzle-orm";
import type { CubeSql } from "./types";

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

// The `ec.name = 'Payroll'` guards in the measures below are a COMPATIBILITY
// SHIM. Payroll no longer writes a mirror expense row, and migration 0040
// soft-deletes the historical ones; these guards only still matter for a
// database where 0040 has not run. Remove them (and the one in
// AnalyticsService.getProfitLossSummary) once 0040 is applied everywhere —
// removing them sooner would double count every historical payroll run.
export const expensesCube: CubeSql = {
  id: "expenses",

  buildFrom: () => sql`
    expenses e
      JOIN stores s ON s.id = e.store_id
      LEFT JOIN expense_categories ec ON ec.id = e.category_id
  `,

  tenantColumn: sql`e.store_id`,
  basePredicate: sql`e.is_deleted = false`,

  // Already store-local — see the file header.
  time: { column: sql`e.date`, kind: "local_date_text" },

  measures: {
    /**
     * Excludes the system "Payroll" category, which AnalyticsService also
     * excludes, because paid payroll periods are counted by the payroll cube.
     * Summing both without this would double-count wages.
     */
    "expenses.operating_amount": {
      kind: "agg",
      agg: sql`COALESCE(SUM(CASE WHEN ec.is_system = true AND ec.name = 'Payroll' THEN 0 ELSE e.amount END), 0)`,
    },
    "expenses.total_amount": {
      kind: "agg",
      agg: sql`COALESCE(SUM(e.amount), 0)`,
    },
    /**
     * Split of operating_amount by cost class — the two sum back to it exactly.
     * Both carry the same Payroll exclusion, for the same reason.
     */
    "expenses.overhead_amount": {
      kind: "agg",
      agg: sql`COALESCE(SUM(CASE WHEN (ec.is_system = true AND ec.name = 'Payroll') OR COALESCE(e.cost_class, 'overhead') <> 'overhead' THEN 0 ELSE e.amount END), 0)`,
    },
    "expenses.direct_supply_amount": {
      kind: "agg",
      agg: sql`COALESCE(SUM(CASE WHEN (ec.is_system = true AND ec.name = 'Payroll') OR COALESCE(e.cost_class, 'overhead') <> 'direct_supply' THEN 0 ELSE e.amount END), 0)`,
    },
    "expenses.count": { kind: "agg", agg: sql`COUNT(*)` },
  },

  dimensions: {
    store: sql`e.store_id`,
    "expenses.category": sql`COALESCE(ec.name, 'Uncategorised')`,
    "expenses.payment_method": sql`COALESCE(e.payment_method, 'unknown')`,
    "expenses.cost_class": sql`COALESCE(e.cost_class, 'overhead')`,
  },
};

// ---------------------------------------------------------------------------
// Consumables
// ---------------------------------------------------------------------------

/**
 * Back-bar supply drawn down by service recipes.
 *
 * Liveness is derived, not stored: order_consumables carries no status, so the
 * join to `checkouts` plus `is_voided = false` is what makes a voided sale drop
 * out. A RETURNED sale deliberately does not drop out — the product was still
 * used — which is why there is no returned_quantity clamp here.
 *
 * Time comes from the checkout rather than order_consumables.created_at: an
 * addendum writes its checkout with the ORIGINAL sale date, so this lands the cost
 * in the period the service was actually delivered.
 */
export const consumablesCube: CubeSql = {
  id: "consumables",

  buildFrom: () => sql`
    order_consumables oc
      JOIN orders    o ON o.id = oc.order_id
      JOIN checkouts c ON c.order_id = o.id
      JOIN inventory i ON i.id = oc.supply_inventory_id
      JOIN products  p ON p.id = i.product_id
      JOIN stores    s ON s.id = c.store_id
  `,

  tenantColumn: sql`c.store_id`,
  basePredicate: sql`c.payment_status = 'completed' AND c.is_voided = false`,

  time: {
    column: sql`c.created_at`,
    kind: "utc_timestamp",
    timezoneColumn: sql`s.timezone`,
  },

  measures: {
    // Cast for the same reason the sales money columns are cast — see sales.ts.
    "consumables.recipe_cost": {
      kind: "agg",
      agg: sql`COALESCE(SUM((oc.total_cost)::numeric), 0)`,
    },
    "consumables.units_used": {
      kind: "agg",
      agg: sql`COALESCE(SUM((oc.quantity_used)::numeric), 0)`,
    },
    "consumables.supplies_touched": {
      kind: "agg",
      agg: sql`COUNT(DISTINCT oc.supply_inventory_id)`,
    },
  },

  dimensions: {
    store: sql`c.store_id`,
    "sales.item": sql`oc.supply_inventory_id`,
    "sales.product": sql`i.product_id`,
    "consumables.consuming_item": sql`o.inventory_id`,
  },
};

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

export const attendanceCube: CubeSql = {
  id: "attendance",

  buildFrom: () => sql`
    attendance_records ar
      JOIN stores s ON s.id = ar.store_id
  `,

  tenantColumn: sql`ar.store_id`,
  time: { column: sql`ar.date`, kind: "local_date_text" },

  measures: {
    "attendance.present_days": {
      kind: "agg",
      agg: sql`COUNT(*) FILTER (WHERE ar.status = 'present')`,
    },
    "attendance.absent_days": {
      kind: "agg",
      agg: sql`COUNT(*) FILTER (WHERE ar.status = 'absent')`,
    },
    "attendance.leave_days": {
      kind: "agg",
      agg: sql`COUNT(*) FILTER (WHERE ar.status = 'leave')`,
    },
    "attendance.recorded_days": { kind: "agg", agg: sql`COUNT(*)` },
    "attendance.attendance_rate": {
      kind: "derived",
      derive: (v) => {
        const recorded = v["attendance.recorded_days"] ?? 0;
        if (recorded === 0) return null;
        return ((v["attendance.present_days"] ?? 0) / recorded) * 100;
      },
    },
  },

  dimensions: {
    store: sql`ar.store_id`,
    "sales.staff": sql`ar.staff_id`,
    "attendance.status": sql`ar.status`,
  },
};

// ---------------------------------------------------------------------------
// Payroll
// ---------------------------------------------------------------------------

/**
 * Bucketed by the PERIOD START, not by an entry timestamp: payroll is earned over
 * a period, and there is no per-entry date to attribute it to. Only approved and
 * paid periods count — a pending calculation is a draft, not a cost.
 */
export const payrollCube: CubeSql = {
  id: "payroll",

  // Reads the payroll ledger for money, and payroll_entries for the operational
  // measures that have no place in a ledger (days worked, headcount).
  //
  // net_pay used to come straight off pe.net_pay with the cube bucketing by
  // pp.start_date and counting 'approved' periods the P&L never counted — two
  // divergences from the statement for the same metric name. Both close by
  // sourcing it from wage_expense postings, which exist only once a period is
  // paid and are dated to the months the work was actually done in.
  buildFrom: () => sql`
    payroll_entries pe
      JOIN payroll_periods pp ON pp.id = pe.period_id
      JOIN stores s ON s.id = pe.store_id
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(pl.amount), 0) AS wage_expense
          FROM payroll_postings pl
         WHERE pl.period_id = pe.period_id
           AND pl.staff_id = pe.staff_id
           AND pl.account = 'wage_expense'
      ) ledger ON true
  `,

  tenantColumn: sql`pe.store_id`,
  basePredicate: sql`pp.status = 'paid'`,
  time: { column: sql`pp.start_date`, kind: "local_date_text" },

  measures: {
    "payroll.net_pay": { kind: "agg", agg: sql`COALESCE(SUM(ledger.wage_expense), 0)` },
    "payroll.gross_commission": {
      kind: "agg",
      agg: sql`COALESCE(SUM(pe.gross_commission), 0)`,
    },
    "payroll.transport": { kind: "agg", agg: sql`COALESCE(SUM(pe.total_transport), 0)` },
    "payroll.active_days": { kind: "agg", agg: sql`COALESCE(SUM(pe.active_days), 0)` },
    "payroll.headcount": { kind: "agg", agg: sql`COUNT(DISTINCT pe.staff_id)` },
  },

  dimensions: {
    store: sql`pe.store_id`,
    "sales.staff": sql`pe.staff_id`,
    "payroll.period_status": sql`pp.status`,
  },
};

// ---------------------------------------------------------------------------
// Credit (the "borrow book")
// ---------------------------------------------------------------------------

export const creditCube: CubeSql = {
  id: "credit",

  buildFrom: () => sql`
    credit_entries ce
      JOIN stores s ON s.id = ce.store_id
  `,

  tenantColumn: sql`ce.store_id`,
  basePredicate: sql`ce.status <> 'void'`,
  time: { column: sql`ce.created_at`, kind: "utc_timestamp", timezoneColumn: sql`s.timezone` },

  measures: {
    "credit.extended": { kind: "agg", agg: sql`COALESCE(SUM(ce.amount_owed), 0)` },
    /**
     * Outstanding balance is a STOCK measure: it is a position at a moment, not
     * a flow accumulated over the period. The additivity flag in the catalog
     * stops an empty bucket being filled with a fictitious zero balance.
     */
    "credit.outstanding": {
      kind: "agg",
      agg: sql`COALESCE(SUM(ce.outstanding_balance), 0)`,
    },
    "credit.written_off": {
      kind: "agg",
      agg: sql`COALESCE(SUM(CASE WHEN ce.status = 'written_off' THEN ce.outstanding_balance ELSE 0 END), 0)`,
    },
    "credit.entries": { kind: "agg", agg: sql`COUNT(*)` },
    "credit.overdue_entries": {
      kind: "agg",
      agg: sql`COUNT(*) FILTER (WHERE ce.status = 'overdue')`,
    },
  },

  dimensions: {
    store: sql`ce.store_id`,
    "sales.customer": sql`ce.customer_id`,
    "credit.status": sql`ce.status`,
  },
};

// ---------------------------------------------------------------------------
// Inventory movement
// ---------------------------------------------------------------------------

/**
 * Restock EVENTS, not stock levels.
 *
 * A cube needs a date to bucket by, and `inventory` holds only a current
 * quantity with no history — there is no honest way to answer "what did we hold
 * last Tuesday" from it. Restock events do have a timestamp, so this cube covers
 * purchasing activity. Stock-on-hand belongs in a snapshot table if it is ever
 * needed as a time series.
 */
export const inventoryCube: CubeSql = {
  id: "inventory",

  buildFrom: () => sql`
    inventory_restock_events ire
      JOIN inventory i ON i.id = ire.inventory_id
      JOIN products p ON p.id = i.product_id
      JOIN stores s ON s.id = ire.store_id
  `,

  tenantColumn: sql`ire.store_id`,
  time: {
    column: sql`ire.restocked_at`,
    kind: "utc_timestamp",
    timezoneColumn: sql`s.timezone`,
  },

  measures: {
    "inventory.restocked_units": {
      kind: "agg",
      agg: sql`COALESCE(SUM(ire.quantity_added), 0)`,
    },
    "inventory.restock_cost": {
      kind: "agg",
      agg: sql`COALESCE(SUM(ire.quantity_added * COALESCE(ire.unit_cost, 0)), 0)`,
    },
    "inventory.restock_events": { kind: "agg", agg: sql`COUNT(*)` },
  },

  dimensions: {
    store: sql`ire.store_id`,
    "sales.item": sql`i.id`,
    "sales.product": sql`p.id`,
    "sales.category": sql`COALESCE(p.category, 'Uncategorised')`,
    "sales.brand": sql`COALESCE(p.brand, 'Unbranded')`,
  },
};

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export const customersCube: CubeSql = {
  id: "customers",

  buildFrom: () => sql`
    customers cust
      JOIN stores s ON s.id = cust.store_id
  `,

  tenantColumn: sql`cust.store_id`,
  basePredicate: sql`cust.is_archived = false AND cust.merged_into_id IS NULL`,
  // Bucketed by signup date, so this measures acquisition.
  time: {
    column: sql`cust.created_at`,
    kind: "utc_timestamp",
    timezoneColumn: sql`s.timezone`,
  },

  measures: {
    "customers.new_customers": { kind: "agg", agg: sql`COUNT(*)` },
    "customers.loyalty_points": {
      kind: "agg",
      agg: sql`COALESCE(SUM(cust.loyalty_points), 0)`,
    },
    "customers.store_credit": {
      kind: "agg",
      agg: sql`COALESCE(SUM(cust.store_credit_balance), 0)`,
    },
  },

  dimensions: {
    store: sql`cust.store_id`,
    "sales.customer": sql`cust.id`,
  },
};

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------

export const bookingsCube: CubeSql = {
  id: "bookings",

  buildFrom: () => sql`
    bookings b
      JOIN stores s ON s.id = b.store_id
  `,

  tenantColumn: sql`b.store_id`,
  basePredicate: sql`b.is_deleted = false`,
  // Bucketed by when the work is scheduled, not when it was booked — that is the
  // question people actually ask of a diary.
  time: {
    column: sql`b.scheduled_at`,
    kind: "utc_timestamp",
    timezoneColumn: sql`s.timezone`,
  },

  measures: {
    "bookings.count": { kind: "agg", agg: sql`COUNT(*)` },
    "bookings.value": { kind: "agg", agg: sql`COALESCE(SUM(b.total_price), 0)` },
    "bookings.deposits": { kind: "agg", agg: sql`COALESCE(SUM(b.deposit_amount), 0)` },
    "bookings.completed": {
      kind: "agg",
      agg: sql`COUNT(*) FILTER (WHERE b.status = 'completed')`,
    },
    "bookings.no_shows": {
      kind: "agg",
      agg: sql`COUNT(*) FILTER (WHERE b.status = 'no_show')`,
    },
    "bookings.completion_rate": {
      kind: "derived",
      derive: (v) => {
        const total = v["bookings.count"] ?? 0;
        if (total === 0) return null;
        return ((v["bookings.completed"] ?? 0) / total) * 100;
      },
    },
  },

  dimensions: {
    store: sql`b.store_id`,
    "sales.staff": sql`b.lead_staff_id`,
    "sales.customer": sql`b.customer_id`,
    "bookings.status": sql`b.status`,
    "bookings.type": sql`b.type`,
  },
};
