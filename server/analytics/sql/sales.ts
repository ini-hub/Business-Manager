/**
 * Analytics Explorer — sales SQL bindings.
 *
 * Every aggregate here is transcribed from SalesRepository.getProfitLossSummary
 * so the Explorer and the P&L report agree to the cent. Two transcription details
 * are easy to get wrong and are load-bearing:
 *
 * - The `GREATEST(..., 0)` clamps are PER LINE, matching the JS `Math.max(0, ...)`.
 *   That is why Gross Revenue - Returned Revenue is not identically Net Revenue:
 *   a line refunded for more than it sold for contributes 0 to net but its full
 *   refund to returned. Reproducing the clamp per line preserves that.
 *
 * - The service/product split tests POSITIVELY in both directions
 *   (`WHEN type = 'service'` / `WHEN type = 'product'`), so a row of any other type
 *   lands in neither. That matches the JS, and it matters now that 'supply' exists:
 *   an `ELSE` on either side would silently bank back-bar consumables as product
 *   revenue. Consequently Service + Product need not equal Net Revenue if a supply
 *   ever reaches a sale line — which it should not, and which the JS logs.
 */

import { sql, type SQL } from "drizzle-orm";
import { DEFAULT_LOYALTY_POINT_VALUE } from "@shared/analytics/constants";
import type { CubeSql } from "./types";

/**
 * Money columns must be cast to `numeric` before they are summed.
 *
 * `shared/schema.ts` declares these as numeric(12,2), but in the live database
 * `orders.total_price`, `orders.refunded_amount`, `checkouts.total_price`,
 * `checkouts.subtotal`, `checkouts.discount_amount`, `expenses.amount` and
 * several others are actually `real` (float4). float4 carries only ~7 significant
 * decimal digits, so SUM() over a store doing hundreds of millions accumulates in
 * float4 and drifts — measured at 15 naira on a 153M total.
 *
 * The existing reports avoid this by accident: they fetch rows and reduce in JS,
 * which widens each float4 to a float64 first. Casting to numeric here matches
 * that behaviour exactly and is also simply correct. It stays correct if the
 * columns are ever migrated to real numeric.
 */
const money = (column: SQL) => sql`(${column})::numeric`;

/** Net revenue for one line: refund-adjusted and clamped at zero. */
const NET_LINE_REVENUE = sql`GREATEST(${money(sql`o.total_price`)} - ${money(sql`o.refunded_amount`)}, 0)`;

/** Quantities are genuinely numeric already, so they need no cast. */
const NET_LINE_QTY = sql`GREATEST(o.quantity - o.returned_quantity, 0)`;

export const salesLinesCube: CubeSql = {
  id: "sales_lines",

  // `products` is joined because category and brand live on the product group —
  // the inventory (variant) row carries neither.
  buildFrom: () => sql`
    checkouts c
      JOIN orders    o ON o.id = c.order_id
      JOIN inventory i ON i.id = o.inventory_id
      JOIN products  p ON p.id = i.product_id
      JOIN stores    s ON s.id = c.store_id
  `,

  tenantColumn: sql`c.store_id`,

  basePredicate: sql`c.payment_status = 'completed' AND c.is_voided = false`,

  time: {
    column: sql`c.created_at`,
    kind: "utc_timestamp",
    timezoneColumn: sql`s.timezone`,
  },

  measures: {
    "sales.net_revenue": {
      kind: "agg",
      agg: sql`COALESCE(SUM(${NET_LINE_REVENUE}), 0)`,
    },
    "sales.gross_revenue": {
      kind: "agg",
      agg: sql`COALESCE(SUM(${money(sql`o.total_price`)}), 0)`,
    },
    "sales.returned_revenue": {
      kind: "agg",
      agg: sql`COALESCE(SUM(${money(sql`o.refunded_amount`)}), 0)`,
    },
    "sales.service_revenue": {
      kind: "agg",
      agg: sql`COALESCE(SUM(CASE WHEN i.type = 'service' THEN ${NET_LINE_REVENUE} ELSE 0 END), 0)`,
    },
    "sales.product_revenue": {
      kind: "agg",
      agg: sql`COALESCE(SUM(CASE WHEN i.type = 'product' THEN ${NET_LINE_REVENUE} ELSE 0 END), 0)`,
    },
    "sales.cogs": {
      kind: "agg",
      agg: sql`COALESCE(SUM(i.cost_price * ${NET_LINE_QTY}), 0)`,
    },
    "sales.units": {
      kind: "agg",
      agg: sql`COALESCE(SUM(${NET_LINE_QTY}), 0)`,
    },
    "sales.line_items": {
      kind: "agg",
      agg: sql`COUNT(*)`,
    },

    "sales.gross_profit": {
      kind: "derived",
      derive: (v) => (v["sales.net_revenue"] ?? 0) - (v["sales.cogs"] ?? 0),
    },
    "sales.gross_margin": {
      kind: "derived",
      derive: (v) => {
        const revenue = v["sales.net_revenue"] ?? 0;
        if (revenue === 0) return null;
        return ((revenue - (v["sales.cogs"] ?? 0)) / revenue) * 100;
      },
    },
  },

  dimensions: {
    store: sql`c.store_id`,
    "sales.item": sql`i.id`,
    "sales.product": sql`p.id`,
    "sales.category": sql`COALESCE(p.category, 'Uncategorised')`,
    "sales.brand": sql`COALESCE(p.brand, 'Unbranded')`,
    "sales.item_type": sql`i.type`,
  },
};

