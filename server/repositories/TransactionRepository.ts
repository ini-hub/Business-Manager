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
import { eq, and, or, ilike, desc, gte, lte } from "drizzle-orm";
import { serializeUser } from "../storage";

export interface TransactionFilters {
  startDate?: Date;
  endDate?: Date;
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

function buildTransactionFromRow(row: {
  tx: typeof transactions.$inferSelect;
  checkout: typeof checkouts.$inferSelect;
  order: typeof orders.$inferSelect | null;
  inv: typeof inventory.$inferSelect;
  customer: typeof customers.$inferSelect;
  store: typeof stores.$inferSelect;
  staffMember: typeof staff.$inferSelect | null;
  voidedBy: typeof users.$inferSelect | null;
}): TransactionWithRelations {
  const { tx, checkout, order, inv, customer, store, staffMember, voidedBy } = row;

  const quantity = order?.quantity ?? 1;
  const returnedQuantity = order?.returnedQuantity ?? 0;
  const refundedAmount = order?.refundedAmount ?? 0;

  const basketSubtotal = Number(checkout.subtotal) || 1;
  const orderPrice = Number(order?.totalPrice) || tx.amount;
  const proportionalDiscount = (orderPrice / basketSubtotal) * (checkout.discountAmount || 0);

  return {
    ...tx,
    customer,
    inventory: inv,
    checkout: {
      ...checkout,
      totalPrice: tx.amount,
      subtotal: orderPrice,
      discountAmount: proportionalDiscount,
      quantity,
      returnedQuantity,
      refundedAmount,
      staff: staffMember ?? undefined,
      voidedByUser: voidedBy ? serializeUser(voidedBy) : null,
    },
    store,
  };
}

async function resolveReceiptPrefix(
  tx: any,
  storeId: string
): Promise<string> {
  const [store] = await tx.select().from(stores).where(eq(stores.id, storeId));
  if (!store) return "RCP";

  const [storeSetting] = await tx.select().from(settings).where(eq(settings.storeId, storeId));
  const [business] = await tx.select().from(businesses).where(eq(businesses.id, store.businessId));

  if (storeSetting?.receiptPrefix && storeSetting.receiptPrefix !== "RCP") {
    return storeSetting.receiptPrefix;
  }
  if (business?.receiptPrefix) {
    return `${business.receiptPrefix}-${store.code.trim().toUpperCase()}`;
  }
  return `RCP-${store.code.trim().toUpperCase()}`;
}

export class TransactionRepository {
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

