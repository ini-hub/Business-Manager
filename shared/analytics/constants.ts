/**
 * Analytics Explorer — shared constants.
 *
 * Safe to import from both the browser and the server: no drizzle, no `sql`.
 */

/**
 * Naira value of one loyalty point when a redemption is expressed as a discount.
 *
 * Hard-coded as a bare `* 10` in SalesRepository (twice) and AnalyticsService today.
 * Those call sites should import this instead so the Explorer and the P&L can never drift.
 */
export const LOYALTY_POINT_VALUE_NGN = 10;

/** Nominal length of each grain in days, used only to bound bucket counts before compiling. */
export const GRAIN_DAYS: Record<string, number> = {
  day: 1,
  week: 7,
  biweek: 14,
  month: 30,
  quarter: 91,
  half: 182,
  year: 365,
};

/**
 * Hard safety limits. These are the difference between a slow query and a downed server,
 * so they are enforced in zod (before any SQL exists) rather than trusted to the UI.
 */
export const ANALYTICS_LIMITS = {
  /** Postgres `statement_timeout` for a single Explorer query. */
  statementTimeoutMs: 15_000,
  /** Rejected in `superRefine` from (to - from) / GRAIN_DAYS[grain]. */
  maxBuckets: 1_500,
  maxMeasures: 12,
  maxDimensions: 3,
  maxFilters: 20,
  maxHaving: 5,
  maxOrderBy: 3,
  maxStores: 50,
  maxRows: 5_000,
  defaultRows: 1_000,
  /** buckets x members x measures, checked after top-N resolution. */
  maxCells: 200_000,
  /** Cubes queried concurrently per request. */
  maxConcurrentCubes: 4,
  /** Applied automatically when a query groups by a dimension but sets no explicit topN. */
  implicitTopN: 50,
  maxTopN: 50,
  /** Measures accepted by the correlation matrix endpoint. */
  maxCorrelationMeasures: 8,
  /** Minimum paired observations before a correlation cell is reported at all. */
  minCorrelationN: 3,
  /** Series with |trend r| above this on raw levels get a spurious-correlation warning. */
  spuriousTrendThreshold: 0.9,
} as const;

/** Member key used when top-N folds the remaining dimension members together. */
export const OTHER_MEMBER_KEY = "__other__";
export const OTHER_MEMBER_LABEL = "Other";

/**
 * Separator for composite drill-across join keys.
 *
 * NUL is used deliberately: a Postgres `text` value cannot contain it, so the
 * keys ["a|b", "c"] and ["a", "b|c"] can never collide the way they would with
 * a printable separator. Written as fromCharCode rather than a literal so the
 * byte stays visible in source.
 */
export const KEY_SEPARATOR = String.fromCharCode(0);
