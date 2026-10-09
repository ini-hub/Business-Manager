// Client side of the server's pagination contract (server/lib/pagination.ts).
export interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasMore: boolean;
}

export interface Paginated<T> {
  data: T[];
  pagination: Pagination;
}

const WALK_PAGE_SIZE = 200;
const WALK_CONCURRENCY = 4;

/**
 * Loads every row of a paginated endpoint by walking its pages, for screens that must total, filter or export
 * the whole list. Each request is bounded, so no single response or query grows with history; the screen still
 * gets a plain array. Prefer a server-side totals endpoint plus a pager where the list can get large.
 *
 * `path` may already carry a query string; page and limit are appended.
 */
export async function fetchAllPages<T = any>(path: string, init: RequestInit = { credentials: "include" }): Promise<T[]> {
  const sep = path.includes("?") ? "&" : "?";
  const load = async (page: number): Promise<Paginated<T>> => {
    const res = await fetch(`${path}${sep}page=${page}&limit=${WALK_PAGE_SIZE}`, { credentials: "include", ...init });
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
  };

  // The first page says how many there are; the rest are then fetched a few at a time instead of one after
  // another, because each request is a separate round trip.
  const first = await load(1);
  const all: T[] = [...first.data];
  const totalPages = first.pagination?.totalPages ?? (first.pagination?.hasMore ? Infinity : 1);
  if (!first.pagination?.hasMore) return all;
  if (!Number.isFinite(totalPages)) {
    for (let page = 2; ; page++) {
      const body = await load(page);
      all.push(...body.data);
      if (!body.pagination?.hasMore) return all;
    }
  }
  for (let start = 2; start <= totalPages; start += WALK_CONCURRENCY) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(WALK_CONCURRENCY, totalPages - start + 1) }, (_, i) => load(start + i)),
    );
    for (const body of batch) all.push(...body.data);
  }
  return all;
}
