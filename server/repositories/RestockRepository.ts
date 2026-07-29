import { db } from "../db";
import {
  inventory,
  inventoryRestockEvents,
  profitLoss,
  staff,
  users,
  type RestockEvent,
  type Staff,
  type User,
  type Inventory,
  type CostStrategy,
} from "@shared/schema";
import { eq, and, count, desc } from "drizzle-orm";
import type { PaginationOptions, PaginatedResult } from "../storage";
import { postSupplyPurchaseExpense, localDateString } from "../services/SupplyCostingService";
import { getStoreTimezone } from "../lib/dateUtils";

export class RestockRepository {
  async getRestockEvents(inventoryId: string): Promise<(RestockEvent & { staff: Staff | null; user: User | null })[]> {
    const events = await db.select({
      restockEvent: inventoryRestockEvents,
      staffMember: staff,
      userRecord: users,
    })
      .from(inventoryRestockEvents)
      .leftJoin(staff, eq(inventoryRestockEvents.staffId, staff.id))
      .leftJoin(users, eq(inventoryRestockEvents.userId, users.id))
      .where(eq(inventoryRestockEvents.inventoryId, inventoryId))
      .orderBy(desc(inventoryRestockEvents.restockedAt));

    return events.map(e => ({
      ...e.restockEvent,
      staff: e.staffMember,
      user: e.userRecord,
    }));
  }

  async getRestockEventsPaginated(inventoryId: string, options: PaginationOptions): Promise<PaginatedResult<RestockEvent & { staff: Staff | null; user: User | null }>> {
    const { page = 1, limit = 20 } = options;
    const offset = (page - 1) * limit;

    const [totalResult] = await db.select({ count: count() })
      .from(inventoryRestockEvents)
      .where(eq(inventoryRestockEvents.inventoryId, inventoryId));

    const total = totalResult?.count ?? 0;

    const events = await db.select({
      restockEvent: inventoryRestockEvents,
      staffMember: staff,
      userRecord: users,
    })
      .from(inventoryRestockEvents)
      .leftJoin(staff, eq(inventoryRestockEvents.staffId, staff.id))
      .leftJoin(users, eq(inventoryRestockEvents.userId, users.id))
      .where(eq(inventoryRestockEvents.inventoryId, inventoryId))
      .orderBy(desc(inventoryRestockEvents.restockedAt))
      .limit(limit)
      .offset(offset);

    const data = events.map(e => ({
      ...e.restockEvent,
      staff: e.staffMember,
      user: e.userRecord,
    }));

    return {
      data,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasMore: page * limit < total,
      },
    };
  }

  async createRestockEvent(data: {
    storeId: string;
    inventoryId: string;
    staffId?: string | null;
    userId?: string | null;
    quantityAdded: number;
    unitCost: number;
    costStrategy: CostStrategy;
    newSellingPrice?: number;
    notes?: string;
    reason?: string;
    attachment?: string | null;
  }): Promise<{ restockEvent: RestockEvent; updatedInventory: Inventory }> {
    const [currentInventory] = await db.select().from(inventory).where(eq(inventory.id, data.inventoryId));

    if (!currentInventory) throw new Error("Inventory item not found");

    const previousQuantity = currentInventory.quantity;
    const newQuantity = previousQuantity + data.quantityAdded;
    const previousCostPrice = currentInventory.costPrice;
    const previousSellingPrice = currentInventory.sellingPrice;

    let newCostPrice = previousCostPrice;

    switch (data.costStrategy) {
      case "keep":
        newCostPrice = previousCostPrice;
        break;
      case "last":
        newCostPrice = data.unitCost;
        break;
      case "weighted":
        const totalOldValue = previousQuantity * previousCostPrice;
        const totalNewValue = data.quantityAdded * data.unitCost;
        newCostPrice = newQuantity > 0 ? (totalOldValue + totalNewValue) / newQuantity : data.unitCost;
        break;
      case "override":
        newCostPrice = data.unitCost;
        break;
    }

    const newSellingPrice = data.newSellingPrice ?? previousSellingPrice;

    const result = await db.transaction(async (tx) => {
      const [updatedInventory] = await tx.update(inventory)
        .set({ quantity: newQuantity, costPrice: newCostPrice, sellingPrice: newSellingPrice })
        .where(eq(inventory.id, data.inventoryId))
        .returning();

      const [restockEvent] = await tx.insert(inventoryRestockEvents).values({
        storeId: data.storeId,
        inventoryId: data.inventoryId,
        staffId: data.staffId,
        userId: data.userId,
        quantityAdded: data.quantityAdded,
        previousQuantity,
        newQuantity,
        unitCost: data.unitCost,
        previousCostPrice,
        newCostPrice,
        previousSellingPrice,
        newSellingPrice,
        costStrategy: data.costStrategy,
        notes: data.notes,
        reason: data.reason || "Regular Restock",
        attachment: data.attachment || null,
      }).returning();

      const [existingPL] = await tx.select().from(profitLoss)
        .where(and(eq(profitLoss.inventoryId, data.inventoryId), eq(profitLoss.storeId, data.storeId)));

      if (existingPL) {
        await tx.update(profitLoss)
          .set({ quantityRemaining: newQuantity })
          .where(eq(profitLoss.id, existingPL.id));
      }

      // An `expensed` supply is charged to Direct Supplies the moment it is
      // bought, because nobody is going to meter it per service. A `metered` one
      // capitalises here exactly as products do and is released by its recipe —
      // doing both would count the same naira twice.
      //
      // Inside the transaction on purpose: if this insert fails, the restock that
      // caused it must roll back too, or a cost that should have been expensed is
      // silently capitalised instead.
      const tz = await getStoreTimezone(data.storeId);
      await postSupplyPurchaseExpense(tx, {
        storeId: data.storeId,
        item: currentInventory,
        quantityAdded: data.quantityAdded,
        unitCost: data.unitCost,
        date: localDateString(tz),
        reference: `restock of ${currentInventory.name}`,
      });

      return { restockEvent, updatedInventory };
    });

    return result;
  }
}
