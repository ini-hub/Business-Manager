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
import { eq, and, gte, lte, sql, inArray, asc } from "drizzle-orm";
import type { SalesRepository } from "./SalesRepository";

/** The dashboard shows at most this many stock alerts; the counts alongside it are exact. */
const LOW_STOCK_LIST_LIMIT = 20;

export class AnalyticsRepository {
  constructor(private salesRepo: SalesRepository) {}

  async getDashboardStats(storeId: string, startDate?: string, endDate?: string) {
    // Build date filters once
    const tz = await getStoreTimezone(storeId);

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

    // Every plain count comes back in ONE statement (scalar subselects plus the inventory aggregate as a CTE).
    // They used to be seven parallel statements: on a remote database each is a round trip that also holds a
    // pool connection (10 total), so one dashboard load starved every other request queued behind it.
    //
    // Inventory is counted by the database, not loaded and filtered in Node. Soft-deleted items are not stock:
    // they are left out as they are from the inventory list, so a deleted product can no longer show up as an
    // out-of-stock alert. Supplies are stock and run out, so they belong in the low-stock alert - running dry on
    // shampoo stops services just as surely as running dry on retail. Services are stockless and never alert.
    // Total customers is unfiltered (like staff/inventory), not scoped to the date range. A receipt is one
    // checkouts row per line: count receipts, sum the per-line shortfall.
    const [[counts], lowStockItems, plSummary, revenueMixRows] = await Promise.all([
      db.execute(sql`
        WITH inv AS (
          SELECT
            count(*)::int AS total,
            (count(*) FILTER (WHERE ${inventory.type} = 'product'))::int AS products,
            (count(*) FILTER (WHERE ${inventory.type} = 'service'))::int AS services,
            (count(*) FILTER (WHERE ${inventory.type} = 'supply'))::int AS supplies,
            (count(*) FILTER (WHERE ${inventory.type} IN ('product', 'supply') AND ${inventory.quantity} <= ${itemThreshold} AND ${inventory.quantity} = 0))::int AS out_of_stock,
            (count(*) FILTER (WHERE ${inventory.type} IN ('product', 'supply') AND ${inventory.quantity} <= ${itemThreshold} AND ${inventory.quantity} <> 0))::int AS low_stock
          FROM ${inventory}
          WHERE ${inventory.storeId} = ${storeId} AND ${inventory.isDeleted} = false
        )
        SELECT
          inv.total, inv.products, inv.services, inv.supplies, inv.out_of_stock, inv.low_stock,
          (SELECT count(*)::int FROM ${customers} WHERE ${customers.storeId} = ${storeId}) AS total_customers,
          (SELECT count(*)::int FROM ${staff} WHERE ${staff.storeId} = ${storeId}) AS total_staff,
          (SELECT count(*)::int FROM ${checkouts} WHERE ${checkoutDateFilter}) AS total_checkouts,
          (SELECT count(DISTINCT ${transactions.customerId})::int
             FROM ${transactions} INNER JOIN ${checkouts} ON ${checkouts.id} = ${transactions.checkoutId}
             WHERE ${checkoutDateFilter}) AS unique_customers,
          (SELECT count(DISTINCT ${checkouts.receiptNumber})::int
             FROM ${checkouts} WHERE ${checkoutDateFilter} AND ${checkouts.lossAmount}::numeric > 0) AS loss_receipts,
          (SELECT coalesce(sum(${checkouts.lossAmount}::numeric), 0)::float8
             FROM ${checkouts} WHERE ${checkoutDateFilter} AND ${checkouts.lossAmount}::numeric > 0) AS loss_amount,
          ${storeThreshold}::int AS low_stock_threshold
        FROM inv
      `).then((r) => r.rows as any[]),
      // Only the most urgent alerts travel to the browser (out of stock first, then lowest stock); the counts
      // above are exact, and the full list lives on the inventory screen.
      db.select().from(inventory).where(and(
        eq(inventory.storeId, storeId),
        eq(inventory.isDeleted, false),
        inArray(inventory.type, ["product", "supply"]),
        sql`${inventory.quantity} <= ${itemThreshold}`,
      )).orderBy(sql`CASE WHEN ${inventory.quantity} = 0 THEN 0 ELSE 1 END`, asc(inventory.quantity), asc(inventory.name)).limit(LOW_STOCK_LIST_LIMIT),
      this.salesRepo.getProfitLossSummary(storeId, startDate, endDate),
      this.getRevenueMixByType(storeId, startDate, endDate),
    ]);

    const lowStockThreshold = Number(counts.low_stock_threshold) || 5;
    const outOfStockCount = Number(counts.out_of_stock);
    const lowStockCount = Number(counts.low_stock);
    const totalCustomers = Number(counts.total_customers);
    const totalStaff = Number(counts.total_staff);
    const totalCheckouts = Number(counts.total_checkouts);
    const uniqueCustomersInPeriod = Number(counts.unique_customers);
    const inventoryCounts = {
      total: Number(counts.total),
      products: Number(counts.products),
      services: Number(counts.services),
      supplies: Number(counts.supplies),
    };
    const lossRow = { receipts: counts.loss_receipts, amount: counts.loss_amount };

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
      lossSales: { count: Number(lossRow.receipts ?? 0), amount: Number(lossRow.amount ?? 0) },
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
