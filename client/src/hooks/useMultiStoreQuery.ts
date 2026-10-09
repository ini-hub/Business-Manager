import { fetchAllPages } from "@/lib/paginated";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "@/lib/store-context";

type MergeStrategy = "flat" | "dedup-by-id";

interface UseMultiStoreQueryOptions<T = unknown> {
  enabled?: boolean;
  merge?: MergeStrategy;
  staleTime?: number;
  /** Extra query-string params appended alongside storeId. Part of the query key,
   *  so two callers of the same path with different params do not share a cache
   *  entry (e.g. /api/products with and without ?include=supplies). */
  params?: Record<string, string>;
  /** Replaces the per-store fetch (e.g. for endpoints that must be paged). */
  fetchList?: (storeId: string) => Promise<T[]>;
}

/**
 * Fetches a resource across all stores when "all" is selected,
 * or from the current store when a specific store is active.
 * Each item gets a `storeName` field injected in multi-store mode.
 */
export function useMultiStoreQuery<T extends { id: string | number }>(
  path: string,
  options: UseMultiStoreQueryOptions<T> = {}
) {
  const { currentStore, stores } = useStore();
  const { enabled = true, merge = "flat", staleTime, params, fetchList } = options;

  const isAll = currentStore?.id === "all";
  const queryEnabled = enabled && (isAll ? stores.length > 0 : !!currentStore?.id);

  const extra = new URLSearchParams(params ?? {}).toString();
  const suffix = extra ? `&${extra}` : "";

  return useQuery<(T & { storeName?: string })[]>({
    queryKey: [path, currentStore?.id, stores.map((s) => s.id).join(","), extra],
    queryFn: async () => {
      if (isAll && stores.length > 0) {
        const responses = await Promise.all(
          stores.map(async (s) => {
            try {
              let list: T[];
              if (fetchList) {
                list = await fetchList(s.id);
              } else {
                list = await fetchAllPages<T>(`${path}?storeId=${s.id}${suffix}`);
              }
              return list.map((item) => ({ ...item, storeName: s.name }));
            } catch {
              return [] as (T & { storeName?: string })[];
            }
          })
        );

        if (merge === "dedup-by-id") {
          const map = new Map<string | number, T & { storeName?: string }>();
          for (const list of responses) {
            for (const item of list) {
              const existing = map.get(item.id);
              if (existing) {
                if (item.storeName && !existing.storeName?.includes(item.storeName)) {
                  existing.storeName = `${existing.storeName}, ${item.storeName}`;
                }
              } else {
                map.set(item.id, { ...item });
              }
            }
          }
          return Array.from(map.values());
        }

        return responses.flat();
      }

      if (fetchList) return fetchList(currentStore!.id);
      return fetchAllPages<T>(`${path}?storeId=${currentStore?.id}${suffix}`);
    },
    enabled: queryEnabled,
    ...(staleTime !== undefined && { staleTime }),
  });
}
