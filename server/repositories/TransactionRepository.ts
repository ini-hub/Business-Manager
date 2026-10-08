import { db } from "../db";
import {
  salePaymentLegs,
  storePaymentAccounts,
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
  auditLogs,
  type Transaction,
  type InsertTransaction,
  type Checkout,
  type InsertCheckout,
  type Order,
  type InsertOrder,
  type TransactionWithRelations,
} from "@shared/schema";
import { eq, and, or, ilike, desc, gte, lte, inArray, exists, sql } from "drizzle-orm";
import { serializeUser } from "../storage";
import { searchTokens, infix } from "../lib/searchTerms";

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
  const taxRefunded = order?.taxRefunded ?? 0;

  const basketSubtotal = Number(checkout.subtotal) || 1;
  const orderPrice = Number(order?.totalPrice) || tx.amount;
  const proportionalDiscount = (orderPrice / basketSubtotal) * (checkout.discountAmount || 0);

  return {
    ...tx,
    customer,
    inventory: inv,
    checkout: {
      ...checkout,
      totalPrice: Math.max(tx.amount - refundedAmount, 0),
      subtotal: orderPrice,
      discountAmount: proportionalDiscount,
      quantity,
      returnedQuantity,
      refundedAmount,
      taxRefunded,
      staff: staffMember ?? undefined,
      voidedByUser: voidedBy ? serializeUser(voidedBy) : null,
    },
    store,
  };
}

