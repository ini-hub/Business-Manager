import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";

import { roleHasModule, type PermissionModule } from "@shared/permissionModules";

export {  type PermissionModule };

/**
 * Client-side mirror of server/lib/permissions.ts hasModulePermission - used
 * for showing/hiding UI only. The server route is always the real gate; this
 * just avoids flashing controls the API will reject.
 */
function hasModulePermission(
  role: string | undefined,
  customRoles: { name: string; permissions?: string[] | null }[],
  module: PermissionModule,
): boolean {
  return roleHasModule(role, customRoles, module);
}

/** Whether the current user has `module` access - resolves custom roles via /api/custom-roles. */
export function useHasPermission(module: PermissionModule): { hasPermission: boolean; isLoading: boolean } {
  const { user, isLoading: authLoading } = useAuth();
  const isBaseRole = user?.role === "owner" || user?.role === "manager" || user?.role === "staff";

  const { data: customRoles = [], isLoading: rolesLoading } = useQuery<{ name: string; permissions?: string[] | null }[]>({
    queryKey: ["/api/custom-roles"],
    enabled: !!user && !isBaseRole,
  });

  return {
    hasPermission: hasModulePermission(user?.role, customRoles, module),
    isLoading: authLoading || (!isBaseRole && rolesLoading),
  };
}
