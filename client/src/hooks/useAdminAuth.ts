import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

export interface SuperAdminUser {
  id: string;
  name: string;
  email: string;
  role: "super_admin" | "ops_manager" | "support_agent" | "finance_admin";
}

export function useAdminAuth() {
  const { data, isLoading } = useQuery<{ admin: SuperAdminUser }>({
    queryKey: ["/api/admin/auth/me"],
    retry: false,
    staleTime: 60 * 1000, // 1 minute stale time for admin
  });

  const logout = async () => {
    try {
      await apiRequest("POST", "/api/admin/auth/logout");
      queryClient.clear();
      // Redirect to admin login screen
      window.location.href = "/super-admin/login";
    } catch (error) {
      console.error("Admin logout error:", error);
      window.location.href = "/super-admin/login";
    }
  };

  return {
    admin: data?.admin || null,
    isLoading,
    isAuthenticated: !!data?.admin,
    logout,
  };
}
