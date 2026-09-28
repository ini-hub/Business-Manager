import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";

// Mirrors server/lib/permissions.ts PERMISSION_MODULES - keep both lists and
// the role-form.tsx checkbox list in sync.
export const PERMISSION_MODULES = [
  "Dashboard",
  "Sales & Checkout",
  "Customers",
  "Staff & Payroll",
  "Inventory & Catalog",
  "Expenses & Reports",
  "Settings",
] as const;
export type PermissionModule = typeof PERMISSION_MODULES[number];

const STAFF_BASE_MODULES: PermissionModule[] = ["Sales & Checkout", "Customers", "Inventory & Catalog"];

/**
 * Client-side mirror of server/lib/permissions.ts hasModulePermission - used
 * for showing/hiding UI only. The server route is always the real gate; this
 * just avoids flashing controls the API will reject.
 */
export function hasModulePermission(
  role: string | undefined,
  customRoles: { name: string; permissions?: string[] | null }[],
  module: PermissionModule,
): boolean {
  if (!role) return false;
  if (role === "owner" || role === "manager") return true;
  if (role === "staff") return STAFF_BASE_MODULES.includes(module);
  const match = customRoles.find((r) => r.name.toLowerCase() === role);
  return match?.permissions?.includes(module) ?? false;
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
