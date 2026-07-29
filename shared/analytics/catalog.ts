/**
 * Analytics Explorer — the measure and dimension catalog.
 *
 * Phase 0 covers the sales cubes only. Every formula here is transcribed from
 * SalesRepository.getProfitLossSummary so the Explorer and the P&L report agree
 * to the cent; scripts/analytics-parity.ts proves it against a live database.
 *
 * Browser-safe: no drizzle, no `sql`.
 */

import type { CubeDef, CubeId, DimensionDef, MeasureDef } from "./model";
import {
  OPERATIONS_CUBES,
  OPERATIONS_DIMENSIONS,
  OPERATIONS_MEASURES,
} from "./catalog.operations";

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

const ALL_CUBES: readonly CubeId[] = [
  "sales_lines",
  "sales_receipts",
  "expenses",
  "consumables",
  "attendance",
  "payroll",
  "credit",
  "inventory",
  "customers",
  "bookings",
];

/**
 * Conformed across every cube, but NOT the same physical column anywhere: each
 * cube declares its own time column and kind, and the compiler emits the same
 * bucket *keys* from each. That is what makes it conformed.
 */
export const DATE_DIM: DimensionDef = {
  id: "date",
  label: "Date",
  type: "time",
  grains: ["day", "week", "biweek", "month", "quarter", "half", "year", "custom"],
  conformedOn: ALL_CUBES,
  description: "Bucketed in the store's own timezone, not UTC.",
};

export const STORE_DIM: DimensionDef = {
  id: "store",
  label: "Store",
  type: "entity",
  conformedOn: ALL_CUBES,
  lookup: { endpoint: "/api/stores", labelKey: "name" },
  drillTo: "sales.staff",
  description: "Always available, and always the tenancy predicate.",
};

export const SALES_ITEM_DIM: DimensionDef = {
  id: "sales.item",
  label: "Item (variant)",
  type: "entity",
  // On `consumables` this is the SUPPLY that was drawn down, not the service that
  // drew it — that is consumables.consuming_item.
  conformedOn: ["sales_lines", "inventory", "consumables"],
  lookup: { endpoint: "/api/inventory", labelKey: "name" },
  description: "A single sellable SKU — the inventory row, not the product group.",
};

export const SALES_PRODUCT_DIM: DimensionDef = {
  id: "sales.product",
  label: "Product (group)",
  type: "entity",
  conformedOn: ["sales_lines", "inventory", "consumables"],
  lookup: { endpoint: "/api/products", labelKey: "name" },
  drillTo: "sales.item",
};

export const SALES_CATEGORY_DIM: DimensionDef = {
  id: "sales.category",
  label: "Category",
  type: "categorical",
  conformedOn: ["sales_lines", "inventory"],
  drillTo: "sales.product",
  description: "From the product group — inventory rows carry no category of their own.",
};

export const SALES_BRAND_DIM: DimensionDef = {
  id: "sales.brand",
  label: "Brand",
  type: "categorical",
  conformedOn: ["sales_lines", "inventory"],
  drillTo: "sales.product",
};

export const SALES_ITEM_TYPE_DIM: DimensionDef = {
  id: "sales.item_type",
  label: "Item Type",
  type: "categorical",
  conformedOn: ["sales_lines", "inventory"],
  // 'supply' never appears on sales_lines — back-bar consumables are unsellable —
  // but it does on the inventory (restock) cube, which is how you ask what a store
  // spends replenishing supplies.
  enumValues: ["product", "service", "supply"],
};

export const SALES_CUSTOMER_DIM: DimensionDef = {
  id: "sales.customer",
  label: "Customer",
  type: "entity",
  // Not on the sales cubes: `checkouts` carries no customer_id — the link runs
  // through `transactions`. Revisit when the transactions cube lands.
  conformedOn: ["credit", "customers", "bookings"],
  lookup: { endpoint: "/api/customers", labelKey: "name" },
};

export const SALES_STAFF_DIM: DimensionDef = {
  id: "sales.staff",
  label: "Staff",
  type: "entity",
  conformedOn: ["sales_receipts", "attendance", "payroll", "bookings"],
  lookup: { endpoint: "/api/staff", labelKey: "name" },
  description:
    "The staff member who rang up the sale. Lead/assistant attribution is a separate measure.",
};

export const SALES_PAYMENT_METHOD_DIM: DimensionDef = {
  id: "sales.payment_method",
  label: "Payment method",
  type: "categorical",
  conformedOn: ["sales_receipts"],
  enumValues: ["cash", "transfer", "flutterwave", "credit", "split"],
};

export const DIMENSIONS: readonly DimensionDef[] = [
  DATE_DIM,
  STORE_DIM,
  SALES_ITEM_DIM,
  SALES_PRODUCT_DIM,
  SALES_CATEGORY_DIM,
  SALES_BRAND_DIM,
  SALES_ITEM_TYPE_DIM,
  SALES_CUSTOMER_DIM,
  SALES_STAFF_DIM,
  SALES_PAYMENT_METHOD_DIM,
  ...OPERATIONS_DIMENSIONS,
];

