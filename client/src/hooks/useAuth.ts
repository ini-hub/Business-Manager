import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { User } from "@shared/schema";

// The API layers a `staffId` onto the raw user record: the caller's own linked
// staff profile (from the `staff.userId` back-reference), or null if they're a
// shared/unlinked login with no profile to default or lock to.
type AuthUser = User & { staffId?: string | null };

export function useAuth() {
  const { data: user, isLoading } = useQuery<AuthUser>({
    queryKey: ["/api/auth/user"],
    retry: false,
    refetchOnWindowFocus: false, // Prevent frequent polling when refocusing browser tab
    staleTime: Infinity,          // Auth state is highly stable; only invalidate on explicit actions
  });

  const logout = async () => {
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
