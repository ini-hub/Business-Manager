/**
 * Analytics Explorer — the query compiler.
 *
 * Turns a validated AnalyticsQuery into one parameterised statement per cube.
 *
 * The security property this file exists to hold: **no user-supplied string ever
 * becomes SQL text**. Measure and dimension ids are only ever keys into frozen
 * registries; filter values, store ids, limits and dates are all bound as
 * parameters. Output aliases are positional (`d_0`, `m_0`) and generated here, so
 * even a column *name* never originates from the request.
 */

import { sql, type SQL } from "drizzle-orm";
import type { CubeId } from "@shared/analytics/model";
import type { AnalyticsQuery, Filter } from "@shared/analytics/query";
import { ANALYTICS_LIMITS } from "@shared/analytics/constants";
import { expandMeasureDependencies, getDimension, getMeasure } from "@shared/analytics/catalog";
import { bucketAnchor, bucketExpr, localTimestampExpr, rangePredicates } from "./time";
import { getCubeSql } from "./sql";
import type { CubeBuildContext } from "./sql/types";

/** Raised when the request is structurally impossible for this cube. */
export class AnalyticsCompileError extends Error {
  constructor(
    message: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AnalyticsCompileError";
  }
}

export interface CompiledCubeQuery {
  cubeId: CubeId;
  statement: SQL;
  /** Aggregate measures selected from this cube, positionally matched to m_0, m_1... */
  measureRefs: string[];
  /** Dimensions grouped by, positionally matched to d_0, d_1... */
  dimensionRefs: string[];
  /** True when the query groups by time, so the result carries a `bucket` column. */
  hasBucket: boolean;
  /** Echoed so the UI can label integer-division buckets honestly. */
  bucketAnchor: string | null;
}

const BUCKET_ALIAS = "bucket";
const dimAlias = (i: number) => `d_${i}`;
const measureAlias = (i: number) => `m_${i}`;

