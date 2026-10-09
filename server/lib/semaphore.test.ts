import { describe, it, expect } from "vitest";
import { createSemaphore, createKeyedSemaphore } from "./semaphore";

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("semaphore", () => {
  it("never lets more than `max` run, and serves waiters in arrival order", async () => {
    const sem = createSemaphore(2);
    let inFlight = 0, peak = 0;
    const order: number[] = [];
    await Promise.all([1, 2, 3, 4, 5].map((n) => sem.run(async () => {
      inFlight++; peak = Math.max(peak, inFlight); order.push(n);
      await tick(10);
      inFlight--;
    })));
    expect(peak).toBe(2);
    expect(order).toEqual([1, 2, 3, 4, 5]);
    expect(sem.active).toBe(0);
    expect(sem.waiting).toBe(0);
  });

  it("gives the slot back when the work fails", async () => {
    const sem = createSemaphore(1);
    await expect(sem.run(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await sem.run(async () => "ok")).toBe("ok");
  });

  it("lets a held slot be released early, once", async () => {
    const sem = createSemaphore(1);
    const release = await sem.acquire();
    let second = false;
    const waiting = sem.run(async () => { second = true; });
    await tick(5);
    expect(second).toBe(false);
    release();
    release(); // a second call must not free a slot it does not hold
    await waiting;
    expect(second).toBe(true);
    expect(sem.active).toBe(0);
  });
});

describe("keyed semaphore", () => {
  it("limits each key on its own", async () => {
    const keyed = createKeyedSemaphore(1);
    let a = 0, aPeak = 0, b = 0;
    await Promise.all([
      ...[1, 2, 3].map(() => keyed.run("a", async () => { a++; aPeak = Math.max(aPeak, a); await tick(5); a--; })),
      keyed.run("b", async () => { b++; await tick(5); }),
    ]);
    expect(aPeak).toBe(1);
    expect(b).toBe(1);
  });
});
