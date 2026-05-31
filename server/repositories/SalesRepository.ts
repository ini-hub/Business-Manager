import { db } from "../db";
import {
  orders,
  checkouts,
  transactions,
  inventory,
  customers,
  staff,
  stores,
  settings,
  taxRates,
  promotions,
  profitLoss,
  cashRegisterSessions,
  creditEntries,
  repayments,
  bookings,
  returnLogs,
  inventoryRestockEvents,
  storeCreditTransactions,
  bundleComponents,
  payrollPeriods,
  type ProfitLossWithInventory,
} from "@shared/schema";
import { eq, and, or, gt, gte, lte, sql, desc } from "drizzle-orm";
import { InventoryRepository } from "./InventoryRepository";
import { TransactionRepository } from "./TransactionRepository";
import type { NotificationRepository } from "./NotificationRepository";

export class SalesRepository {
  private inventoryRepo = new InventoryRepository();
  private transactionRepo = new TransactionRepository();

  setNotificationRepo(notificationRepo: NotificationRepository) {
    this._notificationRepo = notificationRepo;
  }

  private _notificationRepo: NotificationRepository | null = null;

  private async notifyManagers(storeId: string, type: string, message: string): Promise<void> {
    if (this._notificationRepo) {
      await this._notificationRepo.notifyManagers(storeId, type, message);
    }
  }

  // ─── Profit & Loss ────────────────────────────────────────────────────────
  async getProfitLoss(storeId: string): Promise<ProfitLossWithInventory[]> {
    const plRecords = await db.select().from(profitLoss).where(eq(profitLoss.storeId, storeId));
    const result: ProfitLossWithInventory[] = [];

    for (const pl of plRecords) {
      const [inventoryItem] = await db.select().from(inventory).where(eq(inventory.id, pl.inventoryId));
      result.push({ ...pl, inventory: inventoryItem });
    }

    return result;
  }

  async updateProfitLoss(inventoryId: string, storeId: string): Promise<void> {
    const [inventoryItem] = await db.select().from(inventory).where(eq(inventory.id, inventoryId));
    if (!inventoryItem) return;

    const allOrders = await db.select().from(orders).where(
      and(eq(orders.inventoryId, inventoryId), eq(orders.storeId, storeId))
    );

    const totalQuantitySold = allOrders.reduce((sum, order) => sum + order.quantity, 0);
    const totalRevenue = allOrders.reduce((sum, order) => sum + order.totalPrice, 0);
    const totalGrossProfit = totalRevenue - (totalQuantitySold * inventoryItem.costPrice);
    const quantityRemaining = inventoryItem.type === "product" ? inventoryItem.quantity : 0;

    const [existingPL] = await db.select().from(profitLoss).where(
      and(eq(profitLoss.inventoryId, inventoryId), eq(profitLoss.storeId, storeId))
    );

    if (existingPL) {
      await db.update(profitLoss)
        .set({ totalQuantitySold, quantityRemaining, totalRevenue, totalGrossProfit })
        .where(and(eq(profitLoss.inventoryId, inventoryId), eq(profitLoss.storeId, storeId)));
    } else {
      await db.insert(profitLoss).values({
        storeId, inventoryId, totalQuantitySold, quantityRemaining, totalRevenue, totalGrossProfit,
      });
    }
  }

