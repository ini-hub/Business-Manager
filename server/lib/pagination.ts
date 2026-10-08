// One pagination contract for every list endpoint:
//
//   GET /api/things?page=2&limit=50  ->  { data: [...], pagination: { total, page, limit, totalPages, hasMore } }
//
// A request with no page/limit is page 1 at the default size, never "everything": a list that grows with the
// business must not be able to return its whole history in one response. `limit` is clamped to MAX_PAGE_SIZE.
// Screens that need every row (to total or export) walk the pages (client/src/lib/paginated.ts), so each
// request stays small.
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export interface PageRequest {
  page: number;
  limit: number;
  offset: number;
}

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

function positiveInt(value: unknown): number | undefined {
  const n = typeof value === "string" ? parseInt(value, 10) : typeof value === "number" ? Math.trunc(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Reads `page` and `limit` from a query string, applying the default size and the hard cap. */
export function parsePage(
  query: { page?: unknown; limit?: unknown },
  opts: { defaultLimit?: number; maxLimit?: number } = {},
): PageRequest {
  const maxLimit = opts.maxLimit ?? MAX_PAGE_SIZE;
  const defaultLimit = Math.min(opts.defaultLimit ?? DEFAULT_PAGE_SIZE, maxLimit);
  const page = positiveInt(query.page) ?? 1;
  const limit = Math.min(positiveInt(query.limit) ?? defaultLimit, maxLimit);
  return { page, limit, offset: (page - 1) * limit };
}

export function pagination(total: number, req: Pick<PageRequest, "page" | "limit">): Pagination {
  const totalPages = Math.max(1, Math.ceil(total / req.limit));
  return { total, page: req.page, limit: req.limit, totalPages, hasMore: req.page < totalPages };
}

/** Wraps one page of rows in the standard envelope. */
export function paginated<T>(data: T[], total: number, req: Pick<PageRequest, "page" | "limit">): Paginated<T> {
  return { data, pagination: pagination(total, req) };
}

/** Pages an in-memory array. For small, already-loaded lists only; big tables must page in SQL. */
export function pageOfArray<T>(rows: T[], req: PageRequest): Paginated<T> {
  return paginated(rows.slice(req.offset, req.offset + req.limit), rows.length, req);
}
