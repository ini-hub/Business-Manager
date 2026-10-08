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

/**
 * Loads every row of a paginated endpoint by walking its pages, for screens that must total, filter or export
 * the whole list. Each request is bounded, so no single response or query grows with history; the screen still
 * gets a plain array. Prefer a server-side totals endpoint plus a pager where the list can get large.
 *
 * `path` may already carry a query string; page and limit are appended.
 */
export async function fetchAllPages<T = any>(path: string, init: RequestInit = { credentials: "include" }): Promise<T[]> {
  const all: T[] = [];
  const sep = path.includes("?") ? "&" : "?";
  for (let page = 1; ; page++) {
    const res = await fetch(`${path}${sep}page=${page}&limit=${WALK_PAGE_SIZE}`, { credentials: "include", ...init });
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    const body: Paginated<T> = await res.json();
    all.push(...body.data);
    if (!body.pagination?.hasMore) return all;
  }
}