// ---------------------------------------------------------------------------
// Measures — sales_lines (line grain, safe to SUM)
// ---------------------------------------------------------------------------

const LINE_DIMS = [
  "date",
  "store",
  "sales.item",
  "sales.product",
  "sales.category",
  "sales.brand",
  "sales.item_type",
] as const;

export const SALES_MEASURES: readonly MeasureDef[] = [
  {
    id: "sales.net_revenue",
    cube: "sales_lines",
    label: "Net Revenue",
    description:
      "SUM(GREATEST(order.total_price - order.refunded_amount, 0)) over completed, non-voided " +
      "checkout lines. Matches totalRevenue on the Profit & Loss report. Not attributable to a " +
      "staff member — use Attributed Revenue for that.",
    format: "currency",
    additivity: "flow",
    polarity: "higher_is_better",
    dimensions: LINE_DIMS,
  },
  {
    id: "sales.gross_revenue",
    cube: "sales_lines",
    label: "Gross Revenue",
    description:
      "SUM(order.total_price) before refunds are deducted. Note this is NOT clamped per line, " +
      "so Gross Revenue - Returned Revenue can differ slightly from Net Revenue when a single " +
      "line was refunded for more than it sold for.",
    format: "currency",
    additivity: "flow",
    polarity: "higher_is_better",
    dimensions: LINE_DIMS,
  },
  {
    id: "sales.returned_revenue",
    cube: "sales_lines",
    label: "Returned Revenue",
    description: "SUM(order.refunded_amount) over completed, non-voided checkout lines.",
    format: "currency",
    additivity: "flow",
    polarity: "lower_is_better",
    dimensions: LINE_DIMS,
  },
  {
    id: "sales.service_revenue",
    cube: "sales_lines",
    label: "Service Revenue",
    description: "Net Revenue restricted to lines whose inventory type is 'service'.",
    format: "currency",
    additivity: "flow",
    polarity: "higher_is_better",
    dimensions: LINE_DIMS,
  },
  {
    id: "sales.product_revenue",
    cube: "sales_lines",
    label: "Product Revenue",
    description:
      "Net Revenue restricted to lines whose inventory type is not 'service'. " +
      "The P&L treats anything non-service as a product, so an unset type counts here.",
    format: "currency",
    additivity: "flow",
    polarity: "higher_is_better",
    dimensions: LINE_DIMS,
  },
  {
    id: "sales.cogs",
    cube: "sales_lines",
    label: "Cost of Goods Sold",
    description:
      "SUM(inventory.cost_price * GREATEST(order.quantity - order.returned_quantity, 0)). " +
      "Uses the item's cost price as it stands today, not the cost at time of sale.",
    format: "currency",
    additivity: "flow",
    polarity: "lower_is_better",
    minRole: "owner",
    dimensions: LINE_DIMS,
  },
  {
    id: "sales.units",
    cube: "sales_lines",
    label: "Units Sold",
    description: "SUM(GREATEST(order.quantity - order.returned_quantity, 0)). Fractional quantities are supported.",
    format: "number",
    additivity: "flow",
    polarity: "higher_is_better",
    dimensions: LINE_DIMS,
  },
  {
    id: "sales.line_items",
    cube: "sales_lines",
    label: "Line Items",
    description:
      "COUNT of checkout lines. This is NOT the number of receipts — a 3-item sale is 3 lines. " +
      "Use Receipts for transaction counts.",
    format: "integer",
    additivity: "flow",
    polarity: "neutral",
    dimensions: LINE_DIMS,
  },
  {
    id: "sales.gross_profit",
    cube: "sales_lines",
    label: "Gross Profit",
    description: "Net Revenue - Cost of Goods Sold.",
    format: "currency",
    additivity: "flow",
    polarity: "higher_is_better",
    minRole: "owner",
    derivedFrom: ["sales.net_revenue", "sales.cogs"],
    dimensions: LINE_DIMS,
  },
  {
    id: "sales.gross_margin",
    cube: "sales_lines",
    label: "Gross Margin %",
    description:
      "(Net Revenue - COGS) / Net Revenue x 100, recomputed at every roll-up level rather than " +
      "averaged. Null when Net Revenue is 0.",
    format: "percent",
    additivity: "ratio",
    polarity: "higher_is_better",
    minRole: "owner",
    derivedFrom: ["sales.net_revenue", "sales.cogs"],
    dimensions: LINE_DIMS,
  },

  // -------------------------------------------------------------------------
  // sales_receipts (receipt grain, deduplicated)
  // -------------------------------------------------------------------------
  {
    id: "sales.receipts",
    cube: "sales_receipts",
    label: "Receipts",
    description:
      "COUNT of distinct receipts (one per sale, however many items it contained).",
    format: "integer",
    additivity: "flow",
    polarity: "higher_is_better",
    dimensions: ["date", "store", "sales.staff", "sales.payment_method"],
  },
  {
    id: "sales.discounts",
    cube: "sales_receipts",
    label: "Discounts Given",
    description:
      "SUM(discount_amount + points_redeemed * 10) per DISTINCT receipt. Checkouts replicate the " +
      "basket discount onto every line, so this deduplicates first. The Profit & Loss report does " +
      "not, and therefore over-reports discounts on multi-line sales.",
    format: "currency",
    additivity: "flow",
    polarity: "lower_is_better",
    dimensions: ["date", "store", "sales.staff", "sales.payment_method"],
  },
  {
    id: "sales.avg_basket",
    cube: "sales_receipts",
    label: "Average Basket",
    description:
      "Net Revenue / Receipts. Spans both sales cubes, so it is resolved after the drill-across join.",
    format: "currency",
    additivity: "ratio",
    polarity: "higher_is_better",
    derivedFrom: ["sales.net_revenue", "sales.receipts"],
    dimensions: ["date", "store"],
  },
];

