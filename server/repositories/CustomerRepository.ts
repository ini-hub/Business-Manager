import { db } from "../db";
import { getStoreTimezone, toUtcStart, toUtcEnd } from "../lib/dateUtils";
import {
  customers,
  stores,
  transactions,
  bookings,
  creditEntries,
  quotes,
  checkouts,
  orders,
  customerPhones,
  storeCreditTransactions,
  type Customer,
  type CustomerPhone,
  type InsertCustomer,
} from "@shared/schema";
import { eq, ne, and, or, ilike, inArray, count, asc, sql, gte, lte, desc } from "drizzle-orm";
import { normalizePhoneNumber, sanitizePhoneNumber } from "../sanitize";
import { searchTokens, infix, searchPhoneDigits } from "../lib/searchTerms";
import { assertWithinCountLimit, getBusinessIdForStore } from "../lib/entitlements";
import type { PaginationOptions, PaginatedResult } from "../storage";

type Conn = Pick<typeof db, "select" | "insert" | "update" | "delete">;

/** True when any of the customer's numbers (primary or secondary) matches the ilike pattern. */
const anyPhoneLike = (pattern: string) =>
  sql`exists (select 1 from customer_phones cp where cp.customer_id = ${customers.id} and cp.number ilike ${pattern})`;

export class CustomerRepository {
  // ─── Phone numbers ─────────────────────────────────────────────────────────
  // customers.mobileNumber always mirrors the primary row of customer_phones.
  private async mirrorPrimary(conn: Conn, customerId: string): Promise<void> {
    const [primary] = await conn.select().from(customerPhones)
      .where(and(eq(customerPhones.customerId, customerId), eq(customerPhones.isPrimary, true)));
    await conn.update(customers)
      .set({ mobileNumber: primary?.number ?? null, updatedAt: new Date() })
      .where(eq(customers.id, customerId));
  }

  /** Customers created outside createCustomer (bulk import, walk-in provisioning) may hold a number with no phone row yet. */
  private async ensureLegacyRow(conn: Conn, customer: Customer): Promise<void> {
    if (!customer.mobileNumber) return;
    const rows = await conn.select().from(customerPhones).where(eq(customerPhones.customerId, customer.id));
    if (rows.some(r => r.number === customer.mobileNumber)) return;
    await conn.insert(customerPhones).values({
      customerId: customer.id, storeId: customer.storeId, number: customer.mobileNumber, isPrimary: !rows.some(r => r.isPrimary),
    });
  }

  /** Make the first remaining number primary when the customer has numbers but none is primary. */
  private async ensurePrimary(conn: Conn, customerId: string): Promise<void> {
    const rows = await conn.select().from(customerPhones)
      .where(eq(customerPhones.customerId, customerId)).orderBy(asc(customerPhones.createdAt));
    if (rows.length > 0 && !rows.some(r => r.isPrimary)) {
      await conn.update(customerPhones).set({ isPrimary: true }).where(eq(customerPhones.id, rows[0].id));
    }
    await this.mirrorPrimary(conn, customerId);
  }

  /** Set (or clear, with null) the primary number — what the edit form's single phone field does. */
  private async replacePrimaryNumber(conn: Conn, customerId: string, storeId: string, number: string | null): Promise<void> {
    const [current] = await conn.select().from(customerPhones)
      .where(and(eq(customerPhones.customerId, customerId), eq(customerPhones.isPrimary, true)));
    if (!number) {
      if (current) await conn.delete(customerPhones).where(eq(customerPhones.id, current.id));
    } else if (!current || current.number !== number) {
      const [existing] = await conn.select().from(customerPhones)
        .where(and(eq(customerPhones.customerId, customerId), eq(customerPhones.number, number)));
      if (existing) {
        // The number is already on the profile as a secondary: promote it, and drop the old primary (it was a correction).
        if (current) await conn.delete(customerPhones).where(eq(customerPhones.id, current.id));
        await conn.update(customerPhones).set({ isPrimary: true }).where(eq(customerPhones.id, existing.id));
      } else if (current) {
        await conn.update(customerPhones).set({ number }).where(eq(customerPhones.id, current.id));
      } else {
        await conn.insert(customerPhones).values({ customerId, storeId, number, isPrimary: true });
      }
    }
    await this.ensurePrimary(conn, customerId);
  }

