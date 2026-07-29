import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { AnalyticsQueryInput } from "@shared/analytics/query";
import {
  analyticsQueryKey,
  postAnalyticsQuery,
  type AnalyticsResponse,
} from "@/lib/analytics/query-client";
import { STALE_TIMES } from "@/lib/queryClient";

/**
 * Runs an Explorer query.
 *
 * `keepPreviousData` is deliberate: changing a grain or adding a measure should
 * not blank the chart and collapse the page height. The previous render stays up
 * (dimmed by the caller) until the new one arrives.
 */
export function useAnalyticsQuery(
  body: AnalyticsQueryInput | null,
  options: { enabled?: boolean } = {},
) {
  return useQuery<AnalyticsResponse>({
    queryKey: body ? analyticsQueryKey(body) : ["analytics:query", "idle"],
    queryFn: () => postAnalyticsQuery(body!),
    enabled: Boolean(body) && options.enabled !== false,
    placeholderData: keepPreviousData,
    staleTime: STALE_TIMES.transactional,
  });
}
