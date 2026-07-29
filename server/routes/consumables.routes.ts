import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { ConsumablesRepository, RecipeValidationError } from "../repositories/ConsumablesRepository";
import { sanitizeNumber } from "../sanitize";
import { auditLogger } from "../audit";
import { getUserId, verifyRecordStoreAccess, broadcastChange } from "./helpers";
import { withInventoryId } from "../utils/slug-resolver";

const consumablesRepo = new ConsumablesRepository();

export type RouteMiddlewares = {
  isAuthenticated: any;
  requireRole: (...roles: any[]) => any;
  requireManagerOrOwner: any;
  checkStoreAccess: (storeId: string, req: Request, res: Response) => Promise<boolean>;
};

/**
 * Consumables recipes: which back-bar supplies an item burns per unit sold.
 *
 * These endpoints only describe intent. Nothing here moves stock or money — that
 * happens at checkout, where the recipe is expanded into order_consumables.
 */
export function registerConsumablesRoutes(app: Express, { isAuthenticated, requireManagerOrOwner }: RouteMiddlewares): void {
  // Recipe for one item, with supply names, stock and per-unit cost.
  app.get("/api/inventory/:id/consumables", isAuthenticated, withInventoryId, async (req, res) => {
    try {
      const item = await storage.getInventoryItem(req.params.id);
      if (!item) return res.status(404).json({ error: "Item not found." });
      if (!(await verifyRecordStoreAccess(req, item.storeId))) {
        return res.status(403).json({ error: "You don't have access to this inventory item." });
      }

      const recipe = await consumablesRepo.getRecipeForItem(item.id);
      const costPerUnit = recipe
        .filter((r) => r.isActive)
        .reduce((sum, r) => sum + r.costPerUnit, 0);

      res.json({
        inventoryId: item.id,
        itemName: item.name,
        itemType: item.type,
        fixedCostPrice: Number(item.costPrice),
        recipe,
        // What one unit of this service costs in supplies, before its fixed cost.
        consumableCostPerUnit: Math.round((costPerUnit + Number.EPSILON) * 100) / 100,
        // The double-count warning, computed here so every client shows it.
        fixedCostWarning: Number(item.costPrice) > 0 && recipe.some((r) => r.isActive)
          ? `This service has a fixed cost of ${Number(item.costPrice)} on top of its recipe. If that figure already covers these supplies, they are being counted twice.`
          : null,
      });
    } catch {
      res.status(500).json({ error: "Could not load the consumables recipe." });
    }
  });

  // Add or update a recipe line.
  app.put("/api/inventory/:id/consumables", requireManagerOrOwner, withInventoryId, async (req, res) => {
    try {
      const item = await storage.getInventoryItem(req.params.id);
      if (!item) return res.status(404).json({ error: "Item not found." });
      if (!(await verifyRecordStoreAccess(req, item.storeId))) {
        return res.status(403).json({ error: "You don't have access to this inventory item." });
      }

      const supplyInventoryId = String(req.body.supplyInventoryId || "");
      const quantityPerUnit = sanitizeNumber(req.body.quantityPerUnit);
      if (!supplyInventoryId) return res.status(400).json({ error: "Pick a supply." });

      const { row, warning } = await consumablesRepo.upsertRecipeLine({
        storeId: item.storeId,
        inventoryId: item.id,
        supplyInventoryId,
        quantityPerUnit,
        isActive: req.body.isActive !== false,
      });

      auditLogger.logDataModification("service_consumables", row.id, getUserId(req), "UPDATE", true);
      broadcastChange(req, "inventory", item.storeId, "updated");
      res.json({ recipeLine: row, warning });
    } catch (error) {
      if (error instanceof RecipeValidationError) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: "Could not save the recipe line." });
    }
  });

  // Remove a recipe line.
  app.delete("/api/inventory/:id/consumables/:lineId", requireManagerOrOwner, withInventoryId, async (req, res) => {
    try {
      const item = await storage.getInventoryItem(req.params.id);
      if (!item) return res.status(404).json({ error: "Item not found." });
      if (!(await verifyRecordStoreAccess(req, item.storeId))) {
        return res.status(403).json({ error: "You don't have access to this inventory item." });
      }

      const removed = await consumablesRepo.deleteRecipeLine(req.params.lineId, item.storeId);
      if (!removed) return res.status(404).json({ error: "That recipe line no longer exists." });

      auditLogger.logDataModification("service_consumables", req.params.lineId, getUserId(req), "DELETE", true);
      broadcastChange(req, "inventory", item.storeId, "updated");
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Could not remove the recipe line." });
    }
  });

  // Services charging their consumables twice: a fixed cost price AND a recipe.
  app.get("/api/reports/consumables-double-count", requireManagerOrOwner, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) return res.status(400).json({ error: "storeId required" });
      if (!(await verifyRecordStoreAccess(req, storeId))) {
        return res.status(403).json({ error: "You don't have access to this store." });
      }
      res.json(await consumablesRepo.findDoubleCountedServices(storeId));
    } catch {
      res.status(500).json({ error: "Could not run the double-count check." });
    }
  });
}
