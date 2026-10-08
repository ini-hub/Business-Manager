import { describe, it, expect, vi } from "vitest";

// VITEST disables the cache by default; these tests need it on, so load the module with the flag cleared.
async function loadEnabled() {
  vi.resetModules();
  const prev = process.env.VITEST;
  delete process.env.VITEST;
  const mod = await import("./ttlCache");
  process.env.VITEST = prev;
  return mod;
}

describe("ttlCache", () => {
  it("shares one in-flight load and serves it until the ttl passes", async () => {
    const { createTtlCache } = await loadEnabled();
    const cache = createTtlCache<string, number>(1000);
    const load = vi.fn(async () => 7);
    const [a, b] = await Promise.all([cache.get("k", load), cache.get("k", load)]);
    expect([a, b]).toEqual([7, 7]);
    await cache.get("k", load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("reloads after invalidate", async () => {
    const { createTtlCache } = await loadEnabled();
    const cache = createTtlCache<string, number>(1000);
    let n = 0;
    const load = async () => ++n;
    expect(await cache.get("k", load)).toBe(1);
    cache.invalidate("k");
    expect(await cache.get("k", load)).toBe(2);
    cache.invalidate();
    expect(await cache.get("k", load)).toBe(3);
  });

  it("does not cache a failed load", async () => {
    const { createTtlCache } = await loadEnabled();
    const cache = createTtlCache<string, number>(1000);
    await expect(cache.get("k", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await cache.get("k", async () => 5)).toBe(5);
  });

  it("is a pass-through under vitest", async () => {
    vi.resetModules();
    const { createTtlCache } = await import("./ttlCache");
    const cache = createTtlCache<string, number>(1000);
    const load = vi.fn(async () => 1);
    await cache.get("k", load);
    await cache.get("k", load);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
