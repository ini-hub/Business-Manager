import { BaseRepository } from "./BaseRepository";
import { db } from "../db";
import {
  stockTransfers,
  stockTransferItems,
  stores,
  inventory,
  products,
  inventoryRestockEvents,
  profitLoss,
  type StockTransfer,
  type InsertStockTransfer,
  type StockTransferItem,
  type InsertStockTransferItem,
  type Inventory,
  type Store,
} from "@shared/schema";
import { eq, and, or, desc, sql } from "drizzle-orm";

export class StockTransferRepository extends BaseRepository<typeof stockTransfers> {
  constructor() {
    super(stockTransfers);
  }

  async getStockTransfers(storeId: string): Promise<(StockTransfer & { fromStore: Store; toStore: Store })[]> {
    const rows = await db
      .select({
        transfer: stockTransfers,
        fromStore: stores,
      })
      .from(stockTransfers)
      .innerJoin(stores, eq(stockTransfers.fromStoreId, stores.id))
      .where(or(eq(stockTransfers.fromStoreId, storeId), eq(stockTransfers.toStoreId, storeId)))
      .orderBy(desc(stockTransfers.createdAt));

    // To load both stores properly, let's select from stores twice or map it cleanly
    const allStores = await db.select().from(stores);
    const storeMap = new Map(allStores.map(s => [s.id, s]));

    return rows.map(r => ({
      ...r.transfer,
      fromStore: storeMap.get(r.transfer.fromStoreId)!,
      toStore: storeMap.get(r.transfer.toStoreId)!,
    }));
  }

  async getStockTransfer(id: string): Promise<(StockTransfer & { fromStore: Store; toStore: Store; items: (StockTransferItem & { inventory: Inventory })[] }) | undefined> {
    const [transfer] = await db.select().from(stockTransfers).where(eq(stockTransfers.id, id));
    if (!transfer) return undefined;

    const [fromStore] = await db.select().from(stores).where(eq(stores.id, transfer.fromStoreId));
    const [toStore] = await db.select().from(stores).where(eq(stores.id, transfer.toStoreId));

    const itemRows = await db
      .select({
        item: stockTransferItems,
        inv: inventory,
      })
      .from(stockTransferItems)
      .innerJoin(inventory, eq(stockTransferItems.inventoryId, inventory.id))
      .where(eq(stockTransferItems.transferId, id));

    return {
      ...transfer,
      fromStore: fromStore!,
      toStore: toStore!,
      items: itemRows.map(ir => ({
        ...ir.item,
        inventory: ir.inv,
      })),
    };
  }

  async createStockTransfer(data: InsertStockTransfer & { items: { inventoryId: string; quantity: number }[] }): Promise<StockTransfer> {
    const { items, ...transferData } = data;

    return db.transaction(async (tx) => {
      const [newTransfer] = await tx
        .insert(stockTransfers)
        .values({
          ...transferData,
          status: "pending",
        })
        .returning();

      if (items.length > 0) {
        await tx.insert(stockTransferItems).values(
          items.map((item: { inventoryId: string; quantity: number }) => ({
            transferId: newTransfer.id,
            inventoryId: item.inventoryId,
            quantity: item.quantity,
          }))
        );
      }

      return newTransfer;
    });
  }

