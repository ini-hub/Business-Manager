import { db } from "../db";
import {
  serviceConsumables,
  inventory,
  bundleComponents,
  stockAudits,
  stockAuditItems,
  inventoryRestockEvents,
  orders,
  checkouts,
  type ServiceConsumable,
} from "@shared/schema";
import { eq, and, inArray, desc, gt, lte, sql } from "drizzle-orm";
import { isMeteredSupply } from "../services/SupplyCostingService";
import { deriveCalibration } from "../services/ConsumablesService";

export type RecipeRow = ServiceConsumable & {
  supplyName: string;
  supplyUnit: string | null;
  supplyCostPrice: number;
  supplyQuantity: number;
  /** quantityPerUnit x supplyCostPrice — the cost this line adds per unit sold. */
  costPerUnit: number;
};

/** Thrown for rule violations the caller should surface as a 400. */
export class RecipeValidationError extends Error {}

export class ConsumablesRepository {
  /** Active and inactive recipe lines for one consuming item, with supply detail. */
  async getRecipeForItem(inventoryId: string): Promise<RecipeRow[]> {
    const rows = await db
      .select({ recipe: serviceConsumables, supply: inventory })
      .from(serviceConsumables)
      .innerJoin(inventory, eq(serviceConsumables.supplyInventoryId, inventory.id))
      .where(eq(serviceConsumables.inventoryId, inventoryId));

    return rows.map((r) => ({
      ...r.recipe,
      supplyName: r.supply.name,
      supplyUnit: r.supply.unit,
      supplyCostPrice: Number(r.supply.costPrice),
      supplyQuantity: Number(r.supply.quantity),
      costPerUnit:
        Math.round((Number(r.recipe.quantityPerUnit) * Number(r.supply.costPrice) + Number.EPSILON) * 100) / 100,
    }));
  }

  /**
   * Active recipes for many consuming items at once, shaped for
   * `expandConsumables`. One query — checkout calls this on every sale.
   */
  async getActiveRecipes(
    inventoryIds: string[],
  ): Promise<Map<string, { supplyInventoryId: string; quantityPerUnit: number }[]>> {
    const out = new Map<string, { supplyInventoryId: string; quantityPerUnit: number }[]>();
    if (inventoryIds.length === 0) return out;

    const rows = await db
      .select({
        inventoryId: serviceConsumables.inventoryId,
        supplyInventoryId: serviceConsumables.supplyInventoryId,
        quantityPerUnit: serviceConsumables.quantityPerUnit,
      })
      .from(serviceConsumables)
      .where(and(
        inArray(serviceConsumables.inventoryId, inventoryIds),
        eq(serviceConsumables.isActive, true),
      ));

    for (const r of rows) {
      const list = out.get(r.inventoryId) ?? [];
      list.push({ supplyInventoryId: r.supplyInventoryId, quantityPerUnit: Number(r.quantityPerUnit) });
      out.set(r.inventoryId, list);
    }
    return out;
  }

  /**
   * Validates a proposed recipe line. Every rule here exists to keep a cost from
   * being counted twice or from crossing a tenant boundary.
   */
  private async validate(storeId: string, inventoryId: string, supplyInventoryId: string, quantityPerUnit: number) {
    if (inventoryId === supplyInventoryId) {
      throw new RecipeValidationError("An item cannot consume itself.");
    }
    if (!(quantityPerUnit >= 0.0001)) {
      // Stock is numeric(14,4), so this is the smallest amount that can actually
      // move stock. Anything below it would accrue cost against a quantity that
      // never changes.
      throw new RecipeValidationError(
        "That amount is too small to track — the smallest is 0.0001 per service. " +
        "If one container covers more than 10,000 services, charge it on purchase instead of metering it.",
      );
    }

    const rows = await db.select().from(inventory)
      .where(inArray(inventory.id, [inventoryId, supplyInventoryId]));
    const consumer = rows.find((r) => r.id === inventoryId);
    const supply = rows.find((r) => r.id === supplyInventoryId);

    if (!consumer) throw new RecipeValidationError("The item this recipe belongs to no longer exists.");
    if (!supply) throw new RecipeValidationError("That supply no longer exists.");
    if (consumer.storeId !== storeId || supply.storeId !== storeId) {
      throw new RecipeValidationError("The item and the supply must belong to the same store.");
    }
    if (supply.type !== "supply") {
      throw new RecipeValidationError(`"${supply.name}" is not a supply. Only back-bar supplies can be consumed by a recipe.`);
    }
    // The two costing modes are mutually exclusive. An `expensed` supply has
    // already been charged to the P&L on purchase, so releasing it again through a
    // recipe would count the same naira twice.
    if (!isMeteredSupply(supply)) {
      throw new RecipeValidationError(
        `"${supply.name}" is charged when you buy it, so it can't also be metered per service — that would count the cost twice. ` +
        `Switch it to "metered" on the supply first if you want to track usage.`,
      );
    }
    if (consumer.type === "supply") {
      throw new RecipeValidationError("A supply cannot have a recipe of its own.");
    }
    if (consumer.type !== "service") {
      throw new RecipeValidationError("Only services can have a consumables recipe.");
    }

    // A bundle explodes into its components at checkout and only the sold item's
    // recipe is expanded, so a recipe on a component would never fire. Refuse it
    // rather than let it look like it works.
    const [isComponent] = await db.select({ id: bundleComponents.id })
      .from(bundleComponents)
      .where(eq(bundleComponents.componentInventoryId, inventoryId))
      .limit(1);
    if (isComponent) {
      throw new RecipeValidationError("This item is part of a bundle. Add the recipe to the bundle itself instead.");
    }

    return { consumer, supply };
  }

