import { parseDbTimestamp } from "./dbTime";
import { sql } from "drizzle-orm";
import { db } from "../db";

/**
 * The super-admin dashboard's figures. This used to be about 70 sequential queries (a count per day for the
 * 30-day growth line, a fetch per day for the 7-day bars, a loop of two queries per business to find the ones
 * stuck in onboarding, a store lookup per live-feed transaction) plus whole-table row pulls that were summed in
 * Node, and the heatmap was random numbers. It is now four statements run in parallel, each doing its own
 * counting in the database, and the heatmap is real.
 *
 * Day boundaries are the server's local days, exactly as before. Instants are passed as ISO strings cast to
 * timestamp: the columns hold naive UTC, and a raw Date parameter is formatted in the server's zone by the driver.
 */
const iso = (d: Date) => d.toISOString();
const ts = (d: Date) => sql`${iso(d)}::timestamp`;

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const dayEnd = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);

/** The zone the activity heatmap is read in (the platform's merchants are in Nigeria). */
const HEATMAP_ZONE = "Africa/Lagos";
const LARGE_TRANSACTION = 500_000;

export async function getAdminDashboardMetrics(now: Date = new Date()) {
  const startOfToday = dayStart(now);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  // The seven bar-chart days, oldest first.
  const barDays = Array.from({ length: 7 }, (_, k) => {
    const date = new Date(now.getTime() - (6 - k) * 24 * 60 * 60 * 1000);
    return { date, start: dayStart(date), end: dayEnd(date) };
  });
  // The 30 growth-line days, oldest first.
  const lineDays = Array.from({ length: 30 }, (_, k) => {
    const date = new Date(now.getTime() - (29 - k) * 24 * 60 * 60 * 1000);
    return { date, start: dayStart(date), end: dayEnd(date) };
  });

  const barColumns = sql.join(
    barDays.map((d, k) => sql`
      (count(*) FILTER (WHERE c.created_at >= ${ts(d.start)} AND c.created_at <= ${ts(d.end)}))::int AS bar_count_${sql.raw(String(k))},
      COALESCE(SUM(c.total_price) FILTER (WHERE c.created_at >= ${ts(d.start)} AND c.created_at <= ${ts(d.end)}), 0)::float8 AS bar_gmv_${sql.raw(String(k))}`),
    sql`, `,
  );

  const [platform, sales, series, feed] = await Promise.all([
    // 1. Everything that is a count over the small tables: businesses, users, stores, support, onboarding.
    db.execute(sql`
      SELECT
        (SELECT count(*) FROM organisations)::int AS total_orgs,
        (SELECT count(*) FROM organisations WHERE created_at <= ${ts(thirtyDaysAgo)})::int AS prior_orgs,
        (SELECT count(*) FROM organisations WHERE created_at >= ${ts(thirtyDaysAgo)})::int AS new_orgs,
        (SELECT count(*) FROM organisations WHERE created_at >= ${ts(sixtyDaysAgo)} AND created_at <= ${ts(thirtyDaysAgo)})::int AS prior_new_orgs,
        (SELECT count(*) FROM organisations WHERE status = 'suspended')::int AS suspended_orgs,
        (SELECT count(*) FROM users)::int AS total_users,
        (SELECT count(*) FROM users WHERE status = 'locked')::int AS locked_users,
        (SELECT count(*) FROM support_threads WHERE status = 'open')::int AS open_support,
        -- Stores with no sale of any kind in 30 days (voided ones count as activity, as they always did).
        (SELECT count(*) FROM stores s WHERE NOT EXISTS (
           SELECT 1 FROM checkouts c WHERE c.store_id = s.id AND c.created_at >= ${ts(thirtyDaysAgo)}))::int AS inactive_stores,
        -- Businesses older than 48 hours that have no store, or whose stores have never made a sale.
        (SELECT count(*) FROM organisations o WHERE o.created_at <= ${ts(fortyEightHoursAgo)} AND NOT EXISTS (
           SELECT 1 FROM checkouts c JOIN stores s ON s.id = c.store_id WHERE s.business_id = o.id))::int AS stuck_orgs`),

    // 2. Sales: today, the last 30 days, the 30 before that, the large ones today, and the seven daily bars,
    // in one pass over the last 60 days of sales.
    db.execute(sql`
      SELECT
        (count(*) FILTER (WHERE c.created_at >= ${ts(startOfToday)}))::int AS tx_today,
        (count(*) FILTER (WHERE c.created_at >= ${ts(thirtyDaysAgo)}))::int AS tx_month,
        COALESCE(SUM(c.total_price) FILTER (WHERE c.created_at >= ${ts(thirtyDaysAgo)}), 0)::float8 AS gmv_month,
        COALESCE(SUM(c.total_price) FILTER (WHERE c.created_at >= ${ts(sixtyDaysAgo)} AND c.created_at <= ${ts(thirtyDaysAgo)}), 0)::float8 AS gmv_prior_month,
        (count(*) FILTER (WHERE c.total_price >= ${LARGE_TRANSACTION} AND c.created_at >= ${ts(startOfToday)}))::int AS large_today,
        count(DISTINCT s.business_id) FILTER (WHERE c.created_at >= ${ts(startOfToday)})::int AS active_orgs_today,
        ${barColumns}
      FROM checkouts c
      JOIN stores s ON s.id = c.store_id
      WHERE c.is_voided = false AND c.created_at >= ${ts(sixtyDaysAgo)}`),

    // 3. The growth line (businesses registered over the last 30 days, with the count before it) and the heatmap.
    Promise.all([
      db.execute(sql`
        SELECT
          (SELECT count(*) FROM organisations WHERE created_at < ${ts(lineDays[0].start)})::int AS before_window,
          COALESCE(json_agg(o.created_at ORDER BY o.created_at) FILTER (WHERE o.created_at IS NOT NULL), '[]'::json) AS created
        FROM organisations o WHERE o.created_at >= ${ts(lineDays[0].start)}`),
      db.execute(sql`
        SELECT extract(dow FROM (c.created_at AT TIME ZONE 'UTC' AT TIME ZONE ${HEATMAP_ZONE}))::int AS dow,
               (floor(extract(hour FROM (c.created_at AT TIME ZONE 'UTC' AT TIME ZONE ${HEATMAP_ZONE})) / 2) * 2)::int AS hour,
               count(*)::int AS n
        FROM checkouts c
        WHERE c.is_voided = false AND c.created_at >= ${ts(thirtyDaysAgo)}
        GROUP BY 1, 2`),
    ]),

    // 4. The live feed: newest businesses, newest sales (with the store name in the same query), recent suspensions.
    Promise.all([
      db.execute(sql`SELECT id, name, created_at FROM organisations ORDER BY created_at DESC LIMIT 3`),
      db.execute(sql`
        SELECT c.id, c.total_charged, c.created_at, s.name AS store_name
        FROM checkouts c LEFT JOIN stores s ON s.id = c.store_id
        WHERE c.is_voided = false ORDER BY c.created_at DESC LIMIT 3`),
      db.execute(sql`
        SELECT target, admin_email, created_at FROM super_admin_audit_logs
        WHERE action = 'suspend_business' ORDER BY created_at DESC LIMIT 2`),
    ]),
  ]);

  const p = platform.rows[0] as Record<string, number>;
  const m = sales.rows[0] as Record<string, number>;
  const delta = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 100) : 0);

  const activeOrgsCount = Number(m.active_orgs_today ?? 0);
  const totalOrgs = Number(p.total_orgs);
  const monthlyGMV = Number(m.gmv_month);

  // Growth line: businesses registered by the end of each day. json_agg renders naive timestamps without a zone
  // marker, but they are UTC like every other timestamp in the database.
  const [growthRows, heatRows] = series;
  const created = ((growthRows.rows[0] as any).created as string[]).map((c) => new Date(c.endsWith("Z") ? c : `${c}Z`).getTime());
  const before = Number((growthRows.rows[0] as any).before_window);
  const growthTrend = lineDays.map((d) => ({
    date: d.start.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    businesses: before + created.filter((t) => t <= d.end.getTime()).length,
  }));

  const transactionTrend = barDays.map((d, k) => ({
    day: d.start.toLocaleDateString("en-US", { weekday: "short" }),
    count: Number(m[`bar_count_${k}`] ?? 0),
    gmv: Number(m[`bar_gmv_${k}`] ?? 0),
  }));

  // Heatmap: sales per weekday and two-hour block over the last 30 days (8:00 to 20:00 blocks, as drawn).
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const heat = new Map<string, number>();
  for (const r of heatRows.rows as { dow: number; hour: number; n: number }[]) heat.set(`${r.dow}:${r.hour}`, Number(r.n));
  const activityHeatmap: { day: string; hour: string; value: number }[] = [];
  for (let dow = 0; dow < 7; dow++) {
    for (let hour = 8; hour <= 20; hour += 2) {
      activityHeatmap.push({ day: weekdays[dow], hour: `${hour}:00`, value: heat.get(`${dow}:${hour}`) ?? 0 });
    }
  }

  const [lastOrgs, lastTx, suspensions] = feed;
  const liveFeed: { time: string; timestamp: number; type: string; message: string }[] = [];
  const when = (value: unknown) => parseDbTimestamp(value);
  for (const org of lastOrgs.rows as any[]) {
    const t = when(org.created_at);
    liveFeed.push({ time: t.toLocaleTimeString("en-US", { hour12: false }), timestamp: t.getTime(), type: "business_registration", message: `New business registered → ${org.name}` });
  }
  for (const tx of lastTx.rows as any[]) {
    const t = when(tx.created_at);
    liveFeed.push({
      time: t.toLocaleTimeString("en-US", { hour12: false }), timestamp: t.getTime(), type: "transaction_completed",
      message: `Transaction completed → ${tx.store_name || "Retail Store"} ₦${Number(tx.total_charged).toLocaleString()}`,
    });
  }
  for (const s of suspensions.rows as any[]) {
    const t = when(s.created_at);
    liveFeed.push({ time: t.toLocaleTimeString("en-US", { hour12: false }), timestamp: t.getTime(), type: "business_suspended", message: `Business suspended → ${s.target} [by Admin: ${s.admin_email}]` });
  }
  liveFeed.sort((a, b) => b.timestamp - a.timestamp);

  const alerts: { severity: string; message: string }[] = [];
  if (Number(p.inactive_stores) > 0) alerts.push({ severity: "warning", message: `${p.inactive_stores} Businesses inactive for 30+ days` });
  if (Number(p.locked_users) > 0) alerts.push({ severity: "danger", message: `${p.locked_users} Accounts locked with excessive failed logins` });
  if (Number(m.large_today) > 0) alerts.push({ severity: "danger", message: `${m.large_today} Unusually large transaction flagged today (> ₦500,000)` });
  if (Number(p.open_support) > 0) {
    alerts.push({ severity: "warning", message: `${p.open_support} Open support message${Number(p.open_support) === 1 ? "" : "s"} awaiting a reply` });
  }
  if (Number(p.stuck_orgs) > 0) alerts.push({ severity: "warning", message: `${p.stuck_orgs} New businesses stuck in onboarding funnel (48hr+)` });

  return {
    summaryCards: {
      totalBusinesses: { count: totalOrgs, deltaPercent: delta(totalOrgs, Number(p.prior_orgs)) },
      activeToday: { count: activeOrgsCount, percent: totalOrgs > 0 ? Math.round((activeOrgsCount / totalOrgs) * 100) : 0 },
      newThisMonth: { count: Number(p.new_orgs), deltaPercent: delta(Number(p.new_orgs), Number(p.prior_new_orgs)) },
      suspended: { count: Number(p.suspended_orgs) },
      totalUsers: { count: Number(p.total_users) },
      transactionsToday: { count: Number(m.tx_today) },
      transactionsMonth: { count: Number(m.tx_month) },
      gmvMonth: { count: monthlyGMV, deltaPercent: delta(monthlyGMV, Number(m.gmv_prior_month)) },
      avgRevenuePerBusiness: { count: activeOrgsCount > 0 ? Math.round(monthlyGMV / activeOrgsCount) : 0 },
    },
    charts: {
      growthTrend,
      transactionTrend,
      activityHeatmap,
    },
    liveActivity: liveFeed,
    alerts,
  };
}
