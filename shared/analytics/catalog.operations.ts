/**
 * Analytics Explorer — catalog for the non-sales domains.
 *
 * Split from catalog.ts purely for file size; it is the same registry. The
 * measures here exist so the Explorer can answer cross-domain questions, which
 * is why almost all of them carry the conformed {date, store} pair.
 */

import type { CubeDef, DimensionDef, MeasureDef } from "./model";

// ---------------------------------------------------------------------------
// Domain-local dimensions
// ---------------------------------------------------------------------------

export const OPERATIONS_DIMENSIONS: readonly DimensionDef[] = [
  {
    id: "expenses.category",
    label: "Expense category",
    type: "categorical",
    conformedOn: ["expenses"],
  },
  {
    id: "expenses.payment_method",
    label: "Expense payment method",
    type: "categorical",
    conformedOn: ["expenses"],
  },
  {
    id: "expenses.cost_class",
    label: "Cost class",
    type: "categorical",
    conformedOn: ["expenses"],
    enumValues: ["overhead", "direct_supply"],
    description:
      "Which line of the Profit & Loss a cost takes: overheads sit in Operating Expenses, " +
      "direct supplies in Direct Supplies & Consumables. Decided by what the cost is, not " +
      "by whether it is linked to an item.",
  },
  {
    id: "consumables.consuming_item",
    label: "Consumed by (service)",
    type: "entity",
    conformedOn: ["consumables"],
    lookup: { endpoint: "/api/inventory", labelKey: "name" },
    description: "The service whose recipe drew the supply down — not the supply itself.",
  },
  {
    id: "attendance.status",
    label: "Attendance status",
    type: "categorical",
    conformedOn: ["attendance"],
    enumValues: ["present", "absent", "off_day", "holiday", "leave"],
  },
  {
    id: "payroll.period_status",
    label: "Payroll period status",
    type: "categorical",
    conformedOn: ["payroll"],
    enumValues: ["approved", "paid"],
  },
  {
    id: "credit.status",
    label: "Credit status",
    type: "categorical",
    conformedOn: ["credit"],
    enumValues: ["owing", "partial", "overdue", "settled", "written_off"],
  },
  {
    id: "bookings.status",
    label: "Booking status",
    type: "categorical",
    conformedOn: ["bookings"],
    enumValues: [
      "pending",
      "confirmed",
      "in_progress",
      "completed",
      "cancelled",
      "no_show",
      "rescheduled",
    ],
  },
  {
    id: "bookings.type",
    label: "Booking type",
    type: "categorical",
    conformedOn: ["bookings"],
    enumValues: ["appointment", "order"],
  },
];

const DS = ["date", "store"] as const;
const DSS = ["date", "store", "sales.staff"] as const;

// ---------------------------------------------------------------------------
// Measures
// ---------------------------------------------------------------------------

