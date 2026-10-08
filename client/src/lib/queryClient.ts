import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { announcePlanLimit, toPlanLimitDetails, type PlanLimitDetails } from "./upgrade-prompt";

// Some endpoints return a machine-readable `error.code` alongside the
// human-readable message (e.g. "SMS_UNAVAILABLE"), so callers can branch on
// the failure reason instead of pattern-matching the message text.
export type ApiError = Error & { code?: string; field?: string; planLimit?: PlanLimitDetails; attemptsLeft?: number; retryAfterSeconds?: number };

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;

    // Try to parse JSON error response and extract just the message.
    // Two shapes are in use across the API: nested ({ error: { message,
    // code } }, e.g. LEGAL_DOCUMENTS_STALE) and flat ({ error: "code",
    // message: "friendly text" }, e.g. requireFeature's feature_not_purchased
    // 402). A bare string `error` field is usually itself the friendly
    // message (most routes), but wherever a sibling `message` field is also
    // present, that's the human-readable one and `error` is a machine code -
    // preferring `message` there first is what actually fixes the flat
    // shape without breaking the far more common bare-string-is-the-message
    // convention (jsonError.message is simply undefined in that case).
    try {
      const jsonError = JSON.parse(text);
      const rawError = jsonError.error;
      const nestedMessage = rawError !== null && typeof rawError === "object" ? rawError.message : undefined;
      const errorMessage =
        nestedMessage ||
        jsonError.message ||
        (typeof rawError === "string" ? rawError : undefined) ||
        text;
      const error: ApiError = new Error(errorMessage);
      if (rawError !== null && typeof rawError === "object" && typeof rawError.code === "string") {
        error.code = rawError.code;
      } else if (typeof rawError === "string" && jsonError.message) {
        // Flat shape: the string `error` field doubles as the machine
        // code precisely when a separate human-readable `message` exists.
        error.code = rawError;
      }
      if (rawError !== null && typeof rawError === "object") {
        if (typeof rawError.attemptsLeft === "number") error.attemptsLeft = rawError.attemptsLeft;
        if (typeof rawError.retryAfterSeconds === "number") error.retryAfterSeconds = rawError.retryAfterSeconds;
      }
      if (typeof jsonError.field === "string") {
        error.field = jsonError.field;
      }
      if (res.status === 402) {
        const planLimit = toPlanLimitDetails(jsonError);
        if (planLimit) error.planLimit = planLimit;
      }
      throw error;
    } catch (parseError) {
      // If not JSON, use the text directly (without status code prefix)
      if (parseError instanceof SyntaxError) {
        throw new Error(text || res.statusText);
      }
      throw parseError;
    }
  }
}

// --- Session expiry -------------------------------------------------------------------------------
// The session is a 24h JWT, and /api/auth/user is cached forever, so an expired or revoked session would
// otherwise leave the app looking signed in, with every page quietly failing. Any 401 from a data
// endpoint while a user is cached (or a session_revoked WebSocket close) therefore ends the session
// here: clear the cache and go to the login page, which shows a "session expired" message.
// /api/auth/* 401s are credential failures (wrong password, bad supervisor PIN), and /api/admin/* has
// its own auth, so neither counts.
export const SESSION_EXPIRED_PARAM = "expired";
const RETURN_PATH_KEY = "bm:returnTo";
let sessionEnding = false;
let loggingOut = false;

/** Call before an intentional logout so the revoke it triggers is not mistaken for an expiry. */
export function markIntentionalLogout(): void {
  loggingOut = true;
}

/** Remember where the user was so the next login can put them back there. */
export function saveReturnPath(): void {
  try {
    const { pathname, search } = window.location;
    if (pathname !== "/" && !pathname.startsWith("/auth/") && !pathname.startsWith("/activate")) {
      sessionStorage.setItem(RETURN_PATH_KEY, pathname + search);
    }
  } catch { /* storage unavailable: land on the default page */ }
}

