import { storage } from "../storage";
import { db } from "../db";
import { eq, and, gte, lte, gt, sql } from "drizzle-orm";
import { checkouts, orders, creditEntries, repayments } from "@shared/schema";

export class AnalyticsService {
  /**
   * Computes P&L summary metrics
   */
  public async getProfitLossSummary(
    storeId: string,
    startDate?: string,
    endDate?: string
  ): Promise<any> {
    const {
      serviceRevenue,
      productRevenue,
      totalRevenue,
      costOfGoodsSold,
      grossProfit,
      discountsGiven,
      discountsList,
    } = await storage.getProfitLossSummary(storeId, startDate, endDate);

    const expenseList = await storage.getExpenses(storeId, startDate, endDate, "general");

    const [badDebtRow] = await db
      .select({
        total: sql<number>`sum(${creditEntries.outstandingBalance})`,
      })
      .from(creditEntries)
      .where(
        and(
          eq(creditEntries.storeId, storeId),
          eq(creditEntries.status, "written_off"),
          startDate ? gte(creditEntries.updatedAt, new Date(startDate + "T00:00:00.000Z")) : sql`true`,
          endDate ? lte(creditEntries.updatedAt, new Date(endDate + "T23:59:59.999Z")) : sql`true`
        )
      );

    const writtenOffEntries = await db
      .select({
        id: creditEntries.id,
        amountOwed: creditEntries.amountOwed,
        amountPaidUpfront: creditEntries.amountPaidUpfront,
      })
      .from(creditEntries)
      .where(
        and(
          eq(creditEntries.storeId, storeId),
          eq(creditEntries.status, "written_off"),
          startDate ? gte(creditEntries.updatedAt, new Date(startDate + "T00:00:00.000Z")) : sql`true`,
          endDate ? lte(creditEntries.updatedAt, new Date(endDate + "T23:59:59.999Z")) : sql`true`
        )
      );

    let totalBadDebt = 0;
    for (const entry of writtenOffEntries) {
      const [repaymentsSum] = await db
        .select({
          total: sql<number>`sum(${repayments.amountReceived})`,
        })
        .from(repayments)
        .where(eq(repayments.creditEntryId, entry.id));
      
      const repaid = parseFloat(String(repaymentsSum?.total || 0));
      const originalOwed = entry.amountOwed - entry.amountPaidUpfront;
      const loss = Math.max(0, originalOwed - repaid);
      totalBadDebt += loss;
    }

    let totalOperationalExpenses = totalBadDebt;
    const expensesByCategory: Record<string, number> = {};

    if (totalBadDebt > 0) {
      expensesByCategory["Bad Debt — Written Off"] = totalBadDebt;
    }

    expenseList.forEach((e) => {
      // Exclude system Payroll category if it exists, as we will calculate it precisely below
      if (e.category?.isSystem && e.category?.name === "Payroll") return;

      totalOperationalExpenses += e.amount;
      const catName = e.category?.name || "Uncategorized";
      expensesByCategory[catName] = (expensesByCategory[catName] || 0) + e.amount;
    });

    const expensesGrouped = Object.entries(expensesByCategory).map(([category, amount]) => ({
      category,
      amount,
    }));

    // Fetch overlapping paid payroll periods via storage
    const payrollDetails = await storage.getPaidPayrollExpenses(storeId, startDate, endDate);
    const totalPayrollExpenses = payrollDetails.reduce((sum, p) => sum + p.amount, 0);

    const totalExpenses = totalOperationalExpenses + totalPayrollExpenses + discountsGiven;
    const operatingProfit = grossProfit - totalExpenses;

    return {
      serviceRevenue,
      productRevenue,
      totalRevenue,
      costOfGoodsSold,
      grossProfit,
      discountsGiven,
      discountsList,
      totalOperationalExpenses,
      totalPayrollExpenses,
      totalExpenses,
      operatingProfit,
      expensesGrouped,
      payrollDetails,
    };
  }