export const OPERATIONS_MEASURES: readonly MeasureDef[] = [
  // ── Expenses ─────────────────────────────────────────────────────────────
  {
    id: "expenses.operating_amount",
    cube: "expenses",
    label: "Operating Expenses",
    description:
      "SUM(expenses.amount) EXCLUDING the system 'Payroll' category, which the payroll " +
      "measures already account for. Covers the expenses table only: the Profit & Loss " +
      "report's operating expenses ALSO include recipe consumables, which live on the " +
      "consumables cube. Use Operating Expenses (incl. consumables) to reconcile to it.",
    format: "currency",
    additivity: "flow",
    polarity: "lower_is_better",
    dimensions: [...DS, "expenses.category", "expenses.payment_method", "expenses.cost_class"],
  },
  {
    id: "expenses.overhead_amount",
    cube: "expenses",
    label: "Overheads",
    description:
      "SUM(expenses.amount) for cost class 'overhead', excluding the system 'Payroll' " +
      "category. Rent, utilities and the like — costs not tied to delivering a specific job.",
    format: "currency",
    additivity: "flow",
    polarity: "lower_is_better",
    dimensions: [...DS, "expenses.category", "expenses.payment_method", "expenses.cost_class"],
  },
  {
    id: "expenses.direct_supply_amount",
    cube: "expenses",
    label: "Direct Supplies (expensed)",
    description:
      "SUM(expenses.amount) for cost class 'direct_supply'. Consumables bought and expensed " +
      "outright, WITHOUT going through supply stock. Supplies that are stocked and drawn " +
      "down by a recipe are counted by Recipe Consumable Cost instead — the two together " +
      "make the Profit & Loss report's Direct Supplies line.",
    format: "currency",
    additivity: "flow",
    polarity: "lower_is_better",
    dimensions: [...DS, "expenses.category", "expenses.payment_method", "expenses.cost_class"],
  },
  {
    id: "expenses.total_amount",
    cube: "expenses",
    label: "Total Expenses (incl. payroll category)",
    description:
      "SUM(expenses.amount) with nothing excluded. Selecting this alongside a payroll " +
      "measure counts wages twice — prefer Operating Expenses.",
    format: "currency",
    additivity: "flow",
    polarity: "lower_is_better",
    conflictsWith: ["payroll.net_pay"],
    dimensions: [...DS, "expenses.category", "expenses.payment_method"],
  },
  {
    id: "expenses.count",
    cube: "expenses",
    label: "Expense Entries",
    description: "COUNT of expense records.",
    format: "integer",
    additivity: "flow",
    polarity: "neutral",
    dimensions: [...DS, "expenses.category", "expenses.payment_method", "expenses.cost_class"],
  },

  // ── Consumables ──────────────────────────────────────────────────────────
  {
    id: "consumables.recipe_cost",
    cube: "consumables",
    label: "Recipe Consumable Cost",
    description:
      "SUM(order_consumables.total_cost) over completed, non-voided sales. What back-bar " +
      "supplies cost as services consumed them, valued at the supply's cost price AT THE " +
      "TIME OF SALE — restocking later does not rewrite it. A voided sale drops out; a " +
      "returned one does not, because the product was still used.",
    format: "currency",
    additivity: "flow",
    polarity: "lower_is_better",
    minRole: "owner",
    dimensions: [...DS, "sales.item", "sales.product", "consumables.consuming_item"],
  },
  {
    id: "consumables.units_used",
    cube: "consumables",
    label: "Supply Units Used",
    description:
      "SUM(order_consumables.quantity_used), in whatever unit the supply is stocked in " +
      "(ml, g, each). Mixing supplies with different units makes this meaningless — filter " +
      "to one supply before reading it.",
    format: "number",
    additivity: "flow",
    polarity: "neutral",
    dimensions: [...DS, "sales.item", "sales.product", "consumables.consuming_item"],
  },
  {
    id: "consumables.supplies_touched",
    cube: "consumables",
    label: "Distinct Supplies Used",
    description: "COUNT(DISTINCT supply) drawn down in the period.",
    format: "integer",
    additivity: "stock",
    polarity: "neutral",
    dimensions: [...DS, "sales.item", "sales.product", "consumables.consuming_item"],
  },

  // ── Attendance ───────────────────────────────────────────────────────────
  {
    id: "attendance.present_days",
    cube: "attendance",
    label: "Days Present",
    description: "COUNT of attendance records with status 'present'.",
    format: "days",
    additivity: "flow",
    polarity: "higher_is_better",
    dimensions: [...DSS, "attendance.status"],
  },
  {
    id: "attendance.absent_days",
    cube: "attendance",
    label: "Days Absent",
    description: "COUNT of attendance records with status 'absent'.",
    format: "days",
    additivity: "flow",
    polarity: "lower_is_better",
    dimensions: [...DSS, "attendance.status"],
  },
  {
    id: "attendance.leave_days",
    cube: "attendance",
    label: "Days on Leave",
    description: "COUNT of attendance records with status 'leave'.",
    format: "days",
    additivity: "flow",
    polarity: "neutral",
    dimensions: [...DSS, "attendance.status"],
  },
  {
    id: "attendance.recorded_days",
    cube: "attendance",
    label: "Days Recorded",
    description: "COUNT of all attendance records, whatever the status.",
    format: "days",
    additivity: "flow",
    polarity: "neutral",
    dimensions: [...DSS, "attendance.status"],
  },
  {
    id: "attendance.attendance_rate",
    cube: "attendance",
    label: "Attendance Rate %",
    description:
      "Days Present / Days Recorded x 100, recomputed at every roll-up level. " +
      "Null when nothing was recorded.",
    format: "percent",
    additivity: "ratio",
    polarity: "higher_is_better",
    derivedFrom: ["attendance.present_days", "attendance.recorded_days"],
    dimensions: [...DSS],
  },

  // ── Payroll ──────────────────────────────────────────────────────────────
  {
    id: "payroll.net_pay",
    cube: "payroll",
    label: "Payroll Net Pay",
    description:
      "SUM(payroll_entries.net_pay) over APPROVED and PAID periods only, bucketed by the " +
      "period start date. Pending calculations are drafts and are excluded.",
    format: "currency",
    additivity: "flow",
    polarity: "lower_is_better",
    minRole: "owner",
    dimensions: [...DSS, "payroll.period_status"],
  },
  {
    id: "payroll.gross_commission",
    cube: "payroll",
    label: "Gross Commission",
    description: "SUM(payroll_entries.gross_commission) over approved and paid periods.",
    format: "currency",
    additivity: "flow",
    polarity: "neutral",
    minRole: "owner",
    dimensions: [...DSS, "payroll.period_status"],
  },
  {
    id: "payroll.transport",
    cube: "payroll",
    label: "Transport Allowance",
    description: "SUM(payroll_entries.total_transport) over approved and paid periods.",
    format: "currency",
    additivity: "flow",
    polarity: "lower_is_better",
    minRole: "owner",
    dimensions: [...DSS, "payroll.period_status"],
  },
  {
    id: "payroll.active_days",
    cube: "payroll",
    label: "Payroll Active Days",
    description: "SUM(payroll_entries.active_days) over approved and paid periods.",
    format: "days",
    additivity: "flow",
    polarity: "neutral",
    dimensions: [...DSS, "payroll.period_status"],
  },
  {
    id: "payroll.headcount",
    cube: "payroll",
    label: "Staff Paid",
    description: "COUNT(DISTINCT staff) appearing in approved or paid payroll entries.",
    format: "integer",
    additivity: "stock",
    polarity: "neutral",
    dimensions: [...DS, "payroll.period_status"],
  },

  // ── Credit ───────────────────────────────────────────────────────────────
  {
    id: "credit.extended",
    cube: "credit",
    label: "Credit Extended",
    description:
      "SUM(credit_entries.amount_owed) for entries CREATED in the period. Voided entries excluded.",
    format: "currency",
    additivity: "flow",
    polarity: "neutral",
    dimensions: [...DS, "sales.customer", "credit.status"],
  },
  {
    id: "credit.outstanding",
    cube: "credit",
    label: "Outstanding Balance",
    description:
      "SUM(credit_entries.outstanding_balance) for entries created in the period. This is a " +
      "position, not a flow — a period with no new credit leaves it blank rather than zero.",
    format: "currency",
    additivity: "stock",
    polarity: "lower_is_better",
    dimensions: [...DS, "sales.customer", "credit.status"],
  },
  {
    id: "credit.written_off",
    cube: "credit",
    label: "Bad Debt Written Off",
    description: "Outstanding balance of entries whose status is 'written_off'.",
    format: "currency",
    additivity: "flow",
    polarity: "lower_is_better",
    dimensions: [...DS, "sales.customer", "credit.status"],
  },
  {
    id: "credit.entries",
    cube: "credit",
    label: "Credit Entries",
    description: "COUNT of non-void credit entries created in the period.",
    format: "integer",
    additivity: "flow",
    polarity: "neutral",
    dimensions: [...DS, "sales.customer", "credit.status"],
  },
  {
    id: "credit.overdue_entries",
    cube: "credit",
    label: "Overdue Entries",
    description: "COUNT of credit entries currently marked overdue.",
    format: "integer",
    additivity: "flow",
    polarity: "lower_is_better",
    dimensions: [...DS, "sales.customer", "credit.status"],
  },

  // ── Inventory ────────────────────────────────────────────────────────────
  {
    id: "inventory.restocked_units",
    cube: "inventory",
    label: "Units Restocked",
    description: "SUM(inventory_restock_events.quantity_added).",
    format: "number",
    additivity: "flow",
    polarity: "neutral",
    dimensions: [...DS, "sales.item", "sales.product", "sales.category", "sales.brand"],
  },
  {
    id: "inventory.restock_cost",
    cube: "inventory",
    label: "Restock Cost",
    description:
      "SUM(quantity_added x unit_cost) at the cost recorded on the restock event, so it " +
      "reflects what was actually paid rather than today's cost price.",
    format: "currency",
    additivity: "flow",
    polarity: "lower_is_better",
    minRole: "owner",
    dimensions: [...DS, "sales.item", "sales.product", "sales.category", "sales.brand"],
  },
  {
    id: "inventory.restock_events",
    cube: "inventory",
    label: "Restock Events",
    description: "COUNT of restock events.",
    format: "integer",
    additivity: "flow",
    polarity: "neutral",
    dimensions: [...DS, "sales.item", "sales.product", "sales.category", "sales.brand"],
  },

  // ── Customers ────────────────────────────────────────────────────────────
  {
    id: "customers.new_customers",
    cube: "customers",
    label: "New Customers",
    description:
      "COUNT of customers whose record was CREATED in the period. Archived and merged-away " +
      "duplicates are excluded.",
    format: "integer",
    additivity: "flow",
    polarity: "higher_is_better",
    dimensions: [...DS, "sales.customer"],
  },
  {
    id: "customers.loyalty_points",
    cube: "customers",
    label: "Loyalty Points Held",
    description: "SUM(customers.loyalty_points) for customers acquired in the period.",
    format: "integer",
    additivity: "stock",
    polarity: "neutral",
    dimensions: [...DS, "sales.customer"],
  },
  {
    id: "customers.store_credit",
    cube: "customers",
    label: "Store Credit Held",
    description: "SUM(customers.store_credit_balance) for customers acquired in the period.",
    format: "currency",
    additivity: "stock",
    polarity: "neutral",
    dimensions: [...DS, "sales.customer"],
  },

  // ── Bookings ─────────────────────────────────────────────────────────────
  {
    id: "bookings.count",
    cube: "bookings",
    label: "Bookings",
    description: "COUNT of bookings, bucketed by when they are SCHEDULED, not when booked.",
    format: "integer",
    additivity: "flow",
    polarity: "higher_is_better",
    dimensions: [...DSS, "sales.customer", "bookings.status", "bookings.type"],
  },
  {
    id: "bookings.value",
    cube: "bookings",
    label: "Booking Value",
    description: "SUM(bookings.total_price), bucketed by scheduled date.",
    format: "currency",
    additivity: "flow",
    polarity: "higher_is_better",
    dimensions: [...DSS, "sales.customer", "bookings.status", "bookings.type"],
  },
  {
    id: "bookings.deposits",
    cube: "bookings",
    label: "Deposits Taken",
    description: "SUM(bookings.deposit_amount), bucketed by scheduled date.",
    format: "currency",
    additivity: "flow",
    polarity: "higher_is_better",
    dimensions: [...DSS, "sales.customer", "bookings.status", "bookings.type"],
  },
  {
    id: "bookings.completed",
    cube: "bookings",
    label: "Bookings Completed",
    description: "COUNT of bookings with status 'completed'.",
    format: "integer",
    additivity: "flow",
    polarity: "higher_is_better",
    dimensions: [...DSS, "sales.customer", "bookings.status", "bookings.type"],
  },
  {
    id: "bookings.no_shows",
    cube: "bookings",
    label: "No-shows",
    description: "COUNT of bookings with status 'no_show'.",
    format: "integer",
    additivity: "flow",
    polarity: "lower_is_better",
    dimensions: [...DSS, "sales.customer", "bookings.status", "bookings.type"],
  },
  {
    id: "bookings.completion_rate",
    cube: "bookings",
    label: "Completion Rate %",
    description:
      "Bookings Completed / Bookings x 100, recomputed at every roll-up level.",
    format: "percent",
    additivity: "ratio",
    polarity: "higher_is_better",
    derivedFrom: ["bookings.completed", "bookings.count"],
    dimensions: [...DSS],
  },
];

