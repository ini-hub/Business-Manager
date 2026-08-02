import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { analyticsQuerySchema, type AnalyticsQueryInput } from "@shared/analytics/query";
import { compileCubeQuery, AnalyticsCompileError } from "./compiler";
import { assertBindingsComplete } from "./sql";

const dialect = new PgDialect();

function parse(input: AnalyticsQueryInput) {
  return analyticsQuerySchema.parse(input);
}

function compile(input: AnalyticsQueryInput, cube: "sales_lines" | "sales_receipts" = "sales_lines") {
  const query = parse(input);
  const compiled = compileCubeQuery(cube, query, {
    from: query.time.from,
    to: query.time.to,
  });
  return { compiled, ...dialect.sqlToQuery(compiled.statement) };
}

const BASE: AnalyticsQueryInput = {
  storeIds: ["store-1"],
  measures: ["sales.net_revenue"],
  dimensions: ["date"],
  time: { from: "2026-07-01", to: "2026-07-31", grain: "day" },
};

describe("model/binding consistency", () => {
  it("has a SQL binding for every published catalog id and vice versa", () => {
    expect(() => assertBindingsComplete()).not.toThrow();
  });

  it("compiles the consumables cube with its own dimensions", () => {
    // assertBindingsComplete covers presence; this covers that the cube actually
    // emits SQL, and that consuming_item resolves to the SERVICE that drew the
    // supply down (orders.inventory_id) rather than to the supply itself.
    const query = parse({
      storeIds: ["store-1"],
      measures: ["consumables.recipe_cost", "consumables.units_used"],
      dimensions: ["date", "consumables.consuming_item"],
      time: { from: "2026-07-01", to: "2026-07-31", grain: "day" },
    });
    const compiled = compileCubeQuery("consumables", query, { from: query.time.from, to: query.time.to });
    const { sql: text } = dialect.sqlToQuery(compiled.statement);

    expect(text).toContain("order_consumables");
    expect(text).toContain("o.inventory_id");
    // Voided sales must not be counted, and the cost cast must survive.
    expect(text).toContain("c.is_voided = false");
    expect(text).toContain("(oc.total_cost)::numeric");
  });

  it("splits expenses by cost class into parts that sum to operating expenses", () => {
    const query = parse({
      storeIds: ["store-1"],
      measures: ["expenses.overhead_amount", "expenses.direct_supply_amount"],
      dimensions: ["date"],
      time: { from: "2026-07-01", to: "2026-07-31", grain: "day" },
    });
    const compiled = compileCubeQuery("expenses", query, { from: query.time.from, to: query.time.to });
    const { sql: text } = dialect.sqlToQuery(compiled.statement);

    // Both halves must carry the Payroll exclusion, or selecting them alongside a
    // payroll measure double-counts wages the way expenses.total_amount does.
    expect(text.match(/ec\.name = 'Payroll'/g)?.length).toBe(2);
    expect(text).toContain("cost_class");
  });
});

describe("parameterisation", () => {
  it("binds store ids rather than embedding them", () => {
    const { sql: text, params } = compile({ ...BASE, storeIds: ["store-abc"] });
    expect(text).not.toContain("store-abc");
    expect(params).toContainEqual(["store-abc"]);
  });

  it("binds filter values rather than embedding them", () => {
    const { sql: text, params } = compile({
      ...BASE,
      filters: [{ dimension: "sales.category", op: "eq", values: ["Hair Care"] }],
    });
    expect(text).not.toContain("Hair Care");
    expect(params).toContain("Hair Care");
  });

  it("does not let a quote in a filter value escape into SQL text", () => {
    const attack = "'; DROP TABLE checkouts; --";
    const { sql: text, params } = compile({
      ...BASE,
      filters: [{ dimension: "sales.category", op: "eq", values: [attack] }],
    });
    expect(text).not.toContain("DROP TABLE");
    expect(text).not.toContain(attack);
    expect(params).toContain(attack);
  });

  it("escapes LIKE wildcards so a literal % stays literal", () => {
    const { params } = compile({
      ...BASE,
      filters: [{ dimension: "sales.category", op: "contains", values: ["50%_off"] }],
    });
    // The stored value is matched literally, not as "any characters".
    expect(params).toContain("50\\%\\_off");
  });

  it("emits only positional output aliases, never a user-supplied identifier", () => {
    const { sql: text } = compile({
      ...BASE,
      measures: ["sales.net_revenue", "sales.units"],
      dimensions: ["date", "sales.category"],
    });
    expect(text).toContain('AS "d_0"');
    expect(text).toContain('AS "m_0"');
    expect(text).toContain('AS "m_1"');
    expect(text).not.toContain("sales.net_revenue");
  });
});

