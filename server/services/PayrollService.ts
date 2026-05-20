import { db } from "../db";
import { eq, and, gte, lte, gt } from "drizzle-orm";
import {
  payrollPeriods,
  payrollEntries,
  staff,
  checkouts,
  orders,
  inventory,
  attendanceRecords,
  transactions,
  type Settings,
  type PayrollEntryWithStaff,
  type DailySummaryLine,
  type CommissionBreakdown,
} from "@shared/schema";
import { storage } from "../storage";
import { CommissionSplitCalculator } from "./CommissionService";

export class PayrollService {
  /**
   * Option 4 Hybrid Model Commission Calculation Engine
   */
  public async calculatePayrollForPeriod(periodId: string): Promise<PayrollEntryWithStaff[]> {
    const [period] = await db.select().from(payrollPeriods).where(eq(payrollPeriods.id, periodId));
    if (!period) throw new Error("Payroll period not found");
    if (period.status === "paid") throw new Error("Cannot recalculate a paid payroll period.");

    const store = await storage.getStore(period.storeId);
    if (!store) throw new Error("Store not found");
    const business = await storage.getBusinessById(store.businessId);
    const splitCalculator = new CommissionSplitCalculator(business, store);

    // Fetch store settings snapshot or current settings
    const storeSettings = await storage.getSettings(period.storeId);
    const activeTransportRate = storeSettings.activeDayTransport ?? 1000;
    const passiveTransportRate = storeSettings.passiveDayTransport ?? 500;

    // Snapshot settings on the period if pending/approved to ensure historical stability
    await db.update(payrollPeriods)
      .set({ settingsSnapshot: storeSettings })
      .where(eq(payrollPeriods.id, periodId));

    // Get all staff for quick lookup
    const allStaff = await db.select().from(staff).where(eq(staff.storeId, period.storeId));
    const activeStaffList = allStaff.filter(s => !s.isArchived);
    const staffMap = new Map(allStaff.map(s => [s.id, s]));

    // Fetch all checkouts in period date range
    const periodCheckouts = await db.select({
      checkout: checkouts,
      order: orders,
      inventoryItem: inventory,
    })
      .from(checkouts)
      .innerJoin(orders, eq(checkouts.orderId, orders.id))
      .innerJoin(inventory, eq(orders.inventoryId, inventory.id))
      .where(and(
        eq(checkouts.storeId, period.storeId),
        gte(checkouts.createdAt, new Date(period.startDate + "T00:00:00.000Z")),
        lte(checkouts.createdAt, new Date(period.endDate + "T23:59:59.999Z")),
      ));

    // Fetch attendance records in period date range
    const attendanceList = await db.select()
      .from(attendanceRecords)
      .where(and(
        eq(attendanceRecords.storeId, period.storeId),
        gte(attendanceRecords.date, period.startDate),
        lte(attendanceRecords.date, period.endDate),
      ));

    // Group checkouts by discrete local date string YYYY-MM-DD
    const checkoutsByDate = new Map<string, typeof periodCheckouts>();
    for (const row of periodCheckouts) {
      const dateStr = row.checkout.createdAt.toISOString().split("T")[0];
      if (!checkoutsByDate.has(dateStr)) checkoutsByDate.set(dateStr, []);
      checkoutsByDate.get(dateStr)!.push(row);
    }

    // Group attendance by date -> staffId -> status
    const attendanceByDateStaff = new Map<string, Map<string, string>>();
    for (const rec of attendanceList) {
      if (!attendanceByDateStaff.has(rec.date)) attendanceByDateStaff.set(rec.date, new Map());
      attendanceByDateStaff.get(rec.date)!.set(rec.staffId, rec.status);
    }

    // Prepare per-staff summary accumulation
    const staffTotals = new Map<string, {
      activeDays: number;
      passiveDays: number;
      grossCommission: number;
    }>();

    for (const s of activeStaffList) {
      staffTotals.set(s.id, { activeDays: 0, passiveDays: 0, grossCommission: 0 });
    }

    // Loop through each distinct marked or transaction date in the period interval
    const allDateStrs = Array.from(new Set([
      ...Array.from(checkoutsByDate.keys()), 
      ...Array.from(attendanceByDateStaff.keys())
    ])).sort();

    for (const dateStr of allDateStrs) {
      if (dateStr < period.startDate || dateStr > period.endDate) continue;

      const dayCheckouts = checkoutsByDate.get(dateStr) || [];
      
      // Group dayCheckouts by receiptNumber to allocate pro-rata discounts with rounding correction
      const checkoutsByReceipt = new Map<string, typeof dayCheckouts>();
      for (const row of dayCheckouts) {
        if (!checkoutsByReceipt.has(row.checkout.receiptNumber)) {
          checkoutsByReceipt.set(row.checkout.receiptNumber, []);
        }
        checkoutsByReceipt.get(row.checkout.receiptNumber)!.push(row);
      }

      // Calculate effective prices for all checkouts
      const effectivePrices = new Map<string, number>();

      for (const [receiptNo, rows] of Array.from(checkoutsByReceipt.entries())) {
        const firstRow = rows[0];
        const totalDiscount = firstRow.checkout.discountAmount || 0;
        const subtotal = firstRow.checkout.subtotal || 1;

        if (totalDiscount <= 0) {
          for (const row of rows) {
            effectivePrices.set(row.checkout.id, row.checkout.totalPrice);
          }
        } else {
          let sumShares = 0;
          const shares = new Map<string, number>();

          for (const row of rows) {
            const share = Math.round((row.checkout.totalPrice / subtotal) * totalDiscount * 100) / 100;
            shares.set(row.checkout.id, share);
            sumShares += share;
          }

          const remainder = Math.round((totalDiscount - sumShares) * 100) / 100;
          if (remainder !== 0) {
            let maxRow = rows[0];
            for (const row of rows) {
              if (row.checkout.totalPrice > maxRow.checkout.totalPrice) {
                maxRow = row;
              }
            }
            const currentShare = shares.get(maxRow.checkout.id) || 0;
            shares.set(maxRow.checkout.id, Math.round((currentShare + remainder) * 100) / 100);
          }

          for (const row of rows) {
            const share = shares.get(row.checkout.id) || 0;
            effectivePrices.set(row.checkout.id, Math.max(0, row.checkout.totalPrice - share));
          }
        }
      }

      const dayServiceCheckouts = dayCheckouts.filter(c => c.inventoryItem.type === "service");

      // Identify all distinct staff assigned to any service line items that day
      const dailyActiveStaffIds = new Set<string>();
      let totalDailyServiceRevenue = 0;

      for (const row of dayServiceCheckouts) {
        const effectivePrice = effectivePrices.get(row.checkout.id) ?? row.checkout.totalPrice;
        totalDailyServiceRevenue += effectivePrice;
        const leadId = row.checkout.leadStaffId || row.checkout.staffId;
        dailyActiveStaffIds.add(leadId);
        if (row.checkout.assistingStaff1Id) dailyActiveStaffIds.add(row.checkout.assistingStaff1Id);
        if (row.checkout.assistingStaff2Id) dailyActiveStaffIds.add(row.checkout.assistingStaff2Id);
      }

      const activeStaffCount = dailyActiveStaffIds.size;
      const dayAttendance = attendanceByDateStaff.get(dateStr) || new Map<string, string>();

      staffTotals.forEach((totals, staffId) => {
        const isAssigned = dailyActiveStaffIds.has(staffId);
        const status = dayAttendance.get(staffId);

        if (status === "off_day" || status === "holiday") return;

        if (isAssigned) {
          totals.activeDays++;
        } else if (status === "present") {
          totals.passiveDays++;
        }
      });

      if (totalDailyServiceRevenue <= 0 || activeStaffCount === 0) continue;

      const transportRatio = totalDailyServiceRevenue > 0 ? (activeStaffCount * activeTransportRate) / totalDailyServiceRevenue : 0;

      for (const row of dayServiceCheckouts) {
        const effectivePrice = effectivePrices.get(row.checkout.id) ?? row.checkout.totalPrice;
        const serviceCommissionable = Math.max(0, effectivePrice * (1 - transportRatio));
        const serviceRate = splitCalculator.getStaffRate(row.inventoryItem);
        const perServicePool = serviceCommissionable * serviceRate;

        const leadId = row.checkout.leadStaffId || row.checkout.staffId;
        const assistants = [row.checkout.assistingStaff1Id, row.checkout.assistingStaff2Id].filter(Boolean) as string[];
        const staffCount = 1 + assistants.length;

        let leadShare: number;
        let asstShare: number;

        if (row.checkout.commissionSplit === "equal") {
          leadShare = 1 / staffCount;
          asstShare = 1 / staffCount;
        } else {
          leadShare = staffCount === 1 ? 1.0 : staffCount === 2 ? 0.8 : 0.6;
          asstShare = 0.2;
        }

        if (staffTotals.has(leadId)) {
          staffTotals.get(leadId)!.grossCommission += perServicePool * leadShare;
        }

        for (const asstId of assistants) {
          if (staffTotals.has(asstId)) {
            staffTotals.get(asstId)!.grossCommission += perServicePool * asstShare;
          }
        }
      }
    }

    const results: PayrollEntryWithStaff[] = [];

    for (const [staffId, totals] of Array.from(staffTotals.entries())) {
      const activeTransport = totals.activeDays * activeTransportRate;
      const passiveTransport = totals.passiveDays * passiveTransportRate;
      const totalTransport = activeTransport + passiveTransport;
      const staffMember = staffMap.get(staffId)!;
      let netPay = totalTransport + totals.grossCommission;

      if (staffMember.paymentMethod === "fixed") {
        netPay = staffMember.payPerMonth;
      }

      const [entry] = await db.insert(payrollEntries)
        .values({
          periodId,
          storeId: period.storeId,
          staffId,
          activeDays: totals.activeDays,
          passiveDays: totals.passiveDays,
          activeTransport,
          passiveTransport,
          totalTransport,
          grossCommission: totals.grossCommission,
          netPay,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [payrollEntries.periodId, payrollEntries.staffId],
          set: {
            activeDays: totals.activeDays,
            passiveDays: totals.passiveDays,
            activeTransport,
            passiveTransport,
            totalTransport,
            grossCommission: totals.grossCommission,
            netPay,
            updatedAt: new Date(),
          },
        })
        .returning();

      results.push({ ...entry, staff: staffMember });
    }

    return results.sort((a, b) => b.netPay - a.netPay);
  }

