import { Router, Request, Response } from "express";
import { parsePage, paginated } from "../lib/pagination";
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

      // One page at a time (page 1 at the default size when none is asked for); screens that need the whole
      // list walk the pages (client/src/lib/paginated.ts).
      const pageReq = parsePage(req.query);
      const search = (req.query.search as string | undefined) || undefined;

      if (storeId === "all") {
        const stores = await this.getUserStores(req);
        if (stores.length === 0) return this.ok(res, paginated([], 0, pageReq));
        const names = new Map(stores.map((s) => [s.id, s.name]));
        const result = await storage.getInventoryForStores(stores.map((s) => s.id), { page: pageReq.page, limit: pageReq.limit, search });
        const data = result.data.map((item) => ({ ...item, storeName: names.get(item.storeId) }));
        return this.ok(res, paginated(data, result.pagination.total, pageReq));
      }

      if (!(await this.checkStoreAccess(storeId, req, res))) return res;
      const result = await storage.getInventoryPaginated(storeId, { page: pageReq.page, limit: pageReq.limit, search });
      return this.ok(res, paginated(result.data, result.pagination.total, pageReq));
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
