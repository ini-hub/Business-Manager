import { BaseRepository } from "./BaseRepository";
import { db } from "../db";
import {
  inventory,
  transactions,
  bundleComponents,
  inventoryBatches,
  auditLogs,
  inventoryRestockEvents,
  stockAudits,
  stockAuditItems,
  orderConsumables,
  staff,
  users,
  type Inventory,
  type InsertInventory,
  type BundleComponent,
  type InventoryBatch,
  type InsertInventoryBatch,
} from "@shared/schema";
import { eq, and, or, ilike, asc, desc, sql, count, gt, inArray } from "drizzle-orm";
import { searchTokens, infix } from "../lib/searchTerms";

export interface PaginationOptions {
  page: number;
  limit: number;
  search?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasMore: boolean;
  };
}

export class InventoryRepository extends BaseRepository<typeof inventory> {
  constructor() {
    super(inventory);
  }

  async getInventory(storeId: string): Promise<Inventory[]> {
    return await db.select().from(inventory).where(and(eq(inventory.storeId, storeId), eq(inventory.isDeleted, false))).orderBy(asc(inventory.name));
  }

  async getInventoryPaginated(storeId: string, options: PaginationOptions): Promise<PaginatedResult<Inventory>> {
    const { page, limit, search } = options;
    const offset = (page - 1) * limit;

    const conditions = [eq(inventory.storeId, storeId), eq(inventory.isDeleted, false)];
    if (search) {
      conditions.push(
        or(
          ilike(inventory.name, `%${search}%`),
          ilike(inventory.type, `%${search}%`)
        )!
      );
    }

    const [countResult] = await db.select({ count: count() })
      .from(inventory)
      .where(and(...conditions));
    const total = countResult.count;

    const data = await db.select()
      .from(inventory)
      .where(and(...conditions))
      .orderBy(asc(inventory.name))
      .limit(limit)
      .offset(offset);

    const totalPages = Math.ceil(total / limit);

    return {
      data,
      pagination: {
        total,
        page,
        limit,
        totalPages,
        hasMore: page < totalPages,
      },
    };
  }

  async getInventoryForStores(storeIds: string[], options: PaginationOptions): Promise<PaginatedResult<Inventory>> {
    const { page, limit, search } = options;
    const offset = (page - 1) * limit;

    const conditions = [inArray(inventory.storeId, storeIds), eq(inventory.isDeleted, false)];
    if (search) {
      conditions.push(or(ilike(inventory.name, `%${search}%`), ilike(inventory.type, `%${search}%`))!);
    }

    const [countResult] = await db.select({ count: count() }).from(inventory).where(and(...conditions));
    const total = countResult.count;

    const data = await db.select()
      .from(inventory)
      .where(and(...conditions))
      .orderBy(asc(inventory.name))
      .limit(limit)
      .offset(offset);

    const totalPages = Math.ceil(total / limit);
    return { data, pagination: { total, page, limit, totalPages, hasMore: page < totalPages } };
  }

  async getInventoryItem(id: string): Promise<Inventory | undefined> {
    return this.findById(id);
  }

  /**
   * `type` scopes the lookup to match the (store_id, type, name) unique key. A salon
   * that retails "Shampoo" also stocks it back-bar, and those are different items —
   * without the scope, creating the second one reports a spurious duplicate.
   * Omitting `type` keeps the old store-wide behaviour for callers that want it.
   */
  async getInventoryItemByName(storeId: string, name: string, type?: string): Promise<Inventory | undefined> {
    const [item] = await db
      .select()
      .from(inventory)
      .where(and(
        eq(inventory.storeId, storeId),
        eq(inventory.isDeleted, false),
        type ? eq(inventory.type, type) : sql`true`,
        sql`lower(${inventory.name}) = ${name.toLowerCase().trim()}`
      ));
    return item;
  }

  async createInventoryItem(item: InsertInventory): Promise<Inventory> {
    const [newItem] = await db.insert(inventory).values(item).returning();
    return newItem;
  }

