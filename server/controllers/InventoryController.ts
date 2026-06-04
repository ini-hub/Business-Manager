import { Router, Request, Response } from "express";
import { BaseController } from "./BaseController";
import { storage } from "../storage";
import { isAuthenticated } from "../auth";
import { resolveInventoryId } from "../utils/slug-resolver";

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

      const page = parseInt(req.query.page as string) || 0;
      const limit = parseInt(req.query.limit as string) || 0;
      const search = req.query.search as string | undefined;

      if (storeId === "all") {
        const stores = await this.getUserStores(req);
        if (stores.length === 0) return this.ok(res, page > 0 && limit > 0 ? { items: [], total: 0, pages: 0 } : []);

        if (page > 0 && limit > 0) {
          // Single paginated DB query across all stores — no full-table load
          const storeIds = stores.map(s => s.id);
          const result = await storage.getInventoryForStores(storeIds, { page, limit, search });
          return this.ok(res, {
            items: result.data,
            total: result.pagination.total,
            pages: result.pagination.totalPages,
          });
        }

        // Non-paginated: still fetch per store but include store name
        const responses = await Promise.all(
          stores.map(async (s) => {
            const list = await storage.getInventory(s.id);
            return list.map(item => ({ ...item, storeName: s.name }));
          })
        );
        return this.ok(res, responses.flat());
      }

      if (!(await this.checkStoreAccess(storeId, req, res))) return res;

      if (page > 0 && limit > 0) {
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
      const resolvedId = await resolveInventoryId(req.params.id);
      if (!resolvedId) return this.notFound(res, "Inventory item not found.");
      const item = await storage.getInventoryItem(resolvedId);
      if (!item) {
        return this.notFound(res, "Inventory item not found.");
      }

      if (!(await this.verifyStoreAccess(req, item.storeId))) {
        return this.forbidden(res, "You don't have access to this inventory item.");
      }

      return this.ok(res, item);
    } catch (error) {
      return this.error(res, "We couldn't load item information. Please try again.");
    }
  }
}
