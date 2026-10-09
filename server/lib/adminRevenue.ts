import { sql } from "drizzle-orm";
import { db } from "../db";

/**
 * The platform revenue summary: subscriptions, MRR and ARR, churn, and the top businesses by gross sales.
 *
 * This used to load every business, subscription and plan into Node, and "top businesses" ran the sales of the
 * first five businesses created through a loop and then sorted those five, so it listed whichever five signed up
 * first rather than the biggest. It is now two statements: the subscription figures are summed by the database,
 * and the top five are the five largest by gross sales, from every non-deleted business.
 *
 * MRR: an active subscription counts its plan's monthly price, or its annual price divided by twelve when billed
 * annually; a subscription whose plan is missing is still counted as paying but adds nothing. Churn is
 * subscriptions cancelled (last updated) in the current calendar month of the server's zone.
 */
export async function getRevenueAnalytics(now: Date = new Date()) {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const [summary, top] = await Promise.all([
    db.execute(sql`
      SELECT
        (SELECT count(*) FROM organisations WHERE status = 'trialing')::int AS free_trial,
        count(*) FILTER (WHERE s.status = 'active')::int AS active_paying,
        COALESCE(SUM(CASE WHEN s.billing_cycle = 'annual' THEN p.price_annual::numeric / 12 ELSE p.price_monthly::numeric END)
                 FILTER (WHERE s.status = 'active' AND p.id IS NOT NULL), 0)::float8 AS mrr,
        count(*) FILTER (WHERE s.status = 'cancelled' AND s.updated_at >= ${monthStart.toISOString()}::timestamp
                                AND s.updated_at < ${nextMonthStart.toISOString()}::timestamp)::int AS churned_this_month
      FROM subscriptions s LEFT JOIN plans p ON p.id = s.plan_id`),
    db.execute(sql`
      SELECT o.name, COALESCE(SUM(c.total_price), 0)::float8 AS gmv
      FROM organisations o
      JOIN stores st ON st.business_id = o.id
      JOIN checkouts c ON c.store_id = st.id AND c.is_voided = false
      WHERE o.deleted_at IS NULL
      GROUP BY o.id, o.name
      ORDER BY gmv DESC, o.name
      LIMIT 5`),
  ]);

  const row = summary.rows[0] as Record<string, number>;
  const mrr = Number(row.mrr);
  const activePaying = Number(row.active_paying);
  return {
    revenueSummary: {
      activePaying,
      freeTrial: Number(row.free_trial),
      churnedThisMonth: Number(row.churned_this_month),
      mrr,
      arr: mrr * 12,
      arpu: activePaying > 0 ? mrr / activePaying : 0,
    },
    topBusinesses: (top.rows as { name: string; gmv: number }[]).map((r) => ({ name: r.name, gmv: Number(r.gmv) })),
  };
}