  async updateInventoryItem(id: string, itemData: Partial<InsertInventory>): Promise<Inventory | undefined> {
    const [updated] = await db.update(inventory).set(itemData).where(eq(inventory.id, id)).returning();
    return updated;
  }

  async deleteInventoryItem(id: string): Promise<boolean> {
    const result = await db.update(inventory)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(eq(inventory.id, id))
      .returning();
    return result.length > 0;
  }

  async hardDeleteInventoryItem(id: string): Promise<boolean> {
    const result = await db.delete(inventory).where(eq(inventory.id, id)).returning();
    return result.length > 0;
  }

  async hasInventoryTransactions(id: string): Promise<boolean> {
    const result = await db.select({ count: count() }).from(transactions).where(eq(transactions.inventoryId, id));
    return result[0].count > 0;
  }

  async searchInventory(storeIds: string[], query: string): Promise<Inventory[]> {
    const tokens = searchTokens(query);
    if (storeIds.length === 0 || tokens.length === 0) return [];

    const tokenMatches = tokens.map((token) => {
      const pattern = infix(token);
      return or(
        ilike(inventory.name, pattern),
        ilike(inventory.sku, pattern),
        ilike(inventory.barcode, pattern),
      )!;
    });

    return db.select()
      .from(inventory)
      .where(and(
        inArray(inventory.storeId, storeIds),
        eq(inventory.isDeleted, false),
        ...tokenMatches,
      ))
      .orderBy(asc(inventory.name))
      .limit(10);
  }

  async getBundleComponents(parentInventoryId: string): Promise<(BundleComponent & { component: Inventory })[]> {
    const rows = await db
      .select({
        bundleComponent: bundleComponents,
        component: inventory,
      })
      .from(bundleComponents)
      .innerJoin(inventory, eq(bundleComponents.componentInventoryId, inventory.id))
      .where(eq(bundleComponents.parentInventoryId, parentInventoryId));

    return rows.map(r => ({
      ...r.bundleComponent,
      component: r.component,
    }));
  }

  async setBundleComponents(parentInventoryId: string, components: { componentInventoryId: string; quantity: number }[]): Promise<void> {
    await db.delete(bundleComponents).where(eq(bundleComponents.parentInventoryId, parentInventoryId));
    if (components.length > 0) {
      await db.insert(bundleComponents).values(
        components.map(c => ({
          parentInventoryId,
          componentInventoryId: c.componentInventoryId,
          quantity: c.quantity,
        }))
      );
    }
  }

  // --- Variants / Matrix Support ---
  /**
   * Finds the existing variant (if any) of `productId` with the exact same
   * `variantDimensions` combo. Scopes duplicate detection to dimensions
   * rather than name, since two variants can legitimately share a name
   * pattern but never the same combo within one product.
   */
  async getVariantByDimensions(productId: string, variantDimensions: Record<string, string> | null | undefined): Promise<Inventory | undefined> {
    if (!variantDimensions || Object.keys(variantDimensions).length === 0) return undefined;
    const [item] = await db
      .select()
      .from(inventory)
      .where(and(
        eq(inventory.productId, productId),
        eq(inventory.isDeleted, false),
        sql`${inventory.variantDimensions} = ${JSON.stringify(variantDimensions)}::jsonb`
      ));
    return item;
  }

  async countVariants(productId: string): Promise<number> {
    const [result] = await db
      .select({ count: count() })
      .from(inventory)
      .where(and(eq(inventory.productId, productId), eq(inventory.isDeleted, false)));
    return result.count;
  }

  // --- Batch & Expiry FIFO Support ---
  async getBatches(inventoryId: string): Promise<InventoryBatch[]> {
    return db
      .select()
      .from(inventoryBatches)
      .where(eq(inventoryBatches.inventoryId, inventoryId))
      .orderBy(asc(inventoryBatches.expiryDate));
  }

  async createBatch(data: InsertInventoryBatch): Promise<InventoryBatch> {
    const [inserted] = await db.insert(inventoryBatches).values(data).returning();
    return inserted;
  }

