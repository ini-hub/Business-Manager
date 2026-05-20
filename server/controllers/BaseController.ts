import { Router, Request, Response } from "express";
import { storage } from "../storage";

export abstract class BaseController {
  /**
   * Register routes belonging to this controller on the Express router
   */
  public abstract register(router: Router): void;

  protected ok(res: Response, data?: any): Response {
    if (data !== undefined) {
      return res.status(200).json(data);
    }
    return res.sendStatus(200);
  }

  protected created(res: Response, data?: any): Response {
    if (data !== undefined) {
      return res.status(201).json(data);
    }
    return res.sendStatus(201);
  }

  protected badRequest(res: Response, message: string): Response {
    return res.status(400).json({ error: message });
  }

  protected unauthorized(res: Response, message: string): Response {
    return res.status(401).json({ error: message });
  }

  protected forbidden(res: Response, message: string): Response {
    return res.status(403).json({ error: message });
  }

  protected notFound(res: Response, message: string): Response {
    return res.status(404).json({ error: message });
  }

  protected error(res: Response, message: string): Response {
    return res.status(500).json({ error: message });
  }

  protected async checkStoreAccess(storeId: string, req: Request, res: Response): Promise<boolean> {
    const userId = (req as any).user?.userId || (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ error: "Authentication required." });
      return false;
    }
    const store = await storage.getStore(storeId);
    if (!store) {
      res.status(404).json({ error: "Store not found." });
      return false;
    }

    const member = await storage.getOrganisationMember(userId, store.businessId);
    if (!member) {
      res.status(403).json({ error: "Unauthorized access to store data." });
      return false;
    }
    return true;
  }

  protected async verifyStoreAccess(req: any, storeId: string): Promise<boolean> {
    const user = req.user;
    if (!user?.businessId) return false;

    const store = await storage.getStore(storeId);
    if (!store) return false;

    return store.businessId === user.businessId;
  }
}
