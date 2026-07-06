import { storage } from "../storage";
import { db } from "../db";
import { eq, and, gte, lte, gt, sql, or } from "drizzle-orm";
import { checkouts, orders, creditEntries, repayments } from "@shared/schema";
import { getStoreTimezone, toUtcStart, toUtcEnd } from "../lib/dateUtils";

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
      grossRevenue,
      returnedRevenue,
      totalRevenue,
      costOfGoodsSold,
      grossProfit,
      discountsGiven,
      discountsList,
    } = await storage.getProfitLossSummary(storeId, startDate, endDate);

    const expenseList = await storage.getExpenses(storeId, startDate, endDate, "general");

    const tz = await getStoreTimezone(storeId);
    const [badDebtRow] = await db
      .select({
        total: sql<number>`sum(${creditEntries.outstandingBalance})`,
      })
      .from(creditEntries)
      .where(
        and(
          eq(creditEntries.storeId, storeId),
          eq(creditEntries.status, "written_off"),
          startDate ? gte(creditEntries.updatedAt, toUtcStart(startDate, tz)) : sql`true`,
          endDate ? lte(creditEntries.updatedAt, toUtcEnd(endDate, tz)) : sql`true`
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
          startDate ? gte(creditEntries.updatedAt, toUtcStart(startDate, tz)) : sql`true`,
          endDate ? lte(creditEntries.updatedAt, toUtcEnd(endDate, tz)) : sql`true`
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
      grossRevenue,
      returnedRevenue,
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
    // 1. Fetch all inventory items and their parent products for this store
    const items = await storage.getInventory(storeId);
    const productList = await storage.getProducts(storeId);
    const productNameMap = new Map<string, string>(productList.map((p: any) => [p.id, p.name]));

    // 2. Fetch completed checkouts and their orders in the range
    const checkoutConditions: any[] = [
      eq(checkouts.storeId, storeId),
      eq(checkouts.paymentStatus, "completed"),
      eq(checkouts.isVoided, false),
    ];
    const tz2 = await getStoreTimezone(storeId);
    if (startDate) checkoutConditions.push(gte(checkouts.createdAt, toUtcStart(startDate, tz2)));
    if (endDate) checkoutConditions.push(lte(checkouts.createdAt, toUtcEnd(endDate, tz2)));

    const sales = await db
      .select({
        inventoryId: orders.inventoryId,
        quantity: orders.quantity,
        returnedQuantity: orders.returnedQuantity,
        refundedAmount: orders.refundedAmount,
        totalPrice: orders.totalPrice,
      })
      .from(orders)
      .innerJoin(checkouts, eq(orders.id, checkouts.orderId))
      .where(and(...checkoutConditions));

    // 3. Fetch all expenses linked to specific items in the period
    const allLinkedExpenses = await storage.getExpenses(storeId, startDate, endDate, "linked") as any[];

    // Pre-compute per-product sales metrics (count + revenue) for allocation
    // key = productId
    const productSalesCount = new Map<string, number>();
    const productSalesRevenue = new Map<string, number>();
    for (const item of items) {
      const itemSales = sales.filter(s => s.inventoryId === item.id);
      const pid = item.productId;
      const cnt = itemSales.reduce((s, r) => s + Math.max(0, r.quantity - (r.returnedQuantity || 0)), 0);
      const rev = itemSales.reduce((s, r) => s + Math.max(0, r.totalPrice - (r.refundedAmount || 0)), 0);
      productSalesCount.set(pid, (productSalesCount.get(pid) ?? 0) + cnt);
      productSalesRevenue.set(pid, (productSalesRevenue.get(pid) ?? 0) + rev);
    }

    // Build per-product sustaining cost and breakdown from linked expenses
    // sustainingMap: productId -> total allocated cost
    // breakdownMap:  productId -> [{ title, amount, percent }]
    const sustainingMap = new Map<string, number>();
    const breakdownMap  = new Map<string, { title: string; amount: number; percent: number }[]>();

    for (const exp of allLinkedExpenses) {
      const linked: { productId: string; productName: string }[] = exp.linkedProducts ?? [];

      // Legacy single-link: fall back to inventoryId → productId
      let linkedProductIds: string[] = linked.map(l => l.productId);
      if (linkedProductIds.length === 0 && exp.inventoryId) {
        const legacyItem = items.find(i => i.id === exp.inventoryId);
        if (legacyItem) linkedProductIds = [legacyItem.productId];
      }
      if (linkedProductIds.length === 0) continue;

      // Compute weight for each linked product
      const driver = exp.allocationDriver ?? "count";
      const weights = linkedProductIds.map(pid =>
        driver === "revenue"
          ? (productSalesRevenue.get(pid) ?? 0)
          : (productSalesCount.get(pid) ?? 0)
      );
      const totalWeight = weights.reduce((a, b) => a + b, 0);

      linkedProductIds.forEach((pid, idx) => {
        // If total weight is zero (nothing sold yet) fall back to equal share
        const share = totalWeight > 0 ? weights[idx] / totalWeight : 1 / linkedProductIds.length;
        const allocated = Number(exp.amount) * share;
        const percent = Math.round(share * 100);

        sustainingMap.set(pid, (sustainingMap.get(pid) ?? 0) + allocated);

        if (!breakdownMap.has(pid)) breakdownMap.set(pid, []);
        breakdownMap.get(pid)!.push({ title: exp.title, amount: allocated, percent });
      });
    }

    // 4. Group calculations per item
    const itemSummaries = items.map((item) => {
      const itemSales = sales.filter((s) => s.inventoryId === item.id);
      const revenue = itemSales.reduce((sum, s) => sum + Math.max(0, s.totalPrice - (s.refundedAmount || 0)), 0);
      const quantitySold = itemSales.reduce((sum, s) => sum + Math.max(0, s.quantity - (s.returnedQuantity || 0)), 0);
      const cogs = quantitySold * (item.costPrice ?? 0);
      const grossProfit = revenue - cogs;
      const grossProfitMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;

      const sustainingCosts = sustainingMap.get(item.productId) ?? 0;
      const sustainingBreakdown = breakdownMap.get(item.productId) ?? [];
      const netProfit = grossProfit - sustainingCosts;
      const netProfitMargin = revenue > 0 ? (netProfit / revenue) * 100 : 0;
      const status = netProfit > 0 ? "profit" : netProfit < 0 ? "loss" : "breakeven";

      return {
        id: item.id,
        productId: item.productId,
        productName: productNameMap.get(item.productId) || item.name,
        name: item.name,
        type: item.type,
        revenue,
        quantitySold,
        cogs,
        grossProfit,
        grossProfitMargin,
        sustainingCosts,
        sustainingBreakdown,
        netProfit,
        netProfitMargin,
        status,
      };
    });

    const services = itemSummaries.filter((s) => s.type === "service");
    const products = itemSummaries.filter((s) => s.type === "product");

    // 5. General overheads (unlinked expenses) grouped by category
    const unlinkedExpenses = await storage.getExpenses(storeId, startDate, endDate, "general");

    const tz3 = await getStoreTimezone(storeId);
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
          startDate ? gte(creditEntries.updatedAt, toUtcStart(startDate, tz3)) : sql`true`,
          endDate ? lte(creditEntries.updatedAt, toUtcEnd(endDate, tz3)) : sql`true`
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

    // 7. Discounts given in range (basket + loyalty point redemptions)
    const discountConditions: any[] = [
      eq(checkouts.storeId, storeId),
      eq(checkouts.paymentStatus, "completed"),
      eq(checkouts.isVoided, false),
      or(gt(checkouts.discountAmount, 0), gt(checkouts.pointsRedeemed, 0)),
    ];
    const tz4 = await getStoreTimezone(storeId);
    if (startDate) discountConditions.push(gte(checkouts.createdAt, toUtcStart(startDate, tz4)));
    if (endDate) discountConditions.push(lte(checkouts.createdAt, toUtcEnd(endDate, tz4)));

    const uniqueTxDiscounts = await db
      .select({
        discountAmount: checkouts.discountAmount,
        pointsRedeemed: checkouts.pointsRedeemed,
      })
      .from(checkouts)
      .where(and(...discountConditions));
    const totalDiscounts = uniqueTxDiscounts.reduce((sum, d) => sum + (d.discountAmount || 0) + ((d.pointsRedeemed || 0) * 10), 0);

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
