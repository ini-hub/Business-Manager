import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Paginated } from "@/lib/paginated";

/**
 * One page of a paginated list endpoint (the server's { data, pagination } contract), with the page held in
 * state. The query key is `[...key, page]`, so invalidating by the base key still refreshes every page.
 *
 * `params` are appended to the URL; changing them sends the list back to page 1. The previous page stays on
 * screen while the next one loads, so paging does not flash an empty table.
 */
export function usePaged<T>(
  key: readonly unknown[],
  path: string,
  opts: { params?: Record<string, string | number | boolean | undefined | null>; pageSize?: number; enabled?: boolean } = {},
) {
  const { params = {}, pageSize = 25, enabled = true } = opts;
  const [page, setPage] = useState(1);

  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") query.set(name, String(value));
  }
  const filterSignature = query.toString();
  // Back to the first page whenever the filters change.
  useEffect(() => setPage(1), [filterSignature, path]);

  query.set("page", String(page));
  query.set("limit", String(pageSize));

  const result = useQuery<Paginated<T>>({
    queryKey: [...key, page, filterSignature, pageSize],
    queryFn: async () => (await apiRequest("GET", `${path}?${query.toString()}`)).json(),
    enabled,
    placeholderData: keepPreviousData,
  });

  return {
    rows: result.data?.data ?? [],
    pagination: result.data?.pagination,
    page,
    setPage,
    isLoading: result.isLoading,
    isFetching: result.isFetching,
    error: result.error,
    refetch: result.refetch,
  };
}
