import { BaseRepository } from "./BaseRepository";
import { db } from "../db";
import {
  products,
  inventory,
  transactions,
  type Product,
  type InsertProduct,
} from "@shared/schema";
import { eq, and, or, ilike, asc, sql, count, inArray } from "drizzle-orm";

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

  private async annotateSalesFlags(rows: any[]): Promise<any[]> {
    const variantIds = rows.flatMap((p) => (p.variants ?? []).map((v: any) => v.id));
    if (variantIds.length === 0) return rows.map((p) => ({ ...p, hasSales: false, variants: (p.variants ?? []).map((v: any) => ({ ...v, hasSales: false })) }));
    const sold = await db
      .selectDistinct({ inventoryId: transactions.inventoryId })
      .from(transactions)
      .where(inArray(transactions.inventoryId, variantIds));
    const soldSet = new Set(sold.map((r) => r.inventoryId));
    return rows.map((p) => {
      const annotatedVariants = (p.variants ?? []).map((v: any) => ({ ...v, hasSales: soldSet.has(v.id) }));
      return {
        ...p,
        variants: annotatedVariants,
        hasSales: annotatedVariants.some((v: any) => v.hasSales),
      };
    });
  }

  async getProducts(storeId: string): Promise<any[]> {
    const rows = await db.query.products.findMany({
      where: and(eq(products.storeId, storeId), eq(products.isDeleted, false)),
      with: {
        variants: {
          where: eq(inventory.isDeleted, false),
        },
      },
      orderBy: asc(products.name),
    });
    return this.annotateSalesFlags(rows);
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
    const annotated = await this.annotateSalesFlags(data);

    return {
      data: annotated,
      pagination: { total, page, limit, totalPages, hasMore: page < totalPages },
    };
  }

  async getProduct(id: string): Promise<any> {
    const row = await db.query.products.findFirst({
      where: and(eq(products.id, id), eq(products.isDeleted, false)),
      with: {
        variants: {
          where: eq(inventory.isDeleted, false),
        },
      },
    });
    if (!row) return row;
    const [annotated] = await this.annotateSalesFlags([row]);
    return annotated;
  }

  async getProductByIdRaw(id: string): Promise<any> {
    return db.query.products.findFirst({
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
    return db.query.products.findMany({
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
    await db.update(inventory)
      .set({ isDeleted: true, deletedAt: now })
      .where(eq(inventory.productId, id));
    const result = await db.update(products)
      .set({ isDeleted: true, deletedAt: now, updatedAt: now })
      .where(eq(products.id, id))
      .returning();
    return result.length > 0;
  }

  async hardDeleteProduct(id: string): Promise<boolean> {
    // Remove all variants first (FK constraint), then the product group
    await db.delete(inventory).where(eq(inventory.productId, id));
    const result = await db.delete(products).where(eq(products.id, id)).returning();
    return result.length > 0;
  }
}