  async getProfitLossSummary(storeId: string, startDate?: string, endDate?: string): Promise<{
    serviceRevenue: number;
    productRevenue: number;
    grossRevenue: number;
    returnedRevenue: number;
    totalRevenue: number;
    costOfGoodsSold: number;
    grossProfit: number;
    discountsGiven: number;
    discountsList: Array<{
      receiptNumber: string;
      discountAmount: number;
      discountPercent: number;
      discountReason: string | null;
      discountApprovedBy: string | null;
      createdAt: Date;
    }>;
  }> {
    const conditions: any[] = [
      eq(checkouts.storeId, storeId),
      eq(checkouts.paymentStatus, "completed"),
      eq(checkouts.isVoided, false),
    ];
    if (startDate) conditions.push(gte(checkouts.createdAt, new Date(startDate + "T00:00:00.000Z")));
    if (endDate) conditions.push(lte(checkouts.createdAt, new Date(endDate + "T23:59:59.999Z")));

    const rows = await db
      .select({
        inventoryType: inventory.type,
        costPrice: inventory.costPrice,
        quantity: orders.quantity,
        returnedQuantity: orders.returnedQuantity,
        refundedAmount: orders.refundedAmount,
        totalPrice: orders.totalPrice,
      })
      .from(orders)
      .innerJoin(checkouts, eq(checkouts.orderId, orders.id))
      .innerJoin(inventory, eq(inventory.id, orders.inventoryId))
      .where(and(...conditions));

    let serviceRevenue = 0;
    let productRevenue = 0;
    let costOfGoodsSold = 0;
    let grossRevenue = 0;
    let returnedRevenue = 0;

    for (const row of rows) {
      const netQuantity = Math.max(0, row.quantity - (row.returnedQuantity || 0));
      const netTotalPrice = Math.max(0, row.totalPrice - (row.refundedAmount || 0));

      grossRevenue += row.totalPrice;
      returnedRevenue += (row.refundedAmount || 0);

      if (row.inventoryType === "service") {
        serviceRevenue += netTotalPrice;
      } else {
        productRevenue += netTotalPrice;
      }
      costOfGoodsSold += (row.costPrice ?? 0) * netQuantity;
    }

    const totalRevenue = serviceRevenue + productRevenue;
    const grossProfit = totalRevenue - costOfGoodsSold;

    const discountConditions: any[] = [
      eq(checkouts.storeId, storeId),
      eq(checkouts.paymentStatus, "completed"),
      eq(checkouts.isVoided, false),
      or(gt(checkouts.discountAmount, 0), gt(checkouts.pointsRedeemed, 0)),
    ];
    if (startDate) discountConditions.push(gte(checkouts.createdAt, new Date(startDate + "T00:00:00.000Z")));
    if (endDate) discountConditions.push(lte(checkouts.createdAt, new Date(endDate + "T23:59:59.999Z")));

    const uniqueTxDiscounts = await db
      .select({
        receiptNumber: checkouts.receiptNumber,
        discountAmount: checkouts.discountAmount,
        discountPercent: checkouts.discountPercent,
        discountReason: checkouts.discountReason,
        discountApprovedBy: checkouts.discountApprovedBy,
        pointsRedeemed: checkouts.pointsRedeemed,
        createdAt: checkouts.createdAt,
        subtotal: sql<number>`sum(${checkouts.totalPrice})`,
      })
      .from(checkouts)
      .where(and(...discountConditions))
      .groupBy(
        checkouts.receiptNumber,
        checkouts.discountAmount,
        checkouts.discountPercent,
        checkouts.discountReason,
        checkouts.discountApprovedBy,
        checkouts.pointsRedeemed,
        checkouts.createdAt
      );

    const processedDiscounts = uniqueTxDiscounts.map((d) => {
      const loyaltyDiscount = (d.pointsRedeemed || 0) * 10;
      const totalDiscountVal = (d.discountAmount || 0) + loyaltyDiscount;
      const subtotalVal = Number(d.subtotal || 0);
      const totalPct = subtotalVal > 0 ? (totalDiscountVal / subtotalVal) * 100 : 0;

      let finalReason = d.discountReason || "";
      if (d.pointsRedeemed && d.pointsRedeemed > 0) {
        const loyaltyText = `Redeemed ${d.pointsRedeemed} Loyalty Points (₦${loyaltyDiscount})`;
        finalReason = finalReason ? `${finalReason} | ${loyaltyText}` : loyaltyText;
      }

      return {
        receiptNumber: d.receiptNumber,
        discountAmount: totalDiscountVal,
        discountPercent: totalPct,
        discountReason: finalReason || "Loyalty Point Redemption",
        discountApprovedBy: d.discountApprovedBy || (d.pointsRedeemed ? "Loyalty System" : "N/A"),
        createdAt: d.createdAt,
        subtotal: subtotalVal,
      };
    });

    const discountsGiven = processedDiscounts.reduce((sum, d) => sum + d.discountAmount, 0);

    return {
      serviceRevenue,
      productRevenue,
      grossRevenue,
      returnedRevenue,
      totalRevenue,
      costOfGoodsSold,
      grossProfit,
      discountsGiven,
      discountsList: processedDiscounts,
    };
  }

  // ─── Store Credit Transactions ────────────────────────────────────────────
  async getStoreCreditTransactions(customerId: string): Promise<any[]> {
    return db.select()
      .from(storeCreditTransactions)
      .where(eq(storeCreditTransactions.customerId, customerId))
      .orderBy(desc(storeCreditTransactions.createdAt));
  }

  // ─── Checkout Settings getter (needed by processCheckout) ─────────────────
  private async getSettings(storeId: string) {
    const [row] = await db.select().from(settings).where(eq(settings.storeId, storeId));
    if (row) return row;
    const [inserted] = await db.insert(settings).values({ storeId }).returning();
    return inserted;
  }

