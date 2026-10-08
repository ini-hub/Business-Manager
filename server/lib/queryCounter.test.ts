import { describe, it, expect, afterAll } from "vitest";
import { Client } from "pg";
import { installQueryCounter, runWithRequestStats, type RequestStats } from "./queryCounter";

// A stand-in for pg.Pool: pool.query() and a promise-form connect() handing out a Client-shaped object.
function fakePool() {
  const listeners: Record<string, (...a: any[]) => void> = {};
  const client = Object.create(Client.prototype);
  const pool: any = {
    query: async () => ({ rows: [] }),
    connect: async (cb?: Function) => (cb ? cb(undefined, client, () => {}) : client),
    on: (ev: string, fn: (...a: any[]) => void) => (listeners[ev] = fn),
  };
  return { pool, client, listeners };
}

describe("queryCounter", () => {
  const { pool, client, listeners } = fakePool();
  // Replace the real driver call so the patched Client.prototype.query has something harmless to run.
  const realQuery = Client.prototype.query;
  Client.prototype.query = (() => Promise.resolve({ rows: [] })) as any;
  installQueryCounter(pool);
  // The counter's wrapper now sits on the prototype; put the real driver method back once we are done.
  afterAll(() => {
    Client.prototype.query = realQuery;
  });

  it("counts pool.query calls made inside a request", async () => {
    const stats: RequestStats = { queries: 0 };
    await runWithRequestStats(stats, async () => {
      await pool.query("select 1");
      await pool.query("select 2");
    });
    expect(stats.queries).toBe(2);
  });

  it("ignores queries outside any request", async () => {
    await pool.query("select 1"); // must not throw
  });

  it("counts transaction statements on a checked-out client, and stops after release", async () => {
    const stats: RequestStats = { queries: 0 };
    await runWithRequestStats(stats, async () => {
      const c = await pool.connect();
      await c.query("begin");
      await c.query("update x");
      await c.query("commit");
      listeners.release(undefined, c);
      await c.query("after release");
    });
    expect(stats.queries).toBe(3);
  });

  it("leaves the callback form of connect untouched", async () => {
    const stats: RequestStats = { queries: 0 };
    await runWithRequestStats(stats, async () => {
      await new Promise<void>((resolve) => pool.connect((_e: unknown, c: any) => { c.query("x"); resolve(); }));
    });
    expect(stats.queries).toBe(0);
  });
});
