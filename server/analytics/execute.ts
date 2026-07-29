/**
 * Analytics Explorer — execution and drill-across.
 *
 * Compiles a query into one statement per cube, runs them in parallel under a
 * statement timeout, joins the results on their conformed key tuple, then
 * resolves derived measures.
 *
 * Derived measures are resolved HERE rather than in SQL on purpose: a ratio
 * computed per leaf row and then summed (or averaged) is wrong at every level
 * above the leaf. Recomputing it from already-aggregated parts is correct at
 * every level.
 */

import { sql } from "drizzle-orm";
import { db } from "../db";
import type { CubeId, ResultColumn, ResultRow } from "@shared/analytics/model";
import type { AnalyticsQuery } from "@shared/analytics/query";
import { ANALYTICS_LIMITS, KEY_SEPARATOR } from "@shared/analytics/constants";
import {
  expandMeasureDependencies,
  getDimension,
  getMeasure,
  resolveCubes,
} from "@shared/analytics/catalog";
import { compileCubeQuery, type CompiledCubeQuery } from "./compiler";
import { enumerateBuckets, shiftRange } from "./time";
import { getMeasureSql } from "./sql";

export interface AnalyticsResult {
  meta: {
    grain: string;
    bucketAnchor: string | null;
    from: string;
    to: string;
    buckets: number;
    truncated: boolean;
    cubesQueried: CubeId[];
    elapsedMs: number;
  };
  columns: ResultColumn[];
  rows: ResultRow[];
  totals: Record<string, number | null>;
  /**
   * The same query over the preceding period.
   *
   * Aligned by ORDINAL POSITION in the series rather than by date: a month-long
   * window and the month before it rarely have the same number of days, so
   * matching on date would leave the last bucket of one side unpaired and make
   * every delta after it wrong.
   */
  comparison?: {
    from: string;
    to: string;
    rows: ResultRow[];
    totals: Record<string, number | null>;
    alignment: "bucket_index";
    label: string;
  };
  warnings: string[];
}

/** COUNT(*) comes back as int8, which node-postgres hands over as a string. */
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Runs one compiled statement under a statement timeout.
 *
 * The timeout is SET LOCAL inside a transaction so it applies to this statement
 * and is discarded with it, rather than leaking onto the pooled connection.
 */
async function runCompiled(compiled: CompiledCubeQuery): Promise<Record<string, unknown>[]> {
  return db.transaction(async (tx) => {
    // SET does not accept bind parameters, so this must be inlined. It is a
    // compile-time integer constant from our own module, never request input.
    await tx.execute(
      sql.raw(`SET LOCAL statement_timeout = ${Number(ANALYTICS_LIMITS.statementTimeoutMs)}`),
    );
    const result = await tx.execute(compiled.statement);
    return (result as unknown as { rows: Record<string, unknown>[] }).rows ?? [];
  });
}

/** The conformed key tuple for a row: bucket first, then each grouped dimension. */
function rowKey(
  row: Record<string, unknown>,
  compiled: CompiledCubeQuery,
): string {
  const parts: string[] = [];
  if (compiled.hasBucket) parts.push(String(row.bucket ?? ""));
  compiled.dimensionRefs.forEach((_, i) => parts.push(String(row[`d_${i}`] ?? "")));
  return parts.join(KEY_SEPARATOR);
}

export async function runAnalyticsQuery(query: AnalyticsQuery): Promise<AnalyticsResult> {
  const current = await runOverRange(query, {
    from: query.time.from,
    to: query.time.to,
  });

  if (query.time.compare === "none") return current;

  // Re-run over the shifted window. `compare: "none"` on the inner call stops it
  // recursing, and the shift is calendar-aware so a leap year still lines up.
  const shifted = shiftRange(query.time.from, query.time.to, query.time.compare);
  const previous = await runOverRange(
    { ...query, time: { ...query.time, ...shifted, compare: "none" } },
    shifted,
  );

  return {
    ...current,
    comparison: {
      ...shifted,
      rows: previous.rows,
      totals: previous.totals,
      alignment: "bucket_index",
      label:
        query.time.compare === "previous_year"
          ? "same period last year"
          : "previous period",
    },
    warnings: [...current.warnings, ...previous.warnings],
  };
}