  // ─── processCheckout ──────────────────────────────────────────────────────
  async processCheckout(data: {
    storeId: string;
    customerId: string;
    staffId: string;
    items: Array<{
      inventoryId: string;
      quantity: number;
      customPrice?: number;
      leadStaffId?: string | null;
      assistingStaff1Id?: string | null;
      assistingStaff2Id?: string | null;
      commissionSplit?: "standard" | "equal";
    }>;
    paymentMethod: "cash" | "transfer" | "flutterwave" | "credit" | "split" | "deposit" | "store_credit";
    splitPayments?: Array<{ method: "cash" | "transfer" | "flutterwave" | "credit" | "store_credit"; amount: number }>;
    discountAmount?: number;
    discountPercent?: number;
    discountReason?: string;
    discountApprovedBy?: string;
    effectiveDate?: string;
    creditUpfrontPaid?: number;
    creditDueDate?: string;
    bookingId?: string;
    bookingDepositAmount?: number;
    bookingDepositMethod?: string;
    balanceCollectedToday?: number;
    pointsRedeemed?: number;
  }): Promise<{ success: boolean; message: string; checkoutIds?: string[] }> {
    const checkoutIds: string[] = [];
    const lowStockItems: Array<{ name: string; quantity: number }> = [];

    try {
      await db.transaction(async (tx) => {
        let txDate: Date;
        if (data.effectiveDate) {
          const parts = data.effectiveDate.split("-");
          if (parts.length === 3) {
            const year = parseInt(parts[0], 10);
            const month = parseInt(parts[1], 10) - 1;
            const day = parseInt(parts[2], 10);
            txDate = new Date(year, month, day, 0, 0, 0, 0);
          } else {
            txDate = new Date(data.effectiveDate);
            txDate.setHours(0, 0, 0, 0);
          }
        } else {
          txDate = new Date();
        }

        if (data.paymentMethod === "flutterwave" && data.splitPayments && data.splitPayments.length > 0) {
          throw new Error("Flutterwave cannot be combined with split payments. Choose either Flutterwave OR split payment.");
        }

        const [customer] = await tx.select().from(customers).where(eq(customers.id, data.customerId));
        if (!customer) {
          throw new Error("Please select a valid customer to complete this sale.");
        }

        const [staffMember] = await tx.select().from(staff).where(eq(staff.id, data.staffId));
        if (!staffMember) {
          throw new Error("Please select a valid staff member to complete this sale.");
        }
        if (staffMember.storeId !== data.storeId) {
          throw new Error(`Staff member "${staffMember.name}" does not belong to this store branch.`);
        }

        const hasCashPayment = data.paymentMethod === "cash" ||
          (data.paymentMethod === "split" && data.splitPayments?.some(p => p.method === "cash"));

        let activeSessionId: string | null = null;
        if (hasCashPayment) {
          const [activeSession] = await tx
            .select()
            .from(cashRegisterSessions)
            .where(and(eq(cashRegisterSessions.storeId, data.storeId), eq(cashRegisterSessions.status, "open")))
            .limit(1);

          if (!activeSession) {
            throw new Error("bad_request:Cannot complete sale. The cash drawer is currently closed. Please open the register first.");
          }
          activeSessionId = activeSession.id;
        }

        const storeSettings = await this.getSettings(data.storeId);
        const lowStockThreshold = storeSettings?.lowStockThreshold ?? 5;

        const storePromotions = await tx.select().from(promotions).where(
          and(eq(promotions.storeId, data.storeId), eq(promotions.isActive, true))
        );

        const processedItems: Array<{
          inventoryId: string;
          quantity: number;
          customPrice?: number;
          unitPrice: number;
          leadStaffId?: string | null;
          assistingStaff1Id?: string | null;
          assistingStaff2Id?: string | null;
          commissionSplit?: "standard" | "equal";
          isPromoLine?: boolean;
          promoName?: string;
        }> = [];

        for (const item of data.items) {
          const [inventoryItem] = await tx.select().from(inventory).where(eq(inventory.id, item.inventoryId)).for("update");
          if (!inventoryItem) {
            throw new Error("One of the items in your cart is no longer available.");
          }
          if (item.quantity <= 0) {
            throw new Error(`Invalid quantity for item ${inventoryItem.name}. Quantity must be at least 1.`);
          }

          const unitPrice = item.customPrice !== undefined ? item.customPrice : inventoryItem.sellingPrice;

          if (unitPrice <= 0) {
            throw new Error(`Item ${inventoryItem.name} cannot be sold for ₦0. Only active promotions can apply ₦0 items.`);
          }

          if (item.leadStaffId) {
            const [leadStaffMember] = await tx.select().from(staff).where(eq(staff.id, item.leadStaffId));
            if (!leadStaffMember) throw new Error("One of the assigned lead staff members is invalid.");
            if (leadStaffMember.storeId !== data.storeId) {
              throw new Error(`Lead staff member "${leadStaffMember.name}" does not belong to this store branch.`);
            }
          }

          if (item.assistingStaff1Id) {
            const [ass1Member] = await tx.select().from(staff).where(eq(staff.id, item.assistingStaff1Id));
            if (!ass1Member) throw new Error("One of the assigned assisting staff members is invalid.");
            if (ass1Member.storeId !== data.storeId) {
              throw new Error(`Assisting staff member "${ass1Member.name}" does not belong to this store branch.`);
            }
          }

          if (item.assistingStaff2Id) {
            const [ass2Member] = await tx.select().from(staff).where(eq(staff.id, item.assistingStaff2Id));
            if (!ass2Member) throw new Error("One of the assigned assisting staff members is invalid.");
            if (ass2Member.storeId !== data.storeId) {
              throw new Error(`Assisting staff member "${ass2Member.name}" does not belong to this store branch.`);
            }
          }

          processedItems.push({ ...item, unitPrice, isPromoLine: false });
        }

        // Apply Buy X Get Y (Same Item)
        for (const promo of storePromotions) {
          if (promo.type === "buy_x_get_y" && promo.buyItemId === promo.getItemId && promo.buyItemId) {
            const buyQty = promo.buyQuantity || 1;
            const getQty = promo.getQuantity || 1;
            const cycle = buyQty + getQty;

            const itemIdx = processedItems.findIndex(i => i.inventoryId === promo.buyItemId && !i.isPromoLine);
            if (itemIdx !== -1) {
              const item = processedItems[itemIdx];
              const qty = item.quantity;
              if (qty >= cycle) {
                const times = Math.floor(qty / cycle);
                const freeQty = times * getQty;
                const paidQty = qty - freeQty;
                processedItems.splice(itemIdx, 1);
                if (paidQty > 0) processedItems.push({ ...item, quantity: paidQty });
                processedItems.push({ ...item, quantity: freeQty, unitPrice: 0, customPrice: 0, isPromoLine: true, promoName: promo.name });
              }
            }
          }
        }

        // Apply Buy X Get Y (Different Item)
        for (const promo of storePromotions) {
          if (promo.type === "buy_x_get_y" && promo.buyItemId !== promo.getItemId && promo.buyItemId && promo.getItemId) {
            const buyQty = promo.buyQuantity || 1;
            const getQty = promo.getQuantity || 1;
            const buyItemPaidQty = processedItems
              .filter(i => i.inventoryId === promo.buyItemId && !i.isPromoLine)
              .reduce((sum, i) => sum + i.quantity, 0);
            if (buyItemPaidQty >= buyQty) {
              const times = Math.floor(buyItemPaidQty / buyQty);
              const freeQty = times * getQty;
              processedItems.push({
                inventoryId: promo.getItemId,
                quantity: freeQty,
                unitPrice: 0,
                customPrice: 0,
                isPromoLine: true,
                promoName: promo.name,
                leadStaffId: data.staffId,
                commissionSplit: "standard",
              });
            }
          }
        }

        // Apply Spend X Get Y Free
        for (const promo of storePromotions) {
          if (promo.type === "spend_x_get_y" && promo.spendAmount && promo.getItemId) {
            const spendReq = promo.spendAmount;
            const getQty = promo.getQuantity || 1;
            const paidSubtotal = processedItems
              .filter(i => !i.isPromoLine)
              .reduce((sum, i) => sum + (i.unitPrice * i.quantity), 0);
            if (paidSubtotal >= spendReq) {
              processedItems.push({
                inventoryId: promo.getItemId,
                quantity: getQty,
                unitPrice: 0,
                customPrice: 0,
                isPromoLine: true,
                promoName: promo.name,
                leadStaffId: data.staffId,
                commissionSplit: "standard",
              });
            }
          }
        }

        let grossCartTotal = 0;
        for (const item of processedItems) {
          grossCartTotal += item.unitPrice * item.quantity;
        }

        const receiptNumber = await this.transactionRepo.getNextAvailableTransactionNumber(tx, data.storeId);

        const storeTaxRates = await tx.select().from(taxRates).where(eq(taxRates.storeId, data.storeId));
        const defaultTax = storeTaxRates.find((r: any) => r.isDefault);
        const taxRatePercent = defaultTax ? defaultTax.rate : 0;

        if (data.pointsRedeemed && data.pointsRedeemed > customer.loyaltyPoints) {
          throw new Error(`Insufficient loyalty points. Customer has only ${customer.loyaltyPoints} points.`);
        }
        const pointsValueRate = 10;
        const pointsDiscount = (data.pointsRedeemed || 0) * pointsValueRate;

        let totalDiscount = data.discountAmount || 0;
        let discountPct = data.discountPercent || (grossCartTotal > 0 ? (totalDiscount / grossCartTotal) * 100 : 0);

        if (totalDiscount > grossCartTotal) totalDiscount = grossCartTotal;

        const discountedSubtotal = Math.max(0, grossCartTotal - totalDiscount - pointsDiscount);
        const taxTotalGlobal = discountedSubtotal * (taxRatePercent / 100);
        const totalCharged = discountedSubtotal + taxTotalGlobal;

        const bookingDepositAmount = data.bookingDepositAmount || 0;
        const balanceCollectedToday = data.balanceCollectedToday ?? (totalCharged - bookingDepositAmount);

        if (data.bookingId) {
          const [booking] = await tx.select().from(bookings).where(eq(bookings.id, data.bookingId));
          if (!booking) throw new Error("Invalid booking ID provided.");
          if (booking.status === "completed") throw new Error(`This booking has already been converted to a sale.`);
          if (Math.abs(Number(booking.depositAmount || 0) - bookingDepositAmount) > 0.01) {
            throw new Error(`Deposit amount (₦${bookingDepositAmount}) does not match booking record (₦${booking.depositAmount}).`);
          }
        }

        if (Math.abs(balanceCollectedToday - (totalCharged - bookingDepositAmount)) > 0.01) {
          throw new Error("Balance calculation mismatch.");
        }
        if (balanceCollectedToday < 0) {
          throw new Error("Deposit cannot exceed total charge. Adjust items or issue a refund.");
        }

        if (data.paymentMethod === "split") {
          if (!data.splitPayments || data.splitPayments.length === 0) {
            throw new Error("Split payments array must be provided when paymentMethod is 'split'");
          }
          const sumOfSplits = data.splitPayments.reduce((sum, p) => sum + p.amount, 0);
          if (Math.abs(sumOfSplits - balanceCollectedToday) > 0.01) {
            throw new Error(`Sum of split payments (₦${sumOfSplits.toLocaleString()}) does not match the balance collected today (₦${balanceCollectedToday.toLocaleString()}).`);
          }
        }

        for (const item of processedItems) {
          const [inventoryItem] = await tx.select().from(inventory).where(eq(inventory.id, item.inventoryId)).for("update");
          if (!inventoryItem) throw new Error("One of the items in your cart is no longer available.");

          if (inventoryItem.type === "product") {
            if (inventoryItem.isBundle) {
              const childComponents = await tx
                .select({
                  name: inventory.name,
                  compQty: inventory.quantity,
                  qtyNeeded: bundleComponents.quantity,
                })
                .from(bundleComponents)
                .innerJoin(inventory, eq(bundleComponents.componentInventoryId, inventory.id))
                .where(eq(bundleComponents.parentInventoryId, item.inventoryId));

              for (const comp of childComponents) {
                const totalNeeded = comp.qtyNeeded * item.quantity;
                if (comp.compQty < totalNeeded) {
                  throw new Error(`Sorry, we do not have enough stock for the component ${comp.name} inside bundle ${inventoryItem.name}.`);
                }
              }
            } else if (inventoryItem.quantity < item.quantity) {
              throw new Error(`Sorry, we only have ${inventoryItem.quantity} ${inventoryItem.name} in stock.`);
            }
          }

          const totalPrice = item.unitPrice * item.quantity;
          const itemDiscountPortion = item.isPromoLine ? 0 : (totalDiscount * (totalPrice / grossCartTotal || 1));
          const itemPointsDiscountPortion = item.isPromoLine ? 0 : (pointsDiscount * (totalPrice / grossCartTotal || 1));
          const itemDiscountedSubtotal = Math.max(0, totalPrice - itemDiscountPortion - itemPointsDiscountPortion);
          const itemTaxTotal = itemDiscountedSubtotal * (taxRatePercent / 100);
          const itemCharged = itemDiscountedSubtotal + itemTaxTotal;

          const [order] = await tx.insert(orders).values({
            storeId: data.storeId,
            inventoryId: item.inventoryId,
            quantity: item.quantity,
            totalPrice,
          }).returning();

          const [checkout] = await tx.insert(checkouts).values({
            storeId: data.storeId,
            bookingId: data.bookingId || null,
            staffId: data.staffId,
            leadStaffId: item.leadStaffId || null,
            assistingStaff1Id: item.assistingStaff1Id || null,
            assistingStaff2Id: item.assistingStaff2Id || null,
            commissionSplit: item.commissionSplit || "standard",
            orderId: order.id,
            receiptNumber,
            totalPrice,
            paymentMethod: data.paymentMethod,
            splitPayments: data.paymentMethod === "split" ? data.splitPayments : null,
            paymentStatus: data.paymentMethod === "flutterwave" ? "pending" : "completed",
            subtotal: grossCartTotal,
            discountAmount: item.isPromoLine ? 0 : totalDiscount,
            discountPercent: item.isPromoLine ? 0 : discountPct,
            discountReason: item.isPromoLine ? `Promo - ${item.promoName}` : (data.discountReason || null),
            discountApprovedBy: data.discountApprovedBy || null,
            pointsRedeemed: data.pointsRedeemed || 0,
            totalCharged: itemCharged,
            taxTotal: itemTaxTotal,
            bookingDepositAmount,
            bookingDepositMethod: data.bookingDepositMethod || null,
            balanceCollectedToday: Math.max(0, itemCharged - bookingDepositAmount),
            createdAt: txDate,
          }).returning();

          checkoutIds.push(checkout.id);

          await tx.insert(transactions).values({
            storeId: data.storeId,
            customerId: data.customerId,
            inventoryId: item.inventoryId,
            checkoutId: checkout.id,
            amount: itemCharged,
            transactionDate: txDate,
          });

          if (inventoryItem.type === "product") {
            if (inventoryItem.isBundle) {
              const childComponents = await tx
                .select({
                  id: bundleComponents.componentInventoryId,
                  name: inventory.name,
                  quantity: inventory.quantity,
                  qtyNeeded: bundleComponents.quantity,
                })
                .from(bundleComponents)
                .innerJoin(inventory, eq(bundleComponents.componentInventoryId, inventory.id))
                .where(eq(bundleComponents.parentInventoryId, item.inventoryId));

              for (const comp of childComponents) {
                const totalDeduction = comp.qtyNeeded * item.quantity;
                const newCompQty = comp.quantity - totalDeduction;
                await tx.update(inventory).set({ quantity: newCompQty }).where(eq(inventory.id, comp.id));
                await this.inventoryRepo.deductFIFO(comp.id, totalDeduction, tx);
                if (newCompQty <= lowStockThreshold) {
                  lowStockItems.push({ name: comp.name, quantity: newCompQty });
                }
              }
            } else {
              const newQuantity = inventoryItem.quantity - item.quantity;
              await tx.update(inventory).set({ quantity: newQuantity }).where(eq(inventory.id, item.inventoryId));
              await this.inventoryRepo.deductFIFO(item.inventoryId, item.quantity, tx);
              if (newQuantity <= lowStockThreshold) {
                lowStockItems.push({ name: inventoryItem.name, quantity: newQuantity });
              }
            }
          }

          const costPrice = inventoryItem.costPrice;
          const revenue = totalPrice;
          const profit = revenue - (costPrice * item.quantity);

          const [existingPL] = await tx.select().from(profitLoss)
            .where(and(eq(profitLoss.inventoryId, item.inventoryId), eq(profitLoss.storeId, data.storeId)));

          if (existingPL) {
            await tx.update(profitLoss)
              .set({
                totalQuantitySold: existingPL.totalQuantitySold + item.quantity,
                quantityRemaining: inventoryItem.quantity - item.quantity,
                totalRevenue: existingPL.totalRevenue + revenue,
                totalGrossProfit: existingPL.totalGrossProfit + profit,
              })
              .where(eq(profitLoss.id, existingPL.id));
          } else {
            await tx.insert(profitLoss).values({
              storeId: data.storeId,
              inventoryId: item.inventoryId,
              totalQuantitySold: item.quantity,
              quantityRemaining: inventoryItem.quantity - item.quantity,
              totalRevenue: revenue,
              totalGrossProfit: profit,
            });
          }
        }

        let creditAmount = 0;
        let upfrontPaid = 0;

        if (data.paymentMethod === "credit") {
          creditAmount = balanceCollectedToday;
          upfrontPaid = data.creditUpfrontPaid || 0;
        } else if (data.paymentMethod === "split" && data.splitPayments) {
          const creditPayments = data.splitPayments.filter(p => p.method === "credit");
          if (creditPayments.length > 0) {
            creditAmount = creditPayments.reduce((sum, p) => sum + p.amount, 0);
            upfrontPaid = 0;
          }
        }

        if (creditAmount > 0) {
          const outstanding = Math.max(0, creditAmount - upfrontPaid);
          const creditStatus = outstanding <= 0 ? "settled" : "owing";

          const [creditEntry] = await tx.insert(creditEntries).values({
            storeId: data.storeId,
            customerId: data.customerId,
            amountOwed: creditAmount,
            amountPaidUpfront: upfrontPaid,
            outstandingBalance: outstanding,
            dueDate: data.creditDueDate ? new Date(data.creditDueDate) : null,
            description: `Checkout Receipt #${receiptNumber}`,
            linkedTransactionId: checkoutIds[0],
            status: creditStatus,
            notes: `Auto-generated from POS checkout #${receiptNumber}`,
          }).returning();

          if (upfrontPaid > 0) {
            await tx.insert(repayments).values({
              creditEntryId: creditEntry.id,
              amountReceived: upfrontPaid,
              paymentMethod: "cash",
              notes: `Upfront payment during checkout #${receiptNumber}`,
              recordedByStaffId: data.staffId,
            });
          }
        }

        if (data.bookingId) {
          await tx.update(bookings).set({ status: "completed" }).where(eq(bookings.id, data.bookingId));
        }

        if (hasCashPayment && activeSessionId) {
          let cashReceived = 0;
          if (data.paymentMethod === "cash") {
            cashReceived = balanceCollectedToday;
          } else if (data.paymentMethod === "split" && data.splitPayments) {
            const cashSplit = data.splitPayments.find(p => p.method === "cash");
            if (cashSplit) cashReceived = cashSplit.amount;
          }

          if (cashReceived > 0) {
            await tx
              .update(cashRegisterSessions)
              .set({ expectedCash: sql`${cashRegisterSessions.expectedCash} + ${cashReceived}` })
              .where(eq(cashRegisterSessions.id, activeSessionId));
          }
        }

        const pointsEarned = Math.floor(discountedSubtotal / 100);
        const newPointsBalance = Math.max(0, customer.loyaltyPoints - (data.pointsRedeemed || 0) + pointsEarned);
        await tx.update(customers).set({ loyaltyPoints: newPointsBalance }).where(eq(customers.id, data.customerId));

        let storeCreditUsed = 0;
        if (data.paymentMethod === "store_credit") {
          storeCreditUsed = balanceCollectedToday;
        } else if (data.paymentMethod === "split" && data.splitPayments) {
          const storeCreditSplit = data.splitPayments.find(p => p.method === "store_credit");
          if (storeCreditSplit) storeCreditUsed = storeCreditSplit.amount;
        }

        if (storeCreditUsed > 0) {
          if (!customer) throw new Error("A customer profile is required to redeem store credit.");
          if (Number(customer.storeCreditBalance || 0) < storeCreditUsed) {
            throw new Error(`Insufficient store credit balance. Available: ₦${customer.storeCreditBalance?.toLocaleString() || 0}`);
          }
          await tx.update(customers)
            .set({ storeCreditBalance: sql`${customers.storeCreditBalance} - ${storeCreditUsed}` })
            .where(eq(customers.id, customer.id));
          await tx.insert(storeCreditTransactions).values({
            customerId: customer.id,
            storeId: data.storeId,
            amount: -storeCreditUsed,
            type: "purchase_redemption",
            checkoutId: checkoutIds[0],
          });
        }
      });

      for (const item of lowStockItems) {
        await this.notifyManagers(data.storeId, "low_stock", `Low stock alert: ${item.name} has only ${item.quantity} units left.`);
      }

      return { success: true, message: "Sale completed successfully", checkoutIds };
    } catch (error) {
      const message = error instanceof Error ? error.message : "We couldn't complete this sale right now. Please try again.";
      return { success: false, message };
    }
  }

