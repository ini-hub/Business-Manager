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
  const first = await loadPage<T>(path, 1, WALK_PAGE_SIZE, init);
  return finishPages(path, first, init);
}

async function loadPage<T>(path: string, page: number, limit: number, init: RequestInit): Promise<Paginated<T>> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${path}${sep}page=${page}&limit=${limit}`, { credentials: "include", ...init });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const body = await res.json();
  // An endpoint that has not been paged yet returns a bare array: that is the whole list.
  if (Array.isArray(body)) return { data: body, pagination: { total: body.length, page: 1, limit: body.length, totalPages: 1, hasMore: false } };
  return body;
}

/**
 * Given the first page of a paginated endpoint (fetched with `page=1&limit=N`), loads the rest and returns every
 * row. The first page says how many there are, so the others are fetched a few at a time instead of one after
 * another, because each request is a separate round trip.
 */
export async function finishPages<T = any>(path: string, first: Paginated<T>, init: RequestInit = { credentials: "include" }): Promise<T[]> {
  const all: T[] = [...first.data];
  if (!first.pagination?.hasMore) return all;
  const limit = first.pagination.limit || WALK_PAGE_SIZE;
  const totalPages = first.pagination.totalPages;
  if (!Number.isFinite(totalPages) || totalPages < 2) {
    for (let page = 2; ; page++) {
      const body = await loadPage<T>(path, page, limit, init);
      all.push(...body.data);
      if (!body.pagination?.hasMore) return all;
    }
  }
  for (let start = 2; start <= totalPages; start += WALK_CONCURRENCY) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(WALK_CONCURRENCY, totalPages - start + 1) }, (_, i) => loadPage<T>(path, start + i, limit, init)),
    );
    for (const body of batch) all.push(...body.data);
  }
  return all;
}