export async function resolveReceiptPrefix(
  conn: any,
  storeId: string
): Promise<string> {
  // The store row is needed for the business id; the settings row is independent, so read it alongside.
  const [[store], [storeSetting]] = await Promise.all([
    conn.select().from(stores).where(eq(stores.id, storeId)),
    conn.select().from(settings).where(eq(settings.storeId, storeId)),
  ]);
  if (!store) return "RCP";

  const [business] = await conn.select().from(businesses).where(eq(businesses.id, store.businessId));

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

  async updateCheckoutPaymentMethod(
    checkoutId: string,
    paymentMethod: string,
    paymentStatus: string,
    opts: { accountId?: string; actorUserId?: string } = {},
  ): Promise<boolean | "bad_account"> {
    const [primaryCheckout] = await db.select().from(checkouts).where(eq(checkouts.id, checkoutId));
    if (!primaryCheckout) return false;

    let account: typeof storePaymentAccounts.$inferSelect | undefined;
    if (opts.accountId) {
      [account] = await db.select().from(storePaymentAccounts).where(and(
        eq(storePaymentAccounts.id, opts.accountId),
        eq(storePaymentAccounts.storeId, primaryCheckout.storeId),
        eq(storePaymentAccounts.isActive, true),
      ));
      if (!account) return "bad_account";
    }

    return db.transaction(async (tx) => {
      const result = await tx.update(checkouts)
        .set({ paymentMethod, paymentStatus })
        .where(eq(checkouts.receiptNumber, primaryCheckout.receiptNumber))
        .returning();

      // Keep the receipt's payment legs telling the same story. Only a one-leg receipt can be re-pointed
      // unambiguously; a split keeps its legs, and the account report shows them as recorded.
      const legs = await tx.select().from(salePaymentLegs).where(and(
        eq(salePaymentLegs.storeId, primaryCheckout.storeId),
        eq(salePaymentLegs.receiptNumber, primaryCheckout.receiptNumber),
      ));
      if (legs.length === 1 && primaryCheckout.paymentMethod !== "split") {
        const needsConfirm = paymentMethod === "transfer" || paymentMethod === "flutterwave";
        // Marking the payment completed is a person vouching that the money arrived.
        const confirmed = needsConfirm && paymentStatus === "completed";
        await tx.update(salePaymentLegs).set({
          method: paymentMethod,
          paymentAccountId: paymentMethod === "transfer" ? (account?.id ?? legs[0].paymentAccountId) : null,
          accountLabel: paymentMethod === "transfer" ? (account?.label ?? legs[0].accountLabel) : null,
          accountDetail: paymentMethod === "transfer"
            ? (account ? ([account.bankName, account.accountNumber].filter(Boolean).join(" · ") || null) : legs[0].accountDetail)
            : null,
          confirmationStatus: confirmed ? "confirmed" : needsConfirm ? "pending" : "not_required",
          confirmationSource: confirmed ? "manual" : null,
          confirmedAt: confirmed ? new Date() : null,
          confirmedByUserId: confirmed ? (opts.actorUserId ?? null) : null,
        }).where(eq(salePaymentLegs.id, legs[0].id));
      }
      return result.length > 0;
    });
  }

  // ─── Receipt number counter ───────────────────────────────────────────────
  /**
   * Allocates the next receipt number for a store.
   *
   * One atomic upsert: the counter row is created on the store's first sale and incremented on every later
   * one inside a single statement, so two concurrent sales can never read the same value (the old
   * select-then-write let both take number N) and the first sales of a new store cannot collide on insert.
   * The increment holds the counter row's lock until the surrounding transaction commits, so callers should
   * allocate as late as they can. Pass `prefix` (from resolveReceiptPrefix, read before the transaction) to
   * keep the three prefix lookups out of that window.
   */
  async getNextAvailableTransactionNumber(tx: any, storeId: string, prefix?: string): Promise<string> {
    const resolvedPrefix = prefix ?? (await resolveReceiptPrefix(tx, storeId));
    const [counter] = await tx
      .insert(storeCounters)
      .values({ storeId, nextCustomerNumber: 1, nextTransactionNumber: 2 })
      .onConflictDoUpdate({
        target: storeCounters.storeId,
        set: { nextTransactionNumber: sql`${storeCounters.nextTransactionNumber} + 1` },
      })
      .returning({ next: storeCounters.nextTransactionNumber });
    return `${resolvedPrefix}-TN-${counter.next - 1}`;
  }

  // ─── Transactions ─────────────────────────────────────────────────────────
  async getTransactions(
    storeId: string | string[],
    filters: TransactionFilters = {}
  ): Promise<TransactionWithRelations[]> {
    if (Array.isArray(storeId) && storeId.length === 0) return [];
    const conditions = [Array.isArray(storeId) ? inArray(transactions.storeId, storeId) : eq(transactions.storeId, storeId)];
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

  /**
   * Narrow per-line rows (only what grouping, staff scope and list search read) for
   * one or more stores, newest first. Lets the paged list decide which receipts
   * belong on a page without loading every joined relation for every transaction.
   */
  async getTransactionIndex(storeIds: string[], filters: TransactionFilters = {}) {
    if (storeIds.length === 0) return [];
    const conditions = [inArray(transactions.storeId, storeIds)];
    if (filters.startDate) conditions.push(gte(transactions.transactionDate, filters.startDate));
    if (filters.endDate) conditions.push(lte(transactions.transactionDate, filters.endDate));

    const rows = await db
      .select({
        id: transactions.id,
        transactionDate: transactions.transactionDate,
        checkoutId: transactions.checkoutId,
        receiptNumber: checkouts.receiptNumber,
        isAddendum: checkouts.isAddendum,
        staffId: checkouts.staffId,
        leadStaffId: checkouts.leadStaffId,
        assistingStaff1Id: checkouts.assistingStaff1Id,
        assistingStaff2Id: checkouts.assistingStaff2Id,
        inventoryName: inventory.name,
        inventoryType: inventory.type,
        customerName: customers.name,
      })
      .from(transactions)
      .innerJoin(checkouts, eq(transactions.checkoutId, checkouts.id))
      .innerJoin(inventory, eq(transactions.inventoryId, inventory.id))
      .innerJoin(customers, eq(transactions.customerId, customers.id))
      .where(and(...conditions))
      .orderBy(desc(transactions.transactionDate));

    return rows.map((r) => ({
      id: r.id,
      transactionDate: r.transactionDate,
      checkoutId: r.checkoutId,
      amount: 0,
      checkout: {
        receiptNumber: r.receiptNumber,
        isAddendum: r.isAddendum,
        staffId: r.staffId,
        leadStaffId: r.leadStaffId,
        assistingStaff1Id: r.assistingStaff1Id,
        assistingStaff2Id: r.assistingStaff2Id,
      },
      inventory: { name: r.inventoryName, type: r.inventoryType },
      customer: { name: r.customerName },
    }));
  }

  /**
   * One page of receipts, decided entirely in SQL: which receipts exist, which the viewer may see, which match
   * the search, how many there are in total, and which fall on this page. Only the page's line ids come back,
   * so the work no longer grows with the store's whole history (the old path loaded an index row for every
   * line ever sold and grouped them in Node before slicing).
   *
   * Reproduces the grouping the list has always used:
   *  - a receipt is its lines grouped by receipt number (falling back to the checkout id, then the line id);
   *  - its representative line is the newest non-addendum line (else the oldest), and the receipt is dated,
   *    searched and ordered by that line;
   *  - the viewer's staff scope passes a receipt if the representative line's cashier, or ANY line's lead or
   *    assisting staff, is in scope. An empty scope sees nothing.
   * Search is a case-insensitive substring match over the receipt number, the representative line's id,
   * its item name and its customer name.
   */
  async getReceiptPage(
    storeIds: string[],
    opts: { startDate?: Date; endDate?: Date; customerId?: string; scope?: ReadonlySet<string> | null; search?: string; offset: number; limit: number },
  ): Promise<{ keys: string[]; lineIds: string[]; total: number }> {
    const empty = { keys: [] as string[], lineIds: [] as string[], total: 0 };
    if (storeIds.length === 0) return empty;
    const scopeIds = opts.scope ? Array.from(opts.scope) : null;
    if (scopeIds && scopeIds.length === 0) return empty; // fails closed, like filterToScope

    const list = (ids: string[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);
    // Bound as ISO strings cast to timestamp: a raw Date parameter is formatted in the Node process's local
    // zone by the driver, but transaction_date holds naive UTC (Drizzle's column comparisons convert for us;
    // a hand-written statement has to do it itself).
    const dateFilter = sql`${opts.startDate ? sql`AND t.transaction_date >= ${opts.startDate.toISOString()}::timestamp` : sql``} ${opts.endDate ? sql`AND t.transaction_date <= ${opts.endDate.toISOString()}::timestamp` : sql``}`;
    const scopeTest = scopeIds
      ? sql`(r.staff_id IN (${list(scopeIds)}) OR r.others_in_scope)`
      : sql`TRUE`;
    const pattern = opts.search ? `%${opts.search.replace(/[\\%_]/g, "\\$&")}%` : null;
    const searchTest = pattern
      ? sql`(COALESCE(r.receipt_number, '') ILIKE ${pattern} ESCAPE '\\' OR r.line_id ILIKE ${pattern} ESCAPE '\\' OR r.inv_name ILIKE ${pattern} ESCAPE '\\' OR r.cust_name ILIKE ${pattern} ESCAPE '\\')`
      : sql`TRUE`;
    const othersInScope = scopeIds
      ? sql`bool_or(l.lead IN (${list(scopeIds)}) OR l.a1 IN (${list(scopeIds)}) OR l.a2 IN (${list(scopeIds)})) OVER (PARTITION BY l.gkey)`
      : sql`FALSE`;

    const result = await db.execute(sql`
      WITH lines AS (
        SELECT t.id AS line_id, t.transaction_date AS tdate, c.is_addendum AS addendum, c.receipt_number,
               c.staff_id, c.lead_staff_id AS lead, c.assisting_staff1_id AS a1, c.assisting_staff2_id AS a2,
               COALESCE(NULLIF(c.receipt_number, ''), t.checkout_id, t.id) AS gkey,
               i.name AS inv_name, cu.name AS cust_name
        FROM transactions t
        JOIN checkouts c ON c.id = t.checkout_id
        JOIN inventory i ON i.id = t.inventory_id
        JOIN customers cu ON cu.id = t.customer_id
        WHERE t.store_id IN (${list(storeIds)}) ${dateFilter} ${opts.customerId ? sql`AND t.customer_id = ${opts.customerId}` : sql``}
      ),
      ranked AS (
        SELECT l.*,
               row_number() OVER (PARTITION BY l.gkey ORDER BY COALESCE(l.addendum, false) ASC, l.tdate DESC, l.line_id) AS rn,
               ${othersInScope} AS others_in_scope
        FROM lines l
      ),
      groups AS (
        SELECT r.gkey, r.tdate
        FROM ranked r
        WHERE r.rn = 1 AND ${scopeTest} AND ${searchTest}
      ),
      page AS (
        SELECT g.gkey, g.tdate, count(*) OVER () AS total
        FROM groups g
        ORDER BY g.tdate DESC, g.gkey
        LIMIT ${opts.limit} OFFSET ${opts.offset}
      )
      SELECT p.gkey, p.total, l.line_id
      FROM page p JOIN lines l ON l.gkey = p.gkey
      ORDER BY p.tdate DESC, p.gkey, l.tdate DESC, l.line_id
    `);

    const rows = result.rows as { gkey: string; total: string | number; line_id: string }[];
    if (rows.length === 0) {
      // Past the last page: no rows to read the total from, so count the receipts instead.
      if (opts.offset === 0) return empty;
      const counted = await this.getReceiptPage(storeIds, { ...opts, offset: 0, limit: 1 });
      return { keys: [], lineIds: [], total: counted.total };
    }
    const keys: string[] = [];
    for (const r of rows) if (keys[keys.length - 1] !== r.gkey) keys.push(r.gkey);
    return { keys, lineIds: rows.map((r) => r.line_id), total: Number(rows[0].total) };
  }

  /** Full transactions for specific line ids, newest first (same shape as getTransactions). */
  async getTransactionsByIds(ids: string[]): Promise<TransactionWithRelations[]> {
    if (ids.length === 0) return [];
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
      .where(inArray(transactions.id, ids))
      .orderBy(desc(transactions.transactionDate));

    return rows.map(buildTransactionFromRow);
  }

  /**
   * Lifetime spend and first/last visit per customer, computed in SQL so the
   * customer list doesn't have to download every transaction. Each checkout is
   * counted once however many line items it has, and voided checkouts are
   * ignored - the same rules the customer page used to apply in the browser.
   */
  async getCustomerSummaries(storeIds: string[]): Promise<{ customerId: string; totalSpend: number; firstVisit: string; lastVisit: string }[]> {
    if (storeIds.length === 0) return [];
    const result = await db.execute(sql`
      SELECT customer_id,
             COALESCE(SUM(total_price), 0)::numeric AS total_spend,
             MIN(visit_at) AS first_visit,
             MAX(visit_at) AS last_visit
      FROM (
        SELECT DISTINCT ON (c.id)
               t.customer_id,
               c.total_price::numeric AS total_price,
               COALESCE(t.transaction_date, c.created_at) AS visit_at
        FROM transactions t
        JOIN checkouts c ON c.id = t.checkout_id
        WHERE t.store_id IN (${sql.join(storeIds.map((id) => sql`${id}`), sql`, `)})
          AND c.is_voided = false
        ORDER BY c.id, t.transaction_date
      ) per_checkout
      GROUP BY customer_id
    `);
    return (result.rows as any[]).map((r) => ({
      customerId: r.customer_id,
      totalSpend: Number(r.total_spend) || 0,
      firstVisit: new Date(r.first_visit).toISOString(),
      lastVisit: new Date(r.last_visit).toISOString(),
    }));
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

    // "Last updated" — the most recent post-creation change to this receipt.
    // Returns, addendums, voids, date edits and payment-status edits all log to
    // auditLogs against one of this receipt's checkout ids (see SalesRepository's
    // processReturn/processAddendum and transaction.routes.ts), each with the
    // actor's name already snapshotted on the row — no separate staff/user join
    // needed. "CHECKOUT" is the original sale itself, not an update, so it's excluded.
    const checkoutIds = matchedCheckouts.map(c => c.id);
    const [lastUpdate] = checkoutIds.length
      ? await db.select()
          .from(auditLogs)
          .where(and(
            eq(auditLogs.resource, "checkout"),
            inArray(auditLogs.resourceId, checkoutIds),
            eq(auditLogs.status, "success"),
            sql`${auditLogs.action} != 'CHECKOUT'`,
          ))
          .orderBy(desc(auditLogs.timestamp))
          .limit(1)
      : [];

    const ACTION_LABELS: Record<string, string> = {
      TRANSACTION_RETURN: "Return processed",
      TRANSACTION_ADDENDUM: "Item added",
      TRANSACTION_VOID: "Voided",
      TRANSACTION_DATE_EDIT: "Transaction date edited",
      TRANSACTION_STAFF_EDIT: "Performed-by corrected",
      PAYMENT_UPDATE: "Payment status updated",
    };

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
      settings: storeSettings ? { receiptPrefix: resolvedPrefix, receiptThankYouMessage: storeSettings.receiptThankYouMessage, loyaltyPointValue: storeSettings.loyaltyPointValue } : null,
      checkout: { ...primaryCheckout, voidedByUser },
      order: items[0]?.order || null,
      inventory: items[0]?.inventory || null,
      customer,
      staff: staffMember,
      leadStaff: items[0]?.leadStaff || null,
      items,
      creditEntry: creditEntry || null,
      returnLogs: resolvedReturnLogs,
      lastUpdate: lastUpdate ? {
        at: lastUpdate.timestamp,
        actorName: lastUpdate.actorName ?? null,
        action: ACTION_LABELS[lastUpdate.action] ?? lastUpdate.action.replace(/_/g, " "),
      } : null,
    };
  }

  async searchTransactions(storeIds: string[], query: string): Promise<any[]> {
    const tokens = searchTokens(query);
    if (storeIds.length === 0 || tokens.length === 0) return [];

    // A receipt carries no customer of its own — the buyer hangs off its line
    // items — so customer-name hits are resolved with an EXISTS rather than a
    // join, which would fan one checkout out into a row per line item.
    const tokenMatches = tokens.map((token) => {
      const pattern = infix(token);
      return or(
        ilike(checkouts.receiptNumber, pattern),
        ilike(checkouts.paymentReference, pattern),
        exists(
          db.select({ hit: sql`1` })
            .from(transactions)
            .innerJoin(customers, eq(customers.id, transactions.customerId))
            .where(and(
              eq(transactions.checkoutId, checkouts.id),
              ilike(customers.name, pattern),
            )),
        ),
      )!;
    });

    const rows = await db.select()
      .from(checkouts)
      .where(and(inArray(checkouts.storeId, storeIds), ...tokenMatches))
      .orderBy(desc(checkouts.createdAt))
      .limit(10);

    const checkoutIds = rows.map((r) => r.id);
    const [txIdByCheckout, customerNameByCheckout] = await Promise.all([
      resolveTransactionIdsForCheckouts(checkoutIds),
      resolveCustomerNamesForCheckouts(checkoutIds),
    ]);

    return rows
      .filter((r) => txIdByCheckout.has(r.id))
      .map((r) => ({
        ...r,
        id: txIdByCheckout.get(r.id)!,
        customerName: customerNameByCheckout.get(r.id) ?? null,
      }));
  }
}

/**
 * Maps each checkout id to one representative `transactions.id` belonging to it.
 * Used to deep-link receipt/checkout-level references (which only carry a checkoutId)
 * to the transaction detail page, since `/transactions/:id` resolves against `transactions.id`.
 */
export async function resolveTransactionIdsForCheckouts(checkoutIds: string[]): Promise<Map<string, string>> {
  if (checkoutIds.length === 0) return new Map();
  const rows = await db
    .select({
      checkoutId: transactions.checkoutId,
      id: sql<string>`min(${transactions.id})`,
    })
    .from(transactions)
    .where(inArray(transactions.checkoutId, checkoutIds))
    .groupBy(transactions.checkoutId);
  return new Map(rows.map((r) => [r.checkoutId, r.id]));
}

/**
 * Maps each checkout id to the name of the customer it was sold to, so search
 * results can show who a receipt belongs to. Every line item on a checkout
 * carries the same customer, so any one of them answers the question.
 */
async function resolveCustomerNamesForCheckouts(checkoutIds: string[]): Promise<Map<string, string>> {
  if (checkoutIds.length === 0) return new Map();
  const rows = await db
    .select({
      checkoutId: transactions.checkoutId,
      name: sql<string>`min(${customers.name})`,
    })
    .from(transactions)
    .innerJoin(customers, eq(customers.id, transactions.customerId))
    .where(inArray(transactions.checkoutId, checkoutIds))
    .groupBy(transactions.checkoutId);
  return new Map(rows.map((r) => [r.checkoutId, r.name]));
}
