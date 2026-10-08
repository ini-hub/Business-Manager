// A small single-flight TTL cache for data that is read on every request but changes rarely (the feature
// catalog, feature flags, platform config). A short TTL bounds staleness across server instances;
// invalidate() makes a change made on this instance visible immediately.
//
// Disabled under vitest (ttl 0): tests change these rows directly and expect the next read to see them.

const DISABLED = !!process.env.VITEST;

export interface TtlCache<K, V> {
  get(key: K, load: () => Promise<V>): Promise<V>;
  /** Drop one key, or everything when called with no argument. */
  invalidate(key?: K): void;
}

export function createTtlCache<K, V>(ttlMs: number): TtlCache<K, V> {
  const entries = new Map<K, { at: number; value: Promise<V> }>();
  return {
    get(key, load) {
      if (DISABLED || ttlMs <= 0) return load();
      const hit = entries.get(key);
      if (hit && Date.now() - hit.at < ttlMs) return hit.value;
      const value = load();
      const entry = { at: Date.now(), value };
      entries.set(key, entry);
      // Never keep a failure around: the next caller should retry rather than reuse a rejected promise.
      value.catch(() => {
        if (entries.get(key) === entry) entries.delete(key);
      });
      return value;
    },
    invalidate(key) {
      if (key === undefined) entries.clear();
      else entries.delete(key);
    },
  };
}
