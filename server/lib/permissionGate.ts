import type { NextFunction, Request, Response } from "express";
import { effectivePermissions, hasSystemOverride } from "@shared/permissions";
import { getRoleRows } from "./roles";

/**
 * Route guard for the "management" actions of a page (create, edit, approve, record on someone's
 * behalf), keyed by the page that owns them (shared/permissions.ts).
 *
 *  - The owner always passes.
 *  - A built-in role nobody has customised behaves exactly as `requireRole(...legacyRoles)` did,
 *    so adding this guard to a route changes nothing until a super admin edits that role.
 *  - Once a super admin has saved a Manager/Staff override, and for every custom role, the role
 *    passes only if it holds the page.
 *
 * Owner-only actions (deleting vendors, voiding books, billing) keep `requireRole("owner")`: a page
 * grant is never enough for those, so they are not routed through here.
 */
export function requirePermission(pageKey: string, ...legacyRoles: string[]) {
  const legacy = legacyRoles.length > 0 ? legacyRoles : ["owner", "manager"];
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as any).user as { role?: string; businessId?: string } | undefined;
      const role = user?.role;
      if (!role) return res.status(401).json({ error: "Authentication required." });
      if (role === "owner") return next();

      const rows = await getRoleRows(user?.businessId);
      const builtIn = role === "manager" || role === "staff";
      const allowed = builtIn && !hasSystemOverride(role, rows) ? legacy.includes(role) : effectivePermissions(role, rows).has(pageKey);
      if (!allowed) return res.status(403).json({ error: "You don't have permission to access this resource." });
      next();
    } catch (error) {
      console.error("requirePermission error:", error);
      res.status(500).json({ error: "Authorization check failed." });
    }
  };
}

/**
 * The API domains whose manager-level routes go through requirePermission, and the page that owns
 * each. server/lib/permissionGate.test.ts fails if a route in one of these domains goes back to a
 * hardcoded role check. Domains whose pages staff hold by default (customers, transactions, quotes,
 * bookings) are deliberately absent: a page grant must not unlock their privileged actions.
 */
export const GATED_API_DOMAINS: Record<string, string> = {
  staff: "/staffs",
  attendance: "/staffs",
  payroll: "/payroll",
  expenses: "/expenses",
  "expense-categories": "/expenses",
  accounting: "/profit-loss",
  "profit-loss": "/profit-loss",
  inventory: "/inventory",
  products: "/inventory",
  "inventory-drafts": "/inventory",
  "stock-audits": "/inventory",
  vendors: "/vendors",
  "purchase-orders": "/purchase-orders",
  "stock-transfers": "/stock-transfers",
  "stock-transfer-drafts": "/stock-transfers",
  partners: "/partners",
  "partner-transfers": "/partners",
  "partner-ledger": "/partners",
  "tax-rates": "/settings/taxes",
  promotions: "/settings/promotions",
  "audit-logs": "/reports/audit-logs",
  stores: "/settings",
  business: "/settings",
  billing: "/settings",
};

/** Report sub-paths that belong to a specific page. */
export const GATED_REPORT_PATHS: Record<string, string> = {
  "/api/reports/staff-performance": "/staffs/performance",
  "/api/reports/service-profitability": "/reports/service-profitability",
};