  /**
   * Creates or updates a recipe line. Returns the row plus a warning when the
   * service still carries a fixed cost price: that cost and the recipe would both
   * be charged, counting the consumables twice.
   */
  async upsertRecipeLine(input: {
    storeId: string;
    inventoryId: string;
    supplyInventoryId: string;
    quantityPerUnit: number;
    isActive?: boolean;
  }): Promise<{ row: ServiceConsumable; warning: string | null }> {
    const { consumer } = await this.validate(
      input.storeId, input.inventoryId, input.supplyInventoryId, input.quantityPerUnit,
    );

    const [row] = await db
      .insert(serviceConsumables)
      .values({
        storeId: input.storeId,
        inventoryId: input.inventoryId,
        supplyInventoryId: input.supplyInventoryId,
        quantityPerUnit: input.quantityPerUnit,
        isActive: input.isActive ?? true,
      })
      .onConflictDoUpdate({
        target: [serviceConsumables.inventoryId, serviceConsumables.supplyInventoryId],
        set: {
          quantityPerUnit: input.quantityPerUnit,
          isActive: input.isActive ?? true,
          updatedAt: new Date(),
        },
      })
      .returning();

    const warning = Number(consumer.costPrice) > 0
      ? `"${consumer.name}" still has a fixed cost of ${Number(consumer.costPrice)}. If that figure already covers these consumables they will be counted twice — set it to zero, or keep it only for costs the recipe does not cover.`
      : null;

    return { row, warning };
  }

  /** Every item whose active recipe draws on this supply. */
  async getRecipesUsingSupply(supplyInventoryId: string): Promise<{ id: string; itemName: string }[]> {
    const rows = await db
      .select({ id: serviceConsumables.id, itemName: inventory.name })
      .from(serviceConsumables)
      .innerJoin(inventory, eq(serviceConsumables.inventoryId, inventory.id))
      .where(and(
        eq(serviceConsumables.supplyInventoryId, supplyInventoryId),
        eq(serviceConsumables.isActive, true),
      ));
    return rows;
  }

  async deleteRecipeLine(id: string, storeId: string): Promise<boolean> {
    const result = await db
      .delete(serviceConsumables)
      .where(and(eq(serviceConsumables.id, id), eq(serviceConsumables.storeId, storeId)))
      .returning({ id: serviceConsumables.id });
    return result.length > 0;
  }

