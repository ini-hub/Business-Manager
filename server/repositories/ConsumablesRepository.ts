import { db } from "../db";
import {
  serviceConsumables,
  inventory,
  bundleComponents,
  type ServiceConsumable,
} from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";

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
    if (!(quantityPerUnit >= 0.01)) {
      // Stock is numeric(12,2); anything smaller rounds to zero on deduction, so
      // stock would never move while cost accrued. Measure in ml/g/each instead.
      throw new RecipeValidationError("Quantity per unit must be at least 0.01. Measure the supply in a smaller unit (ml, g, each) if you need finer amounts.");
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

  async deleteRecipeLine(id: string, storeId: string): Promise<boolean> {
    const result = await db
      .delete(serviceConsumables)
      .where(and(eq(serviceConsumables.id, id), eq(serviceConsumables.storeId, storeId)))
      .returning({ id: serviceConsumables.id });
    return result.length > 0;
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