// ---------------------------------------------------------------------------
// Cubes
// ---------------------------------------------------------------------------

const measuresFor = (cube: string) =>
  OPERATIONS_MEASURES.filter((m) => m.cube === cube).map((m) => m.id);

export const OPERATIONS_CUBES: readonly CubeDef[] = [
  {
    id: "expenses",
    label: "Expenses",
    rowGrain: "One row per expense record.",
    conformedDimensions: ["date", "store"],
    measures: measuresFor("expenses"),
    dimensions: ["date", "store", "expenses.category", "expenses.payment_method", "expenses.cost_class"],
  },
  {
    id: "consumables",
    label: "Consumables",
    rowGrain: "One row per sale line per supply consumed.",
    conformedDimensions: ["date", "store"],
    measures: measuresFor("consumables"),
    dimensions: ["date", "store", "sales.item", "sales.product", "consumables.consuming_item"],
  },
  {
    id: "attendance",
    label: "Attendance",
    rowGrain: "One row per staff member per day.",
    conformedDimensions: ["date", "store", "sales.staff"],
    measures: measuresFor("attendance"),
    dimensions: ["date", "store", "sales.staff", "attendance.status"],
  },
  {
    id: "payroll",
    label: "Payroll",
    rowGrain: "One row per staff member per payroll period (approved or paid only).",
    conformedDimensions: ["date", "store", "sales.staff"],
    measures: measuresFor("payroll"),
    dimensions: ["date", "store", "sales.staff", "payroll.period_status"],
  },
  {
    id: "credit",
    label: "Credit (Borrow Book)",
    rowGrain: "One row per credit entry.",
    conformedDimensions: ["date", "store"],
    measures: measuresFor("credit"),
    dimensions: ["date", "store", "sales.customer", "credit.status"],
  },
  {
    id: "inventory",
    label: "Inventory movement",
    rowGrain: "One row per restock event.",
    conformedDimensions: ["date", "store"],
    measures: measuresFor("inventory"),
    dimensions: [
      "date",
      "store",
      "sales.item",
      "sales.product",
      "sales.category",
      "sales.brand",
    ],
  },
  {
    id: "customers",
    label: "Customers",
    rowGrain: "One row per customer, bucketed by signup date.",
    conformedDimensions: ["date", "store"],
    measures: measuresFor("customers"),
    dimensions: ["date", "store", "sales.customer"],
  },
  {
    id: "bookings",
    label: "Bookings",
    rowGrain: "One row per booking, bucketed by scheduled date.",
    conformedDimensions: ["date", "store", "sales.staff"],
    measures: measuresFor("bookings"),
    dimensions: [
      "date",
      "store",
      "sales.staff",
      "sales.customer",
      "bookings.status",
      "bookings.type",
    ],
  },
];