  async updateStockTransferStatus(id: string, status: string, approvedByUserId?: string | null): Promise<{ success: boolean; message: string; transfer?: StockTransfer }> {
    return db.transaction(async (tx) => {
      const [transfer] = await tx.select().from(stockTransfers).where(eq(stockTransfers.id, id));
      if (!transfer) return { success: false, message: "Transfer not found." };

      if (transfer.status === "completed") {
        return { success: false, message: "Transfer is already completed." };
      }

      if (status === "completed") {
        const transferItems = await tx
          .select({
            item: stockTransferItems,
            inv: inventory,
          })
          .from(stockTransferItems)
          .innerJoin(inventory, eq(stockTransferItems.inventoryId, inventory.id))
          .where(eq(stockTransferItems.transferId, id));

        // 1. Validate stock availability at source
        for (const line of transferItems) {
          // Supplies are transferable between branches like any other stock —
          // only services have no quantity to move.
          if (line.inv.type !== "service" && line.inv.quantity < line.item.quantity) {
            return {
              success: false,
              message: `Insufficient stock for item "${line.inv.name}" at source store. Available: ${line.inv.quantity}, Required: ${line.item.quantity}`,
            };
          }
        }

        // 2. Perform atomic movements
        for (const line of transferItems) {
          if (line.inv.type === "service") continue;

          // --- Source Deductions ---
          const sourcePrevQty = line.inv.quantity;
          const sourceNewQty = sourcePrevQty - line.item.quantity;

          await tx
            .update(inventory)
            .set({ quantity: sourceNewQty })
            .where(eq(inventory.id, line.inv.id));

          // Log Source Event
          await tx.insert(inventoryRestockEvents).values({
            storeId: transfer.fromStoreId,
            inventoryId: line.inv.id,
            userId: approvedByUserId || null,
            quantityAdded: -line.item.quantity,
            previousQuantity: sourcePrevQty,
            newQuantity: sourceNewQty,
            unitCost: line.inv.costPrice,
            previousCostPrice: line.inv.costPrice,
            newCostPrice: line.inv.costPrice,
            previousSellingPrice: line.inv.sellingPrice,
            newSellingPrice: line.inv.sellingPrice,
            costStrategy: "keep",
            notes: `Transferred OUT to Store #${transfer.toStoreId}`,
            reason: "Correction",
          });

          // Update Source Profit & Loss
          const [sourcePL] = await tx
            .select()
            .from(profitLoss)
            .where(and(eq(profitLoss.inventoryId, line.inv.id), eq(profitLoss.storeId, transfer.fromStoreId)));

          if (sourcePL) {
            await tx
              .update(profitLoss)
              .set({ quantityRemaining: sourceNewQty })
              .where(eq(profitLoss.id, sourcePL.id));
          }

          // --- Destination Additions ---
          // Look up if destination already has this item
          const [destItem] = await tx
            .select()
            .from(inventory)
            .where(and(eq(inventory.storeId, transfer.toStoreId), eq(inventory.name, line.inv.name)));

          let destInvId: string;
          let destPrevQty = 0;
          let destNewQty = line.item.quantity;

          if (destItem) {
            destInvId = destItem.id;
            destPrevQty = destItem.quantity;
            destNewQty = destPrevQty + line.item.quantity;

            // Update existing destination inventory
            await tx
              .update(inventory)
              .set({ quantity: destNewQty })
              .where(eq(inventory.id, destInvId));

            // Log Destination Event
            await tx.insert(inventoryRestockEvents).values({
              storeId: transfer.toStoreId,
              inventoryId: destInvId,
              userId: approvedByUserId || null,
              quantityAdded: line.item.quantity,
              previousQuantity: destPrevQty,
              newQuantity: destNewQty,
              unitCost: line.inv.costPrice,
              previousCostPrice: destItem.costPrice,
              newCostPrice: destItem.costPrice,
              previousSellingPrice: destItem.sellingPrice,
              newSellingPrice: destItem.sellingPrice,
              costStrategy: "keep",
              notes: `Transferred IN from Store #${transfer.fromStoreId}`,
              reason: "Regular Restock",
            });
          } else {
            // Create a product group + inventory item for the destination store
            const [newProduct] = await tx
              .insert(products)
              .values({
                storeId: transfer.toStoreId,
                name: line.inv.name,
                type: line.inv.type,
              })
              .onConflictDoNothing()
              .returning();
            // If product already exists for this store, look it up
            const destProduct = newProduct ?? await tx.query.products.findFirst({
              where: and(
                eq(products.storeId, transfer.toStoreId),
                sql`lower(${products.name}) = ${line.inv.name.toLowerCase()}`
              ),
            });

            const [newDestItem] = await tx
              .insert(inventory)
              .values({
                storeId: transfer.toStoreId,
                name: line.inv.name,
                type: line.inv.type,
                costPrice: line.inv.costPrice,
                sellingPrice: line.inv.sellingPrice,
                quantity: line.item.quantity,
                commissionSplitOverride: line.inv.commissionSplitOverride,
                commissionSplitBusinessShare: line.inv.commissionSplitBusinessShare,
                commissionSplitStaffShare: line.inv.commissionSplitStaffShare,
                productId: destProduct!.id,
              })
              .returning();

            destInvId = newDestItem.id;

            // Log Destination Event for new item
            await tx.insert(inventoryRestockEvents).values({
              storeId: transfer.toStoreId,
              inventoryId: destInvId,
              userId: approvedByUserId || null,
              quantityAdded: line.item.quantity,
              previousQuantity: 0,
              newQuantity: line.item.quantity,
              unitCost: line.inv.costPrice,
              previousCostPrice: line.inv.costPrice,
              newCostPrice: line.inv.costPrice,
              previousSellingPrice: line.inv.sellingPrice,
              newSellingPrice: line.inv.sellingPrice,
              costStrategy: "Regular Restock" as any,
              notes: `Transferred IN from Store #${transfer.fromStoreId} (Created variant)`,
              reason: "Regular Restock",
            });
          }

          // Update/Create Destination Profit & Loss
          const [destPL] = await tx
            .select()
            .from(profitLoss)
            .where(and(eq(profitLoss.inventoryId, destInvId), eq(profitLoss.storeId, transfer.toStoreId)));

          if (destPL) {
            await tx
              .update(profitLoss)
              .set({ quantityRemaining: destNewQty })
              .where(eq(profitLoss.id, destPL.id));
          } else {
            await tx.insert(profitLoss).values({
              storeId: transfer.toStoreId,
              inventoryId: destInvId,
              totalQuantitySold: 0,
              quantityRemaining: destNewQty,
              totalRevenue: 0,
              totalGrossProfit: 0,
            });
          }
        }
      }

      const [updated] = await tx
        .update(stockTransfers)
        .set({ status, updatedAt: new Date() })
        .where(eq(stockTransfers.id, id))
        .returning();

      return { success: true, message: `Stock transfer marked as ${status}.`, transfer: updated };
    });
  }

  async deleteStockTransfer(id: string): Promise<boolean> {
    return db.transaction(async (tx) => {
      await tx.delete(stockTransferItems).where(eq(stockTransferItems.transferId, id));
      const [deleted] = await tx.delete(stockTransfers).where(eq(stockTransfers.id, id)).returning();
      return !!deleted;
    });
  }
}