/**
 * Receipt-grain sales.
 *
 * `checkouts` stores one row per LINE, but replicates the basket-level discount,
 * points redeemed and subtotal onto each of those rows (SalesRepository writes
 * `discountAmount: totalDiscount` per line rather than the prorated portion it
 * computes a few lines earlier). Summing them at line grain multiplies them by
 * the line count — which is what the P&L report currently does. DISTINCT ON
 * collapses back to one row per receipt first.
 *
 * The tenant and coarse date predicates are pushed INSIDE the subquery: without
 * that, Postgres would sort and deduplicate every checkout in the table on every
 * request.
 */
export const salesReceiptsCube: CubeSql = {
  id: "sales_receipts",

  buildFrom: (ctx) => sql`
    (
      SELECT DISTINCT ON (c0.store_id, c0.receipt_number)
             c0.store_id,
             c0.receipt_number,
             c0.created_at,
             c0.payment_method,
             c0.discount_amount,
             c0.points_redeemed,
             c0.subtotal,
             c0.staff_id
      FROM checkouts c0
      WHERE c0.payment_status = 'completed'
        AND c0.is_voided      = false
        AND c0.store_id       = ANY(${sql.param(ctx.storeIds)})
        AND c0.created_at    >= (${ctx.from}::date - INTERVAL '1 day')
        AND c0.created_at    <  (${ctx.to}::date   + INTERVAL '2 days')
      ORDER BY c0.store_id, c0.receipt_number, c0.created_at
    ) r
    JOIN stores s ON s.id = r.store_id
    LEFT JOIN settings st ON st.store_id = r.store_id
  `,

  tenantColumn: sql`r.store_id`,

  time: {
    column: sql`r.created_at`,
    kind: "utc_timestamp",
    timezoneColumn: sql`s.timezone`,
  },

  measures: {
    "sales.receipts": {
      kind: "agg",
      agg: sql`COUNT(*)`,
    },
    "sales.discounts": {
      kind: "agg",
      agg: sql`COALESCE(SUM(${money(sql`r.discount_amount`)} + r.points_redeemed * COALESCE(st.loyalty_point_value, ${DEFAULT_LOYALTY_POINT_VALUE})), 0)`,
    },
    "sales.avg_basket": {
      kind: "derived",
      derive: (v) => {
        const receipts = v["sales.receipts"] ?? 0;
        if (receipts === 0) return null;
        return (v["sales.net_revenue"] ?? 0) / receipts;
      },
    },
  },

  dimensions: {
    store: sql`r.store_id`,
    "sales.staff": sql`r.staff_id`,
    "sales.payment_method": sql`r.payment_method`,
  },
};