  async getPhones(customerId: string): Promise<CustomerPhone[]> {
    return db.select().from(customerPhones)
      .where(eq(customerPhones.customerId, customerId))
      .orderBy(desc(customerPhones.isPrimary), asc(customerPhones.createdAt));
  }

  /** The live profile in this store that already uses this number, if any. */
  async findPhoneOwner(storeId: string, number: string, excludeCustomerId?: string): Promise<Customer | undefined> {
    const [row] = await db.select({ customer: customers })
      .from(customerPhones)
      .innerJoin(customers, eq(customers.id, customerPhones.customerId))
      .where(and(
        eq(customerPhones.storeId, storeId),
        eq(customerPhones.number, number),
        eq(customers.isArchived, false),
        excludeCustomerId ? ne(customers.id, excludeCustomerId) : undefined,
      ))
      .limit(1);
    return row?.customer;
  }

  async addPhone(customerId: string, rawNumber: string, opts: { label?: string | null; makePrimary?: boolean } = {}): Promise<CustomerPhone[]> {
    const number = sanitizePhoneNumber(rawNumber);
    if (!number) throw new Error("Enter a valid phone number.");
    await db.transaction(async (tx) => {
      const [customer] = await tx.select().from(customers).where(eq(customers.id, customerId));
      if (!customer) throw new Error("Customer not found.");
      await this.ensureLegacyRow(tx, customer);
      const existing = await tx.select().from(customerPhones).where(eq(customerPhones.customerId, customerId));
      if (existing.some(p => p.number === number)) throw new Error("This number is already on this customer.");
      const makePrimary = opts.makePrimary || existing.length === 0;
      if (makePrimary) {
        await tx.update(customerPhones).set({ isPrimary: false }).where(eq(customerPhones.customerId, customerId));
      }
      await tx.insert(customerPhones).values({
        customerId, storeId: customer.storeId, number, label: opts.label?.trim() || null, isPrimary: makePrimary,
      });
      await this.mirrorPrimary(tx, customerId);
    });
    await this.linkGlobalCustomerIds(customerId);
    return this.getPhones(customerId);
  }

  async removePhone(customerId: string, phoneId: string): Promise<CustomerPhone[]> {
    await db.transaction(async (tx) => {
      const deleted = await tx.delete(customerPhones)
        .where(and(eq(customerPhones.id, phoneId), eq(customerPhones.customerId, customerId))).returning();
      if (deleted.length === 0) throw new Error("Phone number not found.");
      await this.ensurePrimary(tx, customerId);
    });
    await this.linkGlobalCustomerIds(customerId);
    return this.getPhones(customerId);
  }

  async setPrimaryPhone(customerId: string, phoneId: string): Promise<CustomerPhone[]> {
    await db.transaction(async (tx) => {
      const [row] = await tx.select().from(customerPhones)
        .where(and(eq(customerPhones.id, phoneId), eq(customerPhones.customerId, customerId)));
      if (!row) throw new Error("Phone number not found.");
      await tx.update(customerPhones).set({ isPrimary: false }).where(eq(customerPhones.customerId, customerId));
      await tx.update(customerPhones).set({ isPrimary: true }).where(eq(customerPhones.id, phoneId));
      await this.mirrorPrimary(tx, customerId);
    });
    await this.linkGlobalCustomerIds(customerId);
    return this.getPhones(customerId);
  }

