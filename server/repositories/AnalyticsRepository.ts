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
import { eq, and, gte, lte, desc, count, sql } from "drizzle-orm";
import type { SalesRepository } from "./SalesRepository";

export class AnalyticsRepository {
  constructor(private salesRepo: SalesRepository) {}

  async getDashboardStats(storeId: string, startDate?: string, endDate?: string) {
    // Build date filters once
    const tz = await getStoreTimezone(storeId);
    const customerDateFilter = startDate || endDate ? and(
      eq(customers.storeId, storeId),
      ...(startDate ? [gte(customers.createdAt, toUtcStart(startDate, tz))] : []),
      ...(endDate   ? [lte(customers.createdAt, toUtcEnd(endDate,   tz))] : []),
    ) : eq(customers.storeId, storeId);

    const checkoutDateFilter = and(
      eq(checkouts.storeId, storeId),
      eq(checkouts.isVoided, false),
      eq(checkouts.paymentStatus, "completed"),
      ...(startDate ? [gte(checkouts.createdAt, toUtcStart(startDate, tz))] : []),
      ...(endDate   ? [lte(checkouts.createdAt, toUtcEnd(endDate,   tz))] : []),
    );

    // All six queries run in parallel
    const [
      [{ total: totalCustomers }],
      [{ total: totalStaff }],
      [{ total: totalCheckouts }],
      allInventory,
      settingsRows,
      plSummary,
    ] = await Promise.all([
      db.select({ total: count() }).from(customers).where(customerDateFilter),
      db.select({ total: count() }).from(staff).where(eq(staff.storeId, storeId)),
      db.select({ total: count() }).from(checkouts).where(checkoutDateFilter),
      db.select().from(inventory).where(eq(inventory.storeId, storeId)),
      db.select().from(settings).where(eq(settings.storeId, storeId)),
      this.salesRepo.getProfitLossSummary(storeId, startDate, endDate),
    ]);

    const lowStockThreshold = settingsRows[0]?.lowStockThreshold || 5;
    const products  = allInventory.filter((i) => i.type === "product");
    const services  = allInventory.filter((i) => i.type === "service");
    const supplies  = allInventory.filter((i) => i.type === "supply");
    // Supplies are stock and run out, so they belong in the low-stock alert —
    // running dry on shampoo stops services just as surely as running dry on retail.
    const lowStockItems = [...products, ...supplies].filter((p) => p.quantity <= lowStockThreshold);

    return {
      totalCustomers,
      totalStaff,
      totalInventory: allInventory.length,
      totalProducts:  products.length,
      totalServices:  services.length,
      totalSupplies:  supplies.length,
      totalTransactions: totalCheckouts,
      totalRevenue:    plSummary.totalRevenue,
      grossRevenue:    plSummary.grossRevenue,
      returnedRevenue: plSummary.returnedRevenue,
      totalProfit:     plSummary.grossProfit,
      lowStockItems,
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
        revenue: sql<number>`COALESCE(SUM(GREATEST((${checkouts.totalPrice})::numeric - COALESCE((${orders.refundedAmount})::numeric, 0), 0)), 0)`,
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
      })
      .from(orders)
      .innerJoin(checkouts, eq(orders.id, checkouts.orderId))
      .innerJoin(inventory, eq(orders.inventoryId, inventory.id))
      .where(and(...conditions));

    const grouped = new Map<string, { name: string; value: number; type: string }>();

    for (const row of rows) {
      const existing = grouped.get(row.inventoryName) || { name: row.inventoryName, value: 0, type: row.inventoryType };
      existing.value += Math.max(0, row.revenue - (row.refundedAmount || 0));
      grouped.set(row.inventoryName, existing);
    }

    const result = Array.from(grouped.values());
    return result.sort((a, b) => b.value - a.value).slice(0, 10);
  }
}
