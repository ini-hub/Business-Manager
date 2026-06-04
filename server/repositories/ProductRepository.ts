import { BaseRepository } from "./BaseRepository";
import { db } from "../db";
import {
  products,
  inventory,
  type Product,
  type InsertProduct,
} from "@shared/schema";
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

export class ProductRepository extends BaseRepository<typeof products> {
  constructor() {
    super(products);
  }

  async getProducts(storeId: string): Promise<any[]> {
    return await db.query.products.findMany({
      where: and(eq(products.storeId, storeId), eq(products.isDeleted, false)),
      with: {
        variants: {
          where: eq(inventory.isDeleted, false),
        },
      },
      orderBy: asc(products.name),
    });
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
    return await db.query.products.findFirst({
      where: and(eq(products.id, id), eq(products.isDeleted, false)),
      with: {
        variants: {
          where: eq(inventory.isDeleted, false),
        },
      },
    });
  }

  async getProductByIdRaw(id: string): Promise<any> {
    return await db.query.products.findFirst({
      where: eq(products.id, id),
      with: { variants: true },
    });
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
    return await db.query.products.findMany({
      where: and(eq(products.storeId, storeId), eq(products.isDeleted, true)),
      with: { variants: true },
      orderBy: asc(products.name),
    });
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
