import { Router, Request, Response } from "express";
import { BaseController } from "./BaseController";
import { storage } from "../storage";
import { isAuthenticated } from "../auth";
import { insertProductSchema, insertInventorySchema } from "@shared/schema";
import { MAX_VARIANTS_PER_PRODUCT } from "@shared/constants";
import { z } from "zod";
import { withProductId } from "../utils/slug-resolver";
import { toTitleCase, sanitizeString } from "../sanitize";
import { broadcastChange } from "../routes/helpers";
import { requireFeature } from "../lib/entitlements";

/** Quick-pick strip defaults. 30 days keeps the ranking current enough to follow
 *  a seasonal swing without a slow week emptying the strip. */
const TOP_SELLER_DEFAULT_DAYS = 30;
const TOP_SELLER_DEFAULT_LIMIT = 8;
const TOP_SELLER_MAX_LIMIT = 24;

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export class ProductController extends BaseController {
  public register(router: Router): void {
    router.get("/products", isAuthenticated, this.getProducts.bind(this));
    router.get("/products/archived", isAuthenticated, this.getArchivedProducts.bind(this));
    // Before /products/:id, or the slug resolver swallows "top-sellers" as an id.
    router.get("/products/top-sellers", isAuthenticated, this.getTopSellers.bind(this));
    router.get("/products/:id", isAuthenticated, withProductId, this.getProduct.bind(this));
    router.post("/products", isAuthenticated, this.createProduct.bind(this));
    router.patch("/products/:id", isAuthenticated, withProductId, this.updateProduct.bind(this));
    router.delete("/products/:id", isAuthenticated, withProductId, this.deleteProduct.bind(this));
    router.post("/products/:id/variants", isAuthenticated, withProductId, requireFeature("product_variants"), this.createVariant.bind(this));
    router.post("/products/:id/restore", isAuthenticated, withProductId, this.restoreProduct.bind(this));
    router.delete("/products/:id/permanent", isAuthenticated, withProductId, this.permanentDeleteProduct.bind(this));
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

  /** Best-selling product-group ids for the POS quick-pick strip, ranked first.
   *  Ids only — the POS already holds the full product list, so shipping names
   *  and prices again would just be a second copy to keep in sync. */
  private async getTopSellers(req: Request, res: Response): Promise<Response> {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) {
        return this.badRequest(res, "Please select a store first.");
      }
      // "All stores" has no single till to speed up, and merging ranks across
      // stores would recommend items the current one may not even carry.
      if (storeId === "all") return this.ok(res, []);
      if (!(await this.checkStoreAccess(storeId, req, res))) return res;

      const days = clampInt(req.query.days, TOP_SELLER_DEFAULT_DAYS, 1, 365);
      const limit = clampInt(req.query.limit, TOP_SELLER_DEFAULT_LIMIT, 1, TOP_SELLER_MAX_LIMIT);

      const ids = await storage.getTopSellingProductIds(storeId, days, limit);
      return this.ok(res, ids);
    } catch (error: any) {
      // A missing strip is a cosmetic loss, not a broken till — the full grid
      // below it still sells everything.
      return this.ok(res, []);
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
      broadcastChange(req, "inventory", product.storeId, "created");
      return this.created(res, product);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return this.badRequest(res, error.errors.map(e => e.message).join(". "));
      }
      console.error("[createProduct]", error);
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

      // Variant names are stored as independent "<product name> - <suffix>" strings
      // (see add-variants-sheet.tsx), not derived from the product name at render time.
      // Rename the prefix on existing variants so they don't keep the old product name.
      if (data.name && data.name !== product.name) {
        const oldPrefix = `${product.name} - `;
        for (const variant of product.variants || []) {
          if (variant.name.startsWith(oldPrefix)) {
            const suffix = variant.name.slice(oldPrefix.length);
            await storage.updateInventoryItem(variant.id, { name: `${data.name} - ${suffix}` });
          }
        }
      }

      broadcastChange(req, "inventory", product.storeId, "updated");
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
      broadcastChange(req, "inventory", product.storeId, "archived");
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
      broadcastChange(req, "inventory", product.storeId, "restored");
      return this.ok(res, { success: true });
    } catch {
      return this.error(res, "We couldn't restore this item. Please try again.");
    }
  }

  private async permanentDeleteProduct(req: Request, res: Response): Promise<Response> {
    try {
      if (!this.isManagerOrOwner(req)) {
        return this.forbidden(res, "Only managers or owners can permanently delete items.");
      }

      const product = await storage.getProductByIdRaw(req.params.id);
      if (!product) return this.notFound(res, "Product not found.");

      if (!(await this.verifyStoreAccess(req, product.storeId))) {
        return this.forbidden(res, "You don't have access to this product.");
      }

      // Block permanent deletion if any variant has sales history
      for (const variant of product.variants || []) {
        if (await storage.hasInventoryTransactions(variant.id)) {
          return this.badRequest(
            res,
            "Cannot permanently delete — this item has sales records that must be preserved for your reports."
          );
        }
      }

      await storage.hardDeleteProduct(req.params.id);
      broadcastChange(req, "inventory", product.storeId, "deleted");
      return res.sendStatus(204);
    } catch (error: any) {
      console.error("[permanentDeleteProduct]", error);
      return this.error(res, "We couldn't permanently delete this item. Please try again.");
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

      const existing = await storage.getInventoryItemByName(product.storeId, data.name, data.type);
      if (existing) {
        return this.conflict(res, `Variant name "${data.name}" already exists.`);
      }

      const existingCombo = await storage.getVariantByDimensions(product.id, data.variantDimensions as Record<string, string> | null | undefined);
      if (existingCombo) {
        return this.conflict(res, `A variant with this exact combination already exists: "${existingCombo.name}".`);
      }

      const variantCount = await storage.countVariants(product.id);
      if (variantCount >= MAX_VARIANTS_PER_PRODUCT) {
        return this.conflict(res, `This product already has the maximum of ${MAX_VARIANTS_PER_PRODUCT} variants.`);
      }

      const variant = await storage.createInventoryItem(data);
      broadcastChange(req, "inventory", product.storeId, "created");
      return this.created(res, variant);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return this.badRequest(res, error.errors.map(e => e.message).join(". "));
      }
      console.error("[createVariant]", error);
      return this.error(res, "We couldn't create the variant. Please try again.");
    }
  }
}