  /**
   * Works out what a supply's recipe rates should have been, from its last stock
   * count — so an owner who never measured anything still ends up with a real
   * number.
   *
   * The window runs from the previous approved count to the latest one, because
   * those are the only two moments the true stock level is known:
   *
   *     actually consumed = opening (previous count) + purchases − closing (this count)
   *
   * Everything in between is inference. `deriveCalibration` turns that into a
   * single scale factor applied across the supply's recipes.
   */
  async getCalibrationForSupply(supplyInventoryId: string) {
    const [supply] = await db.select().from(inventory).where(eq(inventory.id, supplyInventoryId));
    if (!supply) return null;

    // The two most recent approved counts that included this supply.
    const counts = await db
      .select({
        approvedAt: stockAudits.approvedAt,
        physicalQuantity: stockAuditItems.physicalQuantity,
      })
      .from(stockAuditItems)
      .innerJoin(stockAudits, eq(stockAuditItems.auditId, stockAudits.id))
      .where(and(
        eq(stockAuditItems.inventoryId, supplyInventoryId),
        eq(stockAudits.status, "approved"),
      ))
      .orderBy(desc(stockAudits.approvedAt))
      .limit(2);

    if (counts.length === 0 || !counts[0].approvedAt) {
      return { supply, canCalibrate: false as const, reason: "This supply has never been counted." };
    }

    const latest = counts[0];
    const previous = counts[1];
    const windowEnd = latest.approvedAt!;
    // With only one count there is no opening figure, so the window starts at the
    // beginning of time and opening is treated as zero — which is right for a
    // supply that was created empty and restocked.
    const windowStart = previous?.approvedAt ?? new Date(0);
    const opening = previous ? Number(previous.physicalQuantity) : 0;
    const closing = Number(latest.physicalQuantity);

    const [purchaseRow] = await db
      .select({ total: sql<string>`COALESCE(SUM(${inventoryRestockEvents.quantityAdded}), 0)` })
      .from(inventoryRestockEvents)
      .where(and(
        eq(inventoryRestockEvents.inventoryId, supplyInventoryId),
        gt(inventoryRestockEvents.restockedAt, windowStart),
        lte(inventoryRestockEvents.restockedAt, windowEnd),
      ));
    const purchases = Number(purchaseRow?.total ?? 0);

    const actualConsumed = opening + purchases - closing;

    // Active recipes on this supply, with how much each consuming item sold in the
    // window. Net of returns, and excluding voided sales — the same basis the
    // consumption ledger uses.
    const recipeRows = await db
      .select({
        id: serviceConsumables.id,
        inventoryId: serviceConsumables.inventoryId,
        itemName: inventory.name,
        quantityPerUnit: serviceConsumables.quantityPerUnit,
      })
      .from(serviceConsumables)
      .innerJoin(inventory, eq(serviceConsumables.inventoryId, inventory.id))
      .where(and(
        eq(serviceConsumables.supplyInventoryId, supplyInventoryId),
        eq(serviceConsumables.isActive, true),
      ));

    const recipes = [];
    for (const r of recipeRows) {
      const [sold] = await db
        .select({ qty: sql<string>`COALESCE(SUM(GREATEST(${orders.quantity} - ${orders.returnedQuantity}, 0)), 0)` })
        .from(orders)
        .innerJoin(checkouts, eq(checkouts.orderId, orders.id))
        .where(and(
          eq(orders.inventoryId, r.inventoryId),
          eq(checkouts.paymentStatus, "completed"),
          eq(checkouts.isVoided, false),
          gt(checkouts.createdAt, windowStart),
          lte(checkouts.createdAt, windowEnd),
        ));
      recipes.push({
        id: r.id,
        itemName: r.itemName,
        quantityPerUnit: Number(r.quantityPerUnit),
        servicesSold: Number(sold?.qty ?? 0),
      });
    }

    const calibration = deriveCalibration({ actualConsumed, recipes });

    return {
      supply,
      canCalibrate: calibration.factor !== null,
      window: { from: windowStart, to: windowEnd },
      opening,
      purchases,
      closing,
      ...calibration,
    };
  }

  /** Applies a calibration's suggested rates. Each line is validated as usual. */
  async applyCalibration(supplyInventoryId: string): Promise<{ applied: number }> {
    const result = await this.getCalibrationForSupply(supplyInventoryId);
    if (!result || !result.canCalibrate || !("updates" in result)) return { applied: 0 };

    let applied = 0;
    for (const u of result.updates) {
      if (u.to === u.from) continue;
      await db
        .update(serviceConsumables)
        .set({ quantityPerUnit: u.to, updatedAt: new Date() })
        .where(eq(serviceConsumables.id, u.id));
      applied++;
    }
    return { applied };
  }

  /** Services carrying BOTH a fixed cost price and an active recipe — the
   *  double-count risk, surfaced as a report. Asserted as invariant I6. */
  async findDoubleCountedServices(storeId: string) {
    const rows = await db
      .selectDistinct({
        id: inventory.id,
        name: inventory.name,
        costPrice: inventory.costPrice,
      })
      .from(inventory)
      .innerJoin(serviceConsumables, eq(serviceConsumables.inventoryId, inventory.id))
      .where(and(
        eq(inventory.storeId, storeId),
        eq(inventory.type, "service"),
        eq(serviceConsumables.isActive, true),
      ));
    return rows.filter((r) => Number(r.costPrice) > 0);
  }
}
