/**
 * Analytics Explorer — the request contract.
 *
 * Everything the compiler trusts is validated here, before a single SQL chunk is
 * built. In particular: every measure and dimension id must resolve in the
 * catalog, so an id can only ever be looked up in a frozen registry rather than
 * concatenated into SQL text.
 */

import { z } from "zod";
import {
  BINARY_OPERATORS,
  NULLARY_OPERATORS,
  OPERATORS_BY_DIMENSION_TYPE,
} from "./model";
import type { CubeId } from "./model";
import { ANALYTICS_LIMITS, GRAIN_DAYS } from "./constants";
import { getDimension, getMeasure, resolveCubes } from "./catalog";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const grainSchema = z.enum([
  "day",
  "week",
  "biweek",
  "month",
  "quarter",
  "half",
  "year",
  "custom",
]);

export const filterOperatorSchema = z.enum([
  "eq",
  "neq",
  "in",
  "not_in",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "contains",
  "starts_with",
  "is_null",
  "is_not_null",
]);

export const filterSchema = z.object({
  dimension: z.string().min(1),
  op: filterOperatorSchema,
  values: z.array(z.union([z.string(), z.number(), z.boolean()])).max(500).default([]),
});

export const havingSchema = z.object({
  ref: z.string().min(1),
  op: z.enum(["gt", "gte", "lt", "lte", "eq", "neq"]),
  value: z.number(),
});

export const indicatorSchema = z.object({
  type: z.enum(["sma", "ema", "rsi", "pct_change", "difference", "zscore", "momentum"]),
  on: z.string().min(1),
  period: z.number().int().min(2).max(365).optional(),
});

export const timeSchema = z.object({
  from: z.string().regex(ISO_DATE, "from must be YYYY-MM-DD"),
  to: z.string().regex(ISO_DATE, "to must be YYYY-MM-DD"),
  grain: grainSchema.default("day"),
  customBucketDays: z.number().int().min(1).max(365).optional(),
  compare: z.enum(["none", "previous_period", "previous_year"]).default("none"),
});

export const topNSchema = z.object({
  dimension: z.string().min(1),
  measure: z.string().min(1),
  n: z.number().int().min(1).max(ANALYTICS_LIMITS.maxTopN),
  otherBucket: z.boolean().default(true),
});

const baseQuerySchema = z.object({
  storeIds: z.array(z.string().min(1)).min(1).max(ANALYTICS_LIMITS.maxStores),
  measures: z.array(z.string().min(1)).min(1).max(ANALYTICS_LIMITS.maxMeasures),
  dimensions: z.array(z.string().min(1)).max(ANALYTICS_LIMITS.maxDimensions).default([]),
  time: timeSchema,
  filters: z.array(filterSchema).max(ANALYTICS_LIMITS.maxFilters).default([]),
  having: z.array(havingSchema).max(ANALYTICS_LIMITS.maxHaving).default([]),
  orderBy: z
    .array(z.object({ ref: z.string().min(1), dir: z.enum(["asc", "desc"]) }))
    .max(ANALYTICS_LIMITS.maxOrderBy)
    .default([]),
  limit: z
    .number()
    .int()
    .min(1)
    .max(ANALYTICS_LIMITS.maxRows)
    .default(ANALYTICS_LIMITS.defaultRows),
  topN: topNSchema.optional(),
  indicators: z.array(indicatorSchema).max(6).default([]),
});

/** Days between two YYYY-MM-DD dates, inclusive of both ends. */
export function inclusiveDaySpan(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.floor((b - a) / 86_400_000) + 1;
}

/** Approximate bucket count for a range, used only to reject absurd requests early. */
export function estimateBucketCount(
  from: string,
  to: string,
  grain: string,
  customBucketDays?: number,
): number {
  const span = inclusiveDaySpan(from, to);
  const size = grain === "custom" ? (customBucketDays ?? 1) : (GRAIN_DAYS[grain] ?? 1);
  return Math.max(1, Math.ceil(span / size));
}

