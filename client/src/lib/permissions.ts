import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";

import { roleHasModule, type PermissionModule } from "@shared/permissionModules";
import { findPermissionForPath } from "@shared/permissions";
import { useEntitlements } from "@/hooks/useEntitlements";

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

/**
 * Whether the signed-in role may open a route, by the page permissions the server sent
 * (shared/permissions.ts). Routes that aren't a catalogued page, and the self-service pages
 * every role has, are always open here (the API still decides what data they get). Until the
 * permissions arrive owners and managers are let through and everyone else waits, so a custom
 * role never flashes a page it doesn't hold.
 */
export function usePageAccess() {
  const { user } = useAuth();
  const { permissions } = useEntitlements();
  const role = user?.role;
  const isCustomRole = !!role && role !== "owner" && role !== "manager" && role !== "staff";
  const canOpen = (path: string): boolean => {
    const page = findPermissionForPath(path);
    if (!page || page.selfService) return true;
    if (permissions) return permissions.includes(page.key);
    return role === "owner" || role === "manager";
  };
  return { canOpen, isCustomRole, ready: !!permissions };
}
