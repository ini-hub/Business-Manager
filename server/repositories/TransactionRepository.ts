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
import { eq, and, or, ilike, desc, gte, lte, inArray } from "drizzle-orm";
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

    const rawReturnLogs = await db
      .select()
      .from(returnLogs)
      .where(eq(returnLogs.checkoutId, primaryCheckout.id));

    // Batch-fetch every order/inventory/staff referenced across checkouts and return logs
    // instead of querying per-row (previously up to ~5 round trips per line item).
    const checkoutOrderIds = matchedCheckouts.map(c => c.orderId).filter((id): id is string => !!id);
    const returnLogOrderIds = rawReturnLogs.map(l => l.orderId).filter((id): id is string => !!id);
    const orderIds = Array.from(new Set([...checkoutOrderIds, ...returnLogOrderIds]));
    const ordersRows = orderIds.length ? await db.select().from(orders).where(inArray(orders.id, orderIds)) : [];
    const ordersById = new Map(ordersRows.map(o => [o.id, o]));

    const inventoryIds = Array.from(new Set(ordersRows.map(o => o.inventoryId).filter((id): id is string => !!id)));
    const inventoryRows = inventoryIds.length ? await db.select().from(inventory).where(inArray(inventory.id, inventoryIds)) : [];
    const inventoryById = new Map(inventoryRows.map(i => [i.id, i]));

    const staffIds = new Set<string>();
    for (const ch of matchedCheckouts) {
      if (ch.leadStaffId) staffIds.add(ch.leadStaffId);
      if (ch.assistingStaff1Id) staffIds.add(ch.assistingStaff1Id);
      if (ch.assistingStaff2Id) staffIds.add(ch.assistingStaff2Id);
    }
    for (const log of rawReturnLogs) {
      if (log.staffId) staffIds.add(log.staffId);
    }
    if (primaryCheckout.staffId) staffIds.add(primaryCheckout.staffId);
    const staffRows = staffIds.size ? await db.select().from(staff).where(inArray(staff.id, Array.from(staffIds))) : [];
    const staffById = new Map(staffRows.map(s => [s.id, s]));

    const items = matchedCheckouts.map(ch => {
      const order = ch.orderId ? ordersById.get(ch.orderId) ?? null : null;
      const inventoryItem = order?.inventoryId ? inventoryById.get(order.inventoryId) ?? null : null;
      return {
        checkout: ch,
        order,
        inventory: inventoryItem,
        leadStaff: ch.leadStaffId ? staffById.get(ch.leadStaffId) ?? null : null,
        assistingStaff1: ch.assistingStaff1Id ? staffById.get(ch.assistingStaff1Id) ?? null : null,
        assistingStaff2: ch.assistingStaff2Id ? staffById.get(ch.assistingStaff2Id) ?? null : null,
      };
    });

    const resolvedReturnLogs = rawReturnLogs.map(log => {
      const order = log.orderId ? ordersById.get(log.orderId) ?? null : null;
      const inventoryItem = order?.inventoryId ? inventoryById.get(order.inventoryId) ?? null : null;
      return {
        ...log,
        inventory: inventoryItem,
        staff: log.staffId ? staffById.get(log.staffId) ?? null : null,
      };
    });

    const [store] = await db.select().from(stores).where(eq(stores.id, primaryCheckout.storeId));
    const [business] = store ? await db.select().from(businesses).where(eq(businesses.id, store.businessId)) : [null];
    const [storeSettings] = await db.select().from(settings).where(eq(settings.storeId, primaryCheckout.storeId));
    const staffMember = primaryCheckout.staffId ? staffById.get(primaryCheckout.staffId) ?? null : null;

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
