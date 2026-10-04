import { db } from "../db";
import { customRoles } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { PERMISSION_MODULES, roleHasModule, type PermissionModule } from "@shared/permissionModules";

// The module list lives in shared/permissionModules.ts (one list for the role
// form, these checks and the feature registry).
export { PERMISSION_MODULES, type PermissionModule };

/**
 * Whether `user` (req.user - role is either "owner"/"manager"/"staff" or a
 * custom role's name.toLowerCase(), see client/src/pages/staff-form.tsx) has
 * `module` access. owner/manager always do (matches their System Roles
 * snapshot, which lists every module). "staff" only gets the base modules
 * shown on the Staff System Role card. Anything else is looked up as a
 * custom role by businessId + name - the only place the custom_roles.
 * permissions[] array set in /settings/roles is actually consulted; every
 * role === "manager"/"owner" check elsewhere in the codebase still ignores
 * it and is a known gap (see MEMORY.md custom-role-permissions-not-enforced).
 */
export async function hasModulePermission(
  user: { role?: string; businessId?: string } | undefined,
  module: PermissionModule,
): Promise<boolean> {
  if (!user?.role) return false;
  if (user.role === "owner" || user.role === "manager" || user.role === "staff") return roleHasModule(user.role, [], module);

  if (!user.businessId) return false;
  // Custom roles are matched by name.toLowerCase() against user.role - see
  // client/src/pages/staff-form.tsx, which assigns r.name.toLowerCase() as
  // the staff's role value. No case-insensitive column to filter on in SQL,
  // so pull this business's roles and match in JS.
  const rows = await db.select({ name: customRoles.name, permissions: customRoles.permissions })
    .from(customRoles)
    .where(and(eq(customRoles.businessId, user.businessId), eq(customRoles.isDeleted, false)));
  return roleHasModule(user.role, rows, module);
}
