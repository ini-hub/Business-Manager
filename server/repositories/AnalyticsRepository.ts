import { db } from "../db";
import {
  customers,
  staff,
  inventory,
  checkouts,
  transactions,
  orders,
  settings,
} from "@shared/schema";
import { eq, and, gte, lte, desc, count, sql } from "drizzle-orm";
import type { SalesRepository } from "./SalesRepository";

export class AnalyticsRepository {
  constructor(private salesRepo: SalesRepository) {}

  async getDashboardStats(storeId: string, startDate?: string, endDate?: string) {
    // Build date filters once
    const customerDateFilter = startDate || endDate ? and(
      eq(customers.storeId, storeId),
      ...(startDate ? [gte(customers.createdAt, new Date(startDate + "T00:00:00.000Z"))] : []),
      ...(endDate   ? [lte(customers.createdAt, new Date(endDate   + "T23:59:59.999Z"))] : []),
    ) : eq(customers.storeId, storeId);

    const checkoutDateFilter = and(
      eq(checkouts.storeId, storeId),
      eq(checkouts.isVoided, false),
      eq(checkouts.paymentStatus, "completed"),
      ...(startDate ? [gte(checkouts.createdAt, new Date(startDate + "T00:00:00.000Z"))] : []),
      ...(endDate   ? [lte(checkouts.createdAt, new Date(endDate   + "T23:59:59.999Z"))] : []),
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
    const lowStockItems = products.filter((p) => p.quantity <= lowStockThreshold);

    return {
      totalCustomers,
      totalStaff,
      totalInventory: allInventory.length,
      totalProducts:  products.length,
      totalServices:  services.length,
      totalTransactions: totalCheckouts,
      totalRevenue:    plSummary.totalRevenue,
      grossRevenue:    plSummary.grossRevenue,
      returnedRevenue: plSummary.returnedRevenue,
      totalProfit:     plSummary.grossProfit,
      lowStockItems,
    };
  }

  async getSalesTrends(storeId: string, startDate?: string, endDate?: string): Promise<{ date: string; revenue: number; transactions: number }[]> {
    const conditions: any[] = [eq(transactions.storeId, storeId)];
    if (startDate) conditions.push(gte(transactions.transactionDate, new Date(startDate + "T00:00:00.000Z")));
    if (endDate) conditions.push(lte(transactions.transactionDate, new Date(endDate + "T23:59:59.999Z")));

    const allTransactions = await db
      .select()
      .from(transactions)
      .where(and(...conditions))
      .orderBy(transactions.transactionDate);

    const allCheckouts = await db
      .select({
        checkout: checkouts,
        refundedAmount: orders.refundedAmount,
      })
      .from(checkouts)
      .leftJoin(orders, eq(checkouts.orderId, orders.id))
      .where(eq(checkouts.storeId, storeId));
    const checkoutMap = new Map(allCheckouts.map(c => [c.checkout.id, c]));

    const trendMap = new Map<string, { revenue: number; transactions: number }>();

    for (const tx of allTransactions) {
      const dateStr = new Date(tx.transactionDate).toISOString().split('T')[0];
      const checkoutData = checkoutMap.get(tx.checkoutId);
      if (!checkoutData || checkoutData.checkout.isVoided) continue;
      const revenue = Math.max(0, (checkoutData.checkout.totalPrice || 0) - (checkoutData.refundedAmount || 0));

      const existing = trendMap.get(dateStr) ?? { revenue: 0, transactions: 0 };
      trendMap.set(dateStr, {
        revenue: existing.revenue + revenue,
        transactions: existing.transactions + 1,
      });
    }

    const result = Array.from(trendMap.entries())
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return result.slice(-30);
  }

  async getRevenueByType(storeId: string, startDate?: string, endDate?: string): Promise<{ name: string; value: number; type: string }[]> {
    const conditions: any[] = [
      eq(checkouts.storeId, storeId),
      eq(checkouts.paymentStatus, "completed"),
      eq(checkouts.isVoided, false),
    ];
    if (startDate) conditions.push(gte(checkouts.createdAt, new Date(startDate + "T00:00:00.000Z")));
    if (endDate) conditions.push(lte(checkouts.createdAt, new Date(endDate + "T23:59:59.999Z")));

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
