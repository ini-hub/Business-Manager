import type { Request, Response } from "express";
import { storage } from "../storage";
import { broadcastDataChange } from "../websocket";

export function getUserId(req: Request): string | undefined {
  return (req as any).user?.userId || (req as any).user?.id;
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown";
}

export function formatZodErrors(errors: any[]): string {
  const messages = errors.map((err) => {
    const field = err.path[0] || "field";
    const fieldName = String(field).charAt(0).toUpperCase() + String(field).slice(1).replace(/([A-Z])/g, " $1");
    return `${fieldName}: ${err.message}`;
  });
  return messages.join(". ");
}

// TTL cache for store-access checks — avoids 2 sequential DB queries per request
const _accessCache = new Map<string, { authorized: boolean; expires: number }>();
const _ACCESS_TTL = 5 * 60 * 1000; // 5 minutes

// Purge expired entries every 10 minutes so the Map doesn't grow unboundedly
setInterval(() => {
  const now = Date.now();
  _accessCache.forEach((val, key) => {
    if (val.expires <= now) _accessCache.delete(key);
  });
}, 10 * 60 * 1000).unref();

export async function checkStoreAccessHelper(storeId: string, req: Request, res: Response): Promise<boolean> {
  const userId = (req as any).user?.userId || (req as any).user?.id;
  if (!userId) {
    res.status(401).json({ error: "Authentication required." });
    return false;
  }

  const cacheKey = `${userId}:${storeId}`;
  const now = Date.now();
  const cached = _accessCache.get(cacheKey);
  if (cached && cached.expires > now) {
    if (!cached.authorized) {
      res.status(403).json({ error: "Unauthorized access to store data." });
    }
    return cached.authorized;
  }

  const store = await storage.getStore(storeId);
  if (!store) {
    res.status(404).json({ error: "Store not found." });
    _accessCache.set(cacheKey, { authorized: false, expires: now + _ACCESS_TTL });
    return false;
  }
  const member = await storage.getOrganisationMember(userId, store.businessId);
  const authorized = !!member;
  _accessCache.set(cacheKey, { authorized, expires: now + _ACCESS_TTL });
  if (!authorized) {
    res.status(403).json({ error: "Unauthorized access to store data." });
  }
  return authorized;
}

export async function checkBusinessAccess(businessId: string, req: Request, res: Response): Promise<boolean> {
  const userId = (req as any).user?.userId || (req as any).user?.id;
  if (!userId) {
    res.status(401).json({ error: "Authentication required." });
    return false;
  }
  const member = await storage.getOrganisationMember(userId, businessId);
  if (!member) {
    res.status(403).json({ error: "Unauthorized access to business data." });
    return false;
  }
  return true;
}

export async function getUserStores(req: Request): Promise<any[]> {
  const userId = (req as any).user?.userId || (req as any).user?.id;
  if (!userId) return [];
  const user = await storage.getUser(userId);
  if (!user || !user.businessId) return [];
  return await storage.getStores(user.businessId);
}

/**
 * Intersects a requested set of store ids with the ones the caller may actually see.
 *
 * The Explorer queries many stores in one pass, so checking them one at a time
 * would mean N round-trips per request. This resolves the caller's stores once
 * and filters. Inaccessible ids are dropped rather than rejected — a saved view
 * authored by an owner may name stores a manager cannot reach, and the useful
 * behaviour there is to show what they can see and say so.
 *
 * Passing no ids means "everything I can see".
 */
export async function resolveAccessibleStoreIds(
  req: Request,
  requested?: string[],
): Promise<{ storeIds: string[]; dropped: string[] }> {
  const user = (req as any).user;
  const stores = await getUserStores(req);

  let allowed = stores.map((s: any) => s.id as string);

  // Staff are pinned to their own store, matching verifyStoreAccess.
  if (user?.role === "staff") {
    const staffRecord = await storage.getStaffByUserId(user.id ?? user.userId);
    allowed = staffRecord ? allowed.filter((id) => id === staffRecord.storeId) : [];
  }

  if (!requested || requested.length === 0) {
    return { storeIds: allowed, dropped: [] };
  }

  const allowedSet = new Set(allowed);
  return {
    storeIds: requested.filter((id) => allowedSet.has(id)),
    dropped: requested.filter((id) => !allowedSet.has(id)),
  };
}

