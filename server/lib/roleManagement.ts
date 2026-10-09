import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { customRoles, type CustomRole, type InsertCustomRole } from "@shared/schema";
import { canGrant, effectivePermissions, normalizePermissions } from "@shared/permissions";
import { storage } from "../storage";
import { countRoleHolders, getRoleRows, getUserPermissions, invalidateRoleCache, renameRoleHolders } from "./roles";

/**
 * Creating, changing and deleting a business's custom roles, with the rules that keep access from
 * growing by accident: only owners and managers may manage roles, a manager can only hand out pages
 * they hold themselves (and can't touch a role that reaches further than they do), names are unique
 * within a business and never clash with a built-in role, and a role that still has people on it
 * can't be deleted. Routes (settings.routes.ts) stay thin and map `status` straight to the response.
 */

export type RoleResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
export type Actor = { role?: string; businessId?: string };

const RESERVED_ROLE_NAMES = ["owner", "manager", "staff"];
const fail = (status: number, error: string): { ok: false; status: number; error: string } => ({ ok: false, status, error });

export const canManageRoles = (role?: string) => role === "owner" || role === "manager";

async function nameTaken(businessId: string, name: string, exceptId?: string): Promise<boolean> {
  const rows = await storage.getCustomRoles(businessId);
  return rows.some((r) => r.id !== exceptId && r.name.trim().toLowerCase() === name.trim().toLowerCase());
}

async function loadOwnRole(businessId: string, id: string): Promise<CustomRole | undefined> {
  const [row] = await db.select().from(customRoles).where(and(eq(customRoles.id, id), eq(customRoles.businessId, businessId), eq(customRoles.isDeleted, false)));
  return row;
}

export async function createBusinessRole(
  actor: Actor,
  input: { name: string; description?: string | null; permissions: string[]; sourceTemplateId?: string },
): Promise<RoleResult<CustomRole>> {
  if (!actor.businessId) return fail(401, "Unauthorized access.");
  if (!canManageRoles(actor.role)) return fail(403, "Only owners and managers can manage custom roles.");

  const name = input.name.trim();
  const normalized = normalizePermissions(input.permissions);
  if (!normalized.ok) return fail(400, normalized.error);
  if (RESERVED_ROLE_NAMES.includes(name.toLowerCase())) return fail(400, "That name is used by a built-in role. Choose another.");
  if (await nameTaken(actor.businessId, name)) return fail(409, "You already have a role with that name.");
  if (!canGrant(await getUserPermissions(actor), normalized.permissions).ok) {
    return fail(403, "You can't give a role access you don't have yourself.");
  }

  const role = await storage.createCustomRole({
    businessId: actor.businessId,
    name,
    description: input.description ?? null,
    permissions: normalized.permissions,
    isDeleted: false,
    deletedAt: null,
  });
  if (input.sourceTemplateId) {
    await db.update(customRoles).set({ sourceTemplateId: input.sourceTemplateId }).where(eq(customRoles.id, role.id));
  }
  invalidateRoleCache();
  return { ok: true, value: role };
}

export async function updateBusinessRole(
  actor: Actor,
  id: string,
  patch: { name?: string; description?: string | null; permissions?: string[] },
): Promise<RoleResult<CustomRole | undefined>> {
  if (!actor.businessId) return fail(401, "Unauthorized access.");
  if (!canManageRoles(actor.role)) return fail(403, "Only owners and managers can manage custom roles.");

  const existing = await loadOwnRole(actor.businessId, id);
  if (!existing) return fail(404, "Role not found.");

  // A manager can't edit a role that reaches further than they do.
  const mine = await getUserPermissions(actor);
  if (!canGrant(mine, existing.permissions).ok) return fail(403, "This role has access you don't have, so only an owner can change it.");

  const update: Partial<InsertCustomRole> = {};
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.permissions) {
    const normalized = normalizePermissions(patch.permissions);
    if (!normalized.ok) return fail(400, normalized.error);
    if (!canGrant(mine, normalized.permissions).ok) return fail(403, "You can't give a role access you don't have yourself.");
    update.permissions = normalized.permissions;
  }
  let renamed = false;
  if (typeof patch.name === "string") {
    const name = patch.name.trim();
    renamed = name.toLowerCase() !== existing.name.trim().toLowerCase();
    if (renamed) {
      if (RESERVED_ROLE_NAMES.includes(name.toLowerCase())) return fail(400, "That name is used by a built-in role. Choose another.");
      if (await nameTaken(actor.businessId, name, id)) return fail(409, "You already have a role with that name.");
    }
    update.name = name;
  }

  const updated = await storage.updateCustomRole(id, update);
  // People are linked to a role by its name, so a rename has to carry them along.
  if (renamed && updated) await renameRoleHolders(actor.businessId, existing.name, updated.name);
  invalidateRoleCache();
  return { ok: true, value: updated };
}

export async function deleteBusinessRole(actor: Actor, id: string): Promise<RoleResult<true>> {
  if (!actor.businessId) return fail(401, "Unauthorized access.");
  if (!canManageRoles(actor.role)) return fail(403, "Only owners and managers can manage custom roles.");

  const existing = await loadOwnRole(actor.businessId, id);
  if (!existing) return fail(404, "Role not found.");
  if (!canGrant(await getUserPermissions(actor), existing.permissions).ok) {
    return fail(403, "This role has access you don't have, so only an owner can delete it.");
  }
  const holders = await countRoleHolders(actor.businessId, existing.name);
  if (holders > 0) return fail(409, `${holders} staff member${holders === 1 ? " has" : "s have"} this role. Move them to another role first.`);

  await storage.deleteCustomRole(id);
  invalidateRoleCache();
  return { ok: true, value: true };
}

/**
 * Whether `actor` may give `roleName` (a staff member's access role) to someone. The role must exist
 * in the actor's business (a built-in role or one of its custom roles), "owner" is never assignable,
 * and a manager can only assign a role whose pages they hold themselves.
 */
export async function checkRoleAssignable(actor: Actor, roleName: string | undefined | null): Promise<RoleResult<true>> {
  const role = (roleName ?? "staff").trim().toLowerCase();
  if (role === "owner") return fail(400, "The owner role can't be assigned to a staff member.");
  if (!canManageRoles(actor.role)) return fail(403, "Only owners and managers can set a staff member's access role.");

  const rows = await getRoleRows(actor.businessId);
  const builtIn = role === "manager" || role === "staff";
  if (!builtIn && !rows.some((r) => r.kind !== "system" && r.name.toLowerCase() === role)) {
    return fail(400, "That access role doesn't exist. Choose one from the list.");
  }
  if (actor.role === "owner") return { ok: true, value: true };
  if (!canGrant(await getUserPermissions(actor), Array.from(effectivePermissions(role, rows))).ok) {
    return fail(403, "That role has access you don't have yourself, so only an owner can assign it.");
  }
  return { ok: true, value: true };
}
