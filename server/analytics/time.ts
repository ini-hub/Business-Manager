/**
 * Analytics Explorer — time bucketing and range bounds.
 *
 * Two things make this file worth reading carefully.
 *
 * 1. Bucketing happens in the STORE's timezone, not UTC. `checkouts.created_at`
 *    is `timestamp without time zone` holding UTC (server/db.ts pins the session
 *    to UTC and parses OID 1114 accordingly), so a Lagos sale at 00:30 local is
 *    stored as 23:30 the previous day. Bucketing on the raw column puts it in the
 *    wrong day — which is exactly what AnalyticsRepository.getSalesTrends does.
 *    Because every cube joins `stores`, each store contributes its own timezone
 *    within a single query, so we never need the per-store fan-out.
 *
 * 2. Some date columns are `text` 'YYYY-MM-DD' already written in store-local
 *    wall clock (expenses.date, attendance_records.date, payroll_periods.*).
 *    Converting those would re-introduce the offset. The cube declares its
 *    column KIND and this module branches on it, so the mistake is not
 *    expressible rather than merely discouraged.
 */

import { sql, type SQL } from "drizzle-orm";
import { addDays, format, parseISO, startOfISOWeek, subDays, subYears } from "date-fns";
import type { Grain, TimeColumnKind } from "@shared/analytics/model";
import { inclusiveDaySpan } from "@shared/analytics/query";

/** Grains that Postgres `date_trunc` handles natively. */
const NATIVE_TRUNC_GRAINS = new Set<Grain>(["day", "week", "month", "quarter", "year"]);

/**
 * The maximum real-world UTC offset span is -12..+14 hours. Widening the coarse
 * bound by a day on each side therefore always yields a strict superset of the
 * rows the precise local-date filter will keep.
 */
const COARSE_PAD_DAYS_BEFORE = 1;
const COARSE_PAD_DAYS_AFTER = 2;

export interface TimeColumn {
  /** The physical column, e.g. sql`c.created_at`. */
  column: SQL;
  kind: TimeColumnKind;
  /** The store timezone column to convert through. Required for `utc_timestamp`. */
  timezoneColumn?: SQL;
}

/**
 * Expression yielding store-local wall-clock time for the cube's time column.
 *
 * For `local_date_text` this deliberately does no conversion at all — the stored
 * value is already local.
 */
export function localTimestampExpr(time: TimeColumn): SQL {
  if (time.kind === "local_date_text") {
    return sql`(${time.column})::date`;
  }
  if (!time.timezoneColumn) {
    throw new Error("A utc_timestamp cube must supply a timezoneColumn to bucket by.");
  }
  return sql`((${time.column}) AT TIME ZONE 'UTC' AT TIME ZONE ${time.timezoneColumn})`;
}

/**
 * Anchor date for the integer-division grains.
 *
 * `biweek` anchors to the ISO week start of the range start, so fortnights line
 * up with week boundaries. `custom` anchors to the range start itself, so the
 * first bucket begins exactly where the user's window does. Both are <= `from`,
 * which guarantees `localTs - anchor >= 0` and keeps FLOOR away from Postgres's
 * truncate-toward-zero behaviour on negative integer division.
 */
export function bucketAnchor(from: string, grain: Grain): string {
  if (grain === "biweek") {
    return format(startOfISOWeek(parseISO(from)), "yyyy-MM-dd");
  }
  return from;
}

/** Number of days in one bucket, for the integer-division grains. */
export function bucketSizeDays(grain: Grain, customBucketDays?: number): number {
  if (grain === "biweek") return 14;
  if (grain === "custom") {
    if (!customBucketDays) throw new Error("customBucketDays is required for grain 'custom'.");
    return customBucketDays;
  }
  throw new Error(`Grain "${grain}" is not an integer-division grain.`);
}

/**
 * The GROUP BY expression for a grain, always returning a `date` so every grain
 * produces the same column type and the drill-across join keys are comparable.
 */
export function bucketExpr(
  localTs: SQL,
  grain: Grain,
  opts: { from: string; customBucketDays?: number },
): SQL {
  if (NATIVE_TRUNC_GRAINS.has(grain)) {
    // date_trunc's first argument is text, so binding it is safe; the value is
    // a zod enum member regardless.
    return sql`date_trunc(${grain}, ${localTs})::date`;
  }

  if (grain === "half") {
    // Postgres has no 'half' unit: floor the month index into a 0 or 1 half and
    // add that many 6-month steps to the start of the year.
    return sql`(
      date_trunc('year', ${localTs})
      + (FLOOR((EXTRACT(MONTH FROM ${localTs}) - 1) / 6) * INTERVAL '6 months')
    )::date`;
  }

  // biweek / custom: integer day-division from a stable anchor.
  const anchor = bucketAnchor(opts.from, grain);
  const size = bucketSizeDays(grain, opts.customBucketDays);
  return sql`(
    ${anchor}::date
    + (FLOOR(((${localTs})::date - ${anchor}::date)::numeric / ${size}) * ${size})::int
  )`;
}

