import { describe, it, expect, vi } from "vitest";

// The cache is a pass-through under vitest; load a copy with that switched off.
async function enabled() {
  vi.resetModules();
  const prev = process.env.VITEST;
  delete process.env.VITEST;
  const mod = await import("./reportCache");
  process.env.VITEST = prev;
  return mod;
}

describe("reportCache", () => {
  it("shares one computation between identical requests and keeps different params apart", async () => {
    const { cachedReport, storeTag } = await enabled();
    const load = vi.fn(async () => ({ n: 1 }));
    const tags = [storeTag("s1")];
    await Promise.all([cachedReport({ name: "x", tags, params: { a: 1 } }, load), cachedReport({ name: "x", tags, params: { a: 1 } }, load)]);
    await cachedReport({ name: "x", tags, params: { a: 1 } }, load);
    expect(load).toHaveBeenCalledTimes(1);
    await cachedReport({ name: "x", tags, params: { a: 2 } }, load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("drops a store's reports when it is invalidated, and leaves other stores alone", async () => {
    const { cachedReport, invalidateReports, storeTag, businessTag } = await enabled();
    const a = vi.fn(async () => 1);
    const b = vi.fn(async () => 2);
    await cachedReport({ name: "r", tags: [storeTag("s1"), businessTag("b1")] }, a);
    await cachedReport({ name: "r", tags: [storeTag("s2"), businessTag("b1")] }, b);
    invalidateReports("b1", "s1");
    await cachedReport({ name: "r", tags: [storeTag("s1"), businessTag("b1")] }, a);
    await cachedReport({ name: "r", tags: [storeTag("s2"), businessTag("b1")] }, b);
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(1);
    // No store named: everything in the business goes.
    invalidateReports("b1");
    await cachedReport({ name: "r", tags: [storeTag("s2"), businessTag("b1")] }, b);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it("drops a business-wide figure on any write to any of its stores", async () => {
    const { cachedReport, invalidateReports, businessAggregateTag } = await enabled();
    const load = vi.fn(async () => 7);
    await cachedReport({ name: "agg", tags: [businessAggregateTag("b2")] }, load);
    invalidateReports("b2", "some-store");
    await cachedReport({ name: "agg", tags: [businessAggregateTag("b2")] }, load);
    expect(load).toHaveBeenCalledTimes(2);
    invalidateReports("other-business", "x");
    await cachedReport({ name: "agg", tags: [businessAggregateTag("b2")] }, load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not keep a report that was computed across a write", async () => {
    const { cachedReport, invalidateReports, storeTag, reportCacheSize } = await enabled();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = vi.fn(async () => { await gate; return "old"; });
    const pending = cachedReport({ name: "slow", tags: [storeTag("s9")] }, slow);
    invalidateReports("b", "s9"); // a write lands while the report is still being computed
    release();
    expect(await pending).toBe("old");
    await Promise.resolve();
    expect(reportCacheSize()).toBe(0);
    const fresh = vi.fn(async () => "new");
    expect(await cachedReport({ name: "slow", tags: [storeTag("s9")] }, fresh)).toBe("new");
  });

  it("never caches a failure", async () => {
    const { cachedReport, storeTag } = await enabled();
    const load = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue("ok");
    await expect(cachedReport({ name: "f", tags: [storeTag("s3")] }, load)).rejects.toThrow("boom");
    await Promise.resolve();
    expect(await cachedReport({ name: "f", tags: [storeTag("s3")] }, load)).toBe("ok");
  });

  it("is a pass-through under vitest", async () => {
    vi.resetModules();
    const { cachedReport, storeTag } = await import("./reportCache");
    const load = vi.fn(async () => 1);
    await cachedReport({ name: "p", tags: [storeTag("s")] }, load);
    await cachedReport({ name: "p", tags: [storeTag("s")] }, load);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
