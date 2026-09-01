import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { ConsumablesRepository, RecipeValidationError } from "../repositories/ConsumablesRepository";
import { sanitizeNumber } from "../sanitize";
import { auditLogger } from "../audit";
import { getUserId, verifyRecordStoreAccess, broadcastChange } from "./helpers";
import { withInventoryId } from "../utils/slug-resolver";
import { db } from "../db";
import { orders } from "@shared/schema";
import { eq } from "drizzle-orm";
import { getStoreTimezone } from "../lib/dateUtils";
import { switchCostingMode, localDateString } from "../services/SupplyCostingService";

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

  // What the last stock count says this supply's rates SHOULD be.
  app.get("/api/inventory/:id/calibration", requireManagerOrOwner, withInventoryId, async (req, res) => {
    try {
      const item = await storage.getInventoryItem(req.params.id);
      if (!item) return res.status(404).json({ error: "Item not found." });
      if (!(await verifyRecordStoreAccess(req, item.storeId))) {
        return res.status(403).json({ error: "You don't have access to this inventory item." });
      }
      res.json(await consumablesRepo.getCalibrationForSupply(item.id));
    } catch {
      res.status(500).json({ error: "Could not work out a measured rate." });
    }
  });

  // Adopt the measured rates.
  app.post("/api/inventory/:id/calibration/apply", requireManagerOrOwner, withInventoryId, async (req, res) => {
    try {
      const item = await storage.getInventoryItem(req.params.id);
      if (!item) return res.status(404).json({ error: "Item not found." });
      if (!(await verifyRecordStoreAccess(req, item.storeId))) {
        return res.status(403).json({ error: "You don't have access to this inventory item." });
      }
      const result = await consumablesRepo.applyCalibration(item.id);
      auditLogger.logDataModification("service_consumables", item.id, getUserId(req), "UPDATE", true);
      broadcastChange(req, "inventory", item.storeId, "updated");
      res.json(result);
    } catch {
      res.status(500).json({ error: "Could not apply the measured rate." });
    }
  });

  // Which services meter this supply — drives the "remove these first" warning.
  app.get("/api/inventory/:id/consumables/used-by", isAuthenticated, withInventoryId, async (req, res) => {
    try {
      const item = await storage.getInventoryItem(req.params.id);
      if (!item) return res.status(404).json({ error: "Item not found." });
      if (!(await verifyRecordStoreAccess(req, item.storeId))) {
        return res.status(403).json({ error: "You don't have access to this inventory item." });
      }
      res.json(await consumablesRepo.getRecipesUsingSupply(item.id));
    } catch {
      res.status(500).json({ error: "Could not load recipe usage." });
    }
  });

  // Switch a supply between 'expensed' and 'metered', truing up stock on hand.
  app.patch("/api/inventory/:id/costing-mode", requireManagerOrOwner, withInventoryId, async (req, res) => {
    try {
      const item = await storage.getInventoryItem(req.params.id);
      if (!item) return res.status(404).json({ error: "Item not found." });
      if (!(await verifyRecordStoreAccess(req, item.storeId))) {
        return res.status(403).json({ error: "You don't have access to this inventory item." });
      }
      if (item.type !== "supply") {
        return res.status(400).json({ error: "Only supplies have a costing mode." });
      }

      const mode = String(req.body.costingMode || "");
      if (mode !== "expensed" && mode !== "metered") {
        return res.status(400).json({ error: "Costing mode must be 'expensed' or 'metered'." });
      }

      // Going back to 'expensed' while recipes still point at this supply would
      // leave those recipes releasing cost that is now charged on purchase.
      if (mode === "expensed") {
        const users = await consumablesRepo.getRecipesUsingSupply(item.id);
        if (users.length > 0) {
          return res.status(400).json({
            error:
              `${users.length} service${users.length === 1 ? "" : "s"} still meter this supply ` +
              `(${users.map((u) => u.itemName).join(", ")}). Remove those recipe lines first, ` +
              `or the cost would be counted twice.`,
          });
        }
      }

      const tz = await getStoreTimezone(item.storeId);
      const result = await db.transaction(async (tx) =>
        switchCostingMode(tx, { storeId: item.storeId, item, to: mode, date: localDateString(tz) }),
      );

      auditLogger.logDataModification("inventory", item.id, getUserId(req), "UPDATE", true);
      broadcastChange(req, "inventory", item.storeId, "updated");
      broadcastChange(req, "expense", item.storeId, "updated");
      res.json({
        costingMode: mode,
        adjustment: result.adjustment,
        message:
          result.adjustment === 0
            ? "Costing mode updated."
            : result.adjustment > 0
            ? `Costing mode updated. Stock on hand worth ${result.adjustment} was charged to Direct Supplies.`
            : `Costing mode updated. Stock on hand worth ${Math.abs(result.adjustment)} was credited back and is now an asset.`,
      });
    } catch (error) {
      res.status(500).json({ error: "Could not change the costing mode." });
    }
  });

  // Log that a supply was used delivering an already-sold service — off the
  // automatic recipe, and never through the checkout/addendum cart-item path,
  // which exists to price a SALE and rejects supplies outright. This writes
  // straight to the consumption ledger those paths also write to.
  app.post("/api/orders/:orderId/consumables", isAuthenticated, async (req, res) => {
    try {
      const { orderId } = req.params;
      const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
      if (!order) return res.status(404).json({ error: "That sale no longer exists." });
      if (!(await verifyRecordStoreAccess(req, order.storeId))) {
        return res.status(403).json({ error: "You don't have access to this sale." });
      }

      const supplyInventoryId = String(req.body.supplyInventoryId || "");
      const quantityUsed = sanitizeNumber(req.body.quantityUsed);
      if (!supplyInventoryId) return res.status(400).json({ error: "Pick a supply." });

      const { row } = await consumablesRepo.logManualUsage({
        storeId: order.storeId,
        orderId,
        supplyInventoryId,
        quantityUsed,
      });

      auditLogger.logDataModification("order_consumables", row.id, getUserId(req), "UPDATE", true);
      broadcastChange(req, "inventory", order.storeId, "updated");
      res.json({ row });
    } catch (error) {
      if (error instanceof RecipeValidationError) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: "Could not log the supply usage." });
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
