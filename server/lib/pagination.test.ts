import { describe, it, expect } from "vitest";
import { parsePage, paginated, pageOfArray, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "./pagination";

describe("parsePage", () => {
  it("never means 'everything': no params is page 1 at the default size", () => {
    expect(parsePage({})).toEqual({ page: 1, limit: DEFAULT_PAGE_SIZE, offset: 0 });
  });
  it("reads page and limit and computes the offset", () => {
    expect(parsePage({ page: "3", limit: "20" })).toEqual({ page: 3, limit: 20, offset: 40 });
  });
  it("clamps limit to the maximum and falls back on junk", () => {
    expect(parsePage({ limit: "100000" }).limit).toBe(MAX_PAGE_SIZE);
    expect(parsePage({ page: "-4", limit: "abc" })).toEqual({ page: 1, limit: DEFAULT_PAGE_SIZE, offset: 0 });
    expect(parsePage({ page: "0", limit: "0" })).toEqual({ page: 1, limit: DEFAULT_PAGE_SIZE, offset: 0 });
  });
  it("honours a per-endpoint default and maximum", () => {
    expect(parsePage({}, { defaultLimit: 10 }).limit).toBe(10);
    expect(parsePage({ limit: "500" }, { maxLimit: 100 }).limit).toBe(100);
    expect(parsePage({}, { defaultLimit: 500, maxLimit: 100 }).limit).toBe(100);
  });
});

describe("envelope", () => {
  it("describes the page and whether more follow", () => {
    expect(paginated([1, 2], 5, { page: 1, limit: 2 }).pagination).toEqual({ total: 5, page: 1, limit: 2, totalPages: 3, hasMore: true });
    expect(paginated([5], 5, { page: 3, limit: 2 }).pagination.hasMore).toBe(false);
  });
  it("reports one empty page for an empty list", () => {
    expect(paginated([], 0, { page: 1, limit: 50 })).toEqual({ data: [], pagination: { total: 0, page: 1, limit: 50, totalPages: 1, hasMore: false } });
  });
  it("pages an in-memory array", () => {
    const rows = Array.from({ length: 7 }, (_, i) => i);
    const out = pageOfArray(rows, parsePage({ page: "2", limit: "3" }));
    expect(out.data).toEqual([3, 4, 5]);
    expect(out.pagination.total).toBe(7);
  });
});
