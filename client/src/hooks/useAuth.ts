import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient, markIntentionalLogout, getQueryFn } from "@/lib/queryClient";
import type { User } from "@shared/schema";

// The API layers a `staffId` onto the raw user record: the caller's own linked
// staff profile (from the `staff.userId` back-reference), or null if they're a
// shared/unlinked login with no profile to default or lock to.
type AuthUser = User & { staffId?: string | null };

export function useAuth() {
  const { data: user, isLoading } = useQuery<AuthUser>({
    queryKey: ["/api/auth/user"],
    // "Not signed in" is a normal answer, not an error. As an error the query refetched on every new
    // observer mount, and a 1ms 401 meant each mount fired another request: a logged-out page could
    // send hundreds a second and trip the auth rate limiter (429 "Too many login attempts").
    queryFn: getQueryFn<AuthUser>({ on401: "returnNull" }),
    // The same applies when the API is unreachable (server restarting): an errored query refetches on
    // every new observer mount, which sent hundreds of requests a second. Retry inside the one fetch with
    // a backoff instead, and never refetch on mount; a login invalidates the query explicitly.
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    retryOnMount: false,
    refetchOnWindowFocus: false, // Prevent frequent polling when refocusing browser tab
    staleTime: Infinity,          // Auth state is highly stable; only invalidate on explicit actions
  });

  const logout = async () => {
    markIntentionalLogout();
    try {
      await apiRequest("POST", "/api/auth/logout");
      queryClient.clear();
      // Hard redirect ensures the router resets to landing, not a stale route
      window.location.href = "/";
    } catch (error) {
      console.error("Logout error:", error);
      window.location.href = "/";
    }
  };

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    logout,
  };
}
