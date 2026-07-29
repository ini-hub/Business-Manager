import { describe, expect, it } from "vitest";
import {
  bucketAnchor,
  bucketSizeDays,
  enumerateBuckets,
  localTimestampExpr,
  rangePredicates,
  shiftRange,
} from "./time";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

describe("bucketAnchor", () => {
  it("anchors bi-weeks to the ISO week start so fortnights align to week boundaries", () => {
    // 2026-07-27 is a Monday; 2026-07-29 is the Wednesday of that week.
    expect(bucketAnchor("2026-07-29", "biweek")).toBe("2026-07-27");
    expect(bucketAnchor("2026-07-27", "biweek")).toBe("2026-07-27");
  });

  it("anchors custom buckets to the range start, so bucket 1 begins where the window does", () => {
    expect(bucketAnchor("2026-07-29", "custom")).toBe("2026-07-29");
  });

  it("never returns an anchor after the range start, which is what keeps FLOOR non-negative", () => {
    for (const from of ["2026-01-01", "2026-02-28", "2026-12-31", "2024-02-29"]) {
      expect(bucketAnchor(from, "biweek") <= from).toBe(true);
      expect(bucketAnchor(from, "custom") <= from).toBe(true);
    }
  });
});

describe("bucketSizeDays", () => {
  it("treats a bi-week as 14 days", () => {
    expect(bucketSizeDays("biweek")).toBe(14);
  });

  it("requires an explicit size for custom buckets rather than guessing", () => {
    expect(() => bucketSizeDays("custom")).toThrow(/customBucketDays/);
    expect(bucketSizeDays("custom", 10)).toBe(10);
  });

  it("refuses grains that date_trunc already handles", () => {
    expect(() => bucketSizeDays("month")).toThrow(/integer-division/);
  });
});

describe("enumerateBuckets", () => {
  it("produces one bucket per day inclusive of both ends", () => {
    expect(enumerateBuckets("2026-07-01", "2026-07-05", "day")).toEqual([
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
      "2026-07-04",
      "2026-07-05",
    ]);
  });

  it("starts weeks on the ISO week boundary containing the range start", () => {
    // 2026-07-29 is a Wednesday; its ISO week began Monday 2026-07-27.
    expect(enumerateBuckets("2026-07-29", "2026-08-10", "week")).toEqual([
      "2026-07-27",
      "2026-08-03",
      "2026-08-10",
    ]);
  });

  it("steps bi-weeks 14 days apart from the anchor", () => {
    expect(enumerateBuckets("2026-07-27", "2026-09-01", "biweek")).toEqual([
      "2026-07-27",
      "2026-08-10",
      "2026-08-24",
    ]);
  });

  it("honours a custom bucket size and stops before overshooting the range end", () => {
    // Buckets start 07-01, 07-11, 07-21; the last is past `to`, so it is not emitted.
    expect(enumerateBuckets("2026-07-01", "2026-07-20", "custom", 10)).toEqual([
      "2026-07-01",
      "2026-07-11",
    ]);
  });

  it("splits a year into two half-year buckets", () => {
    expect(enumerateBuckets("2026-01-01", "2026-12-31", "half")).toEqual([
      "2026-01-01",
      "2026-07-01",
    ]);
  });

  it("walks quarters across a year boundary", () => {
    expect(enumerateBuckets("2026-11-15", "2027-04-01", "quarter")).toEqual([
      "2026-10-01",
      "2027-01-01",
      "2027-04-01",
    ]);
  });

  it("handles a leap day without dropping or duplicating a bucket", () => {
    const days = enumerateBuckets("2024-02-27", "2024-03-02", "day");
    expect(days).toEqual([
      "2024-02-27",
      "2024-02-28",
      "2024-02-29",
      "2024-03-01",
      "2024-03-02",
    ]);
  });
});

describe("shiftRange", () => {
  it("places the previous period immediately before the current one, same length", () => {
    // 2026-07-01..2026-07-31 is 31 days, so the previous period is 2026-05-31..2026-06-30.
    expect(shiftRange("2026-07-01", "2026-07-31", "previous_period")).toEqual({
      from: "2026-05-31",
      to: "2026-06-30",
    });
  });

  it("leaves no gap and no overlap between the two periods", () => {
    const prev = shiftRange("2026-03-10", "2026-03-20", "previous_period");
    expect(prev.to).toBe("2026-03-09");
  });

  it("shifts by a calendar year, so a leap-spanning range keeps its dates", () => {
    expect(shiftRange("2025-02-28", "2025-03-01", "previous_year")).toEqual({
      from: "2024-02-28",
      to: "2024-03-01",
    });
  });
});

describe("rangePredicates", () => {
  const utcColumn = {
    column: sql`c.created_at`,
    kind: "utc_timestamp" as const,
    timezoneColumn: sql`s.timezone`,
  };

  it("emits a coarse index-usable bound AND a precise local bound for UTC columns", () => {
    const predicates = rangePredicates(utcColumn, "2026-07-01", "2026-07-31");
    // Two coarse bounds keep idx_checkouts_store_created usable; the third is the
    // exact store-local filter.
    expect(predicates).toHaveLength(3);
  });

  it("pads the coarse bound wide enough to cover every real UTC offset", () => {
    const dialect = new PgDialect();
    const params = rangePredicates(utcColumn, "2026-07-01", "2026-07-31").flatMap(
      (p) => dialect.sqlToQuery(p).params,
    );
    // Offsets run -12..+14, so a day back and two days forward is always a superset.
    expect(params).toContain("2026-06-30");
    expect(params).toContain("2026-08-02");
  });

  it("does no timezone conversion at all for local date-text columns", () => {
    const textColumn = { column: sql`e.date`, kind: "local_date_text" as const };
    const predicates = rangePredicates(textColumn, "2026-07-01", "2026-07-31");
    // Exactly two bounds and no conversion: the stored value is already local, so
    // converting it would re-introduce the offset the caller just removed.
    expect(predicates).toHaveLength(2);
  });
});

describe("localTimestampExpr", () => {
  it("refuses to bucket a UTC column without a store timezone to convert through", () => {
    expect(() =>
      localTimestampExpr({ column: sql`c.created_at`, kind: "utc_timestamp" }),
    ).toThrow(/timezoneColumn/);
  });
});