  // ─── voidCheckout ─────────────────────────────────────────────────────────
  async voidCheckout(checkoutId: string, reason: string, voidedByUserId: string): Promise<{ success: boolean; message: string; payrollWarning?: string }> {
    try {
      let voidedStoreId = "";
      let voidedReceiptNumber = "";
      let checkoutCreatedAt: Date | null = null;

      await db.transaction(async (tx) => {
        const [primaryCheckout] = await tx.select().from(checkouts).where(eq(checkouts.id, checkoutId));
        if (!primaryCheckout) throw new Error("Transaction not found.");

        voidedStoreId = primaryCheckout.storeId;
        voidedReceiptNumber = primaryCheckout.receiptNumber;
        checkoutCreatedAt = primaryCheckout.createdAt;

        const matchedCheckouts = await tx.select().from(checkouts)
          .where(eq(checkouts.receiptNumber, primaryCheckout.receiptNumber));

        for (const checkout of matchedCheckouts) {
          if (checkout.isVoided) continue;

          await tx.update(checkouts)
            .set({ isVoided: true, voidedAt: new Date(), voidedByUserId, voidReason: reason })
            .where(eq(checkouts.id, checkout.id));

          const [order] = await tx.select().from(orders).where(eq(orders.id, checkout.orderId));
          if (!order) continue;

          const [inventoryItem] = await tx.select().from(inventory).where(eq(inventory.id, order.inventoryId));
          if (!inventoryItem) continue;

          if (inventoryItem.type === "product") {
            await tx.update(inventory)
              .set({ quantity: sql`quantity + ${order.quantity}` })
              .where(eq(inventory.id, inventoryItem.id));
          }

          const [existingPL] = await tx.select().from(profitLoss)
            .where(and(eq(profitLoss.inventoryId, inventoryItem.id), eq(profitLoss.storeId, checkout.storeId)));
          if (existingPL) {
            const revenue = order.totalPrice;
            const profit = revenue - inventoryItem.costPrice * order.quantity;
            await tx.update(profitLoss)
              .set({
                totalQuantitySold: sql`GREATEST(0, total_quantity_sold - ${order.quantity})`,
                quantityRemaining: sql`quantity_remaining + ${order.quantity}`,
                totalRevenue: sql`GREATEST(0, total_revenue - ${revenue})`,
                totalGrossProfit: sql`total_gross_profit - ${profit}`,
              })
              .where(eq(profitLoss.id, existingPL.id));
          }
        }
      });

      const [checkout] = await db.select().from(checkouts).where(eq(checkouts.id, checkoutId));
      if (checkout) {
        await this.notifyManagers(voidedStoreId, "void_transaction", `Transaction ${voidedReceiptNumber} was voided.`);
      }

      let payrollWarning: string | undefined;
      if (checkoutCreatedAt && voidedStoreId) {
        const checkoutDateStr = (checkoutCreatedAt as Date).toISOString().slice(0, 10);
        const affectedPeriods = await db
          .select({ id: payrollPeriods.id, status: payrollPeriods.status, startDate: payrollPeriods.startDate, endDate: payrollPeriods.endDate })
          .from(payrollPeriods)
          .where(
            and(
              eq(payrollPeriods.storeId, voidedStoreId),
              sql`${payrollPeriods.startDate} <= ${checkoutDateStr}`,
              sql`${payrollPeriods.endDate} >= ${checkoutDateStr}`,
              sql`${payrollPeriods.status} IN ('approved', 'paid')`
            )
          );

        if (affectedPeriods.length > 0) {
          const periodLabels = affectedPeriods.map((p) => `${p.startDate} – ${p.endDate} (${p.status})`).join(", ");
          payrollWarning = `This transaction falls within finalized payroll period(s): ${periodLabels}. Commission for affected staff may need manual adjustment.`;
        }
      }

      return { success: true, message: "Transaction voided successfully.", payrollWarning };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not void transaction.";
      return { success: false, message };
    }
  }

