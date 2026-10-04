/**
 * The modules a role's permissions[] can name (Settings > Roles). One list,
 * shared by the role form, the server's permission checks and the feature
 * registry, so a feature's `module` can only ever be something a role can hold.
 */
export const PERMISSION_MODULES = [
  "Dashboard",
  "Sales & Checkout",
  "Customers",
  "Staff & Payroll",
  "Inventory & Catalog",
  "Expenses & Reports",
  "Settings",
] as const;
export type PermissionModule = (typeof PERMISSION_MODULES)[number];

/** What the built-in "staff" role gets (the Staff card on Settings > Roles). */
const STAFF_BASE_MODULES: readonly PermissionModule[] = ["Sales & Checkout", "Customers", "Inventory & Catalog"];

export function isPermissionModule(value: string): value is PermissionModule {
  return (PERMISSION_MODULES as readonly string[]).includes(value);
}

/**
 * Pure access check. owner/manager hold every module, "staff" holds the base
 * modules, anything else is a custom role matched by name.toLowerCase().
 */
export function roleHasModule(
  role: string | undefined,
  customRoles: readonly { name: string; permissions?: readonly string[] | null }[],
  module: PermissionModule,
): boolean {
  if (!role) return false;
  if (role === "owner" || role === "manager") return true;
  if (role === "staff") return STAFF_BASE_MODULES.includes(module);
  const match = customRoles.find((r) => r.name.toLowerCase() === role);
  return match?.permissions?.includes(module) ?? false;
}