export const analyticsQuerySchema = baseQuerySchema.superRefine((q, ctx) => {
  const issue = (path: (string | number)[], message: string) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });

  // --- measures resolve, and the role gate is applied separately by the route
  q.measures.forEach((id, i) => {
    if (!getMeasure(id)) issue(["measures", i], `Unknown measure "${id}"`);
  });

  // --- dimensions resolve
  q.dimensions.forEach((id, i) => {
    if (!getDimension(id)) issue(["dimensions", i], `Unknown dimension "${id}"`);
  });

  // `.filter(getMeasure)` would not narrow the element type, so resolve to defs
  // and drop the misses explicitly — the unknown-id issues are already recorded.
  const knownMeasures = q.measures
    .map(getMeasure)
    .filter((m): m is NonNullable<typeof m> => Boolean(m));
  const knownDimensions = q.dimensions
    .map(getDimension)
    .filter((d): d is NonNullable<typeof d> => Boolean(d));

  // --- date range sanity
  if (q.time.from > q.time.to) {
    issue(["time", "to"], "to must not be earlier than from");
  }

  if (q.time.grain === "custom" && !q.time.customBucketDays) {
    issue(["time", "customBucketDays"], "customBucketDays is required when grain is 'custom'");
  }

  if (q.time.from <= q.time.to) {
    const buckets = estimateBucketCount(
      q.time.from,
      q.time.to,
      q.time.grain,
      q.time.customBucketDays,
    );
    if (buckets > ANALYTICS_LIMITS.maxBuckets) {
      issue(
        ["time", "grain"],
        `That range produces about ${buckets} buckets, over the limit of ` +
          `${ANALYTICS_LIMITS.maxBuckets}. Choose a coarser grain or a shorter range.`,
      );
    }
  }

  // --- a measure may only be sliced by dimensions it actually supports
  for (const measure of knownMeasures) {
    const supported = new Set(measure.dimensions);
    for (const dim of knownDimensions) {
      if (!supported.has(dim.id)) {
        issue(
          ["dimensions"],
          `"${measure.label}" cannot be broken down by "${dim.label}".`,
        );
      }
    }
  }

  // --- cross-cube conformance: a dimension must exist on EVERY participating cube
  const cubes = resolveCubes(q.measures);
  if (cubes.length > 1) {
    for (const dim of knownDimensions) {
      const conformed = new Set(dim.conformedOn);
      const offending = cubes.filter((c: CubeId) => !conformed.has(c));
      if (offending.length > 0) {
        issue(
          ["dimensions"],
          `"${dim.label}" is not available on all the selected data ` +
            `(missing from: ${offending.join(", ")}). Drop it, or drop the measures that need it.`,
        );
      }
    }
  }

  // --- filters: dimension resolves, and the operator suits its type
  q.filters.forEach((f, i) => {
    const dim = getDimension(f.dimension);
    if (!dim) {
      issue(["filters", i, "dimension"], `Unknown dimension "${f.dimension}"`);
      return;
    }
    const allowed = OPERATORS_BY_DIMENSION_TYPE[dim.type];
    if (!allowed.includes(f.op)) {
      issue(
        ["filters", i, "op"],
        `Operator "${f.op}" is not valid for ${dim.type} dimension "${dim.label}".`,
      );
    }
    const nullary = NULLARY_OPERATORS.includes(f.op);
    const binary = BINARY_OPERATORS.includes(f.op);
    if (nullary && f.values.length !== 0) {
      issue(["filters", i, "values"], `"${f.op}" takes no values.`);
    } else if (binary && f.values.length !== 2) {
      issue(["filters", i, "values"], `"${f.op}" takes exactly two values.`);
    } else if (!nullary && !binary && f.values.length === 0) {
      issue(["filters", i, "values"], `"${f.op}" needs at least one value.`);
    }
  });

  // --- orderBy / having refs must name something the query actually returns
  const refs = new Set<string>(["bucket", ...q.measures, ...q.dimensions]);
  q.orderBy.forEach((o, i) => {
    if (!refs.has(o.ref)) issue(["orderBy", i, "ref"], `Cannot sort by "${o.ref}" — it is not selected.`);
  });
  q.having.forEach((h, i) => {
    if (!refs.has(h.ref)) issue(["having", i, "ref"], `Cannot filter on "${h.ref}" — it is not selected.`);
  });

  // --- topN must reference a selected dimension and measure
  if (q.topN) {
    if (!q.dimensions.includes(q.topN.dimension)) {
      issue(["topN", "dimension"], `Top-N dimension "${q.topN.dimension}" is not grouped by.`);
    }
    if (!q.measures.includes(q.topN.measure)) {
      issue(["topN", "measure"], `Top-N measure "${q.topN.measure}" is not selected.`);
    }
  }

  // --- indicators must sit on a selected measure, and need a time series to sit on
  q.indicators.forEach((ind, i) => {
    if (!q.measures.includes(ind.on)) {
      issue(["indicators", i, "on"], `"${ind.on}" is not one of the selected measures.`);
    }
    if (q.dimensions.length > 0 && !q.dimensions.includes("date")) {
      issue(["indicators", i], "Indicators need the Date dimension in the breakdown.");
    }
  });
});

export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
export type AnalyticsQueryInput = z.input<typeof analyticsQuerySchema>;
export type Filter = z.infer<typeof filterSchema>;
export type Having = z.infer<typeof havingSchema>;
export type TopN = z.infer<typeof topNSchema>;

/** Persisted shape of a saved view: the query plus how it was being displayed. */
export const analyticsViewSpecSchema = z.object({
  query: baseQuerySchema,
  vizType: z
    .enum(["table", "line", "area", "bar", "stacked_bar", "pie", "scatter", "heatmap", "kpi"])
    .default("line"),
  yAxisMode: z.enum(["shared", "panels", "indexed"]).default("panels"),
  /** Stable member -> palette slot, so filtering a series out does not repaint the rest. */
  colorAssignments: z.record(z.string(), z.number().int().min(0)).default({}),
});

export type AnalyticsViewSpec = z.infer<typeof analyticsViewSpecSchema>;
