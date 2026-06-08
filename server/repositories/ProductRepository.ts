import { BaseRepository } from "./BaseRepository";
import { db } from "../db";
import {
  products,
  inventory,
  type Product,
  type InsertProduct,
} from "@shared/schema";
import { eq, and, or, ilike, asc, isNull, sql, count } from "drizzle-orm";

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

export class ProductRepository extends BaseRepository<typeof products> {
  constructor() {
    super(products);
  }

  async getProducts(storeId: string): Promise<any[]> {
    const fromProducts = await db.query.products.findMany({
      where: and(eq(products.storeId, storeId), eq(products.isDeleted, false)),
      with: {
        variants: {
          where: eq(inventory.isDeleted, false),
        },
      },
      orderBy: asc(products.name),
    });

    // Fallback: include legacy inventory items that were never linked to a product group.
    // These exist in stores that were set up before the products table was introduced.
    const orphaned = await db
      .select()
      .from(inventory)
      .where(and(
        eq(inventory.storeId, storeId),
        eq(inventory.isDeleted, false),
        isNull(inventory.productId),
      ));

    const orphanedAsProducts = orphaned.map((item) => ({
      id: item.id,
      storeId: item.storeId,
      name: item.name,
      type: item.type,
      category: null,
      brand: null,
      description: null,
      isActive: true,
      isDeleted: false,
      deletedAt: null,
      createdAt: item.id,
      updatedAt: item.id,
      variants: [item],
      _isOrphaned: true,
    }));

    return [...fromProducts, ...orphanedAsProducts].sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }

  async getProductsPaginated(storeId: string, options: PaginationOptions): Promise<PaginatedResult<any>> {
    const { page, limit, search } = options;
    const offset = (page - 1) * limit;

    const conditions = [eq(products.storeId, storeId), eq(products.isDeleted, false)];
    if (search) {
      conditions.push(
        or(
          ilike(products.name, `%${search}%`),
          ilike(products.category, `%${search}%`),
          ilike(products.brand, `%${search}%`)
        )!
      );
    }

    const [countResult] = await db.select({ count: count() })
      .from(products)
      .where(and(...conditions));
    const total = countResult.count;

    const data = await db.query.products.findMany({
      where: and(...conditions),
      with: {
        variants: {
          where: eq(inventory.isDeleted, false),
        },
      },
      orderBy: asc(products.name),
      limit,
      offset,
    });

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

  async getProduct(id: string): Promise<any> {
    // Try products table first (new-style items)
    const fromProducts = await db.query.products.findFirst({
      where: and(eq(products.id, id), eq(products.isDeleted, false)),
      with: {
        variants: {
          where: eq(inventory.isDeleted, false),
        },
      },
    });
    if (fromProducts) return fromProducts;

    // Fallback: legacy inventory item used directly as its own product group
    const [item] = await db
      .select()
      .from(inventory)
      .where(and(eq(inventory.id, id), eq(inventory.isDeleted, false), isNull(inventory.productId)));
    if (!item) return undefined;
    return {
      id: item.id,
      storeId: item.storeId,
      name: item.name,
      type: item.type,
      category: null,
      brand: null,
      description: null,
      isActive: true,
      isDeleted: false,
      deletedAt: null,
      variants: [item],
      _isOrphaned: true,
    };
  }

  async getProductByIdRaw(id: string): Promise<any> {
    const fromProducts = await db.query.products.findFirst({
      where: eq(products.id, id),
      with: { variants: true },
    });
    if (fromProducts) return fromProducts;

    // Fallback for legacy items
    const [item] = await db
      .select()
      .from(inventory)
      .where(and(eq(inventory.id, id), isNull(inventory.productId)));
    if (!item) return undefined;
    return { id: item.id, storeId: item.storeId, name: item.name, type: item.type, variants: [item], _isOrphaned: true };
  }

  async getProductByName(storeId: string, name: string): Promise<Product | undefined> {
    const [item] = await db
      .select()
      .from(products)
      .where(and(
        eq(products.storeId, storeId),
        eq(products.isDeleted, false),
        sql`lower(${products.name}) = ${name.toLowerCase().trim()}`
      ));
    return item;
  }

  async createProduct(productData: InsertProduct): Promise<Product> {
    const [newItem] = await db.insert(products).values(productData).returning();
    return newItem;
  }

  async updateProduct(id: string, productData: Partial<InsertProduct>): Promise<Product | undefined> {
    const [updated] = await db.update(products).set({
      ...productData,
      updatedAt: new Date(),
    }).where(eq(products.id, id)).returning();
    return updated;
  }

  async getArchivedProducts(storeId: string): Promise<any[]> {
    const fromProducts = await db.query.products.findMany({
      where: and(eq(products.storeId, storeId), eq(products.isDeleted, true)),
      with: { variants: true },
      orderBy: asc(products.name),
    });

    // Fallback: legacy archived inventory items with no product group
    const orphaned = await db
      .select()
      .from(inventory)
      .where(and(
        eq(inventory.storeId, storeId),
        eq(inventory.isDeleted, true),
        isNull(inventory.productId),
      ));

    const orphanedAsProducts = orphaned.map((item) => ({
      id: item.id,
      storeId: item.storeId,
      name: item.name,
      type: item.type,
      category: null,
      brand: null,
      description: null,
      isActive: false,
      isDeleted: true,
      deletedAt: item.deletedAt,
      variants: [item],
      _isOrphaned: true,
    }));

    return [...fromProducts, ...orphanedAsProducts].sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }

  async restoreProduct(id: string): Promise<boolean> {
    const now = new Date();
    await db.update(inventory)
      .set({ isDeleted: false, deletedAt: null })
      .where(eq(inventory.productId, id));
    const result = await db.update(products)
      .set({ isDeleted: false, deletedAt: null, updatedAt: now })
      .where(eq(products.id, id))
      .returning();
    return result.length > 0;
  }

  async deleteProduct(id: string): Promise<boolean> {
    const now = new Date();
    // Soft-delete variants
    await db.update(inventory)
      .set({ isDeleted: true, deletedAt: now })
      .where(eq(inventory.productId, id));

    // Soft-delete product
    const result = await db.update(products)
      .set({ isDeleted: true, deletedAt: now, updatedAt: now })
      .where(eq(products.id, id))
      .returning();
    return result.length > 0;
  }
}