// ---------------------------------------------------------------------------
// Cubes
// ---------------------------------------------------------------------------

export const CUBES: readonly CubeDef[] = [
  ...OPERATIONS_CUBES,
  {
    id: "sales_lines",
    label: "Sales — line items",
    rowGrain: "One row per item sold on a receipt.",
    conformedDimensions: ["date", "store"],
    measures: SALES_MEASURES.filter((m) => m.cube === "sales_lines").map((m) => m.id),
    dimensions: [...LINE_DIMS],
  },
  {
    id: "sales_receipts",
    label: "Sales — receipts",
    rowGrain: "One row per receipt, regardless of how many items it contained.",
    conformedDimensions: ["date", "store"],
    measures: SALES_MEASURES.filter((m) => m.cube === "sales_receipts").map((m) => m.id),
    dimensions: ["date", "store", "sales.staff", "sales.payment_method"],
  },
];

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const MEASURES: readonly MeasureDef[] = [...SALES_MEASURES, ...OPERATIONS_MEASURES];

const MEASURE_BY_ID = new Map(MEASURES.map((m) => [m.id, m]));
const DIMENSION_BY_ID = new Map(DIMENSIONS.map((d) => [d.id, d]));
const CUBE_BY_ID = new Map(CUBES.map((c) => [c.id, c]));

export function getMeasure(id: string): MeasureDef | undefined {
  return MEASURE_BY_ID.get(id);
}

export function getDimension(id: string): DimensionDef | undefined {
  return DIMENSION_BY_ID.get(id);
}

export function getCube(id: CubeId): CubeDef | undefined {
  return CUBE_BY_ID.get(id);
}

export function listMeasureIds(): string[] {
  return Array.from(MEASURE_BY_ID.keys());
}

export function listDimensionIds(): string[] {
  return Array.from(DIMENSION_BY_ID.keys());
}

/**
 * Cubes a set of measures touches, including those pulled in transitively by
 * `derivedFrom` (avg_basket names a receipts measure and a lines measure).
 */
export function resolveCubes(measureIds: readonly string[]): CubeId[] {
  const cubes = new Set<CubeId>();
  const seen = new Set<string>();

  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const measure = MEASURE_BY_ID.get(id);
    if (!measure) return;
    cubes.add(measure.cube);
    for (const dep of measure.derivedFrom ?? []) visit(dep);
  };

  for (const id of measureIds) visit(id);
  return Array.from(cubes);
}

/**
 * Expands a measure list to include every `derivedFrom` dependency, so the
 * compiler knows to actually select the inputs a derived measure needs.
 */
export function expandMeasureDependencies(measureIds: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const measure = MEASURE_BY_ID.get(id);
    if (!measure) return;
    for (const dep of measure.derivedFrom ?? []) visit(dep);
    out.push(id);
  };

  for (const id of measureIds) visit(id);
  return out;
}

/**
 * Role-filtered catalog for GET /api/analytics/model. Managers never receive the
 * owner-only measures, so they cannot be requested from the UI — the query
 * endpoint enforces the same rule independently.
 */
export function catalogForRole(role: string): {
  cubes: readonly CubeDef[];
  measures: readonly MeasureDef[];
  dimensions: readonly DimensionDef[];
} {
  const measures =
    role === "owner" ? MEASURES : MEASURES.filter((m) => m.minRole !== "owner");
  const allowed = new Set(measures.map((m) => m.id));

  return {
    cubes: CUBES.map((c) => ({
      ...c,
      measures: c.measures.filter((id) => allowed.has(id)),
    })),
    measures,
    dimensions: DIMENSIONS,
  };
}
