// A short-lived cache for expensive read-only reports (dashboard stats, P&L, charts), invalidated by tag.
//
// These endpoints are re-requested constantly (dashboards poll, tabs refocus, several people open the same
// screen) while the data behind them only changes when someone writes. Each entry is tagged with the store
// and business it was computed from; broadcastDataChange (called for every mutation) drops the tags it names,
// so a sale shows up on the next request. The TTL is the backstop for any write path that does not broadcast
// and for a change made on another server instance.
//
// Single-flight: concurrent identical requests share one computation. Failures are never cached. Disabled
// under vitest so tests that write and immediately read see their own writes.
const TTL_MS = 30_000;
const MAX_ENTRIES = 1000;
const DISABLED = !!process.env.VITEST;

interface Entry {
  at: number;
  value: Promise<unknown>;
  tags: string[];
}

const entries = new Map<string, Entry>();
const byTag = new Map<string, Set<string>>();
// Bumped whenever a tag is invalidated. A computation that began before the bump may have read data from before
// the write, so it is not allowed to stay in the cache once it finishes.
const tagVersion = new Map<string, number>();
const versionOf = (tag: string) => tagVersion.get(tag) ?? 0;

export const storeTag = (storeId: string) => `store:${storeId}`;
export const businessTag = (businessId: string) => `biz:${businessId}`;
/** For a figure that sums across the business's stores: any write to any of its stores invalidates it. */
export const businessAggregateTag = (businessId: string) => `bizagg:${businessId}`;

function drop(key: string): void {
  const entry = entries.get(key);
  if (!entry) return;
  entries.delete(key);
  for (const tag of entry.tags) {
    const keys = byTag.get(tag);
    if (!keys) continue;
    keys.delete(key);
    if (keys.size === 0) byTag.delete(tag);
  }
}

export function cachedReport<T>(
  opts: { name: string; tags: string[]; params?: unknown },
  load: () => Promise<T>,
): Promise<T> {
  if (DISABLED) return load();
  const key = `${opts.name}|${opts.tags.slice().sort().join(",")}|${JSON.stringify(opts.params ?? null)}`;
  const hit = entries.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as Promise<T>;
  if (hit) drop(key);

  const startedAt = opts.tags.map(versionOf);
  const value = load();
  const entry: Entry = { at: Date.now(), value, tags: opts.tags };
  entries.set(key, entry);
  for (const tag of opts.tags) {
    let keys = byTag.get(tag);
    if (!keys) byTag.set(tag, (keys = new Set()));
    keys.add(key);
  }
  value.then(
    () => {
      if (entries.get(key) === entry && opts.tags.some((tag, i) => versionOf(tag) !== startedAt[i])) drop(key);
    },
    () => {
      if (entries.get(key) === entry) drop(key);
    },
  );
  // Bounded: evict the oldest entries (Map iterates in insertion order).
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    drop(oldest);
  }
  return value;
}

/** Drops every report computed from this store, or, with no store, from anywhere in this business. */
export function invalidateReports(businessId: string, storeId?: string): void {
  // Business-wide figures depend on every store, so any write at all moves them.
  const tags = [businessAggregateTag(businessId), storeId ? storeTag(storeId) : businessTag(businessId)];
  for (const tag of tags) {
    tagVersion.set(tag, versionOf(tag) + 1);
    const keys = byTag.get(tag);
    if (!keys) continue;
    for (const key of Array.from(keys)) drop(key);
  }
}

export function reportCacheSize(): number {
  return entries.size;
}
