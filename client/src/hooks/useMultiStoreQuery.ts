import { useQuery } from "@tanstack/react-query";
import { useStore } from "@/lib/store-context";

type MergeStrategy = "flat" | "dedup-by-id";

interface UseMultiStoreQueryOptions {
  enabled?: boolean;
  merge?: MergeStrategy;
  staleTime?: number;
}

/**
 * Fetches a resource across all stores when "all" is selected,
 * or from the current store when a specific store is active.
 * Each item gets a `storeName` field injected in multi-store mode.
 */
export function useMultiStoreQuery<T extends { id: string | number }>(
  path: string,
  options: UseMultiStoreQueryOptions = {}
) {
  const { currentStore, stores } = useStore();
  const { enabled = true, merge = "flat", staleTime } = options;

  const isAll = currentStore?.id === "all";
  const queryEnabled = enabled && (isAll ? stores.length > 0 : !!currentStore?.id);

  return useQuery<(T & { storeName?: string })[]>({
    queryKey: [path, currentStore?.id, stores.map((s) => s.id).join(",")],
    queryFn: async () => {
      if (isAll && stores.length > 0) {
        const responses = await Promise.all(
          stores.map(async (s) => {
            try {
              const res = await fetch(`${path}?storeId=${s.id}`);
              if (!res.ok) return [] as (T & { storeName?: string })[];
              const list = (await res.json()) as T[];
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

      const res = await fetch(`${path}?storeId=${currentStore?.id}`);
      if (!res.ok) throw new Error(`Failed to fetch ${path}`);
      return res.json();
    },
    enabled: queryEnabled,
    ...(staleTime !== undefined && { staleTime }),
  });
}
