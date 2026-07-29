/**
 * Analytics Explorer — relationship analysis.
 *
 * Builds scatter plots and correlation matrices on top of an already-aggregated
 * result, so the numbers being related are exactly the numbers the Explorer
 * shows. Both surfaces refuse to hand back a confident-looking figure without the
 * context needed to judge it: `n` is always returned, and strongly trending
 * inputs are flagged, because two series that both grow correlate near 1.0
 * whether or not they have anything to do with each other.
 */

import type { AnalyticsQuery } from "@shared/analytics/query";
import type { StatTransform, ValueFormat } from "@shared/analytics/model";
import { ANALYTICS_LIMITS } from "@shared/analytics/constants";
import { getMeasure } from "@shared/analytics/catalog";
import { runAnalyticsQuery } from "./execute";
import {
  applyTransform,
  correlationMatrix,
  crossCorrelation,
  isStronglyTrending,
  linearRegression,
  pearson,
  type Series,
} from "./stats";

const TREND_WARNING =
  "Both series are strongly trending, so a correlation on raw levels is likely " +
  "spurious — almost any two growing measures correlate near 1. Compare % change instead.";

export interface ScatterPoint {
  x: number;
  y: number;
  /** Bucket date or dimension member key. */
  key: string;
  label: string;
}

export interface ScatterResult {
  points: ScatterPoint[];
  fit: {
    slope: number;
    intercept: number;
    r: number;
    r2: number;
    p: number;
    n: number;
  } | null;
  axes: {
    x: { ref: string; label: string; format: ValueFormat };
    y: { ref: string; label: string; format: ValueFormat };
  };
  transform: StatTransform;
  warnings: string[];
}

/**
 * X-vs-Y over one aggregated result.
 *
 * `pointGrain` decides what a dot means, and it is the whole difference between
 * two different questions: "time_bucket" asks whether the two measures move
 * together OVER TIME; "dimension_member" asks which stores/items are outliers.
 */
export async function runScatter(
  query: AnalyticsQuery,
  options: {
    x: string;
    y: string;
    pointGrain: "time_bucket" | "dimension_member";
    pointDimension?: string;
    transform: StatTransform;
  },
): Promise<ScatterResult> {
  const xDef = getMeasure(options.x);
  const yDef = getMeasure(options.y);
  if (!xDef || !yDef) throw new Error("Unknown measure on the scatter axes.");

  const dimensions =
    options.pointGrain === "time_bucket"
      ? ["date"]
      : [options.pointDimension ?? "store"];

  const result = await runAnalyticsQuery({
    ...query,
    measures: [options.x, options.y],
    dimensions,
    time: { ...query.time, compare: "none" },
  });

  const keyRef = dimensions[0];
  const rawX: Series = result.rows.map((r) =>
    typeof r[options.x] === "number" ? (r[options.x] as number) : null,
  );
  const rawY: Series = result.rows.map((r) =>
    typeof r[options.y] === "number" ? (r[options.y] as number) : null,
  );

  const warnings = [...result.warnings];
  if (
    options.transform === "none" &&
    isStronglyTrending(rawX) &&
    isStronglyTrending(rawY)
  ) {
    warnings.push(TREND_WARNING);
  }

  const xs = applyTransform(rawX, options.transform);
  const ys = applyTransform(rawY, options.transform);

  const points: ScatterPoint[] = [];
  result.rows.forEach((row, i) => {
    const x = xs[i];
    const y = ys[i];
    if (typeof x !== "number" || typeof y !== "number") return;
    const key = String(row[keyRef] ?? "");
    points.push({ x, y, key, label: key });
  });

  const fit = linearRegression(xs, ys);
  const correlation = pearson(xs, ys);

  return {
    points,
    fit: fit && correlation
      ? {
          slope: fit.slope,
          intercept: fit.intercept,
          r: correlation.r,
          r2: correlation.r2,
          p: correlation.p,
          n: correlation.n,
        }
      : null,
    axes: {
      x: { ref: options.x, label: xDef.label, format: xDef.format },
      y: { ref: options.y, label: yDef.label, format: yDef.format },
    },
    transform: options.transform,
    warnings,
  };
}

export interface CorrelateResult {
  keys: string[];
  labels: string[];
  matrix: (number | null)[][];
  n: number[][];
  p: (number | null)[][];
  /** The strongest lead/lag relationship found for each ordered pair. */
  bestLags: { a: string; b: string; aLabel: string; bLabel: string; lag: number; r: number }[];
  transform: StatTransform;
  buckets: number;
  warnings: string[];
}

/**
 * N x N correlation over a shared time spine.
 *
 * Defaults to % change rather than raw levels — see TREND_WARNING. `bestLags`
 * answers the more interesting form of the question: not "do staffing and
 * revenue move together" but "does staffing move FIRST".
 */
export async function runCorrelate(
  query: AnalyticsQuery,
  options: { measures: string[]; transform: StatTransform; maxLag: number },
): Promise<CorrelateResult> {
  const measureIds = options.measures.slice(0, ANALYTICS_LIMITS.maxCorrelationMeasures);
  if (measureIds.length < 2) {
    throw new Error("Select at least two measures to correlate.");
  }

  // The dense spine in the executor is what makes this valid: every measure is
  // sampled on the same, gap-free set of buckets, so column i and column j are
  // genuinely aligned rather than merely the same length.
  const result = await runAnalyticsQuery({
    ...query,
    measures: measureIds,
    dimensions: ["date"],
    time: { ...query.time, compare: "none" },
  });

  const columns: Record<string, Series> = {};
  for (const id of measureIds) {
    columns[id] = result.rows.map((r) =>
      typeof r[id] === "number" ? (r[id] as number) : null,
    );
  }

  const warnings = [...result.warnings];
  if (options.transform === "none") {
    const trending = measureIds.filter((id) => isStronglyTrending(columns[id]));
    if (trending.length >= 2) warnings.push(TREND_WARNING);
  }
  if (result.rows.length < 10) {
    warnings.push(
      `Only ${result.rows.length} time buckets — correlations over so few points are ` +
        "unstable. Widen the date range or use a finer grain.",
    );
  }

  const matrix = correlationMatrix(columns, options.transform);

  const bestLags: CorrelateResult["bestLags"] = [];
  for (let i = 0; i < measureIds.length; i++) {
    for (let j = i + 1; j < measureIds.length; j++) {
      const lags = crossCorrelation(
        applyTransform(columns[measureIds[i]], options.transform),
        applyTransform(columns[measureIds[j]], options.transform),
        options.maxLag,
      );
      if (lags.length === 0) continue;
      const best = lags.reduce((a, b) => (Math.abs(b.r) > Math.abs(a.r) ? b : a));
      // Only worth reporting when the lead/lag beats the simultaneous reading.
      const atZero = lags.find((l) => l.lag === 0);
      if (best.lag !== 0 && (!atZero || Math.abs(best.r) > Math.abs(atZero.r))) {
        bestLags.push({
          a: measureIds[i],
          b: measureIds[j],
          aLabel: getMeasure(measureIds[i])?.label ?? measureIds[i],
          bLabel: getMeasure(measureIds[j])?.label ?? measureIds[j],
          lag: best.lag,
          r: best.r,
        });
      }
    }
  }
  bestLags.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));

  return {
    keys: matrix.keys,
    labels: matrix.keys.map((id) => getMeasure(id)?.label ?? id),
    matrix: matrix.matrix,
    n: matrix.n,
    p: matrix.p,
    bestLags: bestLags.slice(0, 5),
    transform: options.transform,
    buckets: result.rows.length,
    warnings,
  };
}
