import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { auditLogger } from "../audit";
import { getClientIp, broadcastChange } from "./helpers";

export type RouteMiddlewares = {
  isAuthenticated: any;
  requireRole: (...roles: any[]) => any;
  requireManagerOrOwner: any;
  checkStoreAccess: (storeId: string, req: Request, res: Response) => Promise<boolean>;
};

export function registerPaymentAccountRoutes(app: Express, { isAuthenticated, requireManagerOrOwner, checkStoreAccess }: RouteMiddlewares): void {
  // Any staff member can read the active accounts (needed at checkout); managers also see inactive ones.
  app.get("/api/sales/payment-accounts", isAuthenticated, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) return res.status(400).json({ error: "Store ID is required." });
      if (!(await checkStoreAccess(storeId, req, res))) return;
      const role = (req as any).user?.role;
      const includeInactive = req.query.includeInactive === "true" && (role === "owner" || role === "manager");
      res.json(await storage.paymentAccountRepo.list(storeId, { includeInactive }));
    } catch {
      res.status(500).json({ error: "Could not fetch payment accounts." });
    }
  });

  // Receipt legs, so receipts and transaction details can show account + confirmation state.
  app.get("/api/sales/receipts/:receiptNumber/payment-legs", isAuthenticated, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) return res.status(400).json({ error: "Store ID is required." });
      if (!(await checkStoreAccess(storeId, req, res))) return;
      res.json(await storage.paymentAccountRepo.getLegsForReceipt(storeId, req.params.receiptNumber));
    } catch {
      res.status(500).json({ error: "Could not fetch payment details." });
    }
  });

  // Mark pending transfers as having landed (cashier or manager checked the bank/POS).
  app.post("/api/sales/payment-legs/confirm", isAuthenticated, requireManagerOrOwner, async (req, res) => {
    try {
      const body = z.object({ storeId: z.string(), legIds: z.array(z.string()).min(1).max(200) }).parse(req.body);
      if (!(await checkStoreAccess(body.storeId, req, res))) return;
      const userId = (req as any).user?.id;
      const count = await storage.paymentAccountRepo.confirmLegs(body.storeId, body.legIds, userId);
      auditLogger.log({ action: "PAYMENT_LEG_CONFIRM", resource: "payment_leg", resourceId: body.legIds[0], userId, ip: getClientIp(req), status: "success", details: { count, legIds: body.legIds } });
      broadcastChange(req, "sales", body.storeId, "updated");
      res.json({ confirmed: count });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: "Invalid request." });
      res.status(500).json({ error: "Could not confirm payments." });
    }
  });
}