  async deductFIFO(inventoryId: string, quantityToDeduct: number, externalTx?: any): Promise<void> {
    const client = externalTx || db;

    // Fetch active batch IDs ordered by FIFO (oldest expiry/creation first).
    // We only read IDs and use atomic UPDATE … WHERE quantity >= deduct to avoid
    // read-then-write race conditions under concurrent checkouts.
    const activeBatches = await client
      .select({ id: inventoryBatches.id, quantity: inventoryBatches.quantity })
      .from(inventoryBatches)
      .where(and(eq(inventoryBatches.inventoryId, inventoryId), gt(inventoryBatches.quantity, 0)))
      .orderBy(asc(inventoryBatches.expiryDate), asc(inventoryBatches.createdAt));

    let remaining = quantityToDeduct;

    for (const batch of activeBatches) {
      if (remaining <= 0) break;

      const deductFromBatch = Math.min(batch.quantity, remaining);

      // Atomic deduction: only succeeds if the row still has enough quantity.
      // Uses SQL arithmetic so no stale read can cause a negative result.
      const updated = await client
        .update(inventoryBatches)
        .set({ quantity: sql`quantity - ${deductFromBatch}` })
        .where(
          and(
            eq(inventoryBatches.id, batch.id),
            sql`quantity >= ${deductFromBatch}`
          )
        )
        .returning({ newQty: inventoryBatches.quantity });

      if (updated.length > 0) {
        remaining -= deductFromBatch;
      }
      // If the atomic update found no rows (concurrent deduction already consumed
      // this batch), we skip it and let the next batch absorb the remainder.
    }
  }

