/**
 * Analytics Explorer — the semantic model.
 *
 * This file is the *catalog* half of the model: ids, labels, formats, and which
 * cube each measure belongs to. It is imported by the browser, so it must stay
 * free of drizzle and of any `sql` template. The matching SQL bindings live
 * server-side under server/analytics/sql/, keyed by the same ids, and
 * `assertBindingsComplete()` proves at boot that the two halves agree.
 */

/**
 * A cube is one fact table at one grain. Splitting sales into two cubes is not
 * stylistic: `checkouts` stores basket-level values (discount, points, subtotal)
 * replicated onto every line of the receipt, so summing them at line grain
 * multiplies them by the line count. `sales_lines` holds what is safe to SUM;
 * `sales_receipts` deduplicates to one row per receipt for the rest.
 */
export type CubeId =
  | "sales_lines"
  | "sales_receipts"
  | "expenses"
  | "consumables"
  | "attendance"
  | "payroll"
  | "credit"
  | "inventory"
  | "customers"
  | "bookings";

export type ValueFormat =
  | "currency"
  | "number"
  | "integer"
  | "percent"
  | "ratio"
  | "days";

export type Grain =
  | "day"
  | "week"
  | "biweek"
  | "month"
  | "quarter"
  | "half"
  | "year"
  | "custom";

export type DimensionType = "time" | "entity" | "categorical" | "boolean";

/**
 * Governs how an empty bucket is filled and whether a measure may be summed
 * over time. Getting this wrong is how analytics tools quietly lie: filling a
 * stock measure with 0 invents a day where the business held no inventory.
 */
export type Additivity =
  /** Sums over time; a bucket with no rows genuinely is 0. Revenue, expense amount. */
  | "flow"
  /** Point-in-time; a bucket with no rows is unknown, not 0. Closing stock, headcount. */
  | "stock"
  /** Never summed; recomputed from its parts at every roll-up level. Margin %, avg basket. */
  | "ratio";

export type Polarity = "higher_is_better" | "lower_is_better" | "neutral";

/** How a cube's time column relates to wall-clock time in the store's timezone. */
export type TimeColumnKind =
  /** `timestamp without time zone` holding UTC. Needs AT TIME ZONE conversion to bucket. */
  | "utc_timestamp"
  /** `text` 'YYYY-MM-DD' already written in store-local wall clock. Must NOT be converted. */
  | "local_date_text";

export interface DimensionDef {
  /** Stable id, e.g. "date", "store", "sales.category". */
  id: string;
  label: string;
  type: DimensionType;
  /**
   * Cubes on which this dimension exists with IDENTICAL member keys.
   *
   * This is what makes a cross-cube query legitimate. A dimension that merely
   * shares a *name* across two cubes is not conformed; the keys must be the
   * same values, or joining on them fabricates rows.
   */
  conformedOn: readonly CubeId[];
  /** Time dimensions only. */
  grains?: readonly Grain[];
  /** Entity dimensions: where the filter picker fetches member labels. */
  lookup?: { endpoint: string; labelKey: string };
  /** Enumerable without a query — lets the picker offer values immediately. */
  enumValues?: readonly string[];
  /** One level down, for click-to-drill. */
  drillTo?: string;
  description?: string;
}

export interface MeasureDef {
  /** Stable id, e.g. "sales.net_revenue". */
  id: string;
  cube: CubeId;
  label: string;
  /**
   * Shown verbatim in the UI tooltip, and it is the contract for what the number
   * means. State the exact formula and any deliberate divergence from an existing
   * report — the alternative is a support ticket every time two screens differ.
   */
  description: string;
  format: ValueFormat;
  additivity: Additivity;
  polarity: Polarity;
  /**
   * Ids this measure is computed from, in JS, AFTER aggregation. A ratio must be
   * derived this way and never AVG()'d, or it comes out wrong at every roll-up
   * level above the leaf (the average of daily margins is not the period margin).
   */
  derivedFrom?: readonly string[];
  /** Dimension ids this measure may legitimately be sliced by. */
  dimensions: readonly string[];
  /** Owner-only measures (cost price, margin) are stripped from a manager's catalog. */
  minRole?: "owner";
  /** Selecting this alongside any of these double-counts; the API returns a warning. */
  conflictsWith?: readonly string[];
}

export interface CubeDef {
  id: CubeId;
  label: string;
  /** Human description of what one row is. Surfaced in the UI — grain confusion is the #1 source of wrong numbers. */
  rowGrain: string;
  conformedDimensions: readonly string[];
  measures: readonly string[];
  dimensions: readonly string[];
}

export type FilterOperator =
  | "eq"
  | "neq"
  | "in"
  | "not_in"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "between"
  | "contains"
  | "starts_with"
  | "is_null"
  | "is_not_null";

export interface Filter {
  /** Must resolve in the dimension registry — never used as a raw SQL identifier. */
  dimension: string;
  op: FilterOperator;
  /** Bound as query parameters, never interpolated into SQL text. */
  values: (string | number | boolean)[];
}

/** Which operators make sense for which dimension type. Enforced during compilation. */
export const OPERATORS_BY_DIMENSION_TYPE: Record<DimensionType, readonly FilterOperator[]> = {
  time: ["eq", "neq", "gt", "gte", "lt", "lte", "between"],
  entity: ["eq", "neq", "in", "not_in", "is_null", "is_not_null"],
  categorical: [
    "eq",
    "neq",
    "in",
    "not_in",
    "contains",
    "starts_with",
    "is_null",
    "is_not_null",
  ],
  boolean: ["eq", "neq"],
};

/** Operators that take no values at all. */
export const NULLARY_OPERATORS: readonly FilterOperator[] = ["is_null", "is_not_null"];

/** Operators that take exactly two values. */
export const BINARY_OPERATORS: readonly FilterOperator[] = ["between"];

/** Statistical transforms available on correlation and scatter surfaces. */
export type StatTransform = "none" | "pct_change" | "difference";

export type IndicatorType =
  | "sma"
  | "ema"
  | "rsi"
  | "pct_change"
  | "difference"
  | "zscore"
  | "momentum";

export interface IndicatorSpec {
  type: IndicatorType;
  /** Measure id the indicator is computed on. Must be one of the query's measures. */
  on: string;
  period?: number;
}

export type ComparePeriod = "none" | "previous_period" | "previous_year";

/** How multiple measures with differing units share (or don't share) a y-axis. */
export type YAxisMode = "shared" | "panels" | "indexed";

export type VizType =
  | "table"
  | "line"
  | "area"
  | "bar"
  | "stacked_bar"
  | "pie"
  | "scatter"
  | "heatmap"
  | "kpi";

/** Column descriptor in the query response envelope. */
export interface ResultColumn {
  ref: string;
  kind: "dimension" | "measure" | "stat";
  label: string;
  format: ValueFormat;
  cube?: CubeId;
}

export type ResultRow = Record<string, string | number | null>;
