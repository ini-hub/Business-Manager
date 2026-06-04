import { BaseRepository } from "./BaseRepository";
import { db } from "../db";
import {
  inventory,
  transactions,
  bundleComponents,
  inventoryBatches,
  type Inventory,
  type InsertInventory,
  type BundleComponent,
  type InventoryBatch,
  type InsertInventoryBatch,
} from "@shared/schema";
import { eq, and, or, ilike, asc, sql, count, gt, inArray } from "drizzle-orm";

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

  async getInventoryItemByName(storeId: string, name: string): Promise<Inventory | undefined> {
    const [item] = await db
      .select()
      .from(inventory)
      .where(and(
        eq(inventory.storeId, storeId),
        eq(inventory.isDeleted, false),
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

  async hasInventoryTransactions(id: string): Promise<boolean> {
    const result = await db.select({ count: count() }).from(transactions).where(eq(transactions.inventoryId, id));
    return result[0].count > 0;
  }

  async searchInventory(storeId: string, query: string): Promise<Inventory[]> {
    return db.select()
      .from(inventory)
      .where(and(eq(inventory.storeId, storeId), ilike(inventory.name, `%${query}%`)))
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
  async getVariants(parentInventoryId: string): Promise<Inventory[]> {
    return db
      .select()
      .from(inventory)
      .where(eq(inventory.parentInventoryId, parentInventoryId))
      .orderBy(asc(inventory.name));
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
}
