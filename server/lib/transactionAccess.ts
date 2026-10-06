import type { NextFunction, Request, Response } from "express";

/**
 * Who may see money figures that are not their own.
 *
 *  - Customer spend (/api/customers/summary): owner and manager, plus a custom
 *    role that holds the "Customers" module. The built-in "staff" role holds that
 *    module too (STAFF_BASE_MODULES) but is deliberately excluded here.
 *  - Transactions: owner and manager see everything. Everyone else sees only the
 *    checkouts they took part in, unless the business turned
 *    organisations.staff_own_transactions_only off AND holds the paid
 *    "staff_sales_visibility" feature (unpaid, the default applies).
 *
 * The pure helpers carry no database import so they can be unit tested; the
 * async ones load storage lazily for the same reason.
 */

type AccessUser = { id?: string; userId?: string; role?: string; businessId?: string } | undefined;

function isOwnerOrManager(user: AccessUser): boolean {
  return user?.role === "owner" || user?.role === "manager";
}

/** Owner/manager, or a custom role holding "Customers". Never the built-in "staff" role. */
export async function canViewCustomerSpend(
  user: AccessUser,
  hasModule?: (user: AccessUser, module: "Customers") => Promise<boolean>,
): Promise<boolean> {
  if (!user?.role) return false;
  if (isOwnerOrManager(user)) return true;
  if (user.role === "staff") return false;
  const check = hasModule ?? (async (u, m) => (await import("./permissions")).hasModulePermission(u as any, m));
  return check(user, "Customers");
}

export async function requireCustomerSpendAccess(req: Request, res: Response, next: NextFunction) {
  try {
    if (await canViewCustomerSpend((req as any).user)) return next();
    return res.status(403).json({ error: "Only owners, managers and roles with Customers access can view customer spend." });
  } catch (error) {
    console.error("requireCustomerSpendAccess error:", error);
    return res.status(500).json({ error: "We couldn't verify your access. Please try again." });
  }
}

export interface CheckoutStaffFields {
  staffId?: string | null;
  leadStaffId?: string | null;
  assistingStaff1Id?: string | null;
  assistingStaff2Id?: string | null;
  serviceStaffIds?: string[] | null;
}

/** True when any of the staff on this checkout (processor, lead, assisting) is in `staffIds`. */
export function checkoutInScope(checkout: CheckoutStaffFields | null | undefined, staffIds: ReadonlySet<string>): boolean {
  if (!checkout) return false;
  const involved = [
    checkout.staffId, checkout.leadStaffId, checkout.assistingStaff1Id, checkout.assistingStaff2Id,
    ...(checkout.serviceStaffIds ?? []),
  ];
  return involved.some((id) => !!id && staffIds.has(id));
}

/**
 * The staff ids whose transactions this user may see, or null when unrestricted.
 * Fails closed: a user with no staff record in the given stores (or no user id) gets
 * an empty set and sees nothing; a missing business row keeps the restriction on.
 */
export async function resolveTransactionScope(user: AccessUser, storeIds: string[]): Promise<Set<string> | null> {
  if (isOwnerOrManager(user)) return null;

  const { storage } = await import("../storage");
  const business = user?.businessId ? await storage.getBusinessById(user.businessId) : undefined;
  // Seeing every sale is the paid "Staff Sales Visibility" feature. The stored value is
  // left alone, so it takes effect again as soon as the business is entitled; until then
  // the default (own sales only) applies. Any lookup failure keeps the restriction on.
  if (business && business.staffOwnTransactionsOnly === false && user?.businessId) {
    const { hasFeature } = await import("./entitlements");
    if (await hasFeature(user.businessId, "staff_sales_visibility").catch(() => false)) return null;
  }

  const scope = new Set<string>();
  const userId = user?.id ?? user?.userId;
  if (!userId) return scope;
  for (const storeId of Array.from(new Set(storeIds))) {
    const row = await storage.getStaffByUserId(userId, storeId);
    if (row?.id) scope.add(row.id);
  }
  return scope;
}

export function filterToScope<T extends { checkout?: CheckoutStaffFields | null }>(txs: T[], scope: Set<string> | null): T[] {
  return scope ? txs.filter((tx) => checkoutInScope(tx.checkout, scope)) : txs;
}
