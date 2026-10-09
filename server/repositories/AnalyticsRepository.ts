import { db } from "../db";
import { getStoreTimezone, toUtcStart, toUtcEnd } from "../lib/dateUtils";
import {
  customers,
  staff,
  inventory,
  checkouts,
  transactions,
  orders,
  settings,
  stores,
} from "@shared/schema";
import { eq, and, gte, lte, count, countDistinct, sql, inArray, asc } from "drizzle-orm";
import type { SalesRepository } from "./SalesRepository";

/** The dashboard shows at most this many stock alerts; the counts alongside it are exact. */
const LOW_STOCK_LIST_LIMIT = 20;

export class AnalyticsRepository {
  constructor(private salesRepo: SalesRepository) {}

  async getDashboardStats(storeId: string, startDate?: string, endDate?: string) {
    // Build date filters once
    const tz = await getStoreTimezone(storeId);
    // Total customers is an unfiltered count (like staff/inventory), not scoped to date range
    const customerDateFilter = eq(customers.storeId, storeId);

    const checkoutDateFilter = and(
      eq(checkouts.storeId, storeId),
      eq(checkouts.isVoided, false),
      eq(checkouts.paymentStatus, "completed"),
      ...(startDate ? [gte(checkouts.createdAt, toUtcStart(startDate, tz))] : []),
      ...(endDate   ? [lte(checkouts.createdAt, toUtcEnd(endDate,   tz))] : []),
    );

    // Stock alerts use the store-wide threshold unless an item sets its own reorder point. Resolved inside the
    // query, so counting and listing the alerts needs no prior round trip for the settings row. A threshold of 0
    // means "unset" (the old `|| 5`).
    const storeThreshold = sql`COALESCE(NULLIF((SELECT ${settings.lowStockThreshold} FROM ${settings} WHERE ${settings.storeId} = ${storeId}), 0), 5)`;
    const itemThreshold = sql`COALESCE(${inventory.reorderPoint}, ${storeThreshold})`;

    // All queries run in parallel
    const [
      [{ total: totalCustomers }],
      [{ total: totalStaff }],
      [{ total: totalCheckouts }],
      [{ total: uniqueCustomersInPeriod }],
      [inventoryCounts],
      lowStockItems,
      settingsRows,
      plSummary,
      revenueMixRows,
      [lossRow],
    ] = await Promise.all([
      db.select({ total: count() }).from(customers).where(customerDateFilter),
      db.select({ total: count() }).from(staff).where(eq(staff.storeId, storeId)),
      db.select({ total: count() }).from(checkouts).where(checkoutDateFilter),
      db.select({ total: countDistinct(transactions.customerId) })
        .from(transactions)
        .innerJoin(checkouts, eq(checkouts.id, transactions.checkoutId))
        .where(checkoutDateFilter),
      // Counted by the database. This used to load every inventory row (a full `select *`) on each dashboard
      // load just to count and filter them in Node. Soft-deleted items are not stock: they are left out here as
      // they are from the inventory list, so a deleted product can no longer show up as an out-of-stock alert.
      //
      // Supplies are stock and run out, so they belong in the low-stock alert - running dry on shampoo stops
      // services just as surely as running dry on retail. Services are stockless and never alert.
      db.select({
        total: sql<number>`count(*)::int`,
        products: sql<number>`(count(*) FILTER (WHERE ${inventory.type} = 'product'))::int`,
        services: sql<number>`(count(*) FILTER (WHERE ${inventory.type} = 'service'))::int`,
        supplies: sql<number>`(count(*) FILTER (WHERE ${inventory.type} = 'supply'))::int`,
        outOfStock: sql<number>`(count(*) FILTER (WHERE ${inventory.type} IN ('product', 'supply') AND ${inventory.quantity} <= ${itemThreshold} AND ${inventory.quantity} = 0))::int`,
        lowStock: sql<number>`(count(*) FILTER (WHERE ${inventory.type} IN ('product', 'supply') AND ${inventory.quantity} <= ${itemThreshold} AND ${inventory.quantity} <> 0))::int`,
      }).from(inventory).where(and(eq(inventory.storeId, storeId), eq(inventory.isDeleted, false))),
      // Only the most urgent alerts travel to the browser (out of stock first, then lowest stock); the counts
      // above are exact, and the full list lives on the inventory screen.
      db.select().from(inventory).where(and(
        eq(inventory.storeId, storeId),
        eq(inventory.isDeleted, false),
        inArray(inventory.type, ["product", "supply"]),
        sql`${inventory.quantity} <= ${itemThreshold}`,
      )).orderBy(sql`CASE WHEN ${inventory.quantity} = 0 THEN 0 ELSE 1 END`, asc(inventory.quantity), asc(inventory.name)).limit(LOW_STOCK_LIST_LIMIT),
      db.select().from(settings).where(eq(settings.storeId, storeId)),
      this.salesRepo.getProfitLossSummary(storeId, startDate, endDate),
      this.getRevenueMixByType(storeId, startDate, endDate),
      // A receipt is one checkouts row per line; count receipts, sum the per-line shortfall.
      db.select({
        receipts: sql<number>`count(distinct ${checkouts.receiptNumber})::int`,
        amount: sql<number>`coalesce(sum(${checkouts.lossAmount}::numeric), 0)::float8`,
      }).from(checkouts).where(and(checkoutDateFilter, sql`${checkouts.lossAmount}::numeric > 0`)),
    ]);

    const lowStockThreshold = settingsRows[0]?.lowStockThreshold || 5;
    const outOfStockCount = inventoryCounts.outOfStock;
    const lowStockCount = inventoryCounts.lowStock;

    return {
      totalCustomers,
      totalStaff,
      totalInventory: inventoryCounts.total,
      totalProducts:  inventoryCounts.products,
      totalServices:  inventoryCounts.services,
      totalSupplies:  inventoryCounts.supplies,
      totalTransactions: totalCheckouts,
      uniqueCustomersInPeriod,
      totalRevenue:    plSummary.totalRevenue,
      grossRevenue:    plSummary.grossRevenue,
      returnedRevenue: plSummary.returnedRevenue,
      totalProfit:     plSummary.grossProfit,
      revenueMix: revenueMixRows,
      lowStockThreshold,
      lowStockItems,
      outOfStockCount,
      lowStockCount,
      lossSales: { count: Number(lossRow?.receipts ?? 0), amount: Number(lossRow?.amount ?? 0) },
    };
  }