describe("measure selection", () => {
  it("does not select derived measures in SQL, but does select their inputs", () => {
    const { compiled } = compile({ ...BASE, measures: ["sales.gross_margin"] });
    // gross_margin is computed after aggregation; net_revenue and cogs are what SQL returns.
    expect(compiled.measureRefs).toEqual(["sales.net_revenue", "sales.cogs"]);
  });

  it("clamps refunds per line, matching the P&L's Math.max(0, ...)", () => {
    const { sql: text } = compile(BASE);
    expect(text).toContain(
      "GREATEST((o.total_price)::numeric - (o.refunded_amount)::numeric, 0)",
    );
  });

  it("casts money to numeric before summing, because the columns are really float4", () => {
    // orders.total_price and friends are `real` in the live database despite the
    // schema declaring numeric(12,2). Summing float4 directly loses precision
    // above ~7 significant digits — measured at 15 naira on a 153M total. Removing
    // these casts silently reintroduces that drift, so assert they are present.
    const { sql: text } = compile({
      ...BASE,
      measures: ["sales.net_revenue", "sales.gross_revenue", "sales.returned_revenue"],
    });
    expect(text).toContain("(o.total_price)::numeric");
    expect(text).toContain("(o.refunded_amount)::numeric");
  });

  it("splits service and product revenue by positive tests, so a supply lands in neither", () => {
    // Both sides must name the type they want. An ELSE on either side would bank
    // back-bar consumables (type 'supply') as product revenue — the same silent
    // misclassification the JS in SalesRepository.getProfitLossSummary avoids by
    // testing both directions and logging anything else.
    const { sql: text } = compile({
      ...BASE,
      measures: ["sales.service_revenue", "sales.product_revenue"],
    });
    expect(text).toContain("CASE WHEN i.type = 'service' THEN");
    expect(text).toContain("CASE WHEN i.type = 'product' THEN");
    expect(text).not.toContain("WHEN i.type = 'service' THEN 0 ELSE");
  });

  it("splits product and service COGS by positive tests, so a supply lands in neither", () => {
    // Same rationale as the revenue split above: sales.product_cogs and
    // sales.service_cogs must sum to sales.cogs under the "supply never sells"
    // invariant, which only holds if both sides test their own type positively
    // instead of one side using a catch-all ELSE.
    const { sql: text } = compile({
      ...BASE,
      measures: ["sales.product_cogs", "sales.service_cogs"],
    });
    expect(text).toContain("CASE WHEN i.type = 'product' THEN");
    expect(text).toContain("CASE WHEN i.type = 'service' THEN");
    expect(text).not.toContain("WHEN i.type = 'product' THEN 0 ELSE");
    expect(text).not.toContain("WHEN i.type = 'service' THEN 0 ELSE");
  });
});

describe("time bucketing", () => {
  it("converts through the store's own timezone, not the server's", () => {
    const { sql: text } = compile(BASE);
    expect(text).toContain("AT TIME ZONE 'UTC' AT TIME ZONE s.timezone");
  });

  it("returns the bucket as text so the pg driver cannot re-interpret it", () => {
    const { sql: text } = compile(BASE);
    expect(text).toMatch(/\)::text AS "bucket"/);
  });

  it("uses integer day-division with an anchor for bi-weeks", () => {
    const { compiled, sql: text, params } = compile({
      ...BASE,
      time: { from: "2026-07-29", to: "2026-09-01", grain: "biweek" },
    });
    expect(text).toContain("FLOOR(");
    expect(params).toContain(14);
    // Anchored to the ISO week start so fortnights land on week boundaries.
    expect(compiled.bucketAnchor).toBe("2026-07-27");
  });

  it("reports no anchor for grains date_trunc handles natively", () => {
    const { compiled } = compile({
      ...BASE,
      time: { from: "2026-01-01", to: "2026-12-31", grain: "month" },
    });
    expect(compiled.bucketAnchor).toBeNull();
  });
});

describe("safety limits", () => {
  it("asks for one row beyond the limit so truncation is detectable", () => {
    const { params } = compile({ ...BASE, limit: 100 });
    expect(params).toContain(101);
  });
});

describe("cross-cube guards", () => {
  it("refuses a dimension the cube does not carry", () => {
    const query = parse({
      ...BASE,
      measures: ["sales.receipts"],
      dimensions: ["date", "sales.payment_method"],
    });
    expect(() =>
      compileCubeQuery("sales_lines", query, { from: query.time.from, to: query.time.to }),
    ).toThrow(AnalyticsCompileError);
  });

  it("refuses to apply a filter to a cube that lacks the dimension, rather than ignoring it", () => {
    // Silently dropping the filter here would compare a filtered series against
    // an unfiltered one.
    const query = parse({
      ...BASE,
      measures: ["sales.net_revenue"],
      dimensions: ["date"],
      filters: [{ dimension: "sales.payment_method", op: "eq", values: ["cash"] }],
    });
    expect(() =>
      compileCubeQuery("sales_lines", query, { from: query.time.from, to: query.time.to }),
    ).toThrow(/does not exist on all the selected data/);
  });
});

describe("receipt grain", () => {
  it("deduplicates checkouts to one row per receipt before summing discounts", () => {
    const { sql: text } = compile(
      {
        ...BASE,
        measures: ["sales.discounts"],
        dimensions: ["date"],
      },
      "sales_receipts",
    );
    // Without DISTINCT ON, the basket discount replicated onto each line would be
    // multiplied by the line count — the bug the P&L report still has.
    expect(text).toContain("DISTINCT ON (c0.store_id, c0.receipt_number)");
  });

  it("pushes the tenant and date bounds inside the dedup subquery", () => {
    const { sql: text } = compile(
      { ...BASE, measures: ["sales.discounts"] },
      "sales_receipts",
    );
    const subqueryEnd = text.indexOf(") r");
    // Otherwise Postgres would sort and deduplicate the entire checkouts table
    // on every request.
    expect(text.slice(0, subqueryEnd)).toContain("c0.store_id       = ANY(");
  });
});
