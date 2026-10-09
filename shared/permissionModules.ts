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

/**
 * The module each sidebar page sits under (shared/permissions.ts builds the page-level permission
 * list from this). `selfService` pages are about the signed-in person themselves, so every role has them.
 */
export const PAGE_MODULE: Record<string, { module: PermissionModule; selfService?: boolean }> = {
  "/": { module: "Dashboard", selfService: true },
  "/leaderboard": { module: "Dashboard" },
  "/customers": { module: "Customers" },
  "/bookings": { module: "Customers" },
  "/broadcasts": { module: "Customers" },
  "/sales/new": { module: "Sales & Checkout" },
  "/transactions": { module: "Sales & Checkout" },
  "/credit-sales": { module: "Sales & Checkout" },
  "/quotes": { module: "Sales & Checkout" },
  "/settings/promotions": { module: "Sales & Checkout" },
  "/settings/taxes": { module: "Sales & Checkout" },
  "/staffs": { module: "Staff & Payroll" },
  "/staffs/performance": { module: "Staff & Payroll" },
  "/payroll": { module: "Staff & Payroll" },
  "/staff/attendance": { module: "Staff & Payroll", selfService: true },
  "/staff/payroll": { module: "Staff & Payroll", selfService: true },
  "/inventory": { module: "Inventory & Catalog" },
  "/stock-transfers": { module: "Inventory & Catalog" },
  "/partners": { module: "Inventory & Catalog" },
  "/purchase-orders": { module: "Inventory & Catalog" },
  "/vendors": { module: "Inventory & Catalog" },
  "/profit-loss": { module: "Expenses & Reports" },
  "/expenses": { module: "Expenses & Reports" },
  "/reports/service-profitability": { module: "Expenses & Reports" },
  "/reports/balance-sheet": { module: "Expenses & Reports" },
  "/analytics": { module: "Expenses & Reports" },
  "/analytics/dashboards": { module: "Expenses & Reports" },
  "/reports/audit-logs": { module: "Expenses & Reports" },
  "/settings": { module: "Settings" },
};


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
  // A role holds a module by naming it, or by being given any page in it (a page grant would
  // otherwise be dead wherever the server or screen checks the module).
  return match?.permissions?.some((p) => p === module || PAGE_MODULE[p]?.module === module && !PAGE_MODULE[p].selfService) ?? false;
}
