import { BaseRepository } from "./BaseRepository";
import { db } from "../db";
import { inventory, transactions, type Inventory, type InsertInventory } from "@shared/schema";
import { eq, and, or, ilike, asc, sql, count } from "drizzle-orm";

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
    return await db.select().from(inventory).where(eq(inventory.storeId, storeId));
  }

  async getInventoryPaginated(storeId: string, options: PaginationOptions): Promise<PaginatedResult<Inventory>> {
    const { page, limit, search } = options;
    const offset = (page - 1) * limit;

    const conditions = [eq(inventory.storeId, storeId)];
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

  async getInventoryItem(id: string): Promise<Inventory | undefined> {
    return this.findById(id);
  }

  async getInventoryItemByName(storeId: string, name: string): Promise<Inventory | undefined> {
    const [item] = await db
      .select()
      .from(inventory)
      .where(and(
        eq(inventory.storeId, storeId),
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
    const result = await db.delete(inventory).where(eq(inventory.id, id)).returning();
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
}