export async function verifyStoreAccess(req: any, storeId: string): Promise<boolean> {
  const user = req.user;
  if (!user?.businessId) return false;
  const store = await storage.getStore(storeId);
  if (!store) return false;
  if (store.businessId !== user.businessId) return false;
  if (user.role === "staff") {
    const staffRecord = await storage.getStaffByUserId(user.id, storeId);
    if (!staffRecord) return false;
  }
  return true;
}

export async function verifyRecordStoreAccess(req: any, recordStoreId: string): Promise<boolean> {
  return verifyStoreAccess(req, recordStoreId);
}

// ── Audit context ────────────────────────────────────────────────────────────
// Built once per mutation to carry actor identity + origin into audit writes.
// See server/audit.ts for how this feeds AuditLogEntry, and the design plan at
// /Users/mac/.claude/plans/going-forward-let-s-treat-compressed-sunbeam.md.
export type AuditChannel = "web" | "api" | "import" | "system" | "admin";

export interface AuditContext {
  userId?: string;
  role?: string;
  name?: string;
  email?: string;
  businessId?: string;
  storeId?: string;
  ip: string;
  userAgent?: string;
  channel: AuditChannel;
  batchId?: string;
}

// Short-TTL cache so we don't hit `users` on every single audited write —
// mirrors the _accessCache pattern above.
const _userNameCache = new Map<string, { name: string | undefined; expires: number }>();
const _USER_NAME_TTL = 5 * 60 * 1000;

async function getCachedUserName(userId: string): Promise<string | undefined> {
  const now = Date.now();
  const cached = _userNameCache.get(userId);
  if (cached && cached.expires > now) return cached.name;
  const user = await storage.getUser(userId);
  const name = user?.name ?? undefined;
  _userNameCache.set(userId, { name, expires: now + _USER_NAME_TTL });
  return name;
}

/**
 * Builds the actor/origin context for an audited mutation. `storeId` should be
 * passed by the caller when the mutation is store-scoped (it isn't derivable
 * from the request generically). `channel`/`batchId` default to a plain web
 * request; pass overrides for CSV imports (`channel: 'import'`), system-
 * generated writes (`channel: 'system'`), or bulk fan-out actions (`batchId`
 * from the `X-Batch-Id` request header set by the client).
 */
export async function getAuditContext(
  req: Request,
  overrides: Partial<Pick<AuditContext, "channel" | "storeId" | "batchId">> = {}
): Promise<AuditContext> {
  const user = (req as any).user;
  const userId: string | undefined = user?.userId || user?.id;
  const name = userId ? await getCachedUserName(userId) : undefined;
  const headerBatchId = req.headers["x-batch-id"];

  return {
    userId,
    role: user?.role,
    name,
    email: user?.email,
    businessId: user?.businessId,
    storeId: overrides.storeId,
    ip: getClientIp(req),
    userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
    channel: overrides.channel ?? "web",
    batchId: overrides.batchId ?? (typeof headerBatchId === "string" ? headerBatchId : undefined),
  };
}

export function broadcastChange(req: Request, resource: string, storeId?: string, action = "mutated"): void {
  try {
    const businessId = (req as any).user?.businessId;
    if (businessId) broadcastDataChange(businessId, resource, storeId, action);
  } catch {
    // never let broadcast errors surface to the caller
  }
}

export async function triggerAutoRecalculate(storeId: string, dateStr: string): Promise<void> {
  try {
    const periods = await storage.getPayrollPeriods(storeId);
    const pendingPeriod = periods.find(p => p.status === "pending" && p.startDate <= dateStr && p.endDate >= dateStr);
    if (pendingPeriod) {
      await storage.calculatePayrollForPeriod(pendingPeriod.id);
      console.log(`Auto-recalculated pending payroll period ${pendingPeriod.id} due to data change on ${dateStr}`);
    }
  } catch (err) {
    console.error("Auto-recalculate error:", err);
  }
}