/**
 * Range predicates.
 *
 * Returns BOTH a coarse bound on the raw column and a precise bound on the local
 * date. The coarse one exists purely so `idx_checkouts_store_created` stays
 * usable — filtering only on the converted expression would force a full scan,
 * and with stores in different timezones no single UTC bound is exact.
 */
export function rangePredicates(time: TimeColumn, from: string, to: string): SQL[] {
  if (time.kind === "local_date_text") {
    // Already store-local, and ISO dates compare correctly as text — so the
    // cheap bound is also the exact one, and it uses the existing index.
    return [sql`${time.column} >= ${from}`, sql`${time.column} <= ${to}`];
  }

  const coarseFrom = format(subDays(parseISO(from), COARSE_PAD_DAYS_BEFORE), "yyyy-MM-dd");
  const coarseTo = format(addDays(parseISO(to), COARSE_PAD_DAYS_AFTER), "yyyy-MM-dd");

  return [
    sql`${time.column} >= ${coarseFrom}::date`,
    sql`${time.column} < ${coarseTo}::date`,
    sql`(${localTimestampExpr(time)})::date BETWEEN ${from}::date AND ${to}::date`,
  ];
}

/**
 * The comparison range for period-over-period.
 *
 * `previous_year` shifts by a calendar year rather than 365 days, so a range
 * spanning a leap day still lines up with the same calendar dates.
 */
export function shiftRange(
  from: string,
  to: string,
  compare: "previous_period" | "previous_year",
): { from: string; to: string } {
  if (compare === "previous_year") {
    return {
      from: format(subYears(parseISO(from), 1), "yyyy-MM-dd"),
      to: format(subYears(parseISO(to), 1), "yyyy-MM-dd"),
    };
  }

  const span = inclusiveDaySpan(from, to);
  const prevTo = subDays(parseISO(from), 1);
  const prevFrom = subDays(prevTo, span - 1);
  return {
    from: format(prevFrom, "yyyy-MM-dd"),
    to: format(prevTo, "yyyy-MM-dd"),
  };
}

/**
 * The dense list of bucket start dates for a range.
 *
 * Used to build the spine every cube LEFT JOINs onto. Without it, a day with no
 * expenses drops out of the series entirely, which silently corrupts every
 * downstream statistic — an RSI computed over a series with holes is meaningless.
 */
export function enumerateBuckets(
  from: string,
  to: string,
  grain: Grain,
  customBucketDays?: number,
): string[] {
  const end = parseISO(to);
  const out: string[] = [];

  if (grain === "biweek" || grain === "custom") {
    const size = bucketSizeDays(grain, customBucketDays);
    let cursor = parseISO(bucketAnchor(from, grain));
    while (cursor <= end) {
      out.push(format(cursor, "yyyy-MM-dd"));
      cursor = addDays(cursor, size);
    }
    return out;
  }

  let cursor = startOfBucket(parseISO(from), grain);
  while (cursor <= end) {
    out.push(format(cursor, "yyyy-MM-dd"));
    cursor = nextBucket(cursor, grain);
  }
  return out;
}

function startOfBucket(d: Date, grain: Grain): Date {
  const y = d.getFullYear();
  const m = d.getMonth();
  switch (grain) {
    case "day":
      return new Date(y, m, d.getDate());
    case "week":
      return startOfISOWeek(d);
    case "month":
      return new Date(y, m, 1);
    case "quarter":
      return new Date(y, Math.floor(m / 3) * 3, 1);
    case "half":
      return new Date(y, m < 6 ? 0 : 6, 1);
    case "year":
      return new Date(y, 0, 1);
    default:
      throw new Error(`startOfBucket does not handle grain "${grain}".`);
  }
}

function nextBucket(d: Date, grain: Grain): Date {
  const y = d.getFullYear();
  const m = d.getMonth();
  switch (grain) {
    case "day":
      return addDays(d, 1);
    case "week":
      return addDays(d, 7);
    case "month":
      return new Date(y, m + 1, 1);
    case "quarter":
      return new Date(y, m + 3, 1);
    case "half":
      return new Date(y, m + 6, 1);
    case "year":
      return new Date(y + 1, 0, 1);
    default:
      throw new Error(`nextBucket does not handle grain "${grain}".`);
  }
}
