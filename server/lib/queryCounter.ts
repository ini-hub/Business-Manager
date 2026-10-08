// Counts DB statements per HTTP request, so System Health can show "statements per request" next to
// latency: an N+1 handler shows up as a big number even when each statement is fast.
//
// Best effort, diagnostics only. pool.query() is counted where it is called (the request's async
// context is intact there). A transaction's statements run on a client from pool.connect(); that
// client is tagged with the request's counter for as long as it is checked out. Statements issued
// from a fire-and-forget continuation that has lost its async context are not counted.
import { AsyncLocalStorage } from "async_hooks";
import { Client, type Pool } from "pg";

export interface RequestStats {
  queries: number;
}

const als = new AsyncLocalStorage<RequestStats>();
const TAG = Symbol("requestStats");

export function runWithRequestStats<T>(stats: RequestStats, fn: () => T): T {
  return als.run(stats, fn);
}

let installedOnClient = false;

export function installQueryCounter(pool: Pool): void {
  if (!installedOnClient) {
    installedOnClient = true;
    const originalClientQuery = Client.prototype.query as (...args: unknown[]) => unknown;
    (Client.prototype as any).query = function (this: any, ...args: unknown[]) {
      const stats = this[TAG] as RequestStats | undefined;
      if (stats) stats.queries++;
      return originalClientQuery.apply(this, args);
    };
  }

  const anyPool = pool as any;

  const originalQuery = anyPool.query.bind(pool);
  anyPool.query = (...args: unknown[]) => {
    const stats = als.getStore();
    if (stats) stats.queries++;
    return originalQuery(...args);
  };

  // Only the promise form (what drizzle's transaction() uses); the callback form is what pool.query
  // uses internally, and that statement is already counted above.
  const originalConnect = anyPool.connect.bind(pool);
  anyPool.connect = (...args: unknown[]) => {
    if (typeof args[0] === "function") return originalConnect(...args);
    const stats = als.getStore();
    const result = originalConnect();
    if (!stats) return result;
    return (result as Promise<any>).then((client) => {
      client[TAG] = stats;
      return client;
    });
  };

  pool.on("release", (_err, client) => {
    delete (client as any)[TAG];
  });
}
