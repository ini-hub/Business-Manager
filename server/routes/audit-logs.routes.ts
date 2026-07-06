import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { getClientIp } from "./helpers";

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
      const startDate = req.query.startDate
        ? new Date(`${req.query.startDate}T00:00:00.000Z`)
        : undefined;
      const endDate = req.query.endDate
        ? new Date(`${req.query.endDate}T23:59:59.999Z`)
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