  /**
   * Profiles in this store whose name looks like the one being entered (same words in any order, or one name
   * containing all the words of the other). Used to ask "same person?" before a second profile is created.
   */
  async findSimilarByName(storeId: string, name: string, excludeId?: string) {
    const words = (v: string) => Array.from(new Set(v.toLowerCase().split(/[^a-z0-9À-ɏ]+/).filter(w => w.length > 1)));
    const wanted = words(name);
    if (wanted.length === 0) return [];
    const candidates = await db.select().from(customers).where(and(
      eq(customers.storeId, storeId),
      eq(customers.isArchived, false),
      excludeId ? ne(customers.id, excludeId) : undefined,
      or(...wanted.map(w => ilike(customers.name, `%${w}%`)))!,
    )).limit(100);

    const similar = candidates.filter(c => {
      const have = words(c.name);
      if (have.length === 0) return false;
      const [small, big] = wanted.length <= have.length ? [wanted, have] : [have, wanted];
      if (small.length < 2) return small.length === big.length && small[0] === big[0];
      return small.every(w => big.includes(w));
    }).slice(0, 5);
    if (similar.length === 0) return [];

    const ids = similar.map(c => c.id);
    const stats = await db.select({
      customerId: transactions.customerId,
      visits: sql<number>`count(distinct ${checkouts.receiptNumber})`,
      lastVisit: sql<string | null>`max(${transactions.transactionDate})`,
    }).from(transactions)
      .leftJoin(checkouts, eq(checkouts.id, transactions.checkoutId))
      .where(inArray(transactions.customerId, ids))
      .groupBy(transactions.customerId);
    const statById = new Map(stats.map(r => [r.customerId, r]));
    const phones = await db.select().from(customerPhones).where(inArray(customerPhones.customerId, ids));

    return similar.map(c => ({
      id: c.id,
      name: c.name,
      customerNumber: c.customerNumber,
      isConfirmedDistinct: c.isConfirmedDistinct,
      numbers: phones.filter(p => p.customerId === c.id).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)).map(p => p.number),
      visits: Number(statById.get(c.id)?.visits ?? 0),
      lastVisit: statById.get(c.id)?.lastVisit ?? null,
    }));
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────
  private async getNextAvailableCustomerNumber(storeId: string): Promise<string> {
    const [store] = await db.select().from(stores).where(eq(stores.id, storeId));
    if (!store) throw new Error("Store not found");

    const existingCustomers = await db.select({ customerNumber: customers.customerNumber })
      .from(customers)
      .where(eq(customers.storeId, storeId));

    const usedNumbers = new Set<number>();
    const prefix = store.code;

    for (const c of existingCustomers) {
      if (c.customerNumber.startsWith(prefix)) {
        const numPart = c.customerNumber.slice(prefix.length);
        const num = parseInt(numPart, 10);
        if (!isNaN(num)) {
          usedNumbers.add(num);
        }
      }
    }

    let nextNumber = 1;
    while (usedNumbers.has(nextNumber)) {
      nextNumber++;
    }

    return `${prefix}${nextNumber.toString().padStart(3, '0')}`;
  }

  // ─── Global Linking ────────────────────────────────────────────────────────
  async linkGlobalCustomerIds(customerId: string): Promise<void> {
    const [customer] = await db.select().from(customers).where(eq(customers.id, customerId));
    if (!customer) return;

    const normalizedPhone = customer.mobileNumber ? normalizePhoneNumber(customer.mobileNumber) : "";

    if (!normalizedPhone) {
      await db.update(customers).set({ globalCustomerId: null }).where(eq(customers.id, customerId));
      return;
    }

    const [store] = await db.select().from(stores).where(eq(stores.id, customer.storeId));
    if (!store) return;

    const businessStores = await db.select({ id: stores.id }).from(stores).where(eq(stores.businessId, store.businessId));
    const storeIds = businessStores.map(s => s.id);
    if (storeIds.length === 0) return;

    const matches = await db
      .select()
      .from(customers)
      .where(
        and(
          inArray(customers.storeId, storeIds),
          eq(customers.mobileNumber, normalizedPhone),
          eq(customers.isArchived, false)
        )
      );

    if (matches.length > 0) {
      let globalId = matches.find(c => c.globalCustomerId)?.globalCustomerId || null;
      if (!globalId) {
        const crypto = await import("crypto");
        globalId = crypto.randomUUID();
      }
      const idsToUpdate = matches.map(c => c.id);
      await db
        .update(customers)
        .set({ globalCustomerId: globalId })
        .where(inArray(customers.id, idsToUpdate));
    } else {
      const crypto = await import("crypto");
      const globalId = crypto.randomUUID();
      await db
        .update(customers)
        .set({ globalCustomerId: globalId })
        .where(eq(customers.id, customerId));
    }
  }

  // ─── CRUD ──────────────────────────────────────────────────────────────────
  async getCustomers(storeId: string, includeArchived: boolean = true): Promise<Customer[]> {
    if (includeArchived) {
      return await db.select().from(customers).where(eq(customers.storeId, storeId));
    }
    return await db.select().from(customers).where(
      and(eq(customers.storeId, storeId), eq(customers.isArchived, false))
    );
  }

  async getCustomersPaginated(storeId: string, options: PaginationOptions): Promise<PaginatedResult<Customer>> {
    const { page, limit, search, includeArchived = false } = options;
    const offset = (page - 1) * limit;

    const conditions = [eq(customers.storeId, storeId)];
    if (!includeArchived) {
      conditions.push(eq(customers.isArchived, false));
    }
    if (search) {
      conditions.push(
        or(
          ilike(customers.name, `%${search}%`),
          ilike(customers.customerNumber, `%${search}%`),
          ilike(customers.mobileNumber, `%${search}%`),
          anyPhoneLike(`%${search}%`)
        )!
      );
    }

    const [countResult] = await db.select({ count: count() })
      .from(customers)
      .where(and(...conditions));
    const total = countResult.count;

    const data = await db.select()
      .from(customers)
      .where(and(...conditions))
      .orderBy(asc(customers.customerNumber))
      .limit(limit)
      .offset(offset);

    const totalPages = Math.ceil(total / limit);

    return {
      data,
      pagination: {
        total,
        page,
        limit,
        totalPages,
        hasMore: page < totalPages,
      },
    };
  }

  /**
   * One page of customers across one or more stores, filtered and ordered in the database. Across several stores
   * a person who is a customer of more than one (same mobile number) is one row, carrying every store's name in
   * `storeName`, as the all-stores screens expect; a customer with no number stands alone.
   */
  async getCustomersPage(
    storeIds: string[],
    options: { search?: string; includeArchived?: boolean },
    page: { limit: number; offset: number },
  ): Promise<{ rows: (Customer & { storeName?: string })[]; total: number }> {
    if (storeIds.length === 0) return { rows: [], total: 0 };
    const conditions: any[] = [storeIds.length === 1 ? eq(customers.storeId, storeIds[0]) : inArray(customers.storeId, storeIds)];
    if (!options.includeArchived) conditions.push(eq(customers.isArchived, false));
    if (options.search) {
      const pattern = `%${options.search}%`;
      conditions.push(or(
        ilike(customers.name, pattern),
        ilike(customers.customerNumber, pattern),
        ilike(customers.mobileNumber, pattern),
        anyPhoneLike(pattern),
      )!);
    }
    const where = and(...conditions);

    if (storeIds.length === 1) {
      const [rows, [{ total }]] = await Promise.all([
        db.select().from(customers).where(where).orderBy(asc(customers.customerNumber), asc(customers.id)).limit(page.limit).offset(page.offset),
        db.select({ total: sql<number>`count(*)::int` }).from(customers).where(where),
      ]);
      return { rows, total };
    }

    const key = sql`COALESCE(NULLIF(${customers.mobileNumber}, ''), ${customers.id})`;
    const groups = await db.select({
      id: sql<string>`(array_agg(${customers.id} ORDER BY ${customers.customerNumber}, ${customers.id}))[1]`,
      storeName: sql<string>`string_agg(DISTINCT ${stores.name}, ', ')`,
      total: sql<number>`(count(*) OVER ())::int`,
    })
      .from(customers)
      .innerJoin(stores, eq(stores.id, customers.storeId))
      .where(where)
      .groupBy(key)
      .orderBy(sql`min(${customers.customerNumber})`, sql`min(${customers.id})`)
      .limit(page.limit)
      .offset(page.offset);
    if (groups.length === 0) return { rows: [], total: 0 };

    const found = await db.select().from(customers).where(inArray(customers.id, groups.map(g => g.id)));
    const byId = new Map(found.map(c => [c.id, c]));
    return {
      rows: groups.map(g => ({ ...byId.get(g.id)!, storeName: g.storeName })),
      total: groups[0].total,
    };
  }

  async getCustomer(id: string): Promise<Customer | undefined> {
    const [customer] = await db.select().from(customers).where(eq(customers.id, id));
    return customer;
  }

  /** True when a live (non-archived) profile with this phone or global id exists in any store of the business. */
  private async personHasLiveProfile(
    conn: Pick<typeof db, "select">,
    businessId: string,
    who: { phone?: string | null; globalId?: string | null; excludeId?: string },
  ): Promise<boolean> {
    const same = [
      who.phone ? eq(customers.mobileNumber, who.phone) : undefined,
      who.globalId ? eq(customers.globalCustomerId, who.globalId) : undefined,
    ].filter((c): c is NonNullable<typeof c> => !!c);
    if (same.length === 0) return false;
    const rows = await conn
      .select({ id: customers.id })
      .from(customers)
      .innerJoin(stores, eq(customers.storeId, stores.id))
      .where(and(eq(stores.businessId, businessId), eq(customers.isArchived, false), or(...same), who.excludeId ? ne(customers.id, who.excludeId) : undefined))
      .limit(1);
    return rows.length > 0;
  }

  async createCustomer(customer: InsertCustomer): Promise<Customer> {
    const { birthday, ...rest } = customer;

    const normalizedPhone = customer.mobileNumber ? normalizePhoneNumber(customer.mobileNumber) : null;

    const newCustomer = await db.transaction(async (tx) => {
      // Free-tier customer cap, checked under the same lock/transaction as the insert.
      // A person who already has a live profile in another of the business's stores is the same customer, so a
      // second profile for them takes no new slot (the cap counts people, not profiles).
      const businessId = await getBusinessIdForStore(tx, customer.storeId);
      if (businessId && !(normalizedPhone && (await this.personHasLiveProfile(tx, businessId, { phone: normalizedPhone })))) {
        await assertWithinCountLimit(tx, businessId, "customer_count");
      }

      const customerNumber = await this.getNextAvailableCustomerNumber(customer.storeId);
      const [inserted] = await tx.insert(customers).values({
        ...rest,
        mobileNumber: normalizedPhone || null,
        customerNumber,
        birthday: birthday ? new Date(birthday) : null,
      }).returning();
      if (normalizedPhone) {
        await tx.insert(customerPhones).values({ customerId: inserted.id, storeId: inserted.storeId, number: normalizedPhone, isPrimary: true });
      }
      return inserted;
    });

    await this.linkGlobalCustomerIds(newCustomer.id);

    const [fresh] = await db.select().from(customers).where(eq(customers.id, newCustomer.id));
    return fresh || newCustomer;
  }

  async updateCustomer(id: string, customerData: Partial<InsertCustomer>): Promise<Customer | undefined> {
    const { birthday, mobileNumber, ...rest } = customerData;
    const updateData: any = { ...rest };
    if (birthday !== undefined) {
      updateData.birthday = birthday ? new Date(birthday) : null;
    }
    updateData.updatedAt = new Date();

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx.update(customers).set(updateData).where(eq(customers.id, id)).returning();
      // The single phone field on the edit form is the primary number; the phones table is the source of truth.
      if (row && mobileNumber !== undefined) {
        await this.replacePrimaryNumber(tx, id, row.storeId, mobileNumber ? normalizePhoneNumber(mobileNumber) : null);
      }
      return row;
    });
    if (updated) {
      await this.linkGlobalCustomerIds(updated.id);
      const [fresh] = await db.select().from(customers).where(eq(customers.id, updated.id));
      return fresh || updated;
    }
    return updated;
  }

  async deleteCustomer(id: string): Promise<boolean> {
    const result = await db.update(customers)
      .set({ isArchived: true, updatedAt: new Date() })
      .where(eq(customers.id, id))
      .returning();
    return result.length > 0;
  }

  async archiveCustomer(id: string): Promise<Customer | undefined> {
    const [updated] = await db.update(customers).set({ isArchived: true, updatedAt: new Date() }).where(eq(customers.id, id)).returning();
    return updated;
  }

  async restoreCustomer(id: string): Promise<Customer | undefined> {
    return db.transaction(async (tx) => {
      const [current] = await tx
        .select({ storeId: customers.storeId, isArchived: customers.isArchived, globalCustomerId: customers.globalCustomerId, mobileNumber: customers.mobileNumber })
        .from(customers)
        .where(eq(customers.id, id))
        .limit(1);
      // Un-archiving takes a slot back, so it's subject to the same free-tier cap as a new customer - unless the
      // same person already has a live profile elsewhere in the business, in which case they're already counted.
      if (current?.isArchived) {
        const businessId = await getBusinessIdForStore(tx, current.storeId);
        if (businessId && !(await this.personHasLiveProfile(tx, businessId, { phone: current.mobileNumber, globalId: current.globalCustomerId, excludeId: id }))) {
          await assertWithinCountLimit(tx, businessId, "customer_count");
        }
      }
      const [updated] = await tx.update(customers).set({ isArchived: false, updatedAt: new Date() }).where(eq(customers.id, id)).returning();
      return updated;
    });
  }

  async hasCustomerTransactions(id: string): Promise<boolean> {
    const result = await db.select({ count: count() }).from(transactions).where(eq(transactions.customerId, id));
    return result[0].count > 0;
  }

  async findCustomerByPhone(storeId: string, phone: string): Promise<Customer | undefined> {
    const [customer] = await db
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.storeId, storeId),
          or(
            eq(customers.mobileNumber, phone),
            sql`exists (select 1 from customer_phones cp where cp.customer_id = ${customers.id} and cp.number = ${phone})`,
          ),
          eq(customers.isArchived, false)
        )
      );
    return customer;
  }

  async dismissDuplicate(targetId: string, duplicateId: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.update(customers).set({ isConfirmedDistinct: true, updatedAt: new Date() }).where(eq(customers.id, targetId));
      await tx.update(customers).set({ isConfirmedDistinct: true, updatedAt: new Date() }).where(eq(customers.id, duplicateId));
    });
  }

  async mergeCustomers(targetId: string, duplicateId: string, customFields?: Partial<InsertCustomer>): Promise<Customer> {
    return await db.transaction(async (tx) => {
      const [target] = await tx.select().from(customers).where(eq(customers.id, targetId));
      const [duplicate] = await tx.select().from(customers).where(eq(customers.id, duplicateId));

      if (!target || !duplicate) {
        throw new Error("Target or Duplicate customer not found.");
      }
      if (target.id === duplicate.id) throw new Error("Pick two different customers to merge.");
      if (target.storeId !== duplicate.storeId) throw new Error("Only customers of the same store can be merged.");
      if (duplicate.staffId && !target.staffId) {
        throw new Error("The duplicate is linked to a staff member. Keep that profile and merge the other into it.");
      }

      const combinedPoints = (target.loyaltyPoints || 0) + (duplicate.loyaltyPoints || 0);
      const combinedCredit = Math.round(((target.storeCreditBalance || 0) + (duplicate.storeCreditBalance || 0)) * 100) / 100;
      const updateData: any = { loyaltyPoints: combinedPoints, storeCreditBalance: combinedCredit };

      if (customFields) {
        // Numbers are merged below from customer_phones, never overwritten from the form; credit is summed above.
        const { birthday, mobileNumber: _m, storeCreditBalance: _c, loyaltyPoints: _l, ...rest } = customFields as any;
        Object.assign(updateData, rest);
        if (birthday !== undefined) {
          updateData.birthday = birthday ? new Date(birthday) : null;
        }
      }
      updateData.updatedAt = new Date();

      const [updatedTarget] = await tx
        .update(customers)
        .set(updateData)
        .where(eq(customers.id, targetId))
        .returning();

      await tx.update(bookings).set({ customerId: targetId }).where(eq(bookings.customerId, duplicateId));
      await tx.update(transactions).set({ customerId: targetId }).where(eq(transactions.customerId, duplicateId));
      await tx.update(creditEntries).set({ customerId: targetId }).where(eq(creditEntries.customerId, duplicateId));
      await tx.update(quotes).set({ customerId: targetId }).where(eq(quotes.customerId, duplicateId));
      await tx.update(storeCreditTransactions).set({ customerId: targetId }).where(eq(storeCreditTransactions.customerId, duplicateId));

      await this.ensureLegacyRow(tx, target);
      await this.ensureLegacyRow(tx, duplicate);
      // Union the phone numbers: the kept profile's primary stays primary, nothing is discarded.
      const duplicatePhones = await tx.select().from(customerPhones).where(eq(customerPhones.customerId, duplicateId));
      const targetNumbers = new Set((await tx.select().from(customerPhones).where(eq(customerPhones.customerId, targetId))).map(p => p.number));
      for (const p of duplicatePhones) {
        if (!targetNumbers.has(p.number)) {
          await tx.insert(customerPhones).values({ customerId: targetId, storeId: target.storeId, number: p.number, label: p.label, isPrimary: false });
        }
      }
      await tx.delete(customerPhones).where(eq(customerPhones.customerId, duplicateId));
      await this.ensurePrimary(tx, targetId);

      await tx.update(customers).set({ isArchived: true, mergedIntoId: targetId, mobileNumber: null, duplicateOfId: null, updatedAt: new Date() }).where(eq(customers.id, duplicateId));
      await tx.update(customers).set({ duplicateOfId: null }).where(and(eq(customers.id, targetId), eq(customers.duplicateOfId, duplicateId)));

      const [fresh] = await tx.select().from(customers).where(eq(customers.id, targetId));
      return fresh ?? updatedTarget;
    }).then(async (merged) => {
      await this.linkGlobalCustomerIds(merged.id);
      return merged;
    });
  }

  async getBusinessCustomerCount(businessId: string, startDate?: string, endDate?: string): Promise<number> {
    const businessStores = await db.select({ id: stores.id }).from(stores).where(eq(stores.businessId, businessId));
    const storeIds = businessStores.map(s => s.id);
    if (storeIds.length === 0) return 0;

    let conditions: any[] = [
      inArray(customers.storeId, storeIds),
      eq(customers.isArchived, false)
    ];
    // Total customers is an unfiltered count (not scoped to date range)

    const [globalCountResult] = await db
      .select({ count: sql<number>`count(distinct ${customers.globalCustomerId})` })
      .from(customers)
      .where(and(...conditions, sql`${customers.globalCustomerId} is not null`));

    const [nullGlobalCountResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(customers)
      .where(and(...conditions, sql`${customers.globalCustomerId} is null`));

    return Number(globalCountResult?.count || 0) + Number(nullGlobalCountResult?.count || 0);
  }

  async searchGlobalCustomers(businessId: string, currentStoreId: string, query: string): Promise<any[]> {
    const businessStores = await db.select({ id: stores.id }).from(stores).where(eq(stores.businessId, businessId));
    const storeIds = businessStores.map(s => s.id);
    if (storeIds.length === 0) return [];

    const searchQuery = `%${query.trim()}%`;
    const normalizedPhone = normalizePhoneNumber(query);
    const phonePattern = normalizedPhone ? `%${normalizedPhone}%` : searchQuery;

    const matches = await db
      .select({ customer: customers, storeName: stores.name })
      .from(customers)
      .innerJoin(stores, eq(customers.storeId, stores.id))
      .where(
        and(
          inArray(customers.storeId, storeIds),
          eq(customers.isArchived, false),
          sql`${customers.storeId} != ${currentStoreId}`,
          or(
            ilike(customers.name, searchQuery),
            ilike(customers.customerNumber, searchQuery),
            normalizedPhone ? or(ilike(customers.mobileNumber, phonePattern), anyPhoneLike(phonePattern))! : sql`false`
          )
        )
      )
      .limit(30);

    return matches.map(m => ({ ...m.customer, storeName: m.storeName }));
  }

  async profileGlobalCustomer(customerId: string, targetStoreId: string): Promise<Customer> {
    const [sourceCustomer] = await db.select().from(customers).where(eq(customers.id, customerId));
    if (!sourceCustomer) throw new Error("Source customer not found.");

    if (sourceCustomer.globalCustomerId) {
      const [existing] = await db
        .select()
        .from(customers)
        .where(
          and(
            eq(customers.storeId, targetStoreId),
            eq(customers.globalCustomerId, sourceCustomer.globalCustomerId),
            eq(customers.isArchived, false)
          )
        );
      if (existing) return existing;
    }

    if (sourceCustomer.mobileNumber) {
      const normalizedPhone = normalizePhoneNumber(sourceCustomer.mobileNumber);
      const [existing] = await db
        .select()
        .from(customers)
        .where(
          and(
            eq(customers.storeId, targetStoreId),
            eq(customers.mobileNumber, normalizedPhone),
            eq(customers.isArchived, false)
          )
        );
      if (existing) {
        if (!existing.globalCustomerId && sourceCustomer.globalCustomerId) {
          await db.update(customers)
            .set({ globalCustomerId: sourceCustomer.globalCustomerId, updatedAt: new Date() })
            .where(eq(customers.id, existing.id));
          existing.globalCustomerId = sourceCustomer.globalCustomerId;
        }
        return existing;
      }
    }

    const customerNumber = await this.getNextAvailableCustomerNumber(targetStoreId);
    const [newCustomer] = await db
      .insert(customers)
      .values({
        storeId: targetStoreId,
        name: sourceCustomer.name,
        customerNumber,
        mobileNumber: sourceCustomer.mobileNumber ? normalizePhoneNumber(sourceCustomer.mobileNumber) : null,
        countryCode: sourceCustomer.countryCode || "NG",
        address: sourceCustomer.address || "",
        birthday: sourceCustomer.birthday,
        globalCustomerId: sourceCustomer.globalCustomerId,
        isConfirmedDistinct: false,
        loyaltyPoints: 0,
      })
      .returning();

    await this.linkGlobalCustomerIds(newCustomer.id);

    const [fresh] = await db.select().from(customers).where(eq(customers.id, newCustomer.id));
    return fresh || newCustomer;
  }

  async linkStaffToCustomer(customerId: string, staffId: string): Promise<Customer | undefined> {
    const [updated] = await db.update(customers).set({ staffId, updatedAt: new Date() }).where(eq(customers.id, customerId)).returning();
    return updated;
  }

  async unlinkStaffFromCustomer(customerId: string): Promise<Customer | undefined> {
    const [updated] = await db.update(customers).set({ staffId: null, updatedAt: new Date() }).where(eq(customers.id, customerId)).returning();
    return updated;
  }

  async getCustomerByStaffId(staffId: string): Promise<Customer | undefined> {
    const [customer] = await db.select().from(customers).where(eq(customers.staffId, staffId));
    return customer;
  }

  async searchCustomers(storeIds: string[], query: string): Promise<Customer[]> {
    const tokens = searchTokens(query);
    if (storeIds.length === 0 || tokens.length === 0) return [];

    // Every token must appear somewhere in the record; each may land in a
    // different field, so "ade CUST-4" matches on name and number together.
    const tokenMatches = tokens.map((token) => {
      const pattern = infix(token);
      return or(
        ilike(customers.name, pattern),
        ilike(customers.customerNumber, pattern),
        ilike(customers.mobileNumber, pattern),
      )!;
    });

    const digits = searchPhoneDigits(query);
    const matches = digits
      ? or(
          and(...tokenMatches)!,
          // '[^0-9]' rather than '\D': a backslash class would be eaten by the
          // template literal before it ever reached Postgres.
          sql`regexp_replace(coalesce(${customers.mobileNumber}, ''), '[^0-9]', '', 'g') like ${`%${digits}%`}`,
        )!
      : and(...tokenMatches)!;

    return db.select()
      .from(customers)
      .where(and(inArray(customers.storeId, storeIds), matches))
      // Archived customers stay searchable (the UI badges them) but rank last.
      .orderBy(asc(customers.isArchived), asc(customers.name))
      .limit(10);
  }

  async getTopCustomers(storeId: string, startDate?: string, endDate?: string): Promise<any[]> {
    const conditions: any[] = [eq(customers.storeId, storeId), eq(checkouts.isVoided, false)];
    if (startDate || endDate) {
      const tz = await getStoreTimezone(storeId);
      if (startDate) conditions.push(gte(checkouts.createdAt, toUtcStart(startDate, tz)));
      if (endDate) conditions.push(lte(checkouts.createdAt, toUtcEnd(endDate, tz)));
    }

    // "Spend" is customer-facing money, so use totalCharged (tax/discount-inclusive,
    // what they actually paid), not totalPrice (raw pre-discount/pre-tax) — paired
    // with refundedAmount, which is likewise tax-inclusive since it refunds what was
    // actually charged.
    const netSpent = sql<number>`COALESCE(SUM(GREATEST((${checkouts.totalCharged})::numeric - COALESCE((${orders.refundedAmount})::numeric, 0), 0)), 0)`;

    return db.select({
      id: customers.id,
      name: customers.name,
      customerNumber: customers.customerNumber,
      totalSpent: netSpent,
      transactionCount: sql<number>`count(${checkouts.id})`,
    })
      .from(customers)
      .innerJoin(transactions, eq(customers.id, transactions.customerId))
      .innerJoin(checkouts, eq(transactions.checkoutId, checkouts.id))
      .leftJoin(orders, eq(orders.id, checkouts.orderId))
      .where(and(...conditions))
      .groupBy(customers.id, customers.name, customers.customerNumber)
      .orderBy(desc(netSpent))
      .limit(10);
  }
}