/** Escapes LIKE wildcards so a literal `%` in a product name stays literal. */
function escapeLikeValue(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function asScalar(value: string | number | boolean): string | number | boolean {
  return value;
}

/**
 * Builds the WHERE fragment for one filter against one cube.
 *
 * The dimension expression comes from the cube's frozen binding map; the values
 * are always parameters. There is deliberately no branch that concatenates a
 * value into SQL text.
 */
function compileFilter(filter: Filter, dimExpr: SQL): SQL {
  const { op, values } = filter;

  switch (op) {
    case "eq":
      return sql`${dimExpr} = ${asScalar(values[0])}`;
    case "neq":
      return sql`${dimExpr} <> ${asScalar(values[0])}`;
    // sql.param is required, not stylistic: a bare `${values}` interpolates an
    // array as a row constructor — ANY(($1, $2, $3)) — which is not an array and
    // fails at runtime. sql.param binds the whole array as one parameter.
    case "in":
      return sql`${dimExpr} = ANY(${sql.param(values)})`;
    case "not_in":
      // NOT (x = ANY(...)) rather than <> ALL(...) so NULL members behave the
      // same way they do for `in`.
      return sql`NOT (${dimExpr} = ANY(${sql.param(values)}))`;
    case "gt":
      return sql`${dimExpr} > ${asScalar(values[0])}`;
    case "gte":
      return sql`${dimExpr} >= ${asScalar(values[0])}`;
    case "lt":
      return sql`${dimExpr} < ${asScalar(values[0])}`;
    case "lte":
      return sql`${dimExpr} <= ${asScalar(values[0])}`;
    case "between":
      return sql`${dimExpr} BETWEEN ${asScalar(values[0])} AND ${asScalar(values[1])}`;
    case "contains":
      return sql`${dimExpr} ILIKE ('%' || ${escapeLikeValue(String(values[0]))} || '%') ESCAPE '\\'`;
    case "starts_with":
      return sql`${dimExpr} ILIKE (${escapeLikeValue(String(values[0]))} || '%') ESCAPE '\\'`;
    case "is_null":
      return sql`${dimExpr} IS NULL`;
    case "is_not_null":
      return sql`${dimExpr} IS NOT NULL`;
    default: {
      const exhaustive: never = op;
      throw new AnalyticsCompileError(`Unsupported filter operator "${String(exhaustive)}".`);
    }
  }
}

const HAVING_OPERATORS: Record<string, string> = {
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  eq: "=",
  neq: "<>",
};

/**
 * Compiles the portion of a query that this cube can answer.
 *
 * Derived measures are not selected here — they have no SQL. The compiler pulls
 * in their `derivedFrom` inputs instead and the caller resolves them after the
 * rows come back, which is what keeps a ratio correct at every roll-up level.
 */
export function compileCubeQuery(
  cubeId: CubeId,
  query: AnalyticsQuery,
  range: { from: string; to: string },
): CompiledCubeQuery {
  const cube = getCubeSql(cubeId);
  if (!cube) throw new AnalyticsCompileError(`No SQL binding for cube "${cubeId}".`);

  const ctx: CubeBuildContext = {
    storeIds: query.storeIds,
    from: range.from,
    to: range.to,
  };

  // --- measures: this cube's aggregates, including derived-measure inputs
  const wanted = expandMeasureDependencies(query.measures);
  const measureRefs: string[] = [];
  const selectParts: SQL[] = [];

  // --- dimensions
  const groupByTime = query.dimensions.includes("date");
  const nonTimeDims = query.dimensions.filter((d) => d !== "date");
  const dimensionRefs: string[] = [];

  const localTs = localTimestampExpr(cube.time);
  let anchor: string | null = null;

  if (groupByTime) {
    const grain = query.time.grain;
    if (grain === "biweek" || grain === "custom") {
      anchor = bucketAnchor(range.from, grain);
    }
    const bucket = bucketExpr(localTs, grain, {
      from: range.from,
      customBucketDays: query.time.customBucketDays,
    });
    // Cast to text: a bare `date` comes back as a JS Date that the node-postgres
    // parser would re-interpret in the process timezone, undoing the store-local
    // bucketing we just did.
    selectParts.push(sql`(${bucket})::text AS ${sql.identifier(BUCKET_ALIAS)}`);
  }

  nonTimeDims.forEach((dimId) => {
    const expr = cube.dimensions[dimId];
    if (!expr) {
      throw new AnalyticsCompileError(
        `Dimension "${dimId}" is not available on "${cubeId}".`,
        { dimension: dimId, cube: cubeId },
      );
    }
    selectParts.push(
      sql`${expr}::text AS ${sql.identifier(dimAlias(dimensionRefs.length))}`,
    );
    dimensionRefs.push(dimId);
  });

  for (const measureId of wanted) {
    const def = getMeasure(measureId);
    if (!def || def.cube !== cubeId) continue;
    const binding = cube.measures[measureId];
    if (!binding) {
      throw new AnalyticsCompileError(`Measure "${measureId}" has no binding on "${cubeId}".`);
    }
    if (binding.kind !== "agg") continue; // derived: resolved after aggregation
    selectParts.push(
      sql`${binding.agg} AS ${sql.identifier(measureAlias(measureRefs.length))}`,
    );
    measureRefs.push(measureId);
  }

  if (measureRefs.length === 0) {
    throw new AnalyticsCompileError(
      `Cube "${cubeId}" contributes no aggregate measures to this query.`,
    );
  }

  // --- WHERE
  const where: SQL[] = [sql`${cube.tenantColumn} = ANY(${sql.param(query.storeIds)})`];
  if (cube.basePredicate) where.push(cube.basePredicate);
  where.push(...rangePredicates(cube.time, range.from, range.to));

  for (const filter of query.filters) {
    const dim = getDimension(filter.dimension);
    if (!dim) {
      throw new AnalyticsCompileError(`Unknown dimension "${filter.dimension}" in filter.`);
    }
    const expr = cube.dimensions[filter.dimension];
    if (!expr) {
      // Applying the filter to some cubes but not others would quietly compare
      // a filtered series against an unfiltered one.
      throw new AnalyticsCompileError(
        `Cannot filter by "${dim.label}" — it does not exist on all the selected data.`,
        { dimension: filter.dimension, cube: cubeId },
      );
    }
    where.push(compileFilter(filter, expr));
  }

  // --- GROUP BY (positional, so no identifier is ever derived from user input)
  const groupCount = (groupByTime ? 1 : 0) + dimensionRefs.length;
  const groupBy =
    groupCount > 0
      ? sql`GROUP BY ${sql.raw(
          Array.from({ length: groupCount }, (_, i) => String(i + 1)).join(", "),
        )}`
      : sql``;

  // --- HAVING: only aggregates this cube actually selected. A `having` on a
  // derived measure cannot be expressed in SQL and is applied post-aggregation.
  const havingParts: SQL[] = [];
  for (const h of query.having) {
    const idx = measureRefs.indexOf(h.ref);
    if (idx === -1) continue;
    const binding = cube.measures[h.ref];
    if (!binding || binding.kind !== "agg") continue;
    const operator = HAVING_OPERATORS[h.op];
    if (!operator) throw new AnalyticsCompileError(`Unsupported HAVING operator "${h.op}".`);
    havingParts.push(sql`${binding.agg} ${sql.raw(operator)} ${h.value}`);
  }
  const having =
    havingParts.length > 0 ? sql`HAVING ${sql.join(havingParts, sql` AND `)}` : sql``;

  // --- ORDER BY, by output position
  const orderParts: SQL[] = [];
  for (const o of query.orderBy) {
    let position: number | null = null;
    if (o.ref === "date" || o.ref === BUCKET_ALIAS) {
      position = groupByTime ? 1 : null;
    } else {
      const dimIdx = dimensionRefs.indexOf(o.ref);
      if (dimIdx >= 0) {
        position = (groupByTime ? 1 : 0) + dimIdx + 1;
      } else {
        const measureIdx = measureRefs.indexOf(o.ref);
        if (measureIdx >= 0) position = groupCount + measureIdx + 1;
      }
    }
    if (position === null) continue;
    orderParts.push(sql`${sql.raw(String(position))} ${sql.raw(o.dir === "desc" ? "DESC" : "ASC")}`);
  }
  if (orderParts.length === 0 && groupByTime) {
    orderParts.push(sql`1 ASC`);
  }
  const orderBy =
    orderParts.length > 0 ? sql`ORDER BY ${sql.join(orderParts, sql`, `)}` : sql``;

  // One extra row so the caller can tell "exactly at the limit" from "truncated".
  const limit = Math.min(query.limit, ANALYTICS_LIMITS.maxRows) + 1;

  const statement = sql`
    SELECT ${sql.join(selectParts, sql`, `)}
    FROM ${cube.buildFrom(ctx)}
    WHERE ${sql.join(where, sql` AND `)}
    ${groupBy}
    ${having}
    ${orderBy}
    LIMIT ${limit}
  `;

  return {
    cubeId,
    statement,
    measureRefs,
    dimensionRefs,
    hasBucket: groupByTime,
    bucketAnchor: anchor,
  };
}
