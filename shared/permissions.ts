import { PAGE_MODULE, PERMISSION_MODULES, type PermissionModule } from "./permissionModules";
import { DEFAULT_SIDEBAR_LAYOUT, NAV_ITEMS, type NavRole } from "./sidebarLayout";

/**
 * What a role can be given, one entry per sidebar page, grouped under the module the
 * page belongs to (the same modules Settings > Roles and the feature registry use).
 * A role's `permissions[]` holds page keys and/or whole module names: a module name
 * is shorthand for every page in it, and is what roles saved before per-page
 * permissions hold, so they keep working unchanged.
 *
 * A key is the page's route. `selfService` pages are about the signed-in person
 * themselves (their dashboard, their own attendance and pay), so every role has them.
 */

export interface PermissionDef {
  key: string;
  label: string;
  module: PermissionModule;
  selfService: boolean;
}

export const PERMISSIONS: PermissionDef[] = NAV_ITEMS.map((item) => {
  const meta = PAGE_MODULE[item.url];
  if (!meta) throw new Error(`Sidebar page ${item.url} has no permission module (shared/permissions.ts).`);
  return { key: item.url, label: item.title, module: meta.module, selfService: !!meta.selfService };
});

const PERMISSION_BY_KEY = new Map(PERMISSIONS.map((p) => [p.key, p]));
export const ALL_PERMISSION_KEYS: readonly string[] = PERMISSIONS.map((p) => p.key);
const SELF_SERVICE_KEYS = PERMISSIONS.filter((p) => p.selfService).map((p) => p.key);

export const isPermissionKey = (value: string): boolean => PERMISSION_BY_KEY.has(value);
export const isModuleName = (value: string): value is PermissionModule => (PERMISSION_MODULES as readonly string[]).includes(value);

export const permissionsInModule = (module: PermissionModule): PermissionDef[] => PERMISSIONS.filter((p) => p.module === module);

/** Pages grouped for pickers, in the order modules are listed elsewhere. */
export const PERMISSIONS_BY_MODULE: { module: PermissionModule; permissions: PermissionDef[] }[] = PERMISSION_MODULES.map((module) => ({
  module,
  permissions: permissionsInModule(module),
}));

/**
 * The page permission a route falls under: the longest page key that is the path or a parent of it
 * (/staffs/12/edit -> /staffs, /settings/billing -> /settings). The dashboard "/" only matches itself.
 */
export function findPermissionForPath(path: string): PermissionDef | undefined {
  const clean = path.split("?")[0].replace(/\/+$/, "") || "/";
  let best: PermissionDef | undefined;
  for (const p of PERMISSIONS) {
    const hit = clean === p.key || (p.key !== "/" && clean.startsWith(p.key + "/"));
    if (hit && (!best || p.key.length > best.key.length)) best = p;
  }
  return best;
}

/** Owner holds everything. Manager and staff start with what their sidebar showed before roles were editable. */
export const SYSTEM_ROLE_DEFAULTS: Record<NavRole, readonly string[]> = {
  owner: ALL_PERMISSION_KEYS,
  manager: DEFAULT_SIDEBAR_LAYOUT.manager.sections.flatMap((s) => s.items),
  staff: DEFAULT_SIDEBAR_LAYOUT.staff.sections.flatMap((s) => s.items),
};

/**
 * The pages a stored permissions[] grants: module names expand to their pages, page keys
 * count as themselves, anything unknown is ignored, and self-service pages are always in.
 */
export function expandPermissions(stored: readonly string[] | null | undefined): Set<string> {
  const out = new Set<string>(SELF_SERVICE_KEYS);
  for (const entry of stored ?? []) {
    if (isModuleName(entry)) permissionsInModule(entry).forEach((p) => out.add(p.key));
    else if (isPermissionKey(entry)) out.add(entry);
  }
  return out;
}

export type RoleRow = { name: string; permissions?: readonly string[] | null; kind?: string | null };

/**
 * The pages `role` (the user's role value) may use. Owner always has everything. A built-in role
 * uses its saved override row when there is one, else its default; anything else is a custom role
 * matched by name (or an id-keyed row, once the caller passes one).
 */
export function effectivePermissions(role: string | undefined, rows: readonly RoleRow[] = []): Set<string> {
  if (!role) return new Set(SELF_SERVICE_KEYS);
  if (role === "owner") return new Set(ALL_PERMISSION_KEYS);
  if (role === "manager" || role === "staff") {
    const override = rows.find((r) => r.kind === "system" && r.name.toLowerCase() === role);
    return expandPermissions(override?.permissions ?? SYSTEM_ROLE_DEFAULTS[role]);
  }
  const match = rows.find((r) => r.kind !== "system" && r.name.toLowerCase() === role);
  return expandPermissions(match?.permissions);
}

/** Whether someone holding `granter` may hand out everything in `requested`. Owners may grant anything. */
export function canGrant(granter: ReadonlySet<string>, requested: readonly string[]): { ok: true } | { ok: false; missing: string[] } {
  const wanted = expandPermissions(requested);
  const missing = Array.from(wanted).filter((key) => !granter.has(key));
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

/**
 * Cleans a permissions[] for storage: drops duplicates and rejects entries that are neither a
 * module nor a page. A module name stays a module name (it also covers pages added to it later);
 * page keys already covered by a ticked module are dropped, and self-service pages (every role
 * has them) are never stored.
 */
export function normalizePermissions(input: readonly string[]): { ok: true; permissions: string[] } | { ok: false; error: string } {
  const seen = new Set<string>();
  for (const entry of input) {
    if (!isModuleName(entry) && !isPermissionKey(entry)) return { ok: false, error: `Unknown permission "${entry}".` };
    seen.add(entry);
  }
  const permissions: string[] = [];
  for (const module of PERMISSION_MODULES) {
    if (seen.has(module)) {
      permissions.push(module);
      continue;
    }
    permissions.push(...permissionsInModule(module).filter((p) => !p.selfService && seen.has(p.key)).map((p) => p.key));
  }
  return { ok: true, permissions };
}

/** Whether a super admin has saved an override for a built-in role (rows come from server/lib/roles.ts getRoleRows). */
export function hasSystemOverride(role: string, rows: readonly RoleRow[]): boolean {
  return rows.some((r) => r.kind === "system" && r.name.toLowerCase() === role);
}
