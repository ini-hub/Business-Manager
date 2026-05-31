import { db } from "../db";
import {
  transactions,
  checkouts,
  orders,
  inventory,
  customers,
  stores,
  staff,
  users,
  settings,
  businesses,
  storeCounters,
  creditEntries,
  returnLogs,
  type Transaction,
  type InsertTransaction,
  type Checkout,
  type InsertCheckout,
  type Order,
  type InsertOrder,
  type TransactionWithRelations,
} from "@shared/schema";
import { eq, and, or, ilike, desc } from "drizzle-orm";
import { serializeUser } from "../storage";
import type { PaginationOptions, PaginatedResult } from "../storage";

export class TransactionRepository {
  // ─── Public so SalesRepository can call it ───────────────────────────────
  async getNextAvailableTransactionNumber(tx: any, storeId: string): Promise<string> {
    const [store] = await tx.select().from(stores).where(eq(stores.id, storeId));
    if (!store) throw new Error("Store not found");

    const [storeSetting] = await tx.select().from(settings).where(eq(settings.storeId, storeId));
    const [business] = await tx.select().from(businesses).where(eq(businesses.id, store.businessId));

    let prefix = "RCP";
    if (storeSetting?.receiptPrefix && storeSetting.receiptPrefix !== "RCP") {
      prefix = storeSetting.receiptPrefix;
    } else if (business?.receiptPrefix) {
      prefix = `${business.receiptPrefix}-${store.code.trim().toUpperCase()}`;
    } else {
      prefix = `RCP-${store.code.trim().toUpperCase()}`;
    }

    const [counter] = await tx.select().from(storeCounters).where(eq(storeCounters.storeId, storeId));
    if (!counter) {
      await tx.insert(storeCounters).values({ storeId, nextCustomerNumber: 1, nextTransactionNumber: 2 });
      return `${prefix}-TN-1`;
    }

    const nextNum = counter.nextTransactionNumber;
    await tx.update(storeCounters)
      .set({ nextTransactionNumber: nextNum + 1 })
      .where(eq(storeCounters.id, counter.id));

    return `${prefix}-TN-${nextNum}`;
  }

  // ─── Orders ───────────────────────────────────────────────────────────────
  async createOrder(order: InsertOrder): Promise<Order> {
    const [newOrder] = await db.insert(orders).values(order).returning();
    return newOrder;
  }

  // ─── Checkouts ────────────────────────────────────────────────────────────
  async createCheckout(checkout: InsertCheckout): Promise<Checkout> {
    const checkoutInsert = {
      ...checkout,
      splitPayments: checkout.splitPayments as Array<{
        method: "cash" | "transfer" | "flutterwave" | "credit";
        amount: number;
      }> | null | undefined,
    };
    const [newCheckout] = await db.insert(checkouts).values(checkoutInsert).returning();
    return newCheckout;
  }

  async updateCheckoutPaymentStatus(id: string, status: "pending" | "completed" | "failed"): Promise<Checkout | undefined> {
    const [updated] = await db.update(checkouts)
      .set({ paymentStatus: status })
      .where(eq(checkouts.id, id))
      .returning();
    return updated;
  }

  async updateCheckoutPaymentMethod(checkoutId: string, paymentMethod: string, paymentStatus: string): Promise<boolean> {
    const [primaryCheckout] = await db.select().from(checkouts).where(eq(checkouts.id, checkoutId));
    if (!primaryCheckout) return false;

    const result = await db.update(checkouts)
      .set({ paymentMethod, paymentStatus })
      .where(eq(checkouts.receiptNumber, primaryCheckout.receiptNumber))
      .returning();
    return result.length > 0;
  }

  // ─── Transactions ─────────────────────────────────────────────────────────
  async getTransactions(storeId: string): Promise<TransactionWithRelations[]> {
    const txs = await db
      .select()
      .from(transactions)
      .where(eq(transactions.storeId, storeId))
      .orderBy(desc(transactions.transactionDate));

    const result: TransactionWithRelations[] = [];

    for (const tx of txs) {
      const [checkout] = await db.select().from(checkouts).where(eq(checkouts.id, tx.checkoutId));
      if (!checkout) continue;

      const [inventoryItem] = await db.select().from(inventory).where(eq(inventory.id, tx.inventoryId));
      if (!inventoryItem) continue;

      const [customer] = await db.select().from(customers).where(eq(customers.id, tx.customerId));
      if (!customer) continue;

      const [store] = await db.select().from(stores).where(eq(stores.id, tx.storeId));
      if (!store) continue;

      const [foundStaff] = await db.select().from(staff).where(eq(staff.id, checkout.staffId));

      let voidedByUser: any = null;
      if (checkout.voidedByUserId) {
        const [user] = await db.select().from(users).where(eq(users.id, checkout.voidedByUserId));
        voidedByUser = serializeUser(user) || null;
      }

      const [order] = await db.select().from(orders).where(eq(orders.id, checkout.orderId));
      const quantity = order?.quantity ?? 1;
      const returnedQuantity = order?.returnedQuantity ?? 0;
      const refundedAmount = order?.refundedAmount ?? 0;

      const basketSubtotal = Number(checkout.subtotal) || 1;
      const orderPrice = Number(order?.totalPrice) || tx.amount;
      const proportionalDiscount = (orderPrice / basketSubtotal) * (checkout.discountAmount || 0);

      result.push({
        ...tx,
        customer,
        inventory: inventoryItem,
        checkout: {
          ...checkout,
          totalPrice: tx.amount,
          subtotal: orderPrice,
          discountAmount: proportionalDiscount,
          quantity,
          returnedQuantity,
          refundedAmount,
          staff: foundStaff,
          voidedByUser,
        },
        store,
      });
    }

    return result;
  }

