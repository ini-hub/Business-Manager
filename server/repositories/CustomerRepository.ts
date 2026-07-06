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
  type Customer,
  type InsertCustomer,
} from "@shared/schema";
import { eq, and, or, ilike, inArray, count, asc, sql, gte, lte, desc } from "drizzle-orm";
import { normalizePhoneNumber } from "../sanitize";
import type { PaginationOptions, PaginatedResult } from "../storage";

export class CustomerRepository {
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
          ilike(customers.mobileNumber, `%${search}%`)
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

  async getCustomer(id: string): Promise<Customer | undefined> {
    const [customer] = await db.select().from(customers).where(eq(customers.id, id));
    return customer;
  }

  async createCustomer(customer: InsertCustomer): Promise<Customer> {
    const customerNumber = await this.getNextAvailableCustomerNumber(customer.storeId);
    const { birthday, ...rest } = customer;

    const normalizedPhone = customer.mobileNumber ? normalizePhoneNumber(customer.mobileNumber) : null;

    const [newCustomer] = await db.insert(customers).values({
      ...rest,
      mobileNumber: normalizedPhone || null,
      customerNumber,
      birthday: birthday ? new Date(birthday) : null,
    }).returning();

    await this.linkGlobalCustomerIds(newCustomer.id);

    const [fresh] = await db.select().from(customers).where(eq(customers.id, newCustomer.id));
    return fresh || newCustomer;
  }

  async updateCustomer(id: string, customerData: Partial<InsertCustomer>): Promise<Customer | undefined> {
    const { birthday, ...rest } = customerData;
    const updateData: any = { ...rest };
    if (birthday !== undefined) {
      updateData.birthday = birthday ? new Date(birthday) : null;
    }
    if (customerData.mobileNumber !== undefined) {
      updateData.mobileNumber = customerData.mobileNumber ? normalizePhoneNumber(customerData.mobileNumber) : null;
    }

    const [updated] = await db.update(customers).set(updateData).where(eq(customers.id, id)).returning();
    if (updated) {
      await this.linkGlobalCustomerIds(updated.id);
      const [fresh] = await db.select().from(customers).where(eq(customers.id, updated.id));
      return fresh || updated;
    }
    return updated;
  }

  async deleteCustomer(id: string): Promise<boolean> {
    const result = await db.update(customers)
      .set({ isArchived: true })
      .where(eq(customers.id, id))
      .returning();
    return result.length > 0;
  }

  async archiveCustomer(id: string): Promise<Customer | undefined> {
    const [updated] = await db.update(customers).set({ isArchived: true }).where(eq(customers.id, id)).returning();
    return updated;
  }

  async restoreCustomer(id: string): Promise<Customer | undefined> {
    const [updated] = await db.update(customers).set({ isArchived: false }).where(eq(customers.id, id)).returning();
    return updated;
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
          eq(customers.mobileNumber, phone),
          eq(customers.isArchived, false)
        )
      );
    return customer;
  }

  async dismissDuplicate(targetId: string, duplicateId: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.update(customers).set({ isConfirmedDistinct: true }).where(eq(customers.id, targetId));
      await tx.update(customers).set({ isConfirmedDistinct: true }).where(eq(customers.id, duplicateId));
    });
  }

  async mergeCustomers(targetId: string, duplicateId: string, customFields?: Partial<InsertCustomer>): Promise<Customer> {
    return await db.transaction(async (tx) => {
      const [target] = await tx.select().from(customers).where(eq(customers.id, targetId));
      const [duplicate] = await tx.select().from(customers).where(eq(customers.id, duplicateId));

      if (!target || !duplicate) {
        throw new Error("Target or Duplicate customer not found.");
      }

      const combinedPoints = (target.loyaltyPoints || 0) + (duplicate.loyaltyPoints || 0);
      const updateData: any = { loyaltyPoints: combinedPoints };

      if (customFields) {
        const { birthday, ...rest } = customFields;
        Object.assign(updateData, rest);
        if (birthday !== undefined) {
          updateData.birthday = birthday ? new Date(birthday) : null;
        }
      }

      const [updatedTarget] = await tx
        .update(customers)
        .set(updateData)
        .where(eq(customers.id, targetId))
        .returning();

      await tx.update(bookings).set({ customerId: targetId }).where(eq(bookings.customerId, duplicateId));
      await tx.update(transactions).set({ customerId: targetId }).where(eq(transactions.customerId, duplicateId));
      await tx.update(creditEntries).set({ customerId: targetId }).where(eq(creditEntries.customerId, duplicateId));
      await tx.update(quotes).set({ customerId: targetId }).where(eq(quotes.customerId, duplicateId));

      await tx.update(customers).set({ isArchived: true, mergedIntoId: targetId }).where(eq(customers.id, duplicateId));

      return updatedTarget;
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

    const tz = businessStores[0] ? (await db.select({ timezone: stores.timezone }).from(stores).where(eq(stores.id, businessStores[0].id)).limit(1))[0]?.timezone ?? "Africa/Lagos" : "Africa/Lagos";
    if (startDate) conditions.push(gte(customers.createdAt, toUtcStart(startDate, tz)));
    if (endDate) conditions.push(lte(customers.createdAt, toUtcEnd(endDate, tz)));

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
            normalizedPhone ? ilike(customers.mobileNumber, phonePattern) : sql`false`
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
            .set({ globalCustomerId: sourceCustomer.globalCustomerId })
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
    const [updated] = await db.update(customers).set({ staffId }).where(eq(customers.id, customerId)).returning();
    return updated;
  }

  async unlinkStaffFromCustomer(customerId: string): Promise<Customer | undefined> {
    const [updated] = await db.update(customers).set({ staffId: null }).where(eq(customers.id, customerId)).returning();
    return updated;
  }

  async getCustomerByStaffId(staffId: string): Promise<Customer | undefined> {
    const [customer] = await db.select().from(customers).where(eq(customers.staffId, staffId));
    return customer;
  }

  async searchCustomers(storeId: string, query: string): Promise<Customer[]> {
    return db.select()
      .from(customers)
      .where(and(eq(customers.storeId, storeId), ilike(customers.name, `%${query}%`)))
      .limit(10);
  }

  async getTopCustomers(storeId: string, startDate?: string, endDate?: string): Promise<any[]> {
    const conditions: any[] = [eq(customers.storeId, storeId), eq(checkouts.isVoided, false)];
    if (startDate || endDate) {
      const tz = await getStoreTimezone(storeId);
      if (startDate) conditions.push(gte(checkouts.createdAt, toUtcStart(startDate, tz)));
      if (endDate) conditions.push(lte(checkouts.createdAt, toUtcEnd(endDate, tz)));
    }

    return db.select({
      id: customers.id,
      name: customers.name,
      customerNumber: customers.customerNumber,
      totalSpent: sql<number>`sum(${checkouts.totalPrice})`,
      transactionCount: sql<number>`count(${checkouts.id})`,
    })
      .from(customers)
      .innerJoin(transactions, eq(customers.id, transactions.customerId))
      .innerJoin(checkouts, eq(transactions.checkoutId, checkouts.id))
      .where(and(...conditions))
      .groupBy(customers.id, customers.name, customers.customerNumber)
      .orderBy(desc(sql`sum(${checkouts.totalPrice})`))
      .limit(10);
  }
}
