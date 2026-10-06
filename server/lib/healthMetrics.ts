// Request telemetry for the super-admin System Health page.
//
// The hot path (recordRequest) only bumps in-memory hourly aggregates. A timer
// upserts this instance's aggregates into health_metrics_hourly, and reads
// merge every instance's rows, so the page can be filtered over long periods
// and survives restarts. Latency is a fixed-bucket histogram so percentiles
// merge across instances (values are bucket upper bounds, i.e. approximate).
import { randomUUID } from "crypto";
import { sql, gte, lt } from "drizzle-orm";
import { db } from "../db";
import { healthMetricsHourly } from "@shared/schema";

const HOUR_MS = 3600_000;
const RETENTION_MS = 35 * 24 * HOUR_MS;
const FLUSH_INTERVAL_MS = 60_000;
const MAX_ERRORS = 200;

/** Upper bounds (ms) of the latency buckets; one extra overflow bucket follows. */
export const LATENCY_BOUNDS = [25, 50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000];

export const RANGES = {
  "6h": 6 * HOUR_MS,
  "24h": 24 * HOUR_MS,
  "7d": 7 * 24 * HOUR_MS,
  "30d": 30 * 24 * HOUR_MS,
} as const;
export type HealthRange = keyof typeof RANGES;
export const DEFAULT_RANGE: HealthRange = "24h";

export function parseRange(v: unknown): HealthRange {
  return typeof v === "string" && v in RANGES ? (v as HealthRange) : DEFAULT_RANGE;
}

export interface ErrorSample {
  at: number;
  status: number;
  method: string;
  path: string;
  businessId?: string;
}

interface HourAgg {
  requests: number;
  serverErrors: number;
  hist: number[];
}

const instanceId = randomUUID();
const hours = new Map<number, HourAgg>();
let errors: ErrorSample[] = [];

const emptyHist = () => new Array(LATENCY_BOUNDS.length + 1).fill(0);
const hourOf = (t: number) => Math.floor(t / HOUR_MS) * HOUR_MS;

function bucketIndex(ms: number): number {
  const i = LATENCY_BOUNDS.findIndex((b) => ms <= b);
  return i === -1 ? LATENCY_BOUNDS.length : i;
}

export function recordRequest(s: {
  at: number;
  ms: number;
  status: number;
  method: string;
  path: string;
  businessId?: string;
}): void {
  const h = hourOf(s.at);
  let agg = hours.get(h);
  if (!agg) {
    agg = { requests: 0, serverErrors: 0, hist: emptyHist() };
    hours.set(h, agg);
  }
  agg.requests++;
  agg.hist[bucketIndex(s.ms)]++;
  if (s.status >= 500) {
    agg.serverErrors++;
    errors.push({ at: s.at, status: s.status, method: s.method, path: s.path, businessId: s.businessId });
    if (errors.length > MAX_ERRORS) errors = errors.slice(-MAX_ERRORS);
  }
}

export function percentileFromHist(hist: number[], p: number): number {
  const total = hist.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  const target = Math.ceil((p / 100) * total);
  let cum = 0;
  for (let i = 0; i < hist.length; i++) {
    cum += hist[i];
    if (cum >= target) return LATENCY_BOUNDS[Math.min(i, LATENCY_BOUNDS.length - 1)];
  }
  return LATENCY_BOUNDS[LATENCY_BOUNDS.length - 1];
}

/** Upsert this instance's in-memory hours (the last two are the only ones that can still change). */
export async function flushHealthMetrics(): Promise<void> {
  const keep = hourOf(Date.now()) - HOUR_MS;
  const rows = Array.from(hours.entries())
    .filter(([h]) => h >= keep)
    .map(([h, a]) => ({
      hour: new Date(h),
      instanceId,
      requests: a.requests,
      serverErrors: a.serverErrors,
      latencyHist: a.hist,
    }));
  for (const h of Array.from(hours.keys())) if (h < keep) hours.delete(h);
  if (rows.length === 0) return;
  await db
    .insert(healthMetricsHourly)
    .values(rows)
    .onConflictDoUpdate({
      target: [healthMetricsHourly.hour, healthMetricsHourly.instanceId],
      set: {
        requests: sql`excluded.requests`,
        serverErrors: sql`excluded.server_errors`,
        latencyHist: sql`excluded.latency_hist`,
      },
    });
}

export interface RangeStats {
  total: number;
  serverErrors: number;
  p50: number;
  p95: number;
  p99: number;
  timeline: { time: string; p50: number; p95: number; p99: number }[];
  recentErrors: ErrorSample[];
}

export async function getRangeStats(range: HealthRange, now = Date.now()): Promise<RangeStats> {
  const since = now - RANGES[range];
  await flushHealthMetrics(); // so this instance's current hour is included, counted once

  const rows = await db
    .select()
    .from(healthMetricsHourly)
    .where(gte(healthMetricsHourly.hour, new Date(hourOf(since))));

  const merged = new Map<number, HourAgg>();
  for (const r of rows) {
    const h = r.hour.getTime();
    let agg = merged.get(h);
    if (!agg) {
      agg = { requests: 0, serverErrors: 0, hist: emptyHist() };
      merged.set(h, agg);
    }
    agg.requests += r.requests;
    agg.serverErrors += r.serverErrors;
    r.latencyHist.forEach((n, i) => {
      if (i < agg!.hist.length) agg!.hist[i] += n;
    });
  }

  // Long ranges chart per day; short ones per hour.
  const bucketMs = RANGES[range] > RANGES["24h"] ? 24 * HOUR_MS : HOUR_MS;
  const buckets = new Map<number, HourAgg>();
  const total: HourAgg = { requests: 0, serverErrors: 0, hist: emptyHist() };
  for (const [h, a] of Array.from(merged.entries())) {
    const key = Math.floor(h / bucketMs) * bucketMs;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { requests: 0, serverErrors: 0, hist: emptyHist() };
      buckets.set(key, bucket);
    }
    for (const t of [total, bucket]) {
      t.requests += a.requests;
      t.serverErrors += a.serverErrors;
      a.hist.forEach((n, i) => (t.hist[i] += n));
    }
  }

  const fmt = (t: number): string =>
    bucketMs === HOUR_MS
      ? new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
      : new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

  return {
    total: total.requests,
    serverErrors: total.serverErrors,
    p50: percentileFromHist(total.hist, 50),
    p95: percentileFromHist(total.hist, 95),
    p99: percentileFromHist(total.hist, 99),
    timeline: Array.from(buckets.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([t, a]) => ({
        time: fmt(t),
        p50: percentileFromHist(a.hist, 50),
        p95: percentileFromHist(a.hist, 95),
        p99: percentileFromHist(a.hist, 99),
      })),
    // Per-instance and held in memory: only errors since this process started.
    recentErrors: errors.filter((e) => e.at >= since).slice(-25).reverse(),
  };
}

let timer: NodeJS.Timeout | undefined;

/** Start the periodic flush and old-row cleanup. Idempotent. */
export function startHealthMetricsFlush(): void {
  if (timer) return;
  let ticks = 0;
  timer = setInterval(() => {
    flushHealthMetrics().catch((e) => console.error("[HealthMetrics] flush failed:", e));
    if (++ticks % 60 === 0) {
      db.delete(healthMetricsHourly)
        .where(lt(healthMetricsHourly.hour, new Date(Date.now() - RETENTION_MS)))
        .catch((e) => console.error("[HealthMetrics] cleanup failed:", e));
    }
  }, FLUSH_INTERVAL_MS);
  timer.unref();
}

/** Test hook. */
export function resetHealthMetrics(): void {
  hours.clear();
  errors = [];
}
