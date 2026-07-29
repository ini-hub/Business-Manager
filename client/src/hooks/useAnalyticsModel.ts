import { useQuery } from "@tanstack/react-query";
import type { CubeDef, DimensionDef, MeasureDef } from "@shared/analytics/model";
import { ANALYTICS_MODEL_KEY } from "@/lib/analytics/query-client";
import { STALE_TIMES } from "@/lib/queryClient";

export interface AnalyticsModel {
  cubes: CubeDef[];
  measures: MeasureDef[];
  dimensions: DimensionDef[];
  /** Every store the caller may query, already access-filtered by the server. */
  storeIds: string[];
}

/**
 * The measure/dimension catalog, already filtered to the caller's role.
 *
 * Reference data — it only changes on deploy, so it gets the longest stale time
 * and its own key root (see query-client.ts) so a sale does not refetch it.
 */
export function useAnalyticsModel() {
  return useQuery<AnalyticsModel>({
    queryKey: ANALYTICS_MODEL_KEY,
    staleTime: STALE_TIMES.reference,
  });
}
