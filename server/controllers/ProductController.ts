import { Router, Request, Response } from "express";
import { BaseController } from "./BaseController";
import { storage } from "../storage";
import { isAuthenticated } from "../auth";
import { insertProductSchema, insertInventorySchema } from "@shared/schema";
import { z } from "zod";
import { withProductId } from "../utils/slug-resolver";
import { toTitleCase, sanitizeString } from "../sanitize";

export class ProductController extends BaseController {
  public register(router: Router): void {
    router.get("/products", isAuthenticated, this.getProducts.bind(this));
    router.get("/products/archived", isAuthenticated, this.getArchivedProducts.bind(this));
    router.get("/products/:id", isAuthenticated, withProductId, this.getProduct.bind(this));
    router.post("/products", isAuthenticated, this.createProduct.bind(this));
    router.patch("/products/:id", isAuthenticated, withProductId, this.updateProduct.bind(this));
    router.delete("/products/:id", isAuthenticated, withProductId, this.deleteProduct.bind(this));
    router.post("/products/:id/variants", isAuthenticated, withProductId, this.createVariant.bind(this));
    router.post("/products/:id/restore", isAuthenticated, withProductId, this.restoreProduct.bind(this));
  }

  private isManagerOrOwner(req: Request): boolean {
    const role = (req as any).user?.role;
    return role === "owner" || role === "manager";
  }

  private async getProducts(req: Request, res: Response): Promise<Response> {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) {
        return this.badRequest(res, "Please select a store first.");
      }

      const page = parseInt(req.query.page as string) || 0;
      const limit = parseInt(req.query.limit as string) || 0;

      if (storeId === "all") {
        const stores = await this.getUserStores(req);
        if (stores.length === 0) {
          return this.ok(res, page > 0 && limit > 0 ? { items: [], total: 0, pages: 0 } : []);
        }

        const responses = await Promise.all(
          stores.map(async (s) => {
            const list = await storage.getProducts(s.id);
            return list.map((item) => ({ ...item, storeName: s.name }));
          })
        );
        let merged = responses.flat();

        if (page > 0 && limit > 0) {
          const search = req.query.search as string;
          if (search) {
            const sLower = search.toLowerCase();
            merged = merged.filter((item) => String(item.name || "").toLowerCase().includes(sLower));
          }
          const start = (page - 1) * limit;
          const paginated = merged.slice(start, start + limit);
          return this.ok(res, {
            items: paginated,
            total: merged.length,
            pages: Math.ceil(merged.length / limit),
          });
        }
        return this.ok(res, merged);
      }

      if (!(await this.checkStoreAccess(storeId, req, res))) return res;

      if (page > 0 && limit > 0) {
        const search = req.query.search as string;
        const result = await storage.getProductsPaginated(storeId, { page, limit, search });
        return this.ok(res, result);
      }

