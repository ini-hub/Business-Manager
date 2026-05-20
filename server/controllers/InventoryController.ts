import { Router, Request, Response } from "express";
import { BaseController } from "./BaseController";
import { storage } from "../storage";
import { isAuthenticated } from "../auth";

export class InventoryController extends BaseController {
  public register(router: Router): void {
    router.get("/inventory", isAuthenticated, this.getInventory.bind(this));
    router.get("/inventory/:id", isAuthenticated, this.getInventoryItem.bind(this));
  }

  private async getInventory(req: Request, res: Response): Promise<Response> {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) {
        return this.badRequest(res, "Please select a store first.");
      }
      if (!(await this.checkStoreAccess(storeId, req, res))) return res;

      // Support both paginated and non-paginated queries
      const page = parseInt(req.query.page as string) || 0;
      const limit = parseInt(req.query.limit as string) || 0;

      if (page > 0 && limit > 0) {
        const search = req.query.search as string;
        const result = await storage.getInventoryPaginated(storeId, { page, limit, search });
        return this.ok(res, result);
      }

      const items = await storage.getInventory(storeId);
      return this.ok(res, items);
    } catch (error) {
      return this.error(res, "We couldn't load your inventory. Please try again.");
    }
  }

  private async getInventoryItem(req: Request, res: Response): Promise<Response> {
    try {
      const item = await storage.getInventoryItem(req.params.id);
      if (!item) {
        return this.notFound(res, "Inventory item not found.");
      }

      // Verify user has access to this item's store
      if (!(await this.verifyStoreAccess(req, item.storeId))) {
        return this.forbidden(res, "You don't have access to this inventory item.");
      }

      return this.ok(res, item);
    } catch (error) {
      return this.error(res, "We couldn't load item information. Please try again.");
    }
  }
}
