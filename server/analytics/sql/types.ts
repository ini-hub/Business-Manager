/**
 * Analytics Explorer — SQL binding types.
 *
 * The server half of the semantic model. Catalog ids (shared/analytics/catalog.ts)
 * are looked up in these frozen registries; a user-supplied string is only ever a
 * *key* into a Map, never a fragment of SQL text.
 */

import type { SQL } from "drizzle-orm";
import type { CubeId } from "@shared/analytics/model";
import type { TimeColumn } from "../time";

/** Context a cube may use to push predicates down into its own FROM clause. */
export interface CubeBuildContext {
  storeIds: string[];
  /** Inclusive range in YYYY-MM-DD, store-local. */
  from: string;
  to: string;
}

export type MeasureSql =
  /** Aggregated in SQL. */
  | { kind: "agg"; agg: SQL }
  /**
   * Computed in JS after aggregation, from other measures. Ratios MUST use this:
   * AVG()-ing a ratio gives the wrong answer at every level above the leaf.
   * Returns null when the inputs make the result undefined (e.g. divide by zero).
   */
  | {
      kind: "derived";
      derive: (values: Record<string, number | null>) => number | null;
    };

export interface CubeSql {
  id: CubeId;
  /**
   * The FROM clause. A function rather than a constant so a cube can push the
   * tenant and coarse date predicates *inside* a subquery — for `sales_receipts`
   * the DISTINCT ON would otherwise deduplicate the entire checkouts table on
   * every request.
   */
  buildFrom: (ctx: CubeBuildContext) => SQL;
  /** The column carrying store_id, for the tenancy predicate. */
  tenantColumn: SQL;
  /** Always-on predicate defining what belongs in the cube at all. */
  basePredicate?: SQL;
  time: TimeColumn;
  measures: Record<string, MeasureSql>;
  dimensions: Record<string, SQL>;
}
