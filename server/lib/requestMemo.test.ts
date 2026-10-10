import { describe, it, expect } from "vitest";
import { memoForRequest, clearRequestMemo, runWithRequestMemo } from "./requestMemo";

describe("requestMemo", () => {
  it("loads every time outside a request", async () => {
    let n = 0;
    await memoForRequest("k", async () => ++n);
    await memoForRequest("k", async () => ++n);
    expect(n).toBe(2);
  });

  it("shares one load inside a request, including concurrent callers", async () => {
    let n = 0;
    await runWithRequestMemo(async () => {
      const [a, b] = await Promise.all([memoForRequest("k", async () => ++n), memoForRequest("k", async () => ++n)]);
      expect(a).toBe(1);
      expect(b).toBe(1);
      expect(await memoForRequest("k", async () => ++n)).toBe(1);
    });
    expect(n).toBe(1);
  });

  it("is isolated per request and per key", async () => {
    let n = 0;
    const load = () => memoForRequest("k", async () => ++n);
    const [a, b] = await Promise.all([runWithRequestMemo(load), runWithRequestMemo(load)]);
    expect([a, b].sort()).toEqual([1, 2]);
    await runWithRequestMemo(async () => {
      await memoForRequest("a", async () => ++n);
      await memoForRequest("b", async () => ++n);
    });
    expect(n).toBe(4);
  });

  it("re-reads after clearRequestMemo and does not keep a failure", async () => {
    let n = 0;
    await runWithRequestMemo(async () => {
      await memoForRequest("k", async () => ++n);
      clearRequestMemo("k");
      expect(await memoForRequest("k", async () => ++n)).toBe(2);
      await expect(memoForRequest("bad", async () => { throw new Error("x"); })).rejects.toThrow("x");
      expect(await memoForRequest("bad", async () => "ok")).toBe("ok");
    });
  });
});
