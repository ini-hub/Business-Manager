import { paginated, type PageRequest, type Paginated } from "./pagination";

/**
 * One page of a query plus its total, fetched together. The caller supplies the page read (with the
 * limit/offset applied) and the count read, both for the same filter.
 */
export async function pagedSelect<T>(
  req: PageRequest,
  rows: (page: { limit: number; offset: number }) => PromiseLike<T[]>,
  total: () => PromiseLike<number>,
): Promise<Paginated<T>> {
  const [data, count] = await Promise.all([rows({ limit: req.limit, offset: req.offset }), total()]);
  return paginated(data, count, req);
}

/** Reads the number out of a `select count(*)::int as total` result. */
export const totalOf = async (result: PromiseLike<{ total: number | string }[]>): Promise<number> =>
  Number((await result)[0]?.total ?? 0);