async function runOverRange(
  query: AnalyticsQuery,
  range: { from: string; to: string },
): Promise<AnalyticsResult> {
  const started = Date.now();
  const warnings: string[] = [];

  const cubes = resolveCubes(query.measures);
  if (cubes.length > ANALYTICS_LIMITS.maxConcurrentCubes) {
    throw new Error(
      `This query spans ${cubes.length} datasets, above the limit of ` +
        `${ANALYTICS_LIMITS.maxConcurrentCubes}. Select fewer measures.`,
    );
  }

  const compiled = cubes.map((cubeId) => compileCubeQuery(cubeId, query, range));
  const resultSets = await Promise.all(compiled.map(runCompiled));

  // --- detect truncation (the compiler asks for limit + 1)
  let truncated = false;
  resultSets.forEach((rows, i) => {
    if (rows.length > query.limit) {
      truncated = true;
      rows.length = query.limit;
      warnings.push(
        `Results from "${compiled[i].cubeId}" were truncated at ${query.limit} rows.`,
      );
    }
  });

  // --- join on the conformed key tuple
  const groupByTime = query.dimensions.includes("date");
  const nonTimeDims = query.dimensions.filter((d) => d !== "date");
  const merged = new Map<string, ResultRow>();
  const order: string[] = [];

  compiled.forEach((c, cubeIndex) => {
    for (const row of resultSets[cubeIndex]) {
      const key = rowKey(row, c);
      let target = merged.get(key);
      if (!target) {
        target = {};
        if (c.hasBucket) target.date = String(row.bucket ?? "");
        c.dimensionRefs.forEach((dimId, i) => {
          target![dimId] = row[`d_${i}`] === null ? null : String(row[`d_${i}`]);
        });
        merged.set(key, target);
        order.push(key);
      }
      c.measureRefs.forEach((measureId, i) => {
        target![measureId] = toNumber(row[`m_${i}`]);
      });
    }
  });

  // A cube contributed no row for a key another cube did: for flow measures an
  // absent row genuinely means zero. Stock measures are left null — see the
  // additivity notes in shared/analytics/model.ts.
  Array.from(merged.values()).forEach((row) => {
    for (const measureId of expandMeasureDependencies(query.measures)) {
      const def = getMeasure(measureId);
      if (!def || def.derivedFrom?.length) continue;
      if (row[measureId] === undefined) {
        row[measureId] = def.additivity === "flow" ? 0 : null;
      }
    }
  });

  // --- dense spine
  //
  // A bucket in which NO cube had a row is absent from the join entirely, which
  // silently shortens the series: a week with no trading disappears rather than
  // reading zero, and every downstream statistic is then computed over a series
  // with holes in it (an RSI or a correlation over a gappy series is meaningless,
  // and a "30-day average" over 24 present days is simply wrong).
  //
  // So enumerate every bucket the range should contain and materialise the
  // missing ones. Each observed member-tuple of the non-time dimensions gets the
  // full spine, which keeps the fill bounded by what the data already contains
  // rather than by the cross product of every possible member.
  if (groupByTime) {
    const spine = enumerateBuckets(
      range.from,
      range.to,
      query.time.grain,
      query.time.customBucketDays,
    );

    const memberTuples = new Map<string, Record<string, string | null>>();
    if (nonTimeDims.length === 0) {
      memberTuples.set("", {});
    } else {
      for (const row of Array.from(merged.values())) {
        const tuple: Record<string, string | null> = {};
        for (const dim of nonTimeDims) tuple[dim] = (row[dim] as string | null) ?? null;
        memberTuples.set(nonTimeDims.map((d) => String(tuple[d])).join(KEY_SEPARATOR), tuple);
      }
    }

    for (const bucket of spine) {
      for (const [tupleKey, tuple] of Array.from(memberTuples.entries())) {
        const key = [bucket, ...(nonTimeDims.length ? tupleKey.split(KEY_SEPARATOR) : [])]
          .join(KEY_SEPARATOR);
        if (merged.has(key)) continue;
        const filled: ResultRow = { date: bucket, ...tuple };
        merged.set(key, filled);
        order.push(key);
      }
    }

    // Spine rows were appended out of order; sort by bucket, then by member.
    order.sort((a, b) => {
      const rowA = merged.get(a)!;
      const rowB = merged.get(b)!;
      const byDate = String(rowA.date).localeCompare(String(rowB.date));
      if (byDate !== 0) return byDate;
      for (const dim of nonTimeDims) {
        const cmp = String(rowA[dim] ?? "").localeCompare(String(rowB[dim] ?? ""));
        if (cmp !== 0) return cmp;
      }
      return 0;
    });

    // Newly created spine rows carry no measures yet — fill them by additivity,
    // the same rule used above for a cube that contributed nothing to a key.
    for (const row of Array.from(merged.values())) {
      for (const measureId of expandMeasureDependencies(query.measures)) {
        const def = getMeasure(measureId);
        if (!def || def.derivedFrom?.length) continue;
        if (row[measureId] === undefined) {
          row[measureId] = def.additivity === "flow" ? 0 : null;
        }
      }
    }
  }

  const rows = order.map((k) => merged.get(k)!);

  // --- cell budget
  const cellCount = rows.length * (query.measures.length + query.dimensions.length);
  if (cellCount > ANALYTICS_LIMITS.maxCells) {
    throw new Error(
      `That query returns about ${cellCount} values, above the limit of ` +
        `${ANALYTICS_LIMITS.maxCells}. Add a filter or use a coarser grain.`,
    );
  }

  // --- totals: sum the aggregates, then recompute derived measures from those
  // sums rather than summing the per-row derived values.
  const totals: Record<string, number | null> = {};
  for (const measureId of expandMeasureDependencies(query.measures)) {
    const def = getMeasure(measureId);
    if (!def || def.derivedFrom?.length) continue;
    if (def.additivity === "ratio") {
      totals[measureId] = null;
      continue;
    }
    let sum = 0;
    let sawValue = false;
    for (const row of rows) {
      const v = row[measureId];
      if (typeof v === "number") {
        sum += v;
        sawValue = true;
      }
    }
    totals[measureId] = sawValue ? sum : def.additivity === "flow" ? 0 : null;
  }

  resolveDerived(query, rows, totals);

  // --- post-aggregation HAVING on derived measures (not expressible in SQL)
  const derivedHaving = query.having.filter((h) => {
    const def = getMeasure(h.ref);
    return def && (def.derivedFrom?.length ?? 0) > 0;
  });
  let finalRows = rows;
  if (derivedHaving.length > 0) {
    finalRows = rows.filter((row) =>
      derivedHaving.every((h) => {
        const v = row[h.ref];
        if (typeof v !== "number") return false;
        switch (h.op) {
          case "gt": return v > h.value;
          case "gte": return v >= h.value;
          case "lt": return v < h.value;
          case "lte": return v <= h.value;
          case "eq": return v === h.value;
          case "neq": return v !== h.value;
          default: return true;
        }
      }),
    );
    warnings.push(
      "Filters on calculated measures are applied after aggregation, so totals " +
        "still reflect all matching records.",
    );
  }

  return {
    meta: {
      grain: query.time.grain,
      bucketAnchor: compiled.find((c) => c.bucketAnchor)?.bucketAnchor ?? null,
      from: range.from,
      to: range.to,
      buckets: groupByTime ? new Set(finalRows.map((r) => r.date)).size : 1,
      truncated,
      cubesQueried: cubes,
      elapsedMs: Date.now() - started,
    },
    columns: buildColumns(query, groupByTime, nonTimeDims),
    rows: finalRows,
    totals,
    warnings,
  };
}

