import { db } from "../db";
import { getStoreTimezone, toUtcStart, toUtcEnd, storeLocalDate } from "../lib/dateUtils";
import { eq, and, gte, lte, gt, inArray } from "drizzle-orm";
import {
  payrollPeriods,
  payrollEntries,
  payrollDeductions,
  staff,
  checkouts,
  orders,
  inventory,
  attendanceRecords,
  type Settings,
  type PayrollEntryWithStaff,
  type DailySummaryLine,
  type CommissionBreakdown,
  type CommissionReconciliation,
  type PayrollDrilldown,
} from "@shared/schema";
import { explainCommission, formulaLabel } from "@shared/commission-explainer";
import { storage } from "../storage";
import { classifyDay, transportForDay } from "./attendance/dayTyping";
import { buildScheduleResolver, exceptionKey, type ScheduleResolver } from "./attendance/scheduleResolver";
import { staffCreditDeductionService } from "./StaffCreditDeductionService";
import { salaryAdvanceDeductionService } from "./SalaryAdvanceDeductionService";
import { lateArrivalDeductionService } from "./LateArrivalDeductionService";
import { commissionForFormula } from "./payroll/commissionFormula";

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

    // Auto-inject carry-forward deductions from previous paid periods
    const prevPaidPeriods = await db.select().from(payrollPeriods).where(
      and(eq(payrollPeriods.storeId, period.storeId), eq(payrollPeriods.status, "paid"))
    );
    if (prevPaidPeriods.length > 0) {
      const prevEntries = await db.select().from(payrollEntries).where(
        and(
          inArray(payrollEntries.periodId, prevPaidPeriods.map(p => p.id)),
          gt(payrollEntries.carryForwardAmount, 0),
        )
      );
      for (const prev of prevEntries) {
        const existing = await db.select().from(payrollDeductions).where(
          and(
            eq(payrollDeductions.periodId, periodId),
            eq(payrollDeductions.staffId, prev.staffId),
            eq(payrollDeductions.type, "carry_forward"),
          )
        );
        if (existing.length === 0) {
          const src = prevPaidPeriods.find(p => p.id === prev.periodId);
          const label = src
            ? `Balance carried from ${src.startDate} – ${src.endDate}`
            : "Balance carried from previous period";
          await db.insert(payrollDeductions).values({
            periodId,
            storeId: period.storeId,
            staffId: prev.staffId,
            type: "carry_forward",
            label,
            amount: prev.carryForwardAmount,
          });
        }
      }
    }

    const timezone = await getStoreTimezone(period.storeId);

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
        gte(checkouts.createdAt, toUtcStart(period.startDate, timezone)),
        lte(checkouts.createdAt, toUtcEnd(period.endDate, timezone)),
      ));

    // Fetch attendance records in period date range
    const attendanceList = await db.select()
      .from(attendanceRecords)
      .where(and(
        eq(attendanceRecords.storeId, period.storeId),
        gte(attendanceRecords.date, period.startDate),
        lte(attendanceRecords.date, period.endDate),
      ));

    // Rosters, so an unmarked day can be told apart from an absence. Two queries,
    // loaded once before the day loop rather than per staff per day.
    const scheduledOff = await this.loadScheduleResolver(period.storeId, period.startDate, period.endDate, storeSettings);

    // Group checkouts by discrete local date string YYYY-MM-DD.
    //
    // Store-local, not UTC. The window above is store-local and `dateRange`
    // below is store-local, so a UTC bucket key silently misses: in
    // Africa/Lagos (UTC+1) a sale at 00:30 local is 23:30Z the previous day,
    // and on the period's first day that key is not in `dateRange` at all —
    // the sale vanished from both the revenue total and the active-day typing.
    const checkoutsByDate = new Map<string, typeof periodCheckouts>();
    for (const row of periodCheckouts) {
      const dateStr = storeLocalDate(row.checkout.createdAt, timezone);
      if (!checkoutsByDate.has(dateStr)) checkoutsByDate.set(dateStr, []);
      checkoutsByDate.get(dateStr)!.push(row);
    }

    // Group attendance by date -> staffId -> status
    const attendanceByDateStaff = new Map<string, Map<string, string>>();
    for (const rec of attendanceList) {
      if (!attendanceByDateStaff.has(rec.date)) attendanceByDateStaff.set(rec.date, new Map());
      attendanceByDateStaff.get(rec.date)!.set(rec.staffId, rec.status);
    }

    // Helper to get dates in range (defined early so prorateBase can use it below)
    const getDatesInRangeEarly = (start: string, end: string): string[] => {
      const dates: string[] = [];
      const curr = new Date(start);
      const last = new Date(end);
      while (curr <= last) {
        dates.push(curr.toISOString().split("T")[0]);
        curr.setDate(curr.getDate() + 1);
      }
      return dates;
    };

    // G1: Prorate the monthly base salary to match the actual period type.
    // payPerMonth / fixedBaseAmount are always stored as monthly figures.
    // - monthly  → full amount (31-day months must not overpay vs 28-day months)
    // - biweekly → exactly half the monthly salary
    // - weekly   → 7/30 of the monthly salary (standardised sub-monthly slice)
    const prorateBase = (monthly: number): number => {
      switch (period.periodType) {
        case "monthly":  return monthly;
        case "biweekly": return Math.round((monthly / 2) * 100) / 100;
        case "weekly":   return Math.round((monthly * 7 / 30) * 100) / 100;
        default:         return monthly;
      }
    };

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
      monthlyBaseSalary: number;
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
      const monthlyBaseSalary = s.overridePaymentMethod ? s.payPerMonth : storeSettings.fixedBaseAmount;
      // G1: apply proration so weekly/biweekly periods don't pay the full monthly base
      const baseSalary = prorateBase(monthlyBaseSalary);

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
        monthlyBaseSalary,
      });
    }

    // dateRange already computed above via getDatesInRangeEarly (used for proration)
    const dateRange = getDatesInRangeEarly(period.startDate, period.endDate);

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
        const classification = classifyDay({
          isAssignedToService: dailyActiveStaffIds.has(s.id),
          attendanceStatus: dayAttendance.get(s.id),
          scheduledOff: scheduledOff(s.id, dateStr),
        });

        switch (classification) {
          case "active":  totals.activeDays++;  break;
          case "passive": totals.passiveDays++; break;
          case "leave":   totals.leaveDays++;   break;
          case "holiday": totals.holidayDays++; break;
          case "off":     totals.offDays++;     break;
          case "absent":  totals.absentDays++;  break;
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

        // Each participant banks their slice of the service price. That slice
        // is the commission base — the formula below decides what fraction of
        // it becomes pay. The per-line detail is rebuilt on demand by
        // getPayrollDrillDown rather than accumulated here.
        const allocate = (staffId: string | null, share: number) => {
          if (!staffId) return;
          const totals = staffTotals.get(staffId);
          if (!totals) return;
          totals.serviceRevenueContribution += effectivePrice * share;
          totals.serviceCountWorked++;
        };

        allocate(leadId, leadShare);
        if (assistants.length > 0) allocate(assistants[0], asst1Share);
        if (assistants.length > 1) allocate(assistants[1], asst2Share);
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

      const prorateNote = period.periodType !== "monthly"
        ? ` [prorated for ${period.periodType}: ₦${comp.monthlyBaseSalary}/month → ₦${comp.baseSalary}]`
        : "";
      formulaSteps.push(`Step 1: Resolved compensation settings (Payment Method: ${comp.paymentMethod.toUpperCase()}, Commission Type: ${comp.commissionType}, Formula: ${comp.commissionFormula.toUpperCase()}, Base Salary: ₦${comp.baseSalary}${prorateNote})`);
      formulaSteps.push(`Step 2: Compiled attendance logs (Active: ${totals.activeDays} days @ ₦${comp.activeDayRate}/day = ₦${activePay}, Passive: ${totals.passiveDays} days @ ₦${comp.passiveDayRate}/day = ₦${passivePay}, Leaves: ${totals.leaveDays} days (Paid: ${comp.payLeaveDays ? "Yes" : "No"}) @ ₦${comp.leaveDayRate}/day = ₦${leavePay}, Holidays: ${totals.holidayDays} days (Paid: ${comp.payHolidayDays ? "Yes" : "No"}) @ ₦${comp.holidayDayRate}/day = ₦${holidayPay}, Off-days: ${totals.offDays} days (Paid: ${comp.payOffDays ? "Yes" : "No"}) @ ₦${comp.offDayRate}/day = ₦${offDayPay}. Total Attendance Pay: ₦${totalAttendancePay})`);

      if (comp.paymentMethod === "fixed") {
        netPay = comp.baseSalary;
        grossCommission = 0;
        formulaSteps.push(`Step 3: Applied FIXED SALARY model. Base salary ₦${comp.baseSalary}${period.periodType !== "monthly" ? ` (prorated from ₦${comp.monthlyBaseSalary}/month for ${period.periodType} period)` : ""} — services worked: ${totals.serviceCountWorked}, attendance transport not applicable.`);
      } else {
        // Commissionable or Hybrid calculation.
        // The money comes from commissionForFormula so the branches cannot
        // drift apart; each one below only narrates its own step.
        ({ attendanceDeduction, commissionableRevenue, grossCommission } = commissionForFormula(
          comp.commissionFormula,
          {
            serviceRevenueContribution: totals.serviceRevenueContribution,
            serviceCountWorked: totals.serviceCountWorked,
            commissionRate: comp.commissionRate,
            commissionFixedAmount: comp.commissionFixedAmount,
            activeDays: totals.activeDays,
            passiveDays: totals.passiveDays,
            activeDayRate: comp.activeDayRate,
            activePay, passivePay, leavePay, holidayPay,
          },
        ));

        if (comp.commissionFormula === "formula_a") {
          formulaSteps.push(`Step 3: Compiled service revenue contribution (₦${totals.serviceRevenueContribution.toFixed(2)} from ${totals.serviceCountWorked} services worked)`);
          formulaSteps.push(`Step 4: Applied FORMULA A deduction (Active+Passive days multiplied by active rate: ₦${attendanceDeduction}. Commissionable Revenue: ₦${totals.serviceRevenueContribution.toFixed(2)} - ₦${attendanceDeduction} = ₦${commissionableRevenue.toFixed(2)}, floored at ₦0)`);
          formulaSteps.push(`Step 5: Multiplied commission rate (${(comp.commissionRate * 100).toFixed(0)}% * ₦${Math.max(0, commissionableRevenue).toFixed(2)} = ₦${grossCommission.toFixed(2)} gross commission)`);
        } else if (comp.commissionFormula === "formula_b") {
          formulaSteps.push(`Step 3: Compiled service revenue contribution (₦${totals.serviceRevenueContribution.toFixed(2)} from ${totals.serviceCountWorked} services worked)`);
          formulaSteps.push(`Step 4: Applied FORMULA B deduction (Active transport ₦${activePay} + Passive transport ₦${passivePay} = ₦${attendanceDeduction}. Commissionable Revenue: ₦${totals.serviceRevenueContribution.toFixed(2)} - ₦${attendanceDeduction} = ₦${commissionableRevenue.toFixed(2)}, floored at ₦0)`);
          formulaSteps.push(`Step 5: Multiplied commission rate (${(comp.commissionRate * 100).toFixed(0)}% * ₦${Math.max(0, commissionableRevenue).toFixed(2)} = ₦${grossCommission.toFixed(2)} gross commission)`);
        } else if (comp.commissionFormula === "formula_c") {
          formulaSteps.push(`Step 3: Compiled service revenue contribution (₦${totals.serviceRevenueContribution.toFixed(2)} from ${totals.serviceCountWorked} services worked)`);
          formulaSteps.push(`Step 4: Applied FORMULA C deduction (Active ₦${activePay} + Passive ₦${passivePay} + Leaves ₦${leavePay} + Holidays ₦${holidayPay} = ₦${attendanceDeduction}. Commissionable Revenue: ₦${totals.serviceRevenueContribution.toFixed(2)} - ₦${attendanceDeduction} = ₦${commissionableRevenue.toFixed(2)}, floored at ₦0)`);
          formulaSteps.push(`Step 5: Multiplied commission rate (${(comp.commissionRate * 100).toFixed(0)}% * ₦${Math.max(0, commissionableRevenue).toFixed(2)} = ₦${grossCommission.toFixed(2)} gross commission)`);
        } else if (comp.commissionFormula === "formula_d") {
          formulaSteps.push(`Step 3: Compiled service revenue contribution (₦${totals.serviceRevenueContribution.toFixed(2)} from ${totals.serviceCountWorked} services worked)`);
          formulaSteps.push(`Step 4: Applied FORMULA D (Pure commission - no attendance costs deducted. Commissionable Revenue: ₦${commissionableRevenue.toFixed(2)})`);
          formulaSteps.push(`Step 5: Multiplied commission rate (${(comp.commissionRate * 100).toFixed(0)}% * ₦${commissionableRevenue.toFixed(2)} = ₦${grossCommission.toFixed(2)} gross commission)`);
        } else if (comp.commissionFormula === "formula_f") {
          formulaSteps.push(`Step 3: Counted distinct services worked (total: ${totals.serviceCountWorked} service items)`);
          formulaSteps.push(`Step 4: Applied FORMULA F (Fixed amount per service: ₦${comp.commissionFixedAmount})`);
          formulaSteps.push(`Step 5: Multiplied flat amount (${totals.serviceCountWorked} * ₦${comp.commissionFixedAmount} = ₦${grossCommission.toFixed(2)} gross commission)`);
        } else {
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

      const commissionInputs = {
        paymentMethod: comp.paymentMethod,
        commissionFormula: comp.commissionFormula,
        commissionRate: comp.commissionRate,
        commissionFixedAmount: comp.commissionFixedAmount,
        serviceCountWorked: totals.serviceCountWorked,
        totalServiceRevenueContribution: totals.serviceRevenueContribution,
        attendanceDeduction,
        commissionableRevenue,
        grossCommission,
      };

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
        // Inputs the commission explainer needs. Snapshotted rather than
        // re-resolved at read time so a paid period, which can never be
        // recalculated, keeps the explanation that matches its figures.
        commissionFixedAmount: comp.commissionFixedAmount,
        serviceCountWorked: totals.serviceCountWorked,
        commissionExplanation: explainCommission(commissionInputs),
        grossCommission,
        netPay,
        formulaSteps,
        formulaName: formulaLabel(comp.commissionFormula),
      };

      // G2: Fixed-salary staff have no transport component in their netPay.
      // Store zero for all monetary transport fields so the UI doesn't show phantom figures.
      // Day-count fields (activeDays, passiveDays, etc.) are kept as attendance facts.
      const isFixed = comp.paymentMethod === "fixed";
      const storedActiveTransport  = isFixed ? 0 : activePay;
      const storedPassiveTransport = isFixed ? 0 : passivePay;
      const storedLeavePay         = isFixed ? 0 : leavePay;
      const storedHolidayPay       = isFixed ? 0 : holidayPay;
      const storedOffDayPay        = isFixed ? 0 : offDayPay;
      const storedTotalTransport   = isFixed ? 0 : totalAttendancePay;

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
          activeTransport:  storedActiveTransport,
          passiveTransport: storedPassiveTransport,
          leavePay:         storedLeavePay,
          holidayPay:       storedHolidayPay,
          offDayPay:        storedOffDayPay,
          totalTransport:   storedTotalTransport,
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
            activeTransport:  storedActiveTransport,
            passiveTransport: storedPassiveTransport,
            leavePay:         storedLeavePay,
            holidayPay:       storedHolidayPay,
            offDayPay:        storedOffDayPay,
            totalTransport:   storedTotalTransport,
            grossCommission,
            netPay,
            calculationDetails: calculationDetailsSnapshot,
            updatedAt: new Date(),
          },
        })
        .returning();

      results.push({ ...entry, staff: staffMember });
    }

    // Propose a charge for any day attendance flagged late — late_arrival
    // outranks both advance_recovery and staff_credit in DEDUCTION_PRIORITY, and
    // their own headroom calcs read whatever is already on the period, so this
    // has to run first. Failure here must not lose a completed calculation —
    // the proposals are re-derived on the next sync.
    try {
      await lateArrivalDeductionService.syncProposals(periodId);
    } catch (e) {
      console.error("Failed to sync late-arrival deductions:", e);
    }

    // Propose recovery of any approved, unrecovered salary advances next —
    // advance_recovery outranks staff_credit in DEDUCTION_PRIORITY, and staff
    // credit's own headroom calc reads whatever advance_recovery amount is
    // already on the period, so it has to be written first. Failure here must
    // not lose a completed calculation — the proposals are re-derived on the
    // next sync.
    try {
      await salaryAdvanceDeductionService.syncProposals(periodId);
    } catch (e) {
      console.error("Failed to sync salary advance deductions:", e);
    }

    // Propose recovery of any shop debt owed by staff-linked customer profiles.
    // Runs last because the allocation is capped against whatever pay
    // advance_recovery left behind. Failure here must not lose a completed
    // calculation — the proposals are re-derived on the next sync.
    try {
      await staffCreditDeductionService.syncProposals(periodId);
    } catch (e) {
      console.error("Failed to sync staff credit deductions:", e);
    }

    return results.sort((a, b) => b.netPay - a.netPay);
  }

  /**
   * Builds the roster lookup for a period. Deliberately shared by the payroll
   * calculation and the drill-down: those two used to classify days with separate
   * copies of the same logic, and had already drifted apart once.
   */
  private async loadScheduleResolver(
    storeId: string,
    startDate: string,
    endDate: string,
    storeSettings: Settings,
  ): Promise<ScheduleResolver> {
    const [schedules, exceptions] = await Promise.all([
      storage.getStaffSchedules(storeId),
      storage.getStaffScheduleExceptions(storeId, startDate, endDate),
    ]);

    return buildScheduleResolver({
      // A period calculated before this feature has a settingsSnapshot with no
      // roster field. Falling back to [0] reproduces the Sunday rule that was in
      // force when that period was computed, rather than silently reclassifying
      // its Sundays as absences.
      defaultWeeklyOffDays: storeSettings.defaultWeeklyOffDays ?? [0],
      schedulesByStaff: new Map(schedules.map(r => [r.staffId, r.weeklyOffDays ?? []])),
      exceptionsByStaffDate: new Map(
        exceptions.map(e => [exceptionKey(e.staffId, e.date), e.kind as "off" | "working"]),
      ),
    });
  }

  /**
   * Option 4 Hybrid Model drill-down for one staff member.
   *
   * A *view* of the stored entry, never a rival calculation of it. The
   * per-line figure is `revenueShare` — the staff member's slice of the service
   * price, which is what the commission formula consumes — and the
   * reconciliation block is read straight off `payroll_entries`. These rows
   * used to report a second commission model entirely (`price ×
   * commissionSplitStaffShare × role share`, no transport offset, no rate, no
   * fixed-salary gate), so the drill-down total and the "Gross Commission" card
   * on the same screen disagreed by 3-5x.
   */
  public async getPayrollDrillDown(periodId: string, staffId: string): Promise<PayrollDrilldown> {
    const [period] = await db.select().from(payrollPeriods).where(eq(payrollPeriods.id, periodId));
    if (!period) throw new Error("Payroll period not found");

    const storeSettings = (period.settingsSnapshot as Settings | null) ?? (await storage.getSettings(period.storeId));
    const [staffMember] = await db.select().from(staff).where(eq(staff.id, staffId));
    if (!staffMember) throw new Error("Staff member not found");
    const store = await storage.getStore(period.storeId);
    if (!store) throw new Error("Store not found");

    // G1: Prorate base salary for drill-down view — mirrors calculatePayrollForPeriod logic exactly.
    // monthly → full amount, biweekly → ÷ 2, weekly → × 7/30
    const drilldownProrateBase = (monthly: number): number => {
      switch (period.periodType) {
        case "monthly":  return monthly;
        case "biweekly": return Math.round((monthly / 2) * 100) / 100;
        case "weekly":   return Math.round((monthly * 7 / 30) * 100) / 100;
        default:         return monthly;
      }
    };

    // Resolve compensation parameters for this staff member
    const monthlyBaseSalaryForDrilldown = staffMember.overridePaymentMethod
      ? staffMember.payPerMonth
      : storeSettings.fixedBaseAmount;
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
      baseSalary: drilldownProrateBase(monthlyBaseSalaryForDrilldown),
    };

    const timezone = await getStoreTimezone(period.storeId);

    // Fetch period checkouts and orders.
    //
    // Joins exactly what calculatePayrollForPeriod joins. It used to also
    // innerJoin `transactions`, which quietly dropped any checkout without a
    // matching transaction row from the drill-down while it still counted
    // toward the stored gross_commission.
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
        gte(checkouts.createdAt, toUtcStart(period.startDate, timezone)),
        lte(checkouts.createdAt, toUtcEnd(period.endDate, timezone)),
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

    const attendanceMap = new Map(attendanceList.map(a => [a.date, a]));

    const scheduledOff = await this.loadScheduleResolver(period.storeId, period.startDate, period.endDate, storeSettings);

    // Group checkouts by store-local date, matching calculatePayrollForPeriod.
    const checkoutsByDate = new Map<string, typeof periodCheckouts>();
    for (const row of periodCheckouts) {
      const dateStr = storeLocalDate(row.checkout.createdAt, timezone);
      if (!checkoutsByDate.has(dateStr)) checkoutsByDate.set(dateStr, []);
      checkoutsByDate.get(dateStr)!.push(row);
    }

    const dateRange = (() => {
      const dates: string[] = [];
      const curr = new Date(period.startDate);
      const last = new Date(period.endDate);
      while (curr <= last) { dates.push(curr.toISOString().split("T")[0]); curr.setDate(curr.getDate() + 1); }
      return dates;
    })();

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

      const classification = classifyDay({
        isAssignedToService: isAssigned,
        attendanceStatus: attendanceMap.get(dateStr)?.status,
        scheduledOff: scheduledOff(staffId, dateStr),
      });
      const { transport, dayType } = transportForDay(classification, comp);

      let dayRevenueShare = 0;
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

          // The same quantity calculatePayrollForPeriod banks into
          // serviceRevenueContribution — so these rows sum to the figure the
          // formula actually consumed, and the reconciliation below closes.
          const revenueShare = effectivePrice * share;
          dayRevenueShare += revenueShare;

          breakdownList.push({
            checkoutId: row.checkout.id,
            receiptNumber: row.checkout.receiptNumber,
            transactionDate: row.checkout.createdAt.toISOString(),
            inventoryName: row.inventoryItem.name,
            inventoryType: "service",
            serviceAmount: effectivePrice,
            role,
            share,
            revenueShare,
          });
        }
      }

      const attendanceRecord = attendanceMap.get(dateStr);
      const isLate = attendanceRecord?.isLate ?? false;
      // Mirrors LateArrivalDeductionService: a flat amount per late day, and only
      // while the store has the charge switched on.
      const lateDeduction = isLate && storeSettings.lateDeductionEnabled
        ? Number(storeSettings.lateDeductionAmount)
        : 0;

      dailySummaryLines.push({
        date: dateStr,
        dayType,
        transport,
        servicesWorked: servicesWorkedNames.length > 0 ? servicesWorkedNames.join(", ") : "—",
        revenueShare: dayRevenueShare,
        clockInAt: attendanceRecord?.firstClockInAt?.toISOString() ?? null,
        isLate,
        lateDeduction,
      });
    }

    return {
      dailySummary: dailySummaryLines.sort((a, b) => a.date.localeCompare(b.date)),
      transactions: breakdownList.sort((a, b) => a.transactionDate.localeCompare(b.transactionDate)),
      reconciliation: await this.commissionReconciliation(periodId, staffId),
    };
  }

  /**
   * How the drill-down's revenue shares became the commission on the entry.
   *
   * Read from `payroll_entries`, never recomputed — the drill-down must agree
   * with what was paid even when the settings have since changed. Null when the
   * period has never been calculated, so the UI can say so rather than showing
   * a total nobody has approved.
   */
  private async commissionReconciliation(
    periodId: string,
    staffId: string,
  ): Promise<CommissionReconciliation | null> {
    const [entry] = await db.select().from(payrollEntries).where(and(
      eq(payrollEntries.periodId, periodId),
      eq(payrollEntries.staffId, staffId),
    ));
    if (!entry) return null;

    const details = (entry.calculationDetails ?? {}) as Record<string, any>;

    return {
      totalRevenueShare: Number(details.totalServiceRevenueContribution ?? 0),
      attendanceDeduction: Number(details.attendanceDeduction ?? 0),
      commissionableRevenue: Number(details.commissionableRevenue ?? 0),
      commissionRate: Number(details.commissionRate ?? 0),
      grossCommission: Number(entry.grossCommission ?? 0),
      formulaName: details.formulaName ?? formulaLabel(details.commissionFormula),
      // Entries calculated before the explanation was snapshotted still get one,
      // derived from the details they do carry.
      explanation: details.commissionExplanation ?? explainCommission({
        ...details,
        grossCommission: Number(entry.grossCommission ?? 0),
      }),
    };
  }
}

export const payrollService = new PayrollService();