  /**
   * Daily revenue and transaction counts, most recent 30 buckets.
   *
   * Previously this loaded EVERY checkout for the store with no date filter just
   * to build a lookup map, then bucketed with `toISOString()` — i.e. in UTC —
   * even though the range filter was timezone-aware. For a Lagos store that put
   * every sale between 00:00 and 01:00 local into the previous day. Both are
   * fixed by aggregating in SQL and bucketing through the store's timezone.
   */
  async getSalesTrends(storeId: string, startDate?: string, endDate?: string): Promise<{ date: string; revenue: number; transactions: number }[]> {
    const tz = await getStoreTimezone(storeId);
    const conditions: any[] = [
      eq(transactions.storeId, storeId),
      eq(checkouts.isVoided, false),
    ];
    if (startDate) conditions.push(gte(transactions.transactionDate, toUtcStart(startDate, tz)));
    if (endDate) conditions.push(lte(transactions.transactionDate, toUtcEnd(endDate, tz)));

    const bucket = sql<string>`((${transactions.transactionDate} AT TIME ZONE 'UTC' AT TIME ZONE ${stores.timezone})::date)::text`;

    const rows = await db
      .select({
        date: bucket,
        // checkouts.totalPrice is pre-tax/pre-discount; orders.refundedAmount is now
        // tax-inclusive (it refunds what the customer actually paid), so subtract only
        // its non-tax portion here to keep both sides of the subtraction on the same
        // pre-tax basis — otherwise a returned, taxed sale gets double-discounted.
        revenue: sql<number>`COALESCE(SUM(GREATEST((${checkouts.totalPrice})::numeric - (COALESCE((${orders.refundedAmount})::numeric, 0) - COALESCE((${orders.taxRefunded})::numeric, 0)), 0)), 0)`,
        transactions: sql<number>`COUNT(*)`,
      })
      .from(transactions)
      .innerJoin(stores, eq(stores.id, transactions.storeId))
      .innerJoin(checkouts, eq(checkouts.id, transactions.checkoutId))
      .leftJoin(orders, eq(orders.id, checkouts.orderId))
      .where(and(...conditions))
      .groupBy(bucket)
      .orderBy(bucket);

    return rows
      .map((r) => ({
        date: r.date,
        revenue: Number(r.revenue) || 0,
        transactions: Number(r.transactions) || 0,
      }))
      .slice(-30);
  }