  /**
   * Option 4 Hybrid Model Drill-down for one staff member
   */
  public async getPayrollDrillDown(periodId: string, staffId: string): Promise<{
    dailySummary: DailySummaryLine[];
    transactions: CommissionBreakdown[];
  }> {
    const [period] = await db.select().from(payrollPeriods).where(eq(payrollPeriods.id, periodId));
    if (!period) throw new Error("Payroll period not found");

    const storeSettings = (period.settingsSnapshot as Settings | null) ?? (await storage.getSettings(period.storeId));
    const activeTransportRate = storeSettings.activeDayTransport ?? 1000;
    const passiveTransportRate = storeSettings.passiveDayTransport ?? 500;
    const baseCommissionRate = storeSettings.commissionRate ?? 0.30;

    const periodCheckouts = await db.select({
      checkout: checkouts,
      order: orders,
      inventoryItem: inventory,
      txn: transactions,
    })
      .from(checkouts)
      .innerJoin(orders, eq(checkouts.orderId, orders.id))
      .innerJoin(inventory, eq(orders.inventoryId, inventory.id))
      .innerJoin(transactions, eq(transactions.checkoutId, checkouts.id))
      .where(and(
        eq(checkouts.storeId, period.storeId),
        gte(checkouts.createdAt, new Date(period.startDate + "T00:00:00.000Z")),
        lte(checkouts.createdAt, new Date(period.endDate + "T23:59:59.999Z")),
      ));

    const attendanceList = await db.select()
      .from(attendanceRecords)
      .where(and(
        eq(attendanceRecords.storeId, period.storeId),
        eq(attendanceRecords.staffId, staffId),
        gte(attendanceRecords.date, period.startDate),
        lte(attendanceRecords.date, period.endDate),
      ));

    const attendanceMap = new Map(attendanceList.map(a => [a.date, a.status]));

    const checkoutsByDate = new Map<string, typeof periodCheckouts>();
    for (const row of periodCheckouts) {
      const dateStr = row.txn.transactionDate.toISOString().split("T")[0];
      if (!checkoutsByDate.has(dateStr)) checkoutsByDate.set(dateStr, []);
      checkoutsByDate.get(dateStr)!.push(row);
    }

    const allDateStrs = Array.from(new Set([
      ...Array.from(checkoutsByDate.keys()), 
      ...Array.from(attendanceMap.keys())
    ])).sort();

    const dailySummaryLines: DailySummaryLine[] = [];
    const breakdownList: CommissionBreakdown[] = [];

    for (const dateStr of allDateStrs) {
      if (dateStr < period.startDate || dateStr > period.endDate) continue;

      const dayCheckouts = checkoutsByDate.get(dateStr) || [];
      const dayServiceCheckouts = dayCheckouts.filter(c => c.inventoryItem.type === "service");

      const dailyActiveStaffIds = new Set<string>();
      let totalDailyServiceRevenue = 0;

      for (const row of dayServiceCheckouts) {
        totalDailyServiceRevenue += row.order.totalPrice;
        const leadId = row.checkout.leadStaffId || row.checkout.staffId;
        dailyActiveStaffIds.add(leadId);
        if (row.checkout.assistingStaff1Id) dailyActiveStaffIds.add(row.checkout.assistingStaff1Id);
        if (row.checkout.assistingStaff2Id) dailyActiveStaffIds.add(row.checkout.assistingStaff2Id);
      }

      const activeStaffCount = dailyActiveStaffIds.size;
      const isAssigned = dailyActiveStaffIds.has(staffId);
      const status = attendanceMap.get(dateStr);

      if (status === "off_day" || status === "holiday") continue;

      let dayType: "Active" | "Passive" | "Absent" = "Absent";
      let transport = 0;

      if (isAssigned) {
        dayType = "Active";
        transport = activeTransportRate;
      } else if (status === "present") {
        dayType = "Passive";
        transport = passiveTransportRate;
      } else {
        continue;
      }

      let commissionEarned = 0;
      const servicesWorkedNames: string[] = [];

      if (totalDailyServiceRevenue > 0 && activeStaffCount > 0 && isAssigned) {
        const commissionable = Math.max(0, totalDailyServiceRevenue - (activeStaffCount * activeTransportRate));
        const dailyCommissionPool = commissionable * baseCommissionRate;

        for (const row of dayServiceCheckouts) {
          const leadId = row.checkout.leadStaffId || row.checkout.staffId;
          const isLead = leadId === staffId;
          const isAsst1 = row.checkout.assistingStaff1Id === staffId;
          const isAsst2 = row.checkout.assistingStaff2Id === staffId;

          if (!isLead && !isAsst1 && !isAsst2) continue;

          const serviceWeight = row.order.totalPrice / totalDailyServiceRevenue;
          const perServicePool = serviceWeight * dailyCommissionPool;

          const assistants = [row.checkout.assistingStaff1Id, row.checkout.assistingStaff2Id].filter(Boolean) as string[];
          const staffCount = 1 + assistants.length;

          let leadShare: number;
          let asstShare: number;

          if (row.checkout.commissionSplit === "equal") {
            leadShare = 1 / staffCount;
            asstShare = 1 / staffCount;
          } else {
            leadShare = staffCount === 1 ? 1.0 : staffCount === 2 ? 0.8 : 0.6;
            asstShare = 0.2;
          }

          let role: "lead" | "assistant_1" | "assistant_2" = "lead";
          let share = leadShare;

          if (isLead) {
            role = "lead";
            share = leadShare;
            servicesWorkedNames.push(`${row.inventoryItem.name} (Lead)`);
          } else if (isAsst1) {
            role = "assistant_1";
            share = asstShare;
            servicesWorkedNames.push(`${row.inventoryItem.name} (Asst 1)`);
          } else if (isAsst2) {
            role = "assistant_2";
            share = asstShare;
            servicesWorkedNames.push(`${row.inventoryItem.name} (Asst 2)`);
          }

          const earned = perServicePool * share;
          commissionEarned += earned;

          breakdownList.push({
            checkoutId: row.checkout.id,
            receiptNumber: row.checkout.receiptNumber,
            transactionDate: row.txn.transactionDate.toISOString(),
            inventoryName: row.inventoryItem.name,
            inventoryType: row.inventoryItem.name,
            serviceAmount: row.order.totalPrice,
            commissionPool: perServicePool,
            role,
            share,
            earned,
          });
        }
      }

      dailySummaryLines.push({
        date: dateStr,
        dayType,
        transport,
        servicesWorked: servicesWorkedNames.length > 0 ? servicesWorkedNames.join(", ") : "—",
        commissionEarned,
        dailyTotal: transport + commissionEarned,
      });
    }

    return {
      dailySummary: dailySummaryLines.sort((a, b) => a.date.localeCompare(b.date)),
      transactions: breakdownList.sort((a, b) => a.transactionDate.localeCompare(b.transactionDate)),
    };
  }
}

export const payrollService = new PayrollService();