      const items = await storage.getProducts(storeId);
      return this.ok(res, items);
    } catch (error: any) {
      return this.error(res, "We couldn't load your products. Please try again.");
    }
  }

  private async getProduct(req: Request, res: Response): Promise<Response> {
    try {
      const product = await storage.getProduct(req.params.id);
      if (!product) {
        return this.notFound(res, "Product not found.");
      }

      if (!(await this.verifyStoreAccess(req, product.storeId))) {
        return this.forbidden(res, "You don't have access to this product.");
      }

      return this.ok(res, product);
    } catch (error: any) {
      return this.error(res, "We couldn't load product information. Please try again.");
    }
  }

  private async createProduct(req: Request, res: Response): Promise<Response> {
    try {
      if (!this.isManagerOrOwner(req)) {
        return this.forbidden(res, "Only managers or owners can create products.");
      }

      const data = insertProductSchema.parse(req.body);
      data.name = toTitleCase(sanitizeString(data.name));

      if (!(await this.checkStoreAccess(data.storeId, req, res))) return res;

      // Check active items first
      const existing = await storage.getProductByName(data.storeId, data.name);
      if (existing) {
        return this.conflict(res, `An item named "${data.name}" already exists.`);
      }

      // Check archived items — unique constraint still applies to soft-deleted records
      const archived = (await storage.getArchivedProducts(data.storeId))
        .find((p: any) => p.name.toLowerCase() === data.name.toLowerCase());
      if (archived) {
        return this.conflict(res, `archived:An item named "${data.name}" is currently archived.`);
      }

      const product = await storage.createProduct(data);
      return this.created(res, product);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return this.badRequest(res, error.errors.map(e => e.message).join(". "));
      }
      return this.error(res, "We couldn't create the product. Please try again.");
    }
  }

  private async updateProduct(req: Request, res: Response): Promise<Response> {
    try {
      if (!this.isManagerOrOwner(req)) {
        return this.forbidden(res, "Only managers or owners can update products.");
      }

      const product = await storage.getProduct(req.params.id);
      if (!product) {
        return this.notFound(res, "Product not found.");
      }

      if (!(await this.verifyStoreAccess(req, product.storeId))) {
        return this.forbidden(res, "You don't have access to this product.");
      }

      const data = insertProductSchema.partial().parse(req.body);
      if (data.name) data.name = toTitleCase(sanitizeString(data.name));

      if (data.name && data.name.toLowerCase().trim() !== product.name.toLowerCase().trim()) {
        const existing = await storage.getProductByName(product.storeId, data.name);
        if (existing) {
          return this.conflict(res, `An item named "${data.name}" already exists.`);
        }
      }

      const updated = await storage.updateProduct(req.params.id, data);
      return this.ok(res, updated);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return this.badRequest(res, error.errors.map(e => e.message).join(". "));
      }
      return this.error(res, "We couldn't update the product. Please try again.");
    }
  }

  private async deleteProduct(req: Request, res: Response): Promise<Response> {
    try {
      if (!this.isManagerOrOwner(req)) {
        return this.forbidden(res, "Only managers or owners can delete products.");
      }

      const product = await storage.getProduct(req.params.id);
      if (!product) {
        return this.notFound(res, "Product not found.");
      }

      if (!(await this.verifyStoreAccess(req, product.storeId))) {
        return this.forbidden(res, "You don't have access to this product.");
      }

      // Check if any variant has transactions
      let hasSales = false;
      for (const variant of product.variants || []) {
        if (await storage.hasInventoryTransactions(variant.id)) {
          hasSales = true;
          break;
        }
      }

      if (hasSales) {
        return this.badRequest(
          res,
          "Cannot delete product with existing sales records. Some variants have sales history that must be preserved."
        );
      }

      await storage.deleteProduct(req.params.id);
      return res.sendStatus(204);
    } catch (error: any) {
      return this.error(res, "We couldn't delete the product. Please try again.");
    }
  }

  private async getArchivedProducts(req: Request, res: Response): Promise<Response> {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) return this.badRequest(res, "Please select a store first.");
      if (!(await this.checkStoreAccess(storeId, req, res))) return res;
      const items = await storage.getArchivedProducts(storeId);
      return this.ok(res, items);
    } catch {
      return this.error(res, "We couldn't load archived items. Please try again.");
    }
  }

  private async restoreProduct(req: Request, res: Response): Promise<Response> {
    try {
      if (!this.isManagerOrOwner(req)) {
        return this.forbidden(res, "Only managers or owners can restore items.");
      }
      const product = await storage.getProductByIdRaw(req.params.id);
      if (!product) return this.notFound(res, "Item not found.");
      if (!(await this.verifyStoreAccess(req, product.storeId))) {
        return this.forbidden(res, "You don't have access to this item.");
      }
      await storage.restoreProduct(req.params.id);
      return this.ok(res, { success: true });
    } catch {
      return this.error(res, "We couldn't restore this item. Please try again.");
    }
  }

  private async createVariant(req: Request, res: Response): Promise<Response> {
    try {
      if (!this.isManagerOrOwner(req)) {
        return this.forbidden(res, "Only managers or owners can create variants.");
      }

      const product = await storage.getProduct(req.params.id);
      if (!product) {
        return this.notFound(res, "Product not found.");
      }

      if (!(await this.verifyStoreAccess(req, product.storeId))) {
        return this.forbidden(res, "You don't have access to this product.");
      }

      const sanitizedBody = {
        ...req.body,
        storeId: product.storeId,
        productId: product.id,
        type: product.type,
        name: toTitleCase(sanitizeString(req.body.name)),
      };

      const data = insertInventorySchema.parse(sanitizedBody);

      const existing = await storage.getInventoryItemByName(product.storeId, data.name);
      if (existing) {
        return this.conflict(res, `Variant name "${data.name}" already exists.`);
      }

      const variant = await storage.createInventoryItem(data);
      return this.created(res, variant);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return this.badRequest(res, error.errors.map(e => e.message).join(". "));
      }
      return this.error(res, "We couldn't create the variant. Please try again.");
    }
  }
}