  async getRevenueByType(storeId: string, startDate?: string, endDate?: string): Promise<{ name: string; value: number; type: string }[]> {
    const conditions: any[] = [
      eq(checkouts.storeId, storeId),
      eq(checkouts.paymentStatus, "completed"),
      eq(checkouts.isVoided, false),
    ];
    const tz = await getStoreTimezone(storeId);
    if (startDate) conditions.push(gte(checkouts.createdAt, toUtcStart(startDate, tz)));
    if (endDate) conditions.push(lte(checkouts.createdAt, toUtcEnd(endDate, tz)));

    const rows = await db
      .select({
        inventoryName: inventory.name,
        inventoryType: inventory.type,
        revenue: orders.totalPrice,
        refundedAmount: orders.refundedAmount,
        taxRefunded: orders.taxRefunded,
      })
      .from(orders)
      .innerJoin(checkouts, eq(orders.id, checkouts.orderId))
      .innerJoin(inventory, eq(orders.inventoryId, inventory.id))
      .where(and(...conditions));

    const grouped = new Map<string, { name: string; value: number; type: string }>();

    for (const row of rows) {
      const existing = grouped.get(row.inventoryName) || { name: row.inventoryName, value: 0, type: row.inventoryType };
      // orders.totalPrice is pre-tax; net only the non-tax portion of the refund
      // against it, same reasoning as getSalesTrends above.
      existing.value += Math.max(0, row.revenue - ((row.refundedAmount || 0) - (row.taxRefunded || 0)));
      grouped.set(row.inventoryName, existing);
    }

    const result = Array.from(grouped.values());
    return result.sort((a, b) => b.value - a.value).slice(0, 10);
  }

  /**
   * Revenue mix by inventory type, over the *entire* result set for the period —
   * unlike getRevenueByType, which caps at the top 10 items and is meant for a
   * per-item breakdown chart, this needs every order to add up to the true total.
   */
  async getRevenueMixByType(storeId: string, startDate?: string, endDate?: string): Promise<{ services: number; products: number }> {
    const conditions: any[] = [
      eq(checkouts.storeId, storeId),
      eq(checkouts.paymentStatus, "completed"),
      eq(checkouts.isVoided, false),
    ];
    const tz = await getStoreTimezone(storeId);
    if (startDate) conditions.push(gte(checkouts.createdAt, toUtcStart(startDate, tz)));
    if (endDate) conditions.push(lte(checkouts.createdAt, toUtcEnd(endDate, tz)));

    // Net of refunds with the tax part of a refund excluded, floored at zero per line, split by item type.
    // Anything that is not a service counts as a product here (unlike the P&L, which tests both directions).
    const net = sql`GREATEST(0, ${orders.totalPrice} - (COALESCE(${orders.refundedAmount}, 0) - COALESCE(${orders.taxRefunded}, 0)))`;
    const [row] = await db
      .select({
        services: sql<number>`COALESCE(SUM(${net}) FILTER (WHERE ${inventory.type} = 'service'), 0)::float8`,
        products: sql<number>`COALESCE(SUM(${net}) FILTER (WHERE ${inventory.type} IS DISTINCT FROM 'service'), 0)::float8`,
      })
      .from(orders)
      .innerJoin(checkouts, eq(orders.id, checkouts.orderId))
      .innerJoin(inventory, eq(orders.inventoryId, inventory.id))
      .where(and(...conditions));
    return { services: row?.services ?? 0, products: row?.products ?? 0 };
  }
}
