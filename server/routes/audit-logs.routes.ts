import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { getClientIp } from "./helpers";
import { db } from "../db";
import { stores } from "@shared/schema";
import { eq } from "drizzle-orm";
import { toUtcStart, toUtcEnd } from "../lib/dateUtils";

export type RouteMiddlewares = {
  isAuthenticated: any;
  requireRole: (...roles: any[]) => any;
  requireManagerOrOwner: any;
  checkStoreAccess: (storeId: string, req: Request, res: Response) => Promise<boolean>;
};

export function registerAuditLogRoutes(
  app: Express,
  { requireRole }: RouteMiddlewares,
): void {
  app.get("/api/audit-logs", requireRole("owner", "manager"), async (req: any, res) => {
    try {
      const businessId = req.user?.businessId || req.user?.organisationId;
      if (!businessId) return res.status(400).json({ error: "Business context required." });

      const action = (req.query.action as string) || undefined;
      const resource = (req.query.resource as string) || undefined;
      const resourceId = (req.query.resourceId as string) || undefined;
      const [firstStore] = await db.select({ timezone: stores.timezone }).from(stores).where(eq(stores.businessId, businessId)).limit(1);
      const tz = firstStore?.timezone ?? "Africa/Lagos";
      const startDate = req.query.startDate
        ? toUtcStart(req.query.startDate as string, tz)
        : undefined;
      const endDate = req.query.endDate
        ? toUtcEnd(req.query.endDate as string, tz)
        : undefined;

      const logs = await storage.getAuditLogs(businessId, {
        action,
        resource,
        resourceId,
        startDate,
        endDate,
      });

      res.json({ logs });
    } catch (error) {
      console.error("GET /api/audit-logs error:", error);
      res.status(500).json({ error: "Could not fetch audit logs." });
    }
  });
}
