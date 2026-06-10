import type { Request, Response } from "express";
import { storage } from "../storage";

export function getUserId(req: Request): string | undefined {
  return (req as any).user?.claims?.sub;
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

export async function verifyStoreAccess(req: any, storeId: string): Promise<boolean> {
  const user = req.user;
  if (!user?.businessId) return false;
  const store = await storage.getStore(storeId);
  if (!store) return false;
  if (store.businessId !== user.businessId) return false;
  if (user.role === "staff") {
    const staffRecord = await storage.getStaffByUserId(user.id);
    if (staffRecord && staffRecord.storeId !== storeId) return false;
  }
  return true;
}

export async function verifyRecordStoreAccess(req: any, recordStoreId: string): Promise<boolean> {
  return verifyStoreAccess(req, recordStoreId);
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
