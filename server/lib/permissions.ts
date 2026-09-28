import { db } from "../db";
import { customRoles } from "@shared/schema";
import { and, eq } from "drizzle-orm";

// Modules a custom role's permissions[] can name - must match the checkbox
// list in client/src/pages/role-form.tsx (permissionsList) and the System
// Roles snapshot in client/src/pages/settings/components/roles-permissions.tsx.
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
  if (user.role === "owner" || user.role === "manager") return true;

  const STAFF_BASE_MODULES: PermissionModule[] = ["Sales & Checkout", "Customers", "Inventory & Catalog"];
  if (user.role === "staff") return STAFF_BASE_MODULES.includes(module);

  if (!user.businessId) return false;
  // Custom roles are matched by name.toLowerCase() against user.role - see
  // client/src/pages/staff-form.tsx, which assigns r.name.toLowerCase() as
  // the staff's role value. No case-insensitive column to filter on in SQL,
  // so pull this business's roles and match in JS.
  const rows = await db.select({ name: customRoles.name, permissions: customRoles.permissions })
    .from(customRoles)
    .where(and(eq(customRoles.businessId, user.businessId), eq(customRoles.isDeleted, false)));
  const match = rows.find((r) => r.name.toLowerCase() === user.role);
  return match?.permissions?.includes(module) ?? false;
}