  async getTransactionsPaginated(storeId: string, options: PaginationOptions): Promise<PaginatedResult<TransactionWithRelations>> {
    const { page, limit, search } = options;

    const txs = await db
      .select()
      .from(transactions)
      .where(eq(transactions.storeId, storeId))
      .orderBy(desc(transactions.transactionDate));

    const data: TransactionWithRelations[] = [];

    for (const tx of txs) {
      const [checkout] = await db.select().from(checkouts).where(eq(checkouts.id, tx.checkoutId));
      if (!checkout) continue;

      const [inventoryItem] = await db.select().from(inventory).where(eq(inventory.id, tx.inventoryId));
      if (!inventoryItem) continue;

      const [customer] = await db.select().from(customers).where(eq(customers.id, tx.customerId));
      if (!customer) continue;

      const [store] = await db.select().from(stores).where(eq(stores.id, tx.storeId));
      if (!store) continue;

      const [foundStaff] = await db.select().from(staff).where(eq(staff.id, checkout.staffId));

      let voidedByUser: any = null;
      if (checkout.voidedByUserId) {
        const [user] = await db.select().from(users).where(eq(users.id, checkout.voidedByUserId));
        voidedByUser = serializeUser(user) || null;
      }

      const [order] = await db.select().from(orders).where(eq(orders.id, checkout.orderId));
      const quantity = order?.quantity ?? 1;
      const returnedQuantity = order?.returnedQuantity ?? 0;
      const refundedAmount = order?.refundedAmount ?? 0;

      const basketSubtotal = Number(checkout.subtotal) || 1;
      const orderPrice = Number(order?.totalPrice) || tx.amount;
      const proportionalDiscount = (orderPrice / basketSubtotal) * (checkout.discountAmount || 0);

      data.push({
        ...tx,
        customer,
        inventory: inventoryItem,
        checkout: {
          ...checkout,
          totalPrice: tx.amount,
          subtotal: orderPrice,
          discountAmount: proportionalDiscount,
          quantity,
          returnedQuantity,
          refundedAmount,
          staff: foundStaff,
          voidedByUser,
        },
        store,
      });
    }

    let filteredData = data;
    if (search) {
      const searchLower = search.toLowerCase();
      filteredData = data.filter(tx =>
        tx.customer?.name?.toLowerCase().includes(searchLower) ||
        tx.inventory?.name?.toLowerCase().includes(searchLower) ||
        tx.checkout?.receiptNumber?.toLowerCase().includes(searchLower) ||
        tx.checkout?.paymentMethod?.toLowerCase().includes(searchLower)
      );
    }

    const total = filteredData.length;
    const offset = (page - 1) * limit;
    const paginatedData = filteredData.slice(offset, offset + limit);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      data: paginatedData,
      pagination: { total, page, limit, totalPages, hasMore: page < totalPages },
    };
  }

  async createTransaction(transaction: InsertTransaction): Promise<Transaction> {
    const [newTransaction] = await db.insert(transactions).values(transaction).returning();
    return newTransaction;
  }

  async getTransactionsByCustomer(customerId: string): Promise<TransactionWithRelations[]> {
    const txs = await db
      .select()
      .from(transactions)
      .where(eq(transactions.customerId, customerId))
      .orderBy(desc(transactions.transactionDate));

    const result: TransactionWithRelations[] = [];

    for (const tx of txs) {
      const [checkout] = await db.select().from(checkouts).where(eq(checkouts.id, tx.checkoutId));
      if (!checkout) continue;

      const [inventoryItem] = await db.select().from(inventory).where(eq(inventory.id, tx.inventoryId));
      if (!inventoryItem) continue;

      const [customer] = await db.select().from(customers).where(eq(customers.id, tx.customerId));
      if (!customer) continue;

      const [store] = await db.select().from(stores).where(eq(stores.id, tx.storeId));
      if (!store) continue;

      const [foundStaff] = await db.select().from(staff).where(eq(staff.id, checkout.staffId));

      let voidedByUser: any = null;
      if (checkout.voidedByUserId) {
        const [user] = await db.select().from(users).where(eq(users.id, checkout.voidedByUserId));
        voidedByUser = serializeUser(user) || null;
      }

      const [order] = await db.select().from(orders).where(eq(orders.id, checkout.orderId));
      const quantity = order?.quantity ?? 1;

      const basketSubtotal = Number(checkout.subtotal) || 1;
      const orderPrice = Number(order?.totalPrice) || tx.amount;
      const proportionalDiscount = (orderPrice / basketSubtotal) * (checkout.discountAmount || 0);

      result.push({
        ...tx,
        customer,
        inventory: inventoryItem,
        checkout: {
          ...checkout,
          totalPrice: tx.amount,
          subtotal: orderPrice,
          discountAmount: proportionalDiscount,
          quantity,
          staff: foundStaff,
          voidedByUser,
        },
        store,
      });
    }

    return result;
  }

  async getReceiptPayload(checkoutId: string) {
    const [primaryCheckout] = await db.select().from(checkouts).where(eq(checkouts.id, checkoutId));
    if (!primaryCheckout) return null;

    const matchedCheckouts = await db.select().from(checkouts)
      .where(and(
        eq(checkouts.receiptNumber, primaryCheckout.receiptNumber),
        eq(checkouts.storeId, primaryCheckout.storeId)
      ));

    const items = [];
    for (const ch of matchedCheckouts) {
      const [order] = await db.select().from(orders).where(eq(orders.id, ch.orderId));
      const [inventoryItem] = order ? await db.select().from(inventory).where(eq(inventory.id, order.inventoryId)) : [null];
      const [leadStaffMember] = ch.leadStaffId
        ? await db.select().from(staff).where(eq(staff.id, ch.leadStaffId))
        : [null];
      items.push({
        checkout: ch,
        order,
        inventory: inventoryItem,
        leadStaff: leadStaffMember,
      });
    }

    const [store] = await db.select().from(stores).where(eq(stores.id, primaryCheckout.storeId));
    const [business] = store ? await db.select().from(businesses).where(eq(businesses.id, store.businessId)) : [null];
    const [storeSettings] = await db.select().from(settings).where(eq(settings.storeId, primaryCheckout.storeId));
    const [staffMember] = await db.select().from(staff).where(eq(staff.id, primaryCheckout.staffId));

    const [tx] = await db.select().from(transactions).where(eq(transactions.checkoutId, checkoutId));
    const [customer] = tx ? await db.select().from(customers).where(eq(customers.id, tx.customerId)) : [null];

    const [creditEntry] = await db
      .select()
      .from(creditEntries)
      .where(eq(creditEntries.linkedTransactionId, checkoutId));

    const rawReturnLogs = await db
      .select()
      .from(returnLogs)
      .where(eq(returnLogs.checkoutId, checkoutId));

    const resolvedReturnLogs = [];
    for (const log of rawReturnLogs) {
      const [order] = await db.select().from(orders).where(eq(orders.id, log.orderId));
      const [inventoryItem] = order
        ? await db.select().from(inventory).where(eq(inventory.id, order.inventoryId))
        : [null];
      const [logStaffMember] = log.staffId
        ? await db.select().from(staff).where(eq(staff.id, log.staffId))
        : [null];
      resolvedReturnLogs.push({
        ...log,
        inventory: inventoryItem,
        staff: logStaffMember,
      });
    }

    let resolvedPrefix = "RCP";
    if (storeSettings?.receiptPrefix && storeSettings.receiptPrefix !== "RCP") {
      resolvedPrefix = storeSettings.receiptPrefix;
    } else if (business?.receiptPrefix) {
      resolvedPrefix = `${business.receiptPrefix}-${store.code.trim().toUpperCase()}`;
    } else {
      resolvedPrefix = `RCP-${store.code.trim().toUpperCase()}`;
    }

    return {
      business: business ? { name: business.name } : null,
      store: store ? { name: store.name, currency: store.currency, phone: store.phone, address: store.address } : null,
      settings: storeSettings ? { receiptPrefix: resolvedPrefix, receiptThankYouMessage: storeSettings.receiptThankYouMessage } : null,
      checkout: primaryCheckout,
      order: items[0]?.order || null,
      inventory: items[0]?.inventory || null,
      customer,
      staff: staffMember,
      leadStaff: items[0]?.leadStaff || null,
      items,
      creditEntry: creditEntry || null,
      returnLogs: resolvedReturnLogs,
    };
  }

  async searchTransactions(storeId: string, query: string): Promise<any[]> {
    return db.select()
      .from(checkouts)
      .where(and(eq(checkouts.storeId, storeId), or(ilike(checkouts.receiptNumber, `%${query}%`), ilike(checkouts.paymentReference, `%${query}%`))))
      .limit(10);
  }
}
