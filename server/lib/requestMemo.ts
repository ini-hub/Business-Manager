// Per-request memo for reads that several layers of one GET request repeat (the business row is read by
// the auth user payload, the business payload, the mask policy...). Each repeat is a database round trip.
//
// Only started for read-only methods (see server/index.ts), so a handler that writes and then re-reads
// never sees a stale value; writers that run inside a GET still call clearRequestMemo. Outside a request
// (jobs, tests, scripts) there is no store and every call simply loads.
import { AsyncLocalStorage } from "async_hooks";

const als = new AsyncLocalStorage<Map<string, Promise<unknown>>>();

export function runWithRequestMemo<T>(fn: () => T): T {
  return als.run(new Map(), fn);
}

export function memoForRequest<T>(key: string, load: () => Promise<T>): Promise<T> {
  const store = als.getStore();
  if (!store) return load();
  const hit = store.get(key);
  if (hit) return hit as Promise<T>;
  const value = load();
  store.set(key, value);
  // A failure is not kept: a later caller in the same request retries instead of reusing a rejection.
  value.catch(() => {
    if (store.get(key) === value) store.delete(key);
  });
  return value;
}

/** Drop one key, or everything for this request. Call after a write the same request may read back. */
export function clearRequestMemo(key?: string): void {
  const store = als.getStore();
  if (!store) return;
  if (key === undefined) store.clear();
  else store.delete(key);
}
