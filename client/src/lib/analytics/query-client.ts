/**
 * Analytics Explorer — react-query wiring.
 *
 * The app's default queryFn derives a URL from the queryKey and only does GET.
 * The Explorer's endpoints are POST (the query document is too large for a query
 * string), so they need their own queryFn.
 */

import { apiRequest } from "@/lib/queryClient";
import type { AnalyticsQueryInput } from "@shared/analytics/query";
import type { ResultColumn, ResultRow, CubeId } from "@shared/analytics/model";

export interface AnalyticsResponse {
  meta: {
    grain: string;
    bucketAnchor: string | null;
    from: string;
    to: string;
    buckets: number;
    truncated: boolean;
    cubesQueried: CubeId[];
    elapsedMs: number;
  };
  columns: ResultColumn[];
  rows: ResultRow[];
  totals: Record<string, number | null>;
  /** Present only when a comparison period was requested. */
  comparison?: {
    from: string;
    to: string;
    rows: ResultRow[];
    totals: Record<string, number | null>;
    alignment: "bucket_index";
    /** Names the period, so a delta never reads just "vs last". */
    label: string;
  };
  warnings: string[];
}

/**
 * Stable hash of a query document, used as the react-query key.
 *
 * Keys are sorted so two logically identical queries built in a different order
 * share a cache entry.
 */
export function stableHash(value: unknown): string {
  const seen = new WeakSet<object>();
  const walk = (v: any): any => {
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v)) return null;
    seen.add(v);
    if (Array.isArray(v)) return v.map(walk);
    return Object.keys(v)
      .sort()
      .reduce<Record<string, any>>((acc, k) => {
        acc[k] = walk(v[k]);
        return acc;
      }, {});
  };
  return JSON.stringify(walk(value));
}

/**
 * Distinct key roots on purpose.
 *
 * The catalog is reference data that changes on deploy; query results change on
 * every sale. Sharing a root would mean invalidating "analytics" on each checkout
 * and refetching the whole catalog with it.
 */
export const ANALYTICS_MODEL_KEY = ["/api/analytics/model"] as const;
export const ANALYTICS_QUERY_ROOT = "analytics:query";

export function analyticsQueryKey(body: AnalyticsQueryInput): [string, string] {
  return [ANALYTICS_QUERY_ROOT, stableHash(body)];
}

export async function postAnalyticsQuery(
  body: AnalyticsQueryInput,
): Promise<AnalyticsResponse> {
  const res = await apiRequest("POST", "/api/analytics/query", body);
  return res.json();
}
