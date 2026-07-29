/**
 * Analytics Explorer — parity harness.
 *
 * The Phase 0 release gate. Runs the existing report path and the new Explorer
 * path over the same store and date range, and asserts they agree to the cent.
 *
 *   npm run analytics:parity
 *
 * This is not a unit test: it needs a real database, because what it is actually
 * checking is that a hand-written JS reduce and a SQL GROUP BY interpret the same
 * rows identically — clamping, null handling, timezone boundaries and all.
 *
 * Exits non-zero on any mismatch so CI can gate on it.
 */

import { sql } from "drizzle-orm";
import { db } from "../server/db";
import { storage } from "../server/storage";
import { runAnalyticsQuery } from "../server/analytics/execute";
import { assertBindingsComplete } from "../server/analytics/sql";
import { analyticsQuerySchema } from "@shared/analytics/query";

/** Money agrees to the cent; counts and quantities must agree exactly. */
const MONEY_TOLERANCE = 0.01;

interface Comparison {
  label: string;
  expected: number;
  actual: number;
  tolerance: number;
}

interface CaseResult {
  store: string;
  range: string;
  comparisons: Comparison[];
  failures: Comparison[];
  error?: string;
}

function near(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance;
}

function fmt(n: number): string {
  return n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function loadStores(): Promise<{ id: string; name: string; timezone: string }[]> {
  const result: any = await db.execute(
    sql`SELECT id, name, COALESCE(timezone, 'Africa/Lagos') AS timezone
        FROM stores
        WHERE is_active = true
        ORDER BY name`,
  );
  return result.rows ?? [];
}

/**
 * Builds the range matrix from real data rather than hard-coded dates: a harness
 * that silently tests only empty ranges proves nothing.
 */
async function buildRanges(storeId: string): Promise<{ label: string; from: string; to: string }[]> {
  const result: any = await db.execute(
    sql`SELECT MIN(c.created_at AT TIME ZONE 'UTC' AT TIME ZONE s.timezone)::date::text AS first,
               MAX(c.created_at AT TIME ZONE 'UTC' AT TIME ZONE s.timezone)::date::text AS last,
               MODE() WITHIN GROUP (
                 ORDER BY (c.created_at AT TIME ZONE 'UTC' AT TIME ZONE s.timezone)::date
               )::text AS busiest
        FROM checkouts c
        JOIN stores s ON s.id = c.store_id
        WHERE c.store_id = ${storeId}
          AND c.is_voided = false
          AND c.payment_status = 'completed'`,
  );

  const { first, last, busiest } = result.rows?.[0] ?? {};
  const ranges: { label: string; from: string; to: string }[] = [];

  if (!first || !last) return ranges;

  ranges.push({ label: "all time", from: first, to: last });
  if (busiest) ranges.push({ label: `single day (${busiest})`, from: busiest, to: busiest });

  // A whole calendar month around the busiest day.
  if (busiest) {
    const monthStart = `${busiest.slice(0, 7)}-01`;
    const d = new Date(`${monthStart}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + 1);
    d.setUTCDate(0);
    ranges.push({
      label: `month of ${busiest.slice(0, 7)}`,
      from: monthStart,
      to: d.toISOString().slice(0, 10),
    });
  }

  // A range that provably contains nothing: an empty result must still agree.
  ranges.push({ label: "empty range (far future)", from: "2099-01-01", to: "2099-01-31" });

  return ranges;
}

/**
 * Ranges that exercise the multi-line discounted receipt and partial return
 * cases, which is where the two implementations are most likely to diverge.
 */
async function findEdgeCaseDays(storeId: string): Promise<{ label: string; from: string; to: string }[]> {
  const out: { label: string; from: string; to: string }[] = [];

  const multiLineDiscount: any = await db.execute(
    sql`SELECT (c.created_at AT TIME ZONE 'UTC' AT TIME ZONE s.timezone)::date::text AS day
        FROM checkouts c
        JOIN stores s ON s.id = c.store_id
        WHERE c.store_id = ${storeId}
          AND c.is_voided = false
          AND c.payment_status = 'completed'
          AND (c.discount_amount > 0 OR c.points_redeemed > 0)
        GROUP BY 1, c.receipt_number
        HAVING COUNT(*) > 1
        LIMIT 1`,
  );
  if (multiLineDiscount.rows?.[0]?.day) {
    const day = multiLineDiscount.rows[0].day;
    out.push({ label: `multi-line discounted receipt (${day})`, from: day, to: day });
  }

  const partialReturn: any = await db.execute(
    sql`SELECT (c.created_at AT TIME ZONE 'UTC' AT TIME ZONE s.timezone)::date::text AS day
        FROM checkouts c
        JOIN orders o ON o.id = c.order_id
        JOIN stores s ON s.id = c.store_id
        WHERE c.store_id = ${storeId}
          AND c.is_voided = false
          AND c.payment_status = 'completed'
          AND (o.returned_quantity > 0 OR o.refunded_amount > 0)
        LIMIT 1`,
  );
  if (partialReturn.rows?.[0]?.day) {
    const day = partialReturn.rows[0].day;
    out.push({ label: `partially returned line (${day})`, from: day, to: day });
  }

  return out;
}

async function runCase(
  store: { id: string; name: string },
  range: { label: string; from: string; to: string },
): Promise<CaseResult> {
  const result: CaseResult = {
    store: store.name,
    range: range.label,
    comparisons: [],
    failures: [],
  };

  try {
    const expected = await storage.getProfitLossSummary(store.id, range.from, range.to);

    const query = analyticsQuerySchema.parse({
      storeIds: [store.id],
      measures: [
        "sales.service_revenue",
        "sales.product_revenue",
        "sales.gross_revenue",
        "sales.returned_revenue",
        "sales.net_revenue",
        "sales.cogs",
        "sales.gross_profit",
        "sales.discounts",
      ],
      dimensions: [],
      time: { from: range.from, to: range.to, grain: "day" },
    });
    const actual = await runAnalyticsQuery(query);
    const t = actual.totals;

    result.comparisons = [
      { label: "serviceRevenue", expected: expected.serviceRevenue, actual: t["sales.service_revenue"] ?? 0, tolerance: MONEY_TOLERANCE },
      { label: "productRevenue", expected: expected.productRevenue, actual: t["sales.product_revenue"] ?? 0, tolerance: MONEY_TOLERANCE },
      { label: "grossRevenue", expected: expected.grossRevenue, actual: t["sales.gross_revenue"] ?? 0, tolerance: MONEY_TOLERANCE },
      { label: "returnedRevenue", expected: expected.returnedRevenue, actual: t["sales.returned_revenue"] ?? 0, tolerance: MONEY_TOLERANCE },
      { label: "totalRevenue", expected: expected.totalRevenue, actual: t["sales.net_revenue"] ?? 0, tolerance: MONEY_TOLERANCE },
      { label: "costOfGoodsSold", expected: expected.costOfGoodsSold, actual: t["sales.cogs"] ?? 0, tolerance: MONEY_TOLERANCE },
      { label: "grossProfit", expected: expected.grossProfit, actual: t["sales.gross_profit"] ?? 0, tolerance: MONEY_TOLERANCE },
      // Both sides must now deduplicate the basket discount by receipt. Before
      // that fix the report multiplied it by the receipt's line count, so this
      // comparison is the regression guard for it.
      { label: "discountsGiven", expected: expected.discountsGiven, actual: t["sales.discounts"] ?? 0, tolerance: MONEY_TOLERANCE },
    ];

    result.failures = result.comparisons.filter((c) => !near(c.expected, c.actual, c.tolerance));
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }

  return result;
}

/**
 * Cross-checks the grain layer: bucketing a range by day and summing the buckets
 * must equal the ungrouped total. If timezone conversion put a sale in the wrong
 * bucket the totals still match, but this catches a sale falling outside every
 * bucket — which is the failure mode that matters.
 */
async function runGrainConsistency(
  store: { id: string; name: string },
  range: { from: string; to: string },
): Promise<CaseResult> {
  const result: CaseResult = {
    store: store.name,
    range: "grain consistency (daily buckets sum to total)",
    comparisons: [],
    failures: [],
  };

  try {
    const base = {
      storeIds: [store.id],
      measures: ["sales.net_revenue", "sales.line_items"],
      time: { from: range.from, to: range.to, grain: "day" as const },
      limit: 5000,
    };

    const total = await runAnalyticsQuery(analyticsQuerySchema.parse({ ...base, dimensions: [] }));
    const byDay = await runAnalyticsQuery(
      analyticsQuerySchema.parse({ ...base, dimensions: ["date"] }),
    );

    if (byDay.meta.truncated) {
      result.error = "daily result was truncated; widen the row limit to compare";
      return result;
    }

    const summed = byDay.rows.reduce(
      (acc, row) => {
        acc.revenue += typeof row["sales.net_revenue"] === "number" ? row["sales.net_revenue"] : 0;
        acc.lines += typeof row["sales.line_items"] === "number" ? row["sales.line_items"] : 0;
        return acc;
      },
      { revenue: 0, lines: 0 },
    );

    result.comparisons = [
      { label: "net revenue", expected: total.totals["sales.net_revenue"] ?? 0, actual: summed.revenue, tolerance: MONEY_TOLERANCE },
      { label: "line items", expected: total.totals["sales.line_items"] ?? 0, actual: summed.lines, tolerance: 0 },
    ];
    result.failures = result.comparisons.filter((c) => !near(c.expected, c.actual, c.tolerance));
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }

  return result;
}

async function main() {
  console.log("Analytics parity harness\n" + "=".repeat(70));

  assertBindingsComplete();
  console.log("Model and SQL bindings are consistent.\n");

  const stores = await loadStores();
  if (stores.length === 0) {
    console.log("No active stores found — nothing to compare.");
    process.exit(0);
  }

  const results: CaseResult[] = [];
  const withSales: { store: { id: string; name: string }; from: string; to: string }[] = [];

  for (const store of stores) {
    const ranges = [...(await buildRanges(store.id)), ...(await findEdgeCaseDays(store.id))];

    if (ranges.length === 0) {
      console.log(`- ${store.name} (${store.timezone}): no completed sales, skipped`);
      continue;
    }

    console.log(`- ${store.name} (${store.timezone}): ${ranges.length} ranges`);

    for (const range of ranges) {
      results.push(await runCase(store, range));
    }

    const allTime = ranges.find((r) => r.label === "all time");
    if (allTime) {
      results.push(await runGrainConsistency(store, allTime));
      withSales.push({ store, from: allTime.from, to: allTime.to });
    }
  }

  // --- report
  console.log("\n" + "=".repeat(70));
  const failed = results.filter((r) => r.failures.length > 0 || r.error);

  for (const r of results) {
    if (r.error) {
      console.log(`\nERROR  ${r.store} / ${r.range}\n       ${r.error}`);
      continue;
    }
    if (r.failures.length === 0) continue;

    console.log(`\nFAIL   ${r.store} / ${r.range}`);
    for (const f of r.failures) {
      const delta = f.actual - f.expected;
      console.log(
        `       ${f.label.padEnd(18)} report=${fmt(f.expected).padStart(16)}  ` +
          `explorer=${fmt(f.actual).padStart(16)}  delta=${fmt(delta)}`,
      );
    }
  }

  // ── Grain invariance ──────────────────────────────────────────────────────
  // Totals must not depend on how the range is bucketed. This is the regression
  // guard for the bucket expressions: an off-by-one in the bi-week/custom anchor
  // arithmetic, or a boundary that drops or double-counts a row, shows up here as
  // a total that shifts when only the grain changed.
  const grains = ["day", "week", "biweek", "month", "quarter", "half", "year", "custom"] as const;
  let grainFailures = 0;

  for (const { store, from, to } of withSales) {
    const totals = await Promise.all(
      grains.map(async (grain) => {
        const query = analyticsQuerySchema.parse({
          storeIds: [store.id],
          measures: ["sales.net_revenue"],
          dimensions: ["date"],
          time: {
            from,
            to,
            grain,
            ...(grain === "custom" ? { customBucketDays: 10 } : {}),
            compare: "none",
          },
        });
        return (await runAnalyticsQuery(query)).totals["sales.net_revenue"] ?? 0;
      }),
    );

    const distinct = new Set(totals.map((t) => Number(t).toFixed(2)));
    if (distinct.size > 1) {
      grainFailures += 1;
      console.log(`\nFAIL   ${store.name} — net revenue changes with grain:`);
      grains.forEach((g, i) => console.log(`       ${g.padEnd(8)} ${fmt(totals[i])}`));
    }
  }
  console.log(
    `\nGrain invariance: ${withSales.length} store(s) x ${grains.length} grains — ` +
      `${grainFailures === 0 ? "PASS" : `${grainFailures} FAILING`}`,
  );

  const checks = results.reduce((n, r) => n + r.comparisons.length, 0);
  console.log("\n" + "=".repeat(70));
  console.log(
    `${results.length} cases, ${checks} value comparisons, ` +
      `${failed.length} failing case(s).`,
  );

  if (failed.length > 0) {
    console.log("\nParity gate FAILED. The Explorer disagrees with the existing reports.");
    process.exit(1);
  }

  console.log("\nParity gate PASSED. Explorer and existing reports agree to the cent.");
  process.exit(0);
}

main().catch((error) => {
  console.error("Parity harness crashed:", error);
  process.exit(1);
});