/** One-shot read of the saved path. Only same-origin app paths are honoured. */
export function takeReturnPath(): string | null {
  try {
    const path = sessionStorage.getItem(RETURN_PATH_KEY);
    sessionStorage.removeItem(RETURN_PATH_KEY);
    return path && path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/auth/") ? path : null;
  } catch {
    return null;
  }
}

export function handleSessionExpired(): void {
  if (sessionEnding || loggingOut || typeof window === "undefined") return;
  // Only when we believe we were signed in; anonymous visitors hitting a 401 are not "expired".
  if (!queryClient.getQueryData(["/api/auth/user"])) return;
  const path = window.location.pathname;
  if (path.startsWith("/auth/") || path.startsWith("/activate")) return;
  sessionEnding = true;
  saveReturnPath();
  queryClient.clear();
  window.location.replace(`/auth/login?${SESSION_EXPIRED_PARAM}=1`);
}

function isSessionLossResponse(url: string, res: Response): boolean {
  return res.status === 401 && url.startsWith("/api/") && !url.startsWith("/api/auth/") && !url.startsWith("/api/admin/");
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  extraHeaders?: Record<string, string>,
  rawBody?: BodyInit,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: {
      ...(data ? { "Content-Type": "application/json" } : {}),
      ...extraHeaders,
    },
    body: rawBody ?? (data ? JSON.stringify(data) : undefined),
    credentials: "include",
  });

  if (isSessionLossResponse(url, res)) handleSessionExpired();

  try {
    await throwIfResNotOk(res);
  } catch (error) {
    // A blocked write (free-plan cap or an add-on the org doesn't have) opens
    // the global upgrade dialog, wherever the request came from. Reads are left
    // to the page's FeatureGate so merely opening a page never pops a dialog.
    const planLimit = (error as ApiError).planLimit;
    if (planLimit && method.toUpperCase() !== "GET") announcePlanLimit(planLimit);
    throw error;
  }
  // Adding, archiving or restoring staff, customers, items or stores changes how much of a cap is used, so the
  // cached usage behind the Add buttons and banners is refreshed instead of waiting out its stale time.
  if (method.toUpperCase() !== "GET" && COUNTED_RESOURCE.test(url)) void queryClient.invalidateQueries({ queryKey: ["/api/entitlements"] });
  return res;
}

const COUNTED_RESOURCE = /^\/api\/(staff|customers|products|inventory|stores)(\/|\?|$)/;

type UnauthorizedBehavior = "returnNull" | "throw";
const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const baseUrl = queryKey[0] as string;
    const secondParam = queryKey[1] as string | undefined;
    const thirdParam = queryKey[2] as string | undefined;
    
    let url = baseUrl;
    if (secondParam) {
      if (thirdParam) {
        url = `${baseUrl}/${secondParam}/${thirdParam}`;
      } else {
        const separator = baseUrl.includes("?") ? "&" : "?";
        // Use businessId for /api/stores, storeId for everything else
        const paramName = baseUrl === "/api/stores" ? "businessId" : "storeId";
        url = `${baseUrl}${separator}${paramName}=${secondParam}`;
      }
    }

    const res = await fetch(url, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }
    if (isSessionLossResponse(url, res)) handleSessionExpired();

    await throwIfResNotOk(res);
    return await res.json();
  };

export const STALE_TIMES = {
  reference:     10 * 60 * 1000,  // 10 min — static catalog (products, staff, settings, vendors)
  transactional:  2 * 60 * 1000,  //  2 min — mutable business records (default)
  live:          30 * 1000,        // 30 sec — dashboard counters / POS
} as const;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      staleTime: STALE_TIMES.transactional,
      gcTime: 24 * 60 * 60 * 1000, // 24 h — keep cache alive for offline POS sessions
      networkMode: "offlineFirst", // serve cached data immediately; don't pause queries when offline
      refetchOnWindowFocus: true,
      retry: false,
    },
    mutations: {
      retry: false,
      networkMode: "offlineFirst", // allow mutations to run offline (they'll be queued by offline-db)
    },
  },
});

