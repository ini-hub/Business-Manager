import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchAllPages, finishPages } from "./paginated";

/** A fake paginated endpoint over `total` rows; records each requested URL and how many ran at once. */
function fakeEndpoint(total: number) {
  const calls: string[] = [];
  let running = 0;
  let peak = 0;
  const fetchMock = vi.fn(async (url: string) => {
    calls.push(url);
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 5));
    running--;
    const q = new URL(url, "http://x").searchParams;
    const page = Number(q.get("page"));
    const limit = Number(q.get("limit"));
    const rows = Array.from({ length: total }, (_, i) => ({ id: i + 1 }));
    const totalPages = Math.max(1, Math.ceil(total / limit));
    return new Response(JSON.stringify({
      data: rows.slice((page - 1) * limit, page * limit),
      pagination: { total, page, limit, totalPages, hasMore: page < totalPages },
    }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, peak: () => peak };
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchAllPages", () => {
  it("returns every row in order and fetches pages after the first in parallel, at most four at a time", async () => {
    const ep = fakeEndpoint(2050); // 11 pages of 200
    const rows = await fetchAllPages<{ id: number }>("/api/things?storeId=s1");
    expect(rows).toHaveLength(2050);
    expect(rows.map((r) => r.id)).toEqual(Array.from({ length: 2050 }, (_, i) => i + 1));
    expect(ep.calls).toHaveLength(11);
    expect(ep.calls[0]).toContain("?storeId=s1&page=1&limit=200");
    expect(ep.peak()).toBeGreaterThan(1);
    expect(ep.peak()).toBeLessThanOrEqual(4);
  });

  it("needs a single request when everything fits on one page", async () => {
    const ep = fakeEndpoint(3);
    expect(await fetchAllPages("/api/things")).toHaveLength(3);
    expect(ep.calls).toEqual(["/api/things?page=1&limit=200"]);
  });

  it("treats a bare-array response (an endpoint not paged yet) as the whole list", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([{ id: 1 }, { id: 2 }]))));
    expect(await fetchAllPages("/api/legacy")).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("throws when a page fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 500 })));
    await expect(fetchAllPages("/api/things")).rejects.toThrow(/500/);
  });
});

describe("finishPages", () => {
  it("continues from a first page fetched elsewhere, using that page's limit", async () => {
    const ep = fakeEndpoint(50);
    const first = { data: Array.from({ length: 20 }, (_, i) => ({ id: i + 1 })), pagination: { total: 50, page: 1, limit: 20, totalPages: 3, hasMore: true } };
    const rows = await finishPages<{ id: number }>("/api/things", first);
    expect(rows.map((r) => r.id)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(ep.calls.sort()).toEqual(["/api/things?page=2&limit=20", "/api/things?page=3&limit=20"]);
  });
});