  // ─── Receipt number counter ───────────────────────────────────────────────
  async getNextAvailableTransactionNumber(tx: any, storeId: string): Promise<string> {
    const prefix = await resolveReceiptPrefix(tx, storeId);

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

  // ─── Transactions ─────────────────────────────────────────────────────────
  async getTransactions(
    storeId: string,
    filters: TransactionFilters = {}
  ): Promise<TransactionWithRelations[]> {
    const conditions = [eq(transactions.storeId, storeId)];
    if (filters.startDate) conditions.push(gte(transactions.transactionDate, filters.startDate));
    if (filters.endDate) conditions.push(lte(transactions.transactionDate, filters.endDate));

    const rows = await db
      .select({
        tx: transactions,
        checkout: checkouts,
        order: orders,
        inv: inventory,
        customer: customers,
        store: stores,
        staffMember: staff,
        voidedBy: users,
      })
      .from(transactions)
      .innerJoin(checkouts, eq(transactions.checkoutId, checkouts.id))
      .leftJoin(orders, eq(checkouts.orderId, orders.id))
      .innerJoin(inventory, eq(transactions.inventoryId, inventory.id))
      .innerJoin(customers, eq(transactions.customerId, customers.id))
      .innerJoin(stores, eq(transactions.storeId, stores.id))
      .leftJoin(staff, eq(checkouts.staffId, staff.id))
      .leftJoin(users, eq(checkouts.voidedByUserId, users.id))
      .where(and(...conditions))
      .orderBy(desc(transactions.transactionDate));

    return rows.map(buildTransactionFromRow);
  }

  async getTransactionById(id: string): Promise<TransactionWithRelations | null> {
    const rows = await db
      .select({
        tx: transactions,
        checkout: checkouts,
        order: orders,
        inv: inventory,
        customer: customers,
        store: stores,
        staffMember: staff,
        voidedBy: users,
      })
      .from(transactions)
      .innerJoin(checkouts, eq(transactions.checkoutId, checkouts.id))
      .leftJoin(orders, eq(checkouts.orderId, orders.id))
      .innerJoin(inventory, eq(transactions.inventoryId, inventory.id))
      .innerJoin(customers, eq(transactions.customerId, customers.id))
      .innerJoin(stores, eq(transactions.storeId, stores.id))
      .leftJoin(staff, eq(checkouts.staffId, staff.id))
      .leftJoin(users, eq(checkouts.voidedByUserId, users.id))
      .where(eq(transactions.id, id))
      .limit(1);

    if (rows.length === 0) return null;
    return buildTransactionFromRow(rows[0]);
  }

  async createTransaction(transaction: InsertTransaction): Promise<Transaction> {
    const [newTransaction] = await db.insert(transactions).values(transaction).returning();
    return newTransaction;
  }

  async getTransactionsByCustomer(customerId: string): Promise<TransactionWithRelations[]> {
    const rows = await db
      .select({
        tx: transactions,
        checkout: checkouts,
        order: orders,
        inv: inventory,
        customer: customers,
        store: stores,
        staffMember: staff,
        voidedBy: users,
      })
      .from(transactions)
      .innerJoin(checkouts, eq(transactions.checkoutId, checkouts.id))
      .leftJoin(orders, eq(checkouts.orderId, orders.id))
      .innerJoin(inventory, eq(transactions.inventoryId, inventory.id))
      .innerJoin(customers, eq(transactions.customerId, customers.id))
      .innerJoin(stores, eq(transactions.storeId, stores.id))
      .leftJoin(staff, eq(checkouts.staffId, staff.id))
      .leftJoin(users, eq(checkouts.voidedByUserId, users.id))
      .where(eq(transactions.customerId, customerId))
      .orderBy(desc(transactions.transactionDate));

    return rows.map(buildTransactionFromRow);
  }

  async getReceiptPayload(checkoutId: string) {
    const [seedCheckout] = await db.select().from(checkouts).where(eq(checkouts.id, checkoutId));
    if (!seedCheckout) return null;

    const matchedCheckouts = await db.select().from(checkouts)
      .where(and(
        eq(checkouts.receiptNumber, seedCheckout.receiptNumber),
        eq(checkouts.storeId, seedCheckout.storeId)
      ));

    // Always use the oldest non-addendum checkout as the receipt header so that
    // navigating via an addendum's checkoutId still shows the correct payment
    // method, staff, and totals from the original sale.
    const sorted = [...matchedCheckouts].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    const primaryCheckout = sorted.find(c => !c.isAddendum) ?? sorted[0];

    const items = [];
    for (const ch of matchedCheckouts) {
      const [order] = await db.select().from(orders).where(eq(orders.id, ch.orderId));
      const [inventoryItem] = order ? await db.select().from(inventory).where(eq(inventory.id, order.inventoryId)) : [null];
      const [leadStaffMember] = ch.leadStaffId
        ? await db.select().from(staff).where(eq(staff.id, ch.leadStaffId))
        : [null];
      const [assistingStaff1Member] = ch.assistingStaff1Id
        ? await db.select().from(staff).where(eq(staff.id, ch.assistingStaff1Id))
        : [null];
      const [assistingStaff2Member] = ch.assistingStaff2Id
        ? await db.select().from(staff).where(eq(staff.id, ch.assistingStaff2Id))
        : [null];
      items.push({
        checkout: ch,
        order,
        inventory: inventoryItem,
        leadStaff: leadStaffMember,
        assistingStaff1: assistingStaff1Member ?? null,
        assistingStaff2: assistingStaff2Member ?? null,
      });
    }

    const [store] = await db.select().from(stores).where(eq(stores.id, primaryCheckout.storeId));
    const [business] = store ? await db.select().from(businesses).where(eq(businesses.id, store.businessId)) : [null];
    const [storeSettings] = await db.select().from(settings).where(eq(settings.storeId, primaryCheckout.storeId));
    const [staffMember] = await db.select().from(staff).where(eq(staff.id, primaryCheckout.staffId));

    const [tx] = await db.select().from(transactions).where(eq(transactions.checkoutId, primaryCheckout.id));
    const [customer] = tx ? await db.select().from(customers).where(eq(customers.id, tx.customerId)) : [null];

    let voidedByUser: any = null;
    if (primaryCheckout.voidedByUserId) {
      const [user] = await db.select().from(users).where(eq(users.id, primaryCheckout.voidedByUserId));
      if (user) voidedByUser = serializeUser(user);
    }

    // Credit entries are linked to the primary (non-addendum) checkout
    const [creditEntry] = await db
      .select()
      .from(creditEntries)
      .where(eq(creditEntries.linkedTransactionId, primaryCheckout.id));

    const rawReturnLogs = await db
      .select()
      .from(returnLogs)
      .where(eq(returnLogs.checkoutId, primaryCheckout.id));

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

    // Resolve receipt prefix using the shared helper (non-transactional read context)
    let resolvedPrefix = "RCP";
    if (storeSettings?.receiptPrefix && storeSettings.receiptPrefix !== "RCP") {
      resolvedPrefix = storeSettings.receiptPrefix;
    } else if (business?.receiptPrefix && store) {
      resolvedPrefix = `${business.receiptPrefix}-${store.code.trim().toUpperCase()}`;
    } else if (store) {
      resolvedPrefix = `RCP-${store.code.trim().toUpperCase()}`;
    }

    return {
      business: business ? { name: business.name } : null,
      store: store ? { name: store.name, currency: store.currency, phone: store.phone, address: store.address } : null,
      settings: storeSettings ? { receiptPrefix: resolvedPrefix, receiptThankYouMessage: storeSettings.receiptThankYouMessage } : null,
      checkout: { ...primaryCheckout, voidedByUser },
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
