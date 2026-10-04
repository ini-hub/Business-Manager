import { BaseRepository } from "./BaseRepository";
import { db } from "../db";
import {
  purchaseOrders,
  purchaseOrderItems,
  purchaseOrderDeliveryReceipts,
  type PurchaseOrderDeliveryReceipt,
  vendors,
  stores,
  inventory,
  inventoryRestockEvents,
  profitLoss,
  vendorBills,
  type PurchaseOrder,
  type InsertPurchaseOrder,
  type PurchaseOrderItem, type Vendor,
  type Inventory
} from "@shared/schema";
import { eq, and, desc, like, sql } from "drizzle-orm";
import { postSupplyPurchaseExpense, localDateString } from "../services/SupplyCostingService";
import { getStoreTimezone } from "../lib/dateUtils";

export class PurchaseOrderRepository extends BaseRepository<typeof purchaseOrders> {
  constructor() {
    super(purchaseOrders);
  }

  async getPurchaseOrders(storeId: string): Promise<(PurchaseOrder & { vendor: Vendor })[]> {
    const rows = await db
      .select({
        po: purchaseOrders,
        vendor: vendors,
      })
      .from(purchaseOrders)
      .innerJoin(vendors, eq(purchaseOrders.vendorId, vendors.id))
      .where(eq(purchaseOrders.storeId, storeId))
      .orderBy(desc(purchaseOrders.createdAt));

    return rows.map(r => ({
      ...r.po,
      vendor: r.vendor,
    }));
  }

  async getPurchaseOrder(id: string): Promise<(PurchaseOrder & { vendor: Vendor; items: (PurchaseOrderItem & { inventory: Inventory })[]; deliveryReceipts: PurchaseOrderDeliveryReceipt[] }) | undefined> {
    const [row] = await db
      .select({
        po: purchaseOrders,
        vendor: vendors,
      })
      .from(purchaseOrders)
      .innerJoin(vendors, eq(purchaseOrders.vendorId, vendors.id))
      .where(eq(purchaseOrders.id, id));

    if (!row) return undefined;

    const itemRows = await db
      .select({
        item: purchaseOrderItems,
        inv: inventory,
      })
      .from(purchaseOrderItems)
      .innerJoin(inventory, eq(purchaseOrderItems.inventoryId, inventory.id))
      .where(eq(purchaseOrderItems.poId, id));

    const deliveryReceipts = await db
      .select()
      .from(purchaseOrderDeliveryReceipts)
      .where(eq(purchaseOrderDeliveryReceipts.poId, id))
      .orderBy(desc(purchaseOrderDeliveryReceipts.createdAt));

    return {
      ...row.po,
      vendor: row.vendor,
      deliveryReceipts,
      items: itemRows.map(ir => ({
        ...ir.item,
        inventory: ir.inv,
      })),
    };
  }

