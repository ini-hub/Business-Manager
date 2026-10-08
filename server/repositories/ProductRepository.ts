import { BaseRepository } from "./BaseRepository";
import { assertWithinCountLimit, getBusinessIdForStore } from "../lib/entitlements";
import { db } from "../db";
import {
  products,
  inventory,
  transactions,
  orders,
  checkouts,
  type Product,
  type InsertProduct,
} from "@shared/schema";
import { eq, and, or, ilike, asc, desc, gte, sql, count, inArray } from "drizzle-orm";

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

  /** Product groups ranked best-selling first, for the POS quick-pick strip.
   *
   *  Ranked by how many sale lines the group appears in, not units moved: the
   *  strip exists to save a cashier scrolling, so what matters is how often an
   *  item gets rung up, not that one wholesale line once moved 500 sachets.
   *  Units break ties. Voided and unpaid checkouts don't count, and a fully
   *  returned line is dropped rather than rewarding the sale that bounced.
   */
  async getTopSellingProductIds(storeId: string, days: number, limit: number): Promise<string[]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const netUnits = sql<number>`sum(${orders.quantity}::numeric - ${orders.returnedQuantity}::numeric)`;

    const rows = await db
      .select({ productId: inventory.productId, lines: count(), units: netUnits })
      .from(orders)
      .innerJoin(checkouts, eq(checkouts.orderId, orders.id))
      .innerJoin(inventory, eq(inventory.id, orders.inventoryId))
      .where(and(
        eq(orders.storeId, storeId),
        eq(checkouts.paymentStatus, "completed"),
        eq(checkouts.isVoided, false),
        eq(inventory.isDeleted, false),
        gte(checkouts.createdAt, since),
        sql`${orders.quantity}::numeric > ${orders.returnedQuantity}::numeric`,
      ))
      .groupBy(inventory.productId)
      .orderBy(desc(count()), desc(netUnits))
      .limit(limit);

    return rows.map((r) => r.productId).filter(Boolean) as string[];
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

  /** `type` scopes the lookup to the (store_id, type, name) unique key — see
   *  InventoryRepository.getInventoryItemByName for why. */
  async getProductByName(storeId: string, name: string, type?: string): Promise<Product | undefined> {
    const [item] = await db
      .select()
      .from(products)
      .where(and(
        eq(products.storeId, storeId),
        eq(products.isDeleted, false),
        type ? eq(products.type, type) : sql`true`,
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

  /** One page of archived products (with their variants) and the total, by name. */
  async getArchivedProductsPage(storeId: string, page: { limit: number; offset: number }): Promise<{ rows: any[]; total: number }> {
    const where = and(eq(products.storeId, storeId), eq(products.isDeleted, true));
    const [rows, [{ total }]] = await Promise.all([
      db.query.products.findMany({ where, with: { variants: true }, orderBy: asc(products.name), limit: page.limit, offset: page.offset }),
      db.select({ total: sql<number>`count(*)::int` }).from(products).where(where),
    ]);
    return { rows, total };
  }

  /** The archived product with this name (case-insensitive), if any: one row, no variants, no full read. */
  async findArchivedProductByName(storeId: string, name: string): Promise<{ id: string } | undefined> {
    const [row] = await db.select({ id: products.id }).from(products)
      .where(and(eq(products.storeId, storeId), eq(products.isDeleted, true), sql`lower(${products.name}) = lower(${name})`))
      .limit(1);
    return row;
  }

  async restoreProduct(id: string): Promise<boolean> {
    const now = new Date();
    return db.transaction(async (tx) => {
      // Un-archiving takes item slots back, so it is held to the same cap as adding them: every archived
      // sellable row this restore brings back counts, and an org at its cap has to free room first.
      const [product] = await tx.select({ storeId: products.storeId }).from(products).where(eq(products.id, id)).limit(1);
      if (product) {
        const [{ n }] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(inventory)
          .where(and(eq(inventory.productId, id), eq(inventory.isDeleted, true), sql`${inventory.type} in ('product','service')`));
        const businessId = await getBusinessIdForStore(tx, product.storeId);
        if (businessId && n > 0) await assertWithinCountLimit(tx, businessId, "item_count", n);
      }
      await tx.update(inventory)
        .set({ isDeleted: false, deletedAt: null })
        .where(eq(inventory.productId, id));
      const result = await tx.update(products)
        .set({ isDeleted: false, deletedAt: null, updatedAt: now })
        .where(eq(products.id, id))
        .returning();
      return result.length > 0;
    });
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
