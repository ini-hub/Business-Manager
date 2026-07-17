import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { verifyRecordStoreAccess } from './helpers';
import { withCustomerId } from '../utils/slug-resolver';

export type RouteMiddlewares = {
  isAuthenticated: any;
  requireRole: (...roles: any[]) => any;
  requireManagerOrOwner: any;
  checkStoreAccess: (storeId: string, req: Request, res: Response) => Promise<boolean>;
};

/**
 * registerBusinessRoutes (server/routes/business.routes.ts) registers the full
 * /api/customers/* CRUD surface and is wired up before this module in routes.ts,
 * so it wins for every path both files define. GET /api/customers/:id is the one
 * route business.routes.ts does not also register, which is why it's the only
 * handler left here — everything else that used to live in this file was dead
 * code, permanently shadowed, and has been removed rather than left to confuse
 * future edits.
 */
export function registerCustomerRoutes(app: Express, { isAuthenticated }: RouteMiddlewares): void {
  app.get("/api/customers/:id", isAuthenticated, withCustomerId, async (req, res) => {
    try {
      const customer = await storage.getCustomer(req.params.id);
      if (!customer) {
        return res.status(404).json({ error: "Customer not found." });
      }

      // Verify user has access to this customer's store
      if (!await verifyRecordStoreAccess(req, customer.storeId)) {
        return res.status(403).json({ error: "You don't have access to this customer." });
      }

      res.json(customer);
    } catch (error) {
      res.status(500).json({ error: "We couldn't load customer information. Please try again." });
    }
  });
}
