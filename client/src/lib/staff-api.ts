const STAFF_PAGE_SIZE = 200;

/**
 * Loads every staff member of a store (archived included) by walking the
 * paginated /api/staff endpoint, so no single request grows with headcount.
 * Resolves to a plain array, the shape all staff consumers expect.
 */
export async function fetchAllStaff<T = any>(storeId: string): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; ; page++) {
    const res = await fetch(
      `/api/staff?storeId=${encodeURIComponent(storeId)}&page=${page}&limit=${STAFF_PAGE_SIZE}&includeArchived=true`,
      { credentials: "include" },
    );
    if (!res.ok) throw new Error("Failed to fetch staff");
    const body = await res.json();
    all.push(...(body.data as T[]));
    if (!body.pagination?.hasMore) return all;
  }
}