  // ─── processReturn ────────────────────────────────────────────────────────
  async processReturn(data: {
    storeId: string;
    checkoutId: string;
    items: Array<{ orderId: string; quantity: number; restock: boolean }>;
    refundMethod: string;
    refundAmount: number;
    reason: string;
    userId: string;
    staffId: string;
  }): Promise<{ success: boolean; message: string; returnLogIds?: string[] }> {
    try {
      const returnLogIds: string[] = [];

      await db.transaction(async (tx) => {
        const [checkout] = await tx.select().from(checkouts).where(eq(checkouts.id, data.checkoutId));
        if (!checkout) throw new Error("Transaction not found.");
        if (checkout.isVoided) throw new Error("Cannot return items from a voided transaction.");

        let customerProfile: any = null;
        const [txRow] = await tx.select().from(transactions).where(eq(transactions.checkoutId, checkout.id)).limit(1);
        if (txRow && txRow.customerId) {
          const [cust] = await tx.select().from(customers).where(eq(customers.id, txRow.customerId));
          customerProfile = cust;
        }

        if (data.refundMethod === "store_credit" && (!txRow || !txRow.customerId)) {
          throw new Error("A profiled customer is required to issue store credit.");
        }

        let calculatedTotalRefund = 0;

        for (const item of data.items) {
          const [order] = await tx.select().from(orders).where(eq(orders.id, item.orderId));
          if (!order) throw new Error(`Line item not found: ${item.orderId}`);

          const maxAvailable = order.quantity - order.returnedQuantity;
          if (item.quantity <= 0 || item.quantity > maxAvailable) {
            throw new Error(`Invalid return quantity (${item.quantity}). Max available: ${maxAvailable}`);
          }

          const unitPrice = order.totalPrice / order.quantity;
          const lineRefundAmount = unitPrice * item.quantity;
          calculatedTotalRefund += lineRefundAmount;

          let restockEventId: string | null = null;

          const [inventoryItem] = await tx.select().from(inventory).where(eq(inventory.id, order.inventoryId));
          if (inventoryItem && inventoryItem.type === "product" && item.restock) {
            const newQty = inventoryItem.quantity + item.quantity;
            const [restockEvent] = await tx.insert(inventoryRestockEvents).values({
              storeId: data.storeId,
              inventoryId: inventoryItem.id,
              quantityAdded: item.quantity,
              previousQuantity: inventoryItem.quantity,
              newQuantity: newQty,
              unitCost: inventoryItem.costPrice || 0,
              previousCostPrice: inventoryItem.costPrice || 0,
              newCostPrice: inventoryItem.costPrice || 0,
              previousSellingPrice: inventoryItem.sellingPrice || 0,
              newSellingPrice: inventoryItem.sellingPrice || 0,
              costStrategy: "keep",
              notes: `Customer return from receipt ${checkout.receiptNumber}`,
              reason: "Returned Stock",
              staffId: data.staffId || null,
              userId: data.userId || null,
            }).returning();

            restockEventId = restockEvent.id;

            await tx.update(inventory)
              .set({ quantity: inventoryItem.quantity + item.quantity })
              .where(eq(inventory.id, inventoryItem.id));
          }

          const beforeQty = inventoryItem ? inventoryItem.quantity : 0;
          const afterQty = inventoryItem ? (inventoryItem.quantity + (item.restock && inventoryItem.type === "product" ? item.quantity : 0)) : 0;

          const [log] = await tx.insert(returnLogs).values({
            storeId: data.storeId,
            checkoutId: checkout.id,
            orderId: order.id,
            quantity: item.quantity,
            refundAmount: lineRefundAmount,
            refundMethod: data.refundMethod,
            reason: data.reason,
            staffId: data.staffId || null,
            userId: data.userId || null,
            restockEventId,
            inventoryQuantityBeforeReturn: beforeQty,
            inventoryQuantityAfterReturn: afterQty,
          }).returning();

          returnLogIds.push(log.id);

          await tx.update(orders)
            .set({
              returnedQuantity: order.returnedQuantity + item.quantity,
              refundedAmount: order.refundedAmount + lineRefundAmount,
            })
            .where(eq(orders.id, order.id));

          if (inventoryItem) {
            const [existingPL] = await tx.select().from(profitLoss)
              .where(and(eq(profitLoss.inventoryId, inventoryItem.id), eq(profitLoss.storeId, data.storeId)));
            if (existingPL) {
              const profit = lineRefundAmount - (inventoryItem.costPrice || 0) * item.quantity;
              await tx.update(profitLoss)
                .set({
                  totalQuantitySold: Math.max(0, existingPL.totalQuantitySold - item.quantity),
                  quantityRemaining: existingPL.quantityRemaining + (item.restock && inventoryItem.type === "product" ? item.quantity : 0),
                  totalRevenue: Math.max(0, existingPL.totalRevenue - lineRefundAmount),
                  totalGrossProfit: existingPL.totalGrossProfit - profit,
                })
                .where(eq(profitLoss.id, existingPL.id));
            }
          }
        }

        if (data.refundAmount > calculatedTotalRefund + 0.01) {
          throw new Error(`Refund amount exceeds the maximum value of returned items (${calculatedTotalRefund.toFixed(2)}).`);
        }

        await tx.update(checkouts).set({ isPartiallyReturned: true }).where(eq(checkouts.id, checkout.id));

        if (data.refundMethod === "store_credit" && customerProfile) {
          await tx.update(customers)
            .set({ storeCreditBalance: (customerProfile.storeCreditBalance || 0) + data.refundAmount })
            .where(eq(customers.id, customerProfile.id));

          await tx.insert(storeCreditTransactions).values({
            customerId: customerProfile.id,
            storeId: data.storeId,
            amount: data.refundAmount,
            type: "issued_refund",
            checkoutId: checkout.id,
          });
        }
      });

      const [checkout] = await db.select().from(checkouts).where(eq(checkouts.id, data.checkoutId));
      if (checkout) {
        await this.notifyManagers(checkout.storeId, "return_transaction", `A return was processed on transaction ${checkout.receiptNumber}.`);
      }

      return { success: true, message: "Return processed successfully.", returnLogIds };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not process return.";
      return { success: false, message };
    }
  }
}
