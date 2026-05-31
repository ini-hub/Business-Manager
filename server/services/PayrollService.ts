import { db } from "../db";
import { eq, and, gte, lte } from "drizzle-orm";
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
   * Calculate Payroll For Period (Payroll V2.0 Calculation Engine)
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
        eq(checkouts.isVoided, false),
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

    // Generate resolved compensation mapping for each staff
    const resolvedComp = new Map<string, {
      paymentMethod: string;
      commissionType: string;
      commissionFixedAmount: number;
      commissionFormula: string;
      activeDayRate: number;
      passiveDayRate: number;
      leaveDayRate: number;
      payLeaveDays: boolean;
      holidayDayRate: number;
      payHolidayDays: boolean;
      offDayRate: number;
      payOffDays: boolean;
      commissionRate: number;
      baseSalary: number;
    }>();

    for (const s of allStaff) {
      const paymentMethod = s.overridePaymentMethod ? s.paymentMethod : storeSettings.defaultPaymentMethod;
      const commissionType = s.overrideCommission ? (s.commissionTypeOverride ?? storeSettings.commissionType) : storeSettings.commissionType;
      const commissionFixedAmount = s.overrideCommission ? (s.commissionFixedAmountOverride ?? storeSettings.commissionFixedAmount) : storeSettings.commissionFixedAmount;
      const commissionFormula = s.overrideFormula ? (s.commissionFormulaOverride ?? storeSettings.commissionFormula) : storeSettings.commissionFormula;
      
      const activeDayRate = s.overrideAttendanceRates ? (s.activeDayRateOverride ?? storeSettings.activeDayTransport) : storeSettings.activeDayTransport;
      const passiveDayRate = s.overrideAttendanceRates ? (s.passiveDayRateOverride ?? storeSettings.passiveDayTransport) : storeSettings.passiveDayTransport;
      const leaveDayRate = s.overrideAttendanceRates ? (s.leaveDayRateOverride ?? storeSettings.leaveDayRate) : storeSettings.leaveDayRate;
      const payLeaveDays = s.overrideAttendanceRates ? s.payLeaveDaysOverride : storeSettings.payLeaveDays;
      
      const holidayDayRate = s.overrideAttendanceRates ? (s.holidayDayRateOverride ?? storeSettings.holidayDayRate) : storeSettings.holidayDayRate;
      const payHolidayDays = s.overrideAttendanceRates ? s.payHolidayDaysOverride : storeSettings.payHolidayDays;
      
      const offDayRate = s.overrideAttendanceRates ? (s.offDayRateOverride ?? storeSettings.offDayRate) : storeSettings.offDayRate;
      const payOffDays = s.overrideAttendanceRates ? s.payOffDaysOverride : storeSettings.payOffDays;
      
      const commissionRate = s.commissionRateOverride ?? storeSettings.commissionRate;
      const baseSalary = s.overridePaymentMethod ? s.payPerMonth : storeSettings.fixedBaseAmount;

      resolvedComp.set(s.id, {
        paymentMethod,
        commissionType,
        commissionFixedAmount,
        commissionFormula,
        activeDayRate,
        passiveDayRate,
        leaveDayRate,
        payLeaveDays,
        holidayDayRate,
        payHolidayDays,
        offDayRate,
        payOffDays,
        commissionRate,
        baseSalary,
      });
    }

    // Helper to get dates in range
    const getDatesInRange = (start: string, end: string): string[] => {
      const dates: string[] = [];
      const curr = new Date(start);
      const last = new Date(end);
      while (curr <= last) {
        dates.push(curr.toISOString().split("T")[0]);
        curr.setDate(curr.getDate() + 1);
      }
      return dates;
    };

    const dateRange = getDatesInRange(period.startDate, period.endDate);

    // Group checkouts by receipt to distribute discounts correctly
    const effectivePrices = new Map<string, number>();
    for (const [dateStr, dayCheckouts] of Array.from(checkoutsByDate.entries())) {
      const checkoutsByReceipt = new Map<string, typeof dayCheckouts>();
      for (const row of dayCheckouts) {
        if (!checkoutsByReceipt.has(row.checkout.receiptNumber)) {
          checkoutsByReceipt.set(row.checkout.receiptNumber, []);
        }
        checkoutsByReceipt.get(row.checkout.receiptNumber)!.push(row);
      }

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
    }

    // Initialize per-staff totals maps
    const staffTotals = new Map<string, {
      activeDays: number;
      passiveDays: number;
      leaveDays: number;
      holidayDays: number;
      offDays: number;
      absentDays: number;
      serviceRevenueContribution: number;
      serviceCountWorked: number;
      checkoutsBreakdown: CommissionBreakdown[];
    }>();

    for (const s of activeStaffList) {
      staffTotals.set(s.id, {
        activeDays: 0,
        passiveDays: 0,
        leaveDays: 0,
        holidayDays: 0,
        offDays: 0,
        absentDays: 0,
        serviceRevenueContribution: 0,
        serviceCountWorked: 0,
        checkoutsBreakdown: [],
      });
    }

    // Loop through calendar days to calculate attendance categories and checkouts
    for (const dateStr of dateRange) {
      const dayCheckouts = checkoutsByDate.get(dateStr) || [];
      const dayServiceCheckouts = dayCheckouts.filter(c => c.inventoryItem.type === "service");

      // Identify staff active on services today
      const dailyActiveStaffIds = new Set<string>();
      for (const row of dayServiceCheckouts) {
        const leadId = row.checkout.leadStaffId || row.checkout.staffId;
        if (leadId) dailyActiveStaffIds.add(leadId);
        if (row.checkout.assistingStaff1Id) dailyActiveStaffIds.add(row.checkout.assistingStaff1Id);
        if (row.checkout.assistingStaff2Id) dailyActiveStaffIds.add(row.checkout.assistingStaff2Id);
      }

      const dayAttendance = attendanceByDateStaff.get(dateStr) || new Map<string, string>();

      // Record daily attendance categories for each staff member
      for (const s of activeStaffList) {
        const totals = staffTotals.get(s.id)!;
        const isAssigned = dailyActiveStaffIds.has(s.id);
        const status = dayAttendance.get(s.id);

        if (isAssigned) {
          totals.activeDays++;
        } else if (status === "present") {
          totals.passiveDays++;
        } else if (status === "leave") {
          totals.leaveDays++;
        } else if (status === "holiday") {
          totals.holidayDays++;
        } else if (status === "off_day") {
          totals.offDays++;
        } else if (status === "absent") {
          totals.absentDays++;
        } else {
          // If no marked attendance record, treat Sundays as off-days
          const dayOfWeek = new Date(dateStr + "T00:00:00").getDay();
          if (dayOfWeek === 0) {
            totals.offDays++;
          } else {
            // Default non-marked days to absent
            totals.absentDays++;
          }
        }
      }

      // Calculate checkout shares for active staff
      for (const row of dayServiceCheckouts) {
        const effectivePrice = effectivePrices.get(row.checkout.id) ?? row.checkout.totalPrice;
        const leadId = row.checkout.leadStaffId || row.checkout.staffId;
        const assistants = [row.checkout.assistingStaff1Id, row.checkout.assistingStaff2Id].filter(Boolean) as string[];
        const staffCount = 1 + assistants.length;

        let leadShare: number;
        let asst1Share = 0;
        let asst2Share = 0;

        if (row.checkout.commissionSplit === "equal") {
          leadShare = 1 / staffCount;
          asst1Share = assistants.length > 0 ? 1 / staffCount : 0;
          asst2Share = assistants.length > 1 ? 1 / staffCount : 0;
        } else {
          if (staffCount === 1) {
            leadShare = 1.0;
          } else if (staffCount === 2) {
            leadShare = (storeSettings.leadSplit2 ?? 80) / 100;
            asst1Share = (storeSettings.asstSplit2 ?? 20) / 100;
          } else {
            leadShare = (storeSettings.leadSplit3 ?? 60) / 100;
            asst1Share = (storeSettings.asst1Split3 ?? 20) / 100;
            asst2Share = (storeSettings.asst2Split3 ?? 20) / 100;
          }
        }

        const serviceRate = splitCalculator.getStaffRate(row.inventoryItem);
        const totalPool = effectivePrice * serviceRate;

        // Allocate lead
        if (staffTotals.has(leadId)) {
          const totals = staffTotals.get(leadId)!;
          totals.serviceRevenueContribution += effectivePrice * leadShare;
          totals.serviceCountWorked++;
          totals.checkoutsBreakdown.push({
            checkoutId: row.checkout.id,
            receiptNumber: row.checkout.receiptNumber,
            transactionDate: row.checkout.createdAt.toISOString(),
            inventoryName: row.inventoryItem.name,
            inventoryType: "service",
            serviceAmount: effectivePrice,
            commissionPool: totalPool,
            role: "lead",
            share: leadShare,
            earned: totalPool * leadShare,
          });
        }

        // Allocate assistants
        if (assistants.length > 0 && staffTotals.has(assistants[0])) {
          const totals = staffTotals.get(assistants[0])!;
          totals.serviceRevenueContribution += effectivePrice * asst1Share;
          totals.serviceCountWorked++;
          totals.checkoutsBreakdown.push({
            checkoutId: row.checkout.id,
            receiptNumber: row.checkout.receiptNumber,
            transactionDate: row.checkout.createdAt.toISOString(),
            inventoryName: row.inventoryItem.name,
            inventoryType: "service",
            serviceAmount: effectivePrice,
            commissionPool: totalPool,
            role: "assistant_1",
            share: asst1Share,
            earned: totalPool * asst1Share,
          });
        }

        if (assistants.length > 1 && staffTotals.has(assistants[1])) {
          const totals = staffTotals.get(assistants[1])!;
          totals.serviceRevenueContribution += effectivePrice * asst2Share;
          totals.serviceCountWorked++;
          totals.checkoutsBreakdown.push({
            checkoutId: row.checkout.id,
            receiptNumber: row.checkout.receiptNumber,
            transactionDate: row.checkout.createdAt.toISOString(),
            inventoryName: row.inventoryItem.name,
            inventoryType: "service",
            serviceAmount: effectivePrice,
            commissionPool: totalPool,
            role: "assistant_2",
            share: asst2Share,
            earned: totalPool * asst2Share,
          });
        }
      }
    }

    const results: PayrollEntryWithStaff[] = [];

    // Process calculations per staff member
    for (const [staffId, totals] of Array.from(staffTotals.entries())) {
      const staffMember = staffMap.get(staffId)!;
      const comp = resolvedComp.get(staffId)!;

      // 1. Calculate Attendance Pay
      const activePay = totals.activeDays * comp.activeDayRate;
      const passivePay = totals.passiveDays * comp.passiveDayRate;
      const leavePay = comp.payLeaveDays ? totals.leaveDays * comp.leaveDayRate : 0;
      const holidayPay = comp.payHolidayDays ? totals.holidayDays * comp.holidayDayRate : 0;
      const offDayPay = comp.payOffDays ? totals.offDays * comp.offDayRate : 0;

      const totalAttendancePay = activePay + passivePay + leavePay + holidayPay + offDayPay;

      // 2. Resolve Formula and Payout structure
      let grossCommission = 0;
      let netPay = 0;
      let attendanceDeduction = 0;
      let commissionableRevenue = 0;
      const formulaSteps: string[] = [];

      formulaSteps.push(`Step 1: Resolved compensation settings (Payment Method: ${comp.paymentMethod.toUpperCase()}, Commission Type: ${comp.commissionType}, Formula: ${comp.commissionFormula.toUpperCase()}, Base Salary: ₦${comp.baseSalary})`);
      formulaSteps.push(`Step 2: Compiled attendance logs (Active: ${totals.activeDays} days @ ₦${comp.activeDayRate}/day = ₦${activePay}, Passive: ${totals.passiveDays} days @ ₦${comp.passiveDayRate}/day = ₦${passivePay}, Leaves: ${totals.leaveDays} days (Paid: ${comp.payLeaveDays ? "Yes" : "No"}) @ ₦${comp.leaveDayRate}/day = ₦${leavePay}, Holidays: ${totals.holidayDays} days (Paid: ${comp.payHolidayDays ? "Yes" : "No"}) @ ₦${comp.holidayDayRate}/day = ₦${holidayPay}, Off-days: ${totals.offDays} days (Paid: ${comp.payOffDays ? "Yes" : "No"}) @ ₦${comp.offDayRate}/day = ₦${offDayPay}. Total Attendance Pay: ₦${totalAttendancePay})`);

      if (comp.paymentMethod === "fixed") {
        netPay = comp.baseSalary;
        grossCommission = 0;
        formulaSteps.push(`Step 3: Applied FIXED SALARY model. Fixed base salary is exactly ₦${comp.baseSalary} (services worked: ${totals.serviceCountWorked}, attendance pay ignored).`);
      } else {
        // Commissionable or Hybrid calculation
        if (comp.commissionFormula === "formula_a") {
          // Present days paid at a single rate (activeDayRate) deducted
          attendanceDeduction = (totals.activeDays + totals.passiveDays) * comp.activeDayRate;
          commissionableRevenue = totals.serviceRevenueContribution - attendanceDeduction;
          grossCommission = Math.max(0, commissionableRevenue) * comp.commissionRate;

          formulaSteps.push(`Step 3: Compiled service revenue contribution (₦${totals.serviceRevenueContribution.toFixed(2)} from ${totals.serviceCountWorked} services worked)`);
          formulaSteps.push(`Step 4: Applied FORMULA A deduction (Active+Passive days multiplied by active rate: ₦${attendanceDeduction}. Commissionable Revenue: ₦${totals.serviceRevenueContribution.toFixed(2)} - ₦${attendanceDeduction} = ₦${commissionableRevenue.toFixed(2)}, floored at ₦0)`);
          formulaSteps.push(`Step 5: Multiplied commission rate (${(comp.commissionRate * 100).toFixed(0)}% * ₦${Math.max(0, commissionableRevenue).toFixed(2)} = ₦${grossCommission.toFixed(2)} gross commission)`);
        } else if (comp.commissionFormula === "formula_b") {
          // Active & Passive separate rates deducted
          attendanceDeduction = activePay + passivePay;
          commissionableRevenue = totals.serviceRevenueContribution - attendanceDeduction;
          grossCommission = Math.max(0, commissionableRevenue) * comp.commissionRate;

          formulaSteps.push(`Step 3: Compiled service revenue contribution (₦${totals.serviceRevenueContribution.toFixed(2)} from ${totals.serviceCountWorked} services worked)`);
          formulaSteps.push(`Step 4: Applied FORMULA B deduction (Active transport ₦${activePay} + Passive transport ₦${passivePay} = ₦${attendanceDeduction}. Commissionable Revenue: ₦${totals.serviceRevenueContribution.toFixed(2)} - ₦${attendanceDeduction} = ₦${commissionableRevenue.toFixed(2)}, floored at ₦0)`);
          formulaSteps.push(`Step 5: Multiplied commission rate (${(comp.commissionRate * 100).toFixed(0)}% * ₦${Math.max(0, commissionableRevenue).toFixed(2)} = ₦${grossCommission.toFixed(2)} gross commission)`);
        } else if (comp.commissionFormula === "formula_c") {
          // Active, Passive, Leave & Holiday paid rates deducted
          attendanceDeduction = activePay + passivePay + leavePay + holidayPay;
          commissionableRevenue = totals.serviceRevenueContribution - attendanceDeduction;
          grossCommission = Math.max(0, commissionableRevenue) * comp.commissionRate;

          formulaSteps.push(`Step 3: Compiled service revenue contribution (₦${totals.serviceRevenueContribution.toFixed(2)} from ${totals.serviceCountWorked} services worked)`);
          formulaSteps.push(`Step 4: Applied FORMULA C deduction (Active ₦${activePay} + Passive ₦${passivePay} + Leaves ₦${leavePay} + Holidays ₦${holidayPay} = ₦${attendanceDeduction}. Commissionable Revenue: ₦${totals.serviceRevenueContribution.toFixed(2)} - ₦${attendanceDeduction} = ₦${commissionableRevenue.toFixed(2)}, floored at ₦0)`);
          formulaSteps.push(`Step 5: Multiplied commission rate (${(comp.commissionRate * 100).toFixed(0)}% * ₦${Math.max(0, commissionableRevenue).toFixed(2)} = ₦${grossCommission.toFixed(2)} gross commission)`);
        } else if (comp.commissionFormula === "formula_d") {
          // Pure Commission (No attendance deductions)
          commissionableRevenue = totals.serviceRevenueContribution;
          grossCommission = commissionableRevenue * comp.commissionRate;

          formulaSteps.push(`Step 3: Compiled service revenue contribution (₦${totals.serviceRevenueContribution.toFixed(2)} from ${totals.serviceCountWorked} services worked)`);
          formulaSteps.push(`Step 4: Applied FORMULA D (Pure commission - no attendance costs deducted. Commissionable Revenue: ₦${commissionableRevenue.toFixed(2)})`);
          formulaSteps.push(`Step 5: Multiplied commission rate (${(comp.commissionRate * 100).toFixed(0)}% * ₦${commissionableRevenue.toFixed(2)} = ₦${grossCommission.toFixed(2)} gross commission)`);
        } else if (comp.commissionFormula === "formula_f") {
          // Fixed Per Service worked
          commissionableRevenue = totals.serviceCountWorked;
          grossCommission = totals.serviceCountWorked * comp.commissionFixedAmount;

          formulaSteps.push(`Step 3: Counted distinct services worked (total: ${totals.serviceCountWorked} service items)`);
          formulaSteps.push(`Step 4: Applied FORMULA F (Fixed amount per service: ₦${comp.commissionFixedAmount})`);
          formulaSteps.push(`Step 5: Multiplied flat amount (${totals.serviceCountWorked} * ₦${comp.commissionFixedAmount} = ₦${grossCommission.toFixed(2)} gross commission)`);
        } else {
          // Fallback to standard Formula B
          attendanceDeduction = activePay + passivePay;
          commissionableRevenue = totals.serviceRevenueContribution - attendanceDeduction;
          grossCommission = Math.max(0, commissionableRevenue) * comp.commissionRate;
          formulaSteps.push(`Step 3: Applied standard fallback Formula B calculation.`);
        }

        // Calculate final Net Pay
        if (comp.paymentMethod === "hybrid") {
          netPay = comp.baseSalary + totalAttendancePay + grossCommission;
          formulaSteps.push(`Step 6: Added hybrid components (Base Salary: ₦${comp.baseSalary} + Attendance Pay: ₦${totalAttendancePay} + Gross Commission: ₦${grossCommission.toFixed(2)} = ₦${netPay.toFixed(2)} Net Pay)`);
        } else {
          // Commission only (Payment Method = commission)
          netPay = totalAttendancePay + grossCommission;
          formulaSteps.push(`Step 6: Added commission components (Attendance Pay: ₦${totalAttendancePay} + Gross Commission: ₦${grossCommission.toFixed(2)} = ₦${netPay.toFixed(2)} Net Pay)`);
        }
      }

      const calculationDetailsSnapshot = {
        paymentMethod: comp.paymentMethod,
        commissionType: comp.commissionType,
        commissionFormula: comp.commissionFormula,
        baseSalary: comp.baseSalary,
        activeDays: totals.activeDays,
        activeDayRate: comp.activeDayRate,
        activePay,
        passiveDays: totals.passiveDays,
        passiveDayRate: comp.passiveDayRate,
        passivePay,
        leaveDays: totals.leaveDays,
        leaveDayRate: comp.leaveDayRate,
        leavePay,
        holidayDays: totals.holidayDays,
        holidayDayRate: comp.holidayDayRate,
        holidayPay,
        offDays: totals.offDays,
        offDayRate: comp.offDayRate,
        offDayPay,
        totalAttendancePay,
        totalServiceRevenueContribution: totals.serviceRevenueContribution,
        attendanceDeduction,
        commissionableRevenue,
        commissionRate: comp.commissionRate,
        grossCommission,
        netPay,
        formulaSteps,
        formulaName: comp.commissionFormula === "formula_a" ? "Formula A" :
                     comp.commissionFormula === "formula_b" ? "Formula B" :
                     comp.commissionFormula === "formula_c" ? "Formula C" :
                     comp.commissionFormula === "formula_d" ? "Formula D" :
                     comp.commissionFormula === "formula_f" ? "Formula F" : "Hybrid Standard"
      };

      const [entry] = await db.insert(payrollEntries)
        .values({
          periodId,
          storeId: period.storeId,
          staffId,
          activeDays: totals.activeDays,
          passiveDays: totals.passiveDays,
          leaveDays: totals.leaveDays,
          holidayDays: totals.holidayDays,
          offDays: totals.offDays,
          absentDays: totals.absentDays,
          activeTransport: activePay,
          passiveTransport: passivePay,
          leavePay,
          holidayPay,
          offDayPay,
          totalTransport: totalAttendancePay,
          grossCommission,
          netPay,
          calculationDetails: calculationDetailsSnapshot,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [payrollEntries.periodId, payrollEntries.staffId],
          set: {
            activeDays: totals.activeDays,
            passiveDays: totals.passiveDays,
            leaveDays: totals.leaveDays,
            holidayDays: totals.holidayDays,
            offDays: totals.offDays,
            absentDays: totals.absentDays,
            activeTransport: activePay,
            passiveTransport: passivePay,
            leavePay,
            holidayPay,
            offDayPay,
            totalTransport: totalAttendancePay,
            grossCommission,
            netPay,
            calculationDetails: calculationDetailsSnapshot,
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
    const [staffMember] = await db.select().from(staff).where(eq(staff.id, staffId));
    if (!staffMember) throw new Error("Staff member not found");
    const store = await storage.getStore(period.storeId);
    if (!store) throw new Error("Store not found");
    const business = await storage.getBusinessById(store.businessId);
    const splitCalculator = new CommissionSplitCalculator(business, store);

    // Resolve compensation parameters for this staff member
    const comp = {
      paymentMethod: staffMember.overridePaymentMethod ? staffMember.paymentMethod : storeSettings.defaultPaymentMethod,
      commissionType: staffMember.overrideCommission ? (staffMember.commissionTypeOverride ?? storeSettings.commissionType) : storeSettings.commissionType,
      commissionFixedAmount: staffMember.overrideCommission ? (staffMember.commissionFixedAmountOverride ?? storeSettings.commissionFixedAmount) : storeSettings.commissionFixedAmount,
      commissionFormula: staffMember.overrideFormula ? (staffMember.commissionFormulaOverride ?? storeSettings.commissionFormula) : storeSettings.commissionFormula,
      
      activeDayRate: staffMember.overrideAttendanceRates ? (staffMember.activeDayRateOverride ?? storeSettings.activeDayTransport) : storeSettings.activeDayTransport,
      passiveDayRate: staffMember.overrideAttendanceRates ? (staffMember.passiveDayRateOverride ?? storeSettings.passiveDayTransport) : storeSettings.passiveDayTransport,
      leaveDayRate: staffMember.overrideAttendanceRates ? (staffMember.leaveDayRateOverride ?? storeSettings.leaveDayRate) : storeSettings.leaveDayRate,
      payLeaveDays: staffMember.overrideAttendanceRates ? staffMember.payLeaveDaysOverride : storeSettings.payLeaveDays,
      
      holidayDayRate: staffMember.overrideAttendanceRates ? (staffMember.holidayDayRateOverride ?? storeSettings.holidayDayRate) : storeSettings.holidayDayRate,
      payHolidayDays: staffMember.overrideAttendanceRates ? staffMember.payHolidayDaysOverride : storeSettings.payHolidayDays,
      
      offDayRate: staffMember.overrideAttendanceRates ? (staffMember.offDayRateOverride ?? storeSettings.offDayRate) : storeSettings.offDayRate,
      payOffDays: staffMember.overrideAttendanceRates ? staffMember.payOffDaysOverride : storeSettings.payOffDays,
      
      commissionRate: staffMember.commissionRateOverride ?? storeSettings.commissionRate,
      baseSalary: staffMember.overridePaymentMethod ? staffMember.payPerMonth : storeSettings.fixedBaseAmount,
    };

    // Fetch period checkouts and orders
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
        eq(checkouts.isVoided, false),
        gte(checkouts.createdAt, new Date(period.startDate + "T00:00:00.000Z")),
        lte(checkouts.createdAt, new Date(period.endDate + "T23:59:59.999Z")),
      ));

    // Fetch attendance records in period date range for this staff member
    const attendanceList = await db.select()
      .from(attendanceRecords)
      .where(and(
        eq(attendanceRecords.storeId, period.storeId),
        eq(attendanceRecords.staffId, staffId),
        gte(attendanceRecords.date, period.startDate),
        lte(attendanceRecords.date, period.endDate),
      ));

    const attendanceMap = new Map(attendanceList.map(a => [a.date, a.status]));

    // Group checkouts by date
    const checkoutsByDate = new Map<string, typeof periodCheckouts>();
    for (const row of periodCheckouts) {
      const dateStr = row.checkout.createdAt.toISOString().split("T")[0];
      if (!checkoutsByDate.has(dateStr)) checkoutsByDate.set(dateStr, []);
      checkoutsByDate.get(dateStr)!.push(row);
    }

    // Helper to get dates in range
    const getDatesInRange = (start: string, end: string): string[] => {
      const dates: string[] = [];
      const curr = new Date(start);
      const last = new Date(end);
      while (curr <= last) {
        dates.push(curr.toISOString().split("T")[0]);
        curr.setDate(curr.getDate() + 1);
      }
      return dates;
    };

    const dateRange = getDatesInRange(period.startDate, period.endDate);

    // Group checkouts by receipt to distribute discounts correctly
    const effectivePrices = new Map<string, number>();
    for (const [dateStr, dayCheckouts] of Array.from(checkoutsByDate.entries())) {
      const checkoutsByReceipt = new Map<string, typeof dayCheckouts>();
      for (const row of dayCheckouts) {
        if (!checkoutsByReceipt.has(row.checkout.receiptNumber)) {
          checkoutsByReceipt.set(row.checkout.receiptNumber, []);
        }
        checkoutsByReceipt.get(row.checkout.receiptNumber)!.push(row);
      }

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
    }

    const dailySummaryLines: DailySummaryLine[] = [];
    const breakdownList: CommissionBreakdown[] = [];

    // Loop through calendar days to compile daily details
    for (const dateStr of dateRange) {
      const dayCheckouts = checkoutsByDate.get(dateStr) || [];
      const dayServiceCheckouts = dayCheckouts.filter(c => c.inventoryItem.type === "service");

      // Identify staff active on services today
      const dailyActiveStaffIds = new Set<string>();
      for (const row of dayServiceCheckouts) {
        const leadId = row.checkout.leadStaffId || row.checkout.staffId;
        if (leadId) dailyActiveStaffIds.add(leadId);
        if (row.checkout.assistingStaff1Id) dailyActiveStaffIds.add(row.checkout.assistingStaff1Id);
        if (row.checkout.assistingStaff2Id) dailyActiveStaffIds.add(row.checkout.assistingStaff2Id);
      }

      const isAssigned = dailyActiveStaffIds.has(staffId);
      const status = attendanceMap.get(dateStr);

      let dayType: "Active" | "Passive" | "Absent" = "Absent";
      let transport = 0;

      if (isAssigned) {
        dayType = "Active";
        transport = comp.activeDayRate;
      } else if (status === "present") {
        dayType = "Passive";
        transport = comp.passiveDayRate;
      } else if (status === "leave") {
        dayType = comp.payLeaveDays ? "Passive" : "Absent";
        transport = comp.payLeaveDays ? comp.leaveDayRate : 0;
      } else if (status === "holiday") {
        dayType = comp.payHolidayDays ? "Passive" : "Absent";
        transport = comp.payHolidayDays ? comp.holidayDayRate : 0;
      } else if (status === "off_day") {
        dayType = comp.payOffDays ? "Passive" : "Absent";
        transport = comp.payOffDays ? comp.offDayRate : 0;
      } else {
        const dayOfWeek = new Date(dateStr + "T00:00:00").getDay();
        if (dayOfWeek === 0) {
          dayType = comp.payOffDays ? "Passive" : "Absent";
          transport = comp.payOffDays ? comp.offDayRate : 0;
        } else {
          dayType = "Absent";
          transport = 0;
        }
      }

      let commissionEarned = 0;
      const servicesWorkedNames: string[] = [];

      if (isAssigned) {
        for (const row of dayServiceCheckouts) {
          const effectivePrice = effectivePrices.get(row.checkout.id) ?? row.checkout.totalPrice;
          const leadId = row.checkout.leadStaffId || row.checkout.staffId;
          const assistants = [row.checkout.assistingStaff1Id, row.checkout.assistingStaff2Id].filter(Boolean) as string[];
          const staffCount = 1 + assistants.length;

          const isLead = leadId === staffId;
          const isAsst1 = assistants[0] === staffId;
          const isAsst2 = assistants[1] === staffId;

          if (!isLead && !isAsst1 && !isAsst2) continue;

          let leadShare: number;
          let asst1Share = 0;
          let asst2Share = 0;

          if (row.checkout.commissionSplit === "equal") {
            leadShare = 1 / staffCount;
            asst1Share = assistants.length > 0 ? 1 / staffCount : 0;
            asst2Share = assistants.length > 1 ? 1 / staffCount : 0;
          } else {
            if (staffCount === 1) {
              leadShare = 1.0;
            } else if (staffCount === 2) {
              leadShare = (storeSettings.leadSplit2 ?? 80) / 100;
              asst1Share = (storeSettings.asstSplit2 ?? 20) / 100;
            } else {
              leadShare = (storeSettings.leadSplit3 ?? 60) / 100;
              asst1Share = (storeSettings.asst1Split3 ?? 20) / 100;
              asst2Share = (storeSettings.asst2Split3 ?? 20) / 100;
            }
          }

          const serviceRate = splitCalculator.getStaffRate(row.inventoryItem);
          const totalPool = effectivePrice * serviceRate;

          let role: "lead" | "assistant_1" | "assistant_2" = "lead";
          let share = 0;

          if (isLead) {
            role = "lead";
            share = leadShare;
            servicesWorkedNames.push(`${row.inventoryItem.name} (Lead)`);
          } else if (isAsst1) {
            role = "assistant_1";
            share = asst1Share;
            servicesWorkedNames.push(`${row.inventoryItem.name} (Asst 1)`);
          } else if (isAsst2) {
            role = "assistant_2";
            share = asst2Share;
            servicesWorkedNames.push(`${row.inventoryItem.name} (Asst 2)`);
          }

          let earned = 0;
          if (comp.commissionFormula === "formula_f") {
            earned = comp.commissionFixedAmount;
          } else {
            earned = totalPool * share;
          }

          commissionEarned += earned;

          breakdownList.push({
            checkoutId: row.checkout.id,
            receiptNumber: row.checkout.receiptNumber,
            transactionDate: row.checkout.createdAt.toISOString(),
            inventoryName: row.inventoryItem.name,
            inventoryType: "service",
            serviceAmount: effectivePrice,
            commissionPool: totalPool,
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