  // Unified stock lifecycle timeline for one inventory item. auditLogs alone misses
  // restocks (logged there under resource "inventory_restock", not "inventory"),
  // stock-count adjustments (never logged to auditLogs at all — only stock_audit_items),
  // and consumable usage (logged under resource "order_consumables" with that table's
  // own row id, not the inventory id). Rather than depend on every write site tagging
  // resource/resourceId correctly forever, this reads each source table directly.
  async getActivityTimeline(inventoryId: string, storeId: string, limit = 200): Promise<Array<{
    id: string;
    type: "created" | "sale" | "return" | "transfer_in" | "transfer_out" | "restock" | "audit_adjustment" | "consumable_usage" | "other";
    label: string;
    quantityDelta: number | null;
    actorName: string | null;
    timestamp: Date;
    details?: Record<string, unknown>;
  }>> {
    const typeForAction = (action: string): { type: any; label: string } => {
      switch (action) {
        case "CREATE": return { type: "created", label: "Added to inventory" };
        case "SALE_DEDUCTION": return { type: "sale", label: "Sold" };
        case "SALE_RETURN_RESTOCK": return { type: "return", label: "Returned" };
        case "STOCK_TRANSFER_IN": return { type: "transfer_in", label: "Transfer in" };
        case "STOCK_TRANSFER_OUT": return { type: "transfer_out", label: "Transfer out" };
        case "INVENTORY_UPDATE": return { type: "other", label: "Details updated" };
        case "INVENTORY_ARCHIVE": return { type: "other", label: "Archived" };
        case "INVENTORY_DELETE": return { type: "other", label: "Deleted" };
        case "INVENTORY_BUNDLE_UPDATE": return { type: "other", label: "Bundle components updated" };
        case "INVENTORY_BATCH_CREATE": return { type: "other", label: "Batch added" };
        default: return { type: "other", label: action.replace(/_/g, " ") };
      }
    };

    const [auditRows, restockRows, auditItemRows, consumableRows] = await Promise.all([
      db.select({
        id: auditLogs.id,
        action: auditLogs.action,
        actorName: auditLogs.actorName,
        timestamp: auditLogs.timestamp,
        details: auditLogs.details,
      })
        .from(auditLogs)
        .where(and(eq(auditLogs.resource, "inventory"), eq(auditLogs.resourceId, inventoryId)))
        .orderBy(desc(auditLogs.timestamp))
        .limit(limit),

      db.select({
        id: inventoryRestockEvents.id,
        quantityAdded: inventoryRestockEvents.quantityAdded,
        reason: inventoryRestockEvents.reason,
        notes: inventoryRestockEvents.notes,
        restockedAt: inventoryRestockEvents.restockedAt,
        staffName: staff.name,
        userName: users.name,
      })
        .from(inventoryRestockEvents)
        .leftJoin(staff, eq(inventoryRestockEvents.staffId, staff.id))
        .leftJoin(users, eq(inventoryRestockEvents.userId, users.id))
        .where(eq(inventoryRestockEvents.inventoryId, inventoryId))
        .orderBy(desc(inventoryRestockEvents.restockedAt))
        .limit(limit),

      db.select({
        id: stockAuditItems.id,
        variance: stockAuditItems.variance,
        reason: stockAuditItems.reason,
        systemQuantity: stockAuditItems.systemQuantity,
        physicalQuantity: stockAuditItems.physicalQuantity,
        approvedAt: stockAudits.approvedAt,
        createdAt: stockAudits.createdAt,
        status: stockAudits.status,
        conductedByName: staff.name,
        approvedByName: users.name,
      })
        .from(stockAuditItems)
        .innerJoin(stockAudits, eq(stockAuditItems.auditId, stockAudits.id))
        .leftJoin(staff, eq(stockAudits.conductedByStaffId, staff.id))
        .leftJoin(users, eq(stockAudits.approvedByUserId, users.id))
        .where(and(eq(stockAuditItems.inventoryId, inventoryId), eq(stockAudits.status, "approved")))
        .orderBy(desc(stockAudits.approvedAt))
        .limit(limit),

      db.select({
        id: orderConsumables.id,
        quantityUsed: orderConsumables.quantityUsed,
        totalCost: orderConsumables.totalCost,
        createdAt: orderConsumables.createdAt,
      })
        .from(orderConsumables)
        .where(and(eq(orderConsumables.supplyInventoryId, inventoryId), eq(orderConsumables.storeId, storeId)))
        .orderBy(desc(orderConsumables.createdAt))
        .limit(limit),
    ]);

    const timeline = [
      ...auditRows.map((r) => {
        const { type, label } = typeForAction(r.action);
        const details = (r.details as Record<string, unknown>) || {};
        const quantityDelta =
          typeof details.quantityRestocked === "number" ? details.quantityRestocked :
          typeof details.quantity === "number" ? (r.action === "SALE_DEDUCTION" ? -details.quantity : details.quantity) :
          null;
        return {
          id: r.id,
          type,
          label,
          quantityDelta,
          actorName: r.actorName,
          timestamp: r.timestamp,
          details,
        };
      }),
      ...restockRows.map((r) => ({
        id: r.id,
        type: "restock" as const,
        label: r.reason || "Restocked",
        quantityDelta: Number(r.quantityAdded),
        actorName: r.staffName ?? r.userName ?? null,
        timestamp: r.restockedAt,
        details: r.notes ? { notes: r.notes } : undefined,
      })),
      ...auditItemRows.map((r) => ({
        id: r.id,
        type: "audit_adjustment" as const,
        label: "Stock count adjustment",
        quantityDelta: Number(r.variance),
        actorName: r.approvedByName ?? r.conductedByName ?? null,
        timestamp: r.approvedAt ?? r.createdAt,
        details: {
          systemQuantity: Number(r.systemQuantity),
          physicalQuantity: Number(r.physicalQuantity),
          ...(r.reason ? { reason: r.reason } : {}),
        },
      })),
      ...consumableRows.map((r) => ({
        id: r.id,
        type: "consumable_usage" as const,
        label: "Used as consumable",
        quantityDelta: -Number(r.quantityUsed),
        actorName: null,
        timestamp: r.createdAt,
        details: { totalCost: Number(r.totalCost) },
      })),
    ];

    return timeline
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }
}
