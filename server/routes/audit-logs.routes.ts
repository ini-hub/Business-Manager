import { parsePage, pagination } from "../lib/pagination";
import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { stores } from "@shared/schema";
import { eq } from "drizzle-orm";
import { toUtcStart, toUtcEnd } from "../lib/dateUtils";
import { requirePermission } from "../lib/permissionGate";

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
  app.get("/api/audit-logs", requirePermission("/reports/audit-logs"), async (req: any, res) => {
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

      // Newest first, one page at a time (the trail only ever grows). `logs` keeps its name so existing readers
      // still work; `pagination` says how much more there is.
      const page = parsePage(req.query, { defaultLimit: 100, maxLimit: 200 });
      const { rows, total } = await storage.getAuditLogsPage(businessId, { action, resource, resourceId, startDate, endDate }, page);
      res.json({ logs: rows, pagination: pagination(total, page) });
    } catch (error) {
      console.error("GET /api/audit-logs error:", error);
      res.status(500).json({ error: "Could not fetch audit logs." });
    }
  });

  // Redacts a log entry's sensitive payload. This is the only mutation the DB's append-only
  // trigger on audit_logs permits — the row itself is never deleted.
  app.patch("/api/audit-logs/:id/redact", requireRole("owner"), async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const updated = await storage.redactAuditLog(req.params.id, userId);
      if (!updated) return res.status(404).json({ error: "Log entry not found." });
      res.json(updated);
    } catch (error) {
      console.error("PATCH /api/audit-logs/:id/redact error:", error);
      res.status(500).json({ error: "Could not redact log entry." });
    }
  });
}