/** Computes every derived measure from already-aggregated inputs, per row and for the totals. */
function resolveDerived(
  query: AnalyticsQuery,
  rows: ResultRow[],
  totals: Record<string, number | null>,
): void {
  const derivedIds = expandMeasureDependencies(query.measures).filter((id) => {
    const def = getMeasure(id);
    return def && (def.derivedFrom?.length ?? 0) > 0;
  });

  for (const measureId of derivedIds) {
    const def = getMeasure(measureId)!;
    const binding = getMeasureSql(def.cube, measureId);
    if (!binding || binding.kind !== "derived") continue;

    for (const row of rows) {
      const inputs: Record<string, number | null> = {};
      for (const dep of def.derivedFrom ?? []) {
        const v = row[dep];
        inputs[dep] = typeof v === "number" ? v : null;
      }
      row[measureId] = binding.derive(inputs);
    }

    const totalInputs: Record<string, number | null> = {};
    for (const dep of def.derivedFrom ?? []) totalInputs[dep] = totals[dep] ?? null;
    totals[measureId] = binding.derive(totalInputs);
  }
}

function buildColumns(
  query: AnalyticsQuery,
  groupByTime: boolean,
  nonTimeDims: string[],
): ResultColumn[] {
  const columns: ResultColumn[] = [];

  if (groupByTime) {
    columns.push({ ref: "date", kind: "dimension", label: "Date", format: "number" });
  }
  for (const dimId of nonTimeDims) {
    const dim = getDimension(dimId);
    columns.push({
      ref: dimId,
      kind: "dimension",
      label: dim?.label ?? dimId,
      format: "number",
    });
  }
  for (const measureId of query.measures) {
    const def = getMeasure(measureId);
    if (!def) continue;
    columns.push({
      ref: measureId,
      kind: "measure",
      label: def.label,
      format: def.format,
      cube: def.cube,
    });
  }

  return columns;
}
