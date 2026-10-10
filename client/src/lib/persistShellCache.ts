import { dehydrate, hydrate, type QueryClient } from "@tanstack/react-query";

// Remembers the handful of queries the app shell needs before it can paint (who you are, your business,
// your stores, your plan) so a returning visit renders from the last known answer straight away and
// revalidates in the background, instead of waiting several round trips to the server first. That wait is
// the dominant cost for users far from the data centre.
//
// Deliberately narrow: only these keys are stored, never lists of customers, transactions or figures.
// The entry is dropped the moment the cache loses the signed-in user (logout, session expiry both call
// queryClient.clear()), and it expires on its own, so a shared device does not keep a previous session.
const STORAGE_KEY = "bm:shell-cache:v1";
const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const WRITE_DEBOUNCE_MS = 500;
const USER_KEY = "/api/auth/user";
const SHELL_KEYS = new Set([USER_KEY, "/api/business", "/api/stores", "/api/entitlements"]);

type Stored = { savedAt: number; state: ReturnType<typeof dehydrate> };

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function clearStored(): void {
  try {
    safeStorage()?.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable: nothing to clear */
  }
}

/** True when a previous visit left a shell cache, i.e. a session is likely and the bootstrap request is worth making. */
export function hasStoredShellCache(): boolean {
  try {
    return !!safeStorage()?.getItem(STORAGE_KEY);
  } catch {
    return false;
  }
}

/** Hydrate the shell queries from storage, then keep storage in step with the cache. Call once, before render. */
export function enableShellCachePersistence(queryClient: QueryClient): void {
  const storage = safeStorage();
  if (!storage) return;

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw) {
      const stored = JSON.parse(raw) as Stored;
      if (Date.now() - stored.savedAt < MAX_AGE_MS && stored.state?.queries?.length) {
        hydrate(queryClient, stored.state);
        // Show the remembered data now, but treat it as stale: the signed-in user in particular is
        // cached forever once fetched, so without this a role or plan change would never be picked up.
        for (const key of Array.from(SHELL_KEYS)) void queryClient.invalidateQueries({ queryKey: [key] });
      } else {
        clearStored();
      }
    }
  } catch {
    clearStored();
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const write = () => {
    timer = undefined;
    // No signed-in user in the cache means nothing may stay behind (logout, expired session).
    if (!queryClient.getQueryData([USER_KEY])) return clearStored();
    try {
      const state = dehydrate(queryClient, {
        shouldDehydrateQuery: (q) => q.state.status === "success" && SHELL_KEYS.has(String(q.queryKey[0])),
      });
      storage.setItem(STORAGE_KEY, JSON.stringify({ savedAt: Date.now(), state } satisfies Stored));
    } catch {
      /* quota or serialisation failure: the cache is an optimisation, never required */
    }
  };

  queryClient.getQueryCache().subscribe((event) => {
    if (!SHELL_KEYS.has(String(event.query.queryKey[0]))) return;
    if (event.type !== "updated" && event.type !== "removed") return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(write, WRITE_DEBOUNCE_MS);
  });
}