  /**
   * Computes detailed Service and Product profitability matrix
   */
  public async getServiceProfitability(
    storeId: string,
    startDate?: string,
    endDate?: string
  ): Promise<any> {
    // 1. Fetch all inventory items for this store
    const items = await storage.getInventory(storeId);

    // 2. Fetch completed checkouts and their orders in the range
    const checkoutConditions: any[] = [
      eq(checkouts.storeId, storeId),
      eq(checkouts.paymentStatus, "completed"),
      eq(checkouts.isVoided, false),
    ];
    if (startDate) checkoutConditions.push(gte(checkouts.createdAt, new Date(startDate + "T00:00:00.000Z")));
    if (endDate) checkoutConditions.push(lte(checkouts.createdAt, new Date(endDate + "T23:59:59.999Z")));

    const sales = await db
      .select({
        inventoryId: orders.inventoryId,
        quantity: orders.quantity,
        totalPrice: orders.totalPrice,
      })
      .from(orders)
      .innerJoin(checkouts, eq(orders.id, checkouts.orderId))
      .where(and(...checkoutConditions));

    // 3. Fetch all expenses linked to specific items in the period
    const allLinkedExpenses = await storage.getExpenses(storeId, startDate, endDate, "linked");

    // 4. Group calculations per item
    const itemSummaries = items.map((item) => {
      const itemSales = sales.filter((s) => s.inventoryId === item.id);
      const revenue = itemSales.reduce((sum, s) => sum + s.totalPrice, 0);
      const quantitySold = itemSales.reduce((sum, s) => sum + s.quantity, 0);
      const cogs = quantitySold * (item.costPrice ?? 0);
      const grossProfit = revenue - cogs;
      const grossProfitMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;

      const itemExpenses = allLinkedExpenses.filter((e) => e.inventoryId === item.id);
      const sustainingCosts = itemExpenses.reduce((sum, e) => sum + e.amount, 0);
      const netProfit = grossProfit - sustainingCosts;
      const netProfitMargin = revenue > 0 ? (netProfit / revenue) * 100 : 0;
      const status = netProfit > 0 ? "profit" : netProfit < 0 ? "loss" : "breakeven";

      return {
        id: item.id,
        name: item.name,
        type: item.type,
        revenue,
        quantitySold,
        cogs,
        grossProfit,
        grossProfitMargin,
        sustainingCosts,
        netProfit,
        netProfitMargin,
        status,
      };
    });

    const services = itemSummaries.filter((s) => s.type === "service");
    const products = itemSummaries.filter((s) => s.type === "product");

    // 5. General overheads (unlinked expenses) grouped by category
    const unlinkedExpenses = await storage.getExpenses(storeId, startDate, endDate, "general");

    const profitWrittenOffEntries = await db
      .select({
        id: creditEntries.id,
        amountOwed: creditEntries.amountOwed,
        amountPaidUpfront: creditEntries.amountPaidUpfront,
      })
      .from(creditEntries)
      .where(
        and(
          eq(creditEntries.storeId, storeId),
          eq(creditEntries.status, "written_off"),
          startDate ? gte(creditEntries.updatedAt, new Date(startDate + "T00:00:00.000Z")) : sql`true`,
          endDate ? lte(creditEntries.updatedAt, new Date(endDate + "T23:59:59.999Z")) : sql`true`
        )
      );

    let totalBadDebtProfit = 0;
    for (const entry of profitWrittenOffEntries) {
      const [repaymentsSum] = await db
        .select({
          total: sql<number>`sum(${repayments.amountReceived})`,
        })
        .from(repayments)
        .where(eq(repayments.creditEntryId, entry.id));
      
      const repaid = parseFloat(String(repaymentsSum?.total || 0));
      const originalOwed = entry.amountOwed - entry.amountPaidUpfront;
      const loss = Math.max(0, originalOwed - repaid);
      totalBadDebtProfit += loss;
    }

    const overheadsByCategory: Record<string, number> = {};

    if (totalBadDebtProfit > 0) {
      overheadsByCategory["Bad Debt — Written Off"] = totalBadDebtProfit;
    }

    unlinkedExpenses.forEach((e) => {
      if (e.category?.isSystem && e.category?.name === "Payroll") return;
      const catName = e.category?.name || "Uncategorized";
      overheadsByCategory[catName] = (overheadsByCategory[catName] || 0) + e.amount;
    });
    const generalOverheads = Object.entries(overheadsByCategory).map(([category, amount]) => ({
      category,
      amount,
    }));
    const totalGeneralOverhead = unlinkedExpenses.reduce((sum, e) => {
      if (e.category?.isSystem && e.category?.name === "Payroll") return sum;
      return sum + e.amount;
    }, 0) + totalBadDebtProfit;

    // 6. Paid payroll periods in range
    const payrollDetails = await storage.getPaidPayrollExpenses(storeId, startDate, endDate);
    const totalPayroll = payrollDetails.reduce((sum, p) => sum + p.amount, 0);

    // 7. Discounts given in range
    const discountConditions: any[] = [
      eq(checkouts.storeId, storeId),
      eq(checkouts.paymentStatus, "completed"),
      eq(checkouts.isVoided, false),
      gt(checkouts.discountAmount, 0),
    ];
    if (startDate) discountConditions.push(gte(checkouts.createdAt, new Date(startDate + "T00:00:00.000Z")));
    if (endDate) discountConditions.push(lte(checkouts.createdAt, new Date(endDate + "T23:59:59.999Z")));

    const uniqueTxDiscounts = await db
      .select({
        discountAmount: checkouts.discountAmount,
      })
      .from(checkouts)
      .where(and(...discountConditions));
    const totalDiscounts = uniqueTxDiscounts.reduce((sum, d) => sum + (d.discountAmount || 0), 0);

    // Final dynamic calculations
    const totalNetProfit = itemSummaries.reduce((sum, s) => sum + s.netProfit, 0);
    const operatingProfit = totalNetProfit - totalGeneralOverhead - totalPayroll - totalDiscounts;

    return {
      services,
      products,
      generalOverheads,
      totalGeneralOverhead,
      payrollDetails,
      totalPayroll,
      totalDiscounts,
      totalNetProfit,
      operatingProfit,
    };
  }
}

export const analyticsService = new AnalyticsService();
