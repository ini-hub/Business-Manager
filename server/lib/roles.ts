import { db } from "../db";
import { customRoles } from "@shared/schema";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { effectivePermissions, type RoleRow } from "@shared/permissions";
import { createTtlCache } from "./ttlCache";

/**
 * Roles as stored: a business's custom roles, plus platform rows (business_id NULL) that a super
 * admin maintains: 'system' rows override what the built-in manager/staff roles can use, and
 * 'template' rows are ready-made roles a business can start from. See shared/permissions.ts
 * for how permissions[] is read.
 */

const rowsCache = createTtlCache<string, RoleRow[]>(15_000);
const PLATFORM = "__platform__";

/** Called after any role change on this instance; other instances catch up within the TTL. */
export function invalidateRoleCache(): void {
  rowsCache.invalidate();
}

/** What effectivePermissions needs for one business: its custom roles and the platform's system overrides. */
export async function getRoleRows(businessId: string | undefined): Promise<RoleRow[]> {
  return rowsCache.get(businessId ?? PLATFORM, async () => {
    const rows = await db
      .select({ name: customRoles.name, permissions: customRoles.permissions, kind: customRoles.kind })
      .from(customRoles)
      .where(
        and(
          eq(customRoles.isDeleted, false),
          businessId
            ? or(eq(customRoles.businessId, businessId), and(isNull(customRoles.businessId), eq(customRoles.kind, "system")))
            : and(isNull(customRoles.businessId), eq(customRoles.kind, "system")),
        ),
      );
    return rows;
  });
}

/** The pages `user` (req.user) may use. */
export async function getUserPermissions(user: { role?: string; businessId?: string } | undefined): Promise<Set<string>> {
  return effectivePermissions(user?.role, await getRoleRows(user?.businessId));
}

/**
 * A role is linked to people by its lowercased name (staff.role, users.role, organisation_members.role),
 * so renaming one has to move its holders with it or they silently drop to no access.
 */
export async function renameRoleHolders(businessId: string, oldName: string, newName: string): Promise<void> {
  const from = oldName.toLowerCase();
  const to = newName.toLowerCase();
  if (from === to) return;
  await db.transaction(async (tx) => {
    await tx.execute(sql`UPDATE staff SET role = ${to} WHERE role = ${from} AND store_id IN (SELECT id FROM stores WHERE business_id = ${businessId})`);
    await tx.execute(sql`UPDATE users SET role = ${to} WHERE role = ${from} AND business_id = ${businessId}`);
    await tx.execute(sql`UPDATE organisation_members SET role = ${to} WHERE role = ${from} AND organisation_id = ${businessId}`);
  });
}

/** How many people currently hold a custom role (for the delete guard). */
export async function countRoleHolders(businessId: string, name: string): Promise<number> {
  const role = name.toLowerCase();
  const result = await db.execute(
    sql`SELECT count(*)::int AS n FROM staff WHERE role = ${role} AND is_archived = false AND store_id IN (SELECT id FROM stores WHERE business_id = ${businessId})`,
  );
  return Number((result.rows[0] as any)?.n ?? 0);
}