  /**
   * Next number for a store: PO-<STORECODE>-<n>, continuing from the highest
   * existing number with that prefix in this store. po_number is unique per
   * store, so businesses sharing a store code never affect each other.
   */
  async nextPoNumber(storeId: string): Promise<string> {
    const [store] = await db.select({ code: stores.code }).from(stores).where(eq(stores.id, storeId));
    const code = (store?.code || "STORE").toUpperCase().replace(/[^A-Z0-9]/g, "") || "STORE";
    const prefix = `PO-${code}-`;
    const rows = await db
      .select({ poNumber: purchaseOrders.poNumber })
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.storeId, storeId), like(purchaseOrders.poNumber, `${prefix}%`)));
    let max = 0;
    for (const r of rows) {
      const m = r.poNumber.slice(prefix.length).match(/^\d+$/);
      if (m) max = Math.max(max, Number(m[0]));
    }
    return `${prefix}${max + 1}`;
  }

  /** Edits a draft in place (header fields + full line replacement). Only drafts are editable. */
  async updateDraftPurchaseOrder(
    id: string,
    data: {
      vendorId: string;
      poNumber?: string;
      supplierRef: string | null;
      notes: string | null;
      expectedDelivery: Date | null;
      items: { inventoryId: string; quantity: number; unitCost: number }[];
    },
  ): Promise<{ success: true; po: PurchaseOrder } | { success: false; message: string }> {
    return db.transaction(async (tx) => {
      const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, id));
      if (!po) return { success: false as const, message: "Purchase order not found." };
      if (po.status !== "draft") return { success: false as const, message: "Only a draft order can be edited." };

      const totalAmount = data.items.reduce((sum, i) => sum + i.quantity * i.unitCost, 0);
      const [updated] = await tx
        .update(purchaseOrders)
        .set({
          vendorId: data.vendorId,
          ...(data.poNumber ? { poNumber: data.poNumber } : {}),
          supplierRef: data.supplierRef,
          notes: data.notes,
          expectedDelivery: data.expectedDelivery,
          totalAmount,
          updatedAt: new Date(),
        })
        .where(eq(purchaseOrders.id, id))
        .returning();

      await tx.delete(purchaseOrderItems).where(eq(purchaseOrderItems.poId, id));
      if (data.items.length > 0) {
        await tx.insert(purchaseOrderItems).values(
          data.items.map((i) => ({
            poId: id,
            inventoryId: i.inventoryId,
            quantity: i.quantity,
            receivedQuantity: 0,
            unitCost: i.unitCost,
            totalCost: i.quantity * i.unitCost,
          })),
        );
      }
      return { success: true as const, po: updated };
    });
  }

  async createPurchaseOrder(data: InsertPurchaseOrder & { items: { inventoryId: string; quantity: number; unitCost: number }[] }): Promise<PurchaseOrder> {
    const { items, ...poData } = data;

    return db.transaction(async (tx) => {
      const totalAmount = items.reduce((sum: number, item: { quantity: number; unitCost: number }) => sum + (item.quantity * item.unitCost), 0);

      const [newPO] = await tx
        .insert(purchaseOrders)
        .values({
          ...poData,
          totalAmount,
          placedAt: poData.status === "ordered" ? new Date() : null,
        })
        .returning();

      if (items.length > 0) {
        await tx.insert(purchaseOrderItems).values(
          items.map((item: { inventoryId: string; quantity: number; unitCost: number }) => ({
            poId: newPO.id,
            inventoryId: item.inventoryId,
            quantity: item.quantity,
            receivedQuantity: 0,
            unitCost: item.unitCost,
            totalCost: item.quantity * item.unitCost,
          }))
        );
      }

      return newPO;
    });
  }

  async updatePurchaseOrderStatus(id: string, status: string): Promise<PurchaseOrder | undefined> {
    const [updated] = await db
      .update(purchaseOrders)
      .set({
        status,
        updatedAt: new Date(),
        ...(status === "ordered" ? { placedAt: sql`COALESCE(${purchaseOrders.placedAt}, now())` } : {}),
      })
      .where(eq(purchaseOrders.id, id))
      .returning();
    return updated;
  }

  async getDeliveryReceipt(poId: string, receiptId: string): Promise<PurchaseOrderDeliveryReceipt | undefined> {
    const [row] = await db
      .select()
      .from(purchaseOrderDeliveryReceipts)
      .where(and(eq(purchaseOrderDeliveryReceipts.id, receiptId), eq(purchaseOrderDeliveryReceipts.poId, poId)));
    return row;
  }

  async setSupplierRef(id: string, supplierRef: string | null): Promise<PurchaseOrder | undefined> {
    const [updated] = await db
      .update(purchaseOrders)
      .set({ supplierRef, updatedAt: new Date() })
      .where(eq(purchaseOrders.id, id))
      .returning();
    return updated;
  }

  async setReceipt(id: string, receiptKey: string, receiptName: string): Promise<PurchaseOrder | undefined> {
    const [updated] = await db
      .update(purchaseOrders)
      .set({ receiptKey, receiptName, updatedAt: new Date() })
      .where(eq(purchaseOrders.id, id))
      .returning();
    return updated;
  }

  async receivePOItems(
    poId: string,
    itemsToReceive: { inventoryId: string; quantity: number }[],
    staffId?: string | null,
    userId?: string | null,
    deliveryReceipt?: { key: string; name: string } | null
  ): Promise<{ success: boolean; message: string }> {
    return db.transaction(async (tx) => {
      const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId));
      if (!po) return { success: false, message: "Purchase order not found." };
      if (po.status !== "ordered" && po.status !== "partially_received") {
        return { success: false, message: po.status === "draft"
          ? "Send this purchase order to the supplier before receiving stock."
          : `A ${po.status.replace("_", " ")} purchase order cannot receive stock.` };
      }

      // Never receive more than is still outstanding on a line (also stops a
      // double-submit from adding stock twice).
      for (const item of itemsToReceive) {
        if (item.quantity <= 0) continue;
        const [line] = await tx
          .select()
          .from(purchaseOrderItems)
          .where(and(eq(purchaseOrderItems.poId, poId), eq(purchaseOrderItems.inventoryId, item.inventoryId)));
        if (!line) return { success: false, message: "An item being received is not on this purchase order." };
        if (item.quantity > line.quantity - line.receivedQuantity + 1e-9) {
          return { success: false, message: "You can't receive more than the quantity still outstanding on a line." };
        }
      }

      let totalBillAmount = 0;
      let firstRestockEventId: string | null = null;

      for (const item of itemsToReceive) {
        if (item.quantity <= 0) continue;

        // 1. Get PO line item to verify cost and expected quantity
        const [poItem] = await tx
          .select()
          .from(purchaseOrderItems)
          .where(and(eq(purchaseOrderItems.poId, poId), eq(purchaseOrderItems.inventoryId, item.inventoryId)));

        if (!poItem) continue;

        // 2. Fetch inventory details to restock
        const [inv] = await tx.select().from(inventory).where(eq(inventory.id, item.inventoryId));
        if (!inv) continue;

        const quantityAdded = item.quantity;
        const previousQuantity = inv.quantity;
        const newQuantity = previousQuantity + quantityAdded;
        const previousCostPrice = inv.costPrice;
        const previousSellingPrice = inv.sellingPrice;

        // Weighted costing strategy for PO receiving
        const totalOldValue = previousQuantity * previousCostPrice;
        const totalNewValue = quantityAdded * poItem.unitCost;
        const newCostPrice = newQuantity > 0 ? (totalOldValue + totalNewValue) / newQuantity : poItem.unitCost;

        // 3. Update Inventory item
        await tx
          .update(inventory)
          .set({
            quantity: newQuantity,
            costPrice: newCostPrice,
          })
          .where(eq(inventory.id, item.inventoryId))
          .returning();

        // 4. Log Restock Event
        const [restockEvent] = await tx
          .insert(inventoryRestockEvents)
          .values({
            storeId: po.storeId,
            inventoryId: item.inventoryId,
            staffId: staffId || null,
            userId: userId || null,
            quantityAdded,
            previousQuantity,
            newQuantity,
            unitCost: poItem.unitCost,
            previousCostPrice,
            newCostPrice,
            previousSellingPrice,
            newSellingPrice: previousSellingPrice,
            costStrategy: "weighted",
            notes: `Received via PO #${po.poNumber}`,
            reason: "PO Fulfillment",
          })
          .returning();

        if (!firstRestockEventId) {
          firstRestockEventId = restockEvent.id;
        }

        // Same rule as a direct restock: an `expensed` supply is charged to Direct
        // Supplies on receipt rather than capitalised. See SupplyCostingService.
        await postSupplyPurchaseExpense(tx, {
          storeId: po.storeId,
          item: inv,
          quantityAdded,
          unitCost: poItem.unitCost,
          date: localDateString(await getStoreTimezone(po.storeId)),
          reference: `PO #${po.poNumber}`,
        });

        // 5. Update profit & loss entry
        const [existingPL] = await tx
          .select()
          .from(profitLoss)
          .where(and(eq(profitLoss.inventoryId, item.inventoryId), eq(profitLoss.storeId, po.storeId)));

        if (existingPL) {
          await tx
            .update(profitLoss)
            .set({ quantityRemaining: newQuantity })
            .where(eq(profitLoss.id, existingPL.id));
        }

        // 6. Update Purchase Order Item received count
        const newReceivedQty = poItem.receivedQuantity + quantityAdded;
        await tx
          .update(purchaseOrderItems)
          .set({ receivedQuantity: newReceivedQty })
          .where(eq(purchaseOrderItems.id, poItem.id));

        totalBillAmount += quantityAdded * poItem.unitCost;
      }

      if (deliveryReceipt && firstRestockEventId) {
        await tx.insert(purchaseOrderDeliveryReceipts).values({
          poId,
          restockEventId: firstRestockEventId,
          receiptKey: deliveryReceipt.key,
          receiptName: deliveryReceipt.name,
        });
      }

      // 7. Re-calculate PO status based on received items
      const allPOItems = await tx.select().from(purchaseOrderItems).where(eq(purchaseOrderItems.poId, poId));
      const fullyReceived = allPOItems.every(i => i.receivedQuantity >= i.quantity);
      const partiallyReceived = allPOItems.some(i => i.receivedQuantity > 0);

      let newStatus = po.status;
      if (fullyReceived) {
        newStatus = "received";
      } else if (partiallyReceived) {
        newStatus = "partially_received";
      }

      await tx
        .update(purchaseOrders)
        .set({ status: newStatus, updatedAt: new Date() })
        .where(eq(purchaseOrders.id, poId));

      // 8. Generate Vendor Bill (Accounts Payable) for this receipt
      if (totalBillAmount > 0) {
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + 30); // Net 30 days default

        await tx.insert(vendorBills).values({
          storeId: po.storeId,
          vendorId: po.vendorId,
          amount: totalBillAmount,
          amountPaid: 0,
          status: "unpaid",
          dueDate,
          notes: `Auto-generated from PO #${po.poNumber} receipt`,
          linkedRestockEventId: firstRestockEventId,
        });
      }

      return { success: true, message: "Purchase order items received successfully." };
    });
  }

  async deletePurchaseOrder(id: string): Promise<boolean> {
    return db.transaction(async (tx) => {
      await tx.delete(purchaseOrderItems).where(eq(purchaseOrderItems.poId, id));
      const [deleted] = await tx.delete(purchaseOrders).where(eq(purchaseOrders.id, id)).returning();
      return !!deleted;
    });
  }
}
