import { db } from "../db";
import { getStoreTimezone, toUtcStart, toUtcEnd } from "../lib/dateUtils";
import {
  staff,
  stores,
  checkouts,
  orders,
  inventory,
  transactions,
  attendanceRecords,
  users,
  organisationMembers,
  type Staff,
  type InsertStaff,
  type Store,
} from "@shared/schema";
import { eq, and, or, ilike, count, asc, desc, gte, lte, isNull, inArray } from "drizzle-orm";
import { commissionService } from "../services/CommissionService";
import type { PaginationOptions, PaginatedResult } from "../storage";

export class StaffRepository {
  // ─── Revenue share helper ─────────────────────────────────────────────────
  private revenueShare(
    staffId: string,
    checkout: { leadStaffId: string | null; staffId: string; assistingStaff1Id: string | null; assistingStaff2Id: string | null; commissionSplit: string },
    totalPrice: number
  ): number {
    const staffCount =
      1 +
      (checkout.assistingStaff1Id ? 1 : 0) +
      (checkout.assistingStaff2Id ? 1 : 0);

    const { leadShare, asstShare } = commissionService.calculateSplitShares(
      checkout.commissionSplit,
      staffCount
    );

    const isLead =
      checkout.leadStaffId === staffId ||
      (!checkout.leadStaffId && checkout.staffId === staffId);

    return totalPrice * (isLead ? leadShare : asstShare);
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────
  private async getNextAvailableStaffNumber(storeId: string): Promise<string> {
    const [store] = await db.select().from(stores).where(eq(stores.id, storeId));
    if (!store) throw new Error("Store not found");

    const existingStaff = await db.select({ staffNumber: staff.staffNumber })
      .from(staff)
      .where(eq(staff.storeId, storeId));

    const usedNumbers = new Set<number>();
    const prefix = `${store.code}-`;

    for (const s of existingStaff) {
      if (s.staffNumber.startsWith(prefix)) {
        const numPart = s.staffNumber.slice(prefix.length);
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

  // ─── CRUD ──────────────────────────────────────────────────────────────────
  async getStaffList(storeId: string, includeArchived: boolean = true): Promise<Staff[]> {
    if (includeArchived) {
      return await db.select().from(staff).where(eq(staff.storeId, storeId));
    }
    return await db.select().from(staff).where(
      and(eq(staff.storeId, storeId), eq(staff.isArchived, false))
    );
  }

  async getStaffPaginated(storeId: string, options: PaginationOptions): Promise<PaginatedResult<Staff>> {
    const { page, limit, search, includeArchived = false } = options;
    const offset = (page - 1) * limit;

    const conditions = [eq(staff.storeId, storeId)];
    if (!includeArchived) {
      conditions.push(eq(staff.isArchived, false));
    }
    if (search) {
      conditions.push(
        or(
          ilike(staff.name, `%${search}%`),
          ilike(staff.staffNumber, `%${search}%`),
          ilike(staff.mobileNumber, `%${search}%`)
        )!
      );
    }

    const [countResult] = await db.select({ count: count() })
      .from(staff)
      .where(and(...conditions));
    const total = countResult.count;

    const data = await db.select()
      .from(staff)
      .where(and(...conditions))
      .orderBy(asc(staff.staffNumber))
      .limit(limit)
      .offset(offset);

    const totalPages = Math.ceil(total / limit);

    return {
      data,
      pagination: { total, page, limit, totalPages, hasMore: page < totalPages },
    };
  }

  async getStaff(id: string): Promise<Staff | undefined> {
    const [staffMember] = await db.select().from(staff).where(eq(staff.id, id));
    return staffMember;
  }

  // Unscoped, this can return the wrong row: a user linked to staff rows in
  // more than one store (the common shape for an owner/manager who is "the
  // manager" at several branches) gets back whichever row Postgres happens to
  // return first, regardless of which store they're actually working in.
  // Callers that know which store they mean MUST pass storeId; it's optional
  // only for genuinely store-agnostic callers (pre-auth activation flows,
  // cross-store uniqueness checks — see call sites) that predate this and
  // still want "any one row for this user."
  async getStaffByUserId(userId: string, storeId?: string): Promise<Staff | undefined> {
    const condition = storeId ? and(eq(staff.userId, userId), eq(staff.storeId, storeId)) : eq(staff.userId, userId);
    const [result] = await db.select().from(staff).where(condition);
    return result;
  }

  // Unlike getStaffByUserId above, this deliberately returns every row: it
  // backs IdentitySync, which mirrors a login account's name/email onto ALL
  // of that person's staff records (they may work more than one store/
  // business), not just whichever one Postgres would return first.
  async getAllStaffByUserId(userId: string): Promise<Staff[]> {
    return db.select().from(staff).where(and(eq(staff.userId, userId), eq(staff.isArchived, false)));
  }

  /**
   * Raw material for the inviteStatus projection, fetched for a whole page of
   * staff in one query so the list route stays O(1) in DB round-trips.
   *
   * Joins on organisation_members.user_id, NOT staff_id: that column holds the
   * staffNumber ("EXB-001"), not staff.id, so it is useless as a join key here.
   * The left join keeps users whose membership row is missing entirely, which
   * is a real state - an invite that crashed between createUser and
   * createOrganisationMember - and one that resend is expected to repair.
   */
  async getInviteProjection(userIds: string[], organisationId: string): Promise<Array<{
    userId: string;
    memberStatus: string | null;
    createdByInvitation: boolean;
    activationCodeUsed: boolean;
    lastLoginAt: Date | null;
  }>> {
    if (userIds.length === 0) return [];
    return db
      .select({
        userId: users.id,
        memberStatus: organisationMembers.status,
        createdByInvitation: users.createdByInvitation,
        activationCodeUsed: users.activationCodeUsed,
        lastLoginAt: users.lastLoginAt,
      })
      .from(users)
      .leftJoin(
        organisationMembers,
        and(
          eq(organisationMembers.userId, users.id),
          eq(organisationMembers.organisationId, organisationId),
        ),
      )
      .where(inArray(users.id, userIds));
  }

  async getStaffByEmail(email: string): Promise<(Staff & { store: Store }) | undefined> {
    const [result] = await db
      .select()
      .from(staff)
      .innerJoin(stores, eq(staff.storeId, stores.id))
      .where(and(eq(staff.email, email.toLowerCase()), eq(staff.isArchived, false)));

    if (!result) return undefined;

    return {
      ...result.staff,
      store: result.stores,
    };
  }

  async createStaff(staffMember: InsertStaff & { userId?: string | null }): Promise<Staff> {
    const staffNumber = await this.getNextAvailableStaffNumber(staffMember.storeId);
    const [newStaff] = await db.insert(staff).values({
      ...staffMember,
      email: staffMember.email.toLowerCase(),
      staffNumber,
    }).returning();
    return newStaff;
  }

  async updateStaff(id: string, staffData: Partial<InsertStaff> & { userId?: string }): Promise<Staff | undefined> {
    const normalizedData = staffData.email
      ? { ...staffData, email: staffData.email.toLowerCase() }
      : staffData;
    const [updated] = await db.update(staff).set(normalizedData).where(eq(staff.id, id)).returning();
    return updated;
  }

  async transferStaff(id: string, targetStoreId: string): Promise<Staff | undefined> {
    const staffMembers = await db.select().from(staff).where(eq(staff.id, id)).limit(1);
    if (!staffMembers.length) return undefined;

    const sourceStoreId = staffMembers[0].storeId;
    const sourceStore = await db.select().from(stores).where(eq(stores.id, sourceStoreId)).limit(1);

    const newStaffNumber = await this.getNextAvailableStaffNumber(targetStoreId);

    const [updated] = await db.update(staff).set({
      storeId: targetStoreId,
      staffNumber: newStaffNumber,
    }).where(eq(staff.id, id)).returning();

    if (sourceStore.length && sourceStore[0].managerStaffId === id) {
      await db.update(stores).set({ managerStaffId: null }).where(eq(stores.id, sourceStoreId));
    }

    return updated;
  }

  async deleteStaff(id: string): Promise<boolean> {
    return await db.transaction(async (tx) => {
      await tx.update(stores).set({ managerStaffId: null }).where(eq(stores.managerStaffId, id));
      const result = await tx.update(staff)
        .set({ isArchived: true })
        .where(eq(staff.id, id))
        .returning();
      return result.length > 0;
    });
  }

  async archiveStaff(id: string): Promise<Staff | undefined> {
    const [updated] = await db.update(staff).set({ isArchived: true }).where(eq(staff.id, id)).returning();
    return updated;
  }

  async restoreStaff(id: string): Promise<Staff | undefined> {
    const [updated] = await db.update(staff).set({ isArchived: false }).where(eq(staff.id, id)).returning();
    return updated;
  }

  async hasStaffCheckouts(id: string): Promise<boolean> {
    const result = await db.select({ count: count() })
      .from(checkouts)
      .where(
        or(
          eq(checkouts.staffId, id),
          eq(checkouts.leadStaffId, id),
          eq(checkouts.assistingStaff1Id, id),
          eq(checkouts.assistingStaff2Id, id)
        )
      );
    return result[0].count > 0;
  }

  async getStaffBreakdown(staffId: string, storeId: string, startDate?: string, endDate?: string): Promise<{ services: any[]; products: any[] }> {
    const checkoutConditions: any[] = [
      eq(checkouts.storeId, storeId),
      eq(checkouts.paymentStatus, "completed"),
      eq(checkouts.isVoided, false),
      or(
        eq(checkouts.leadStaffId, staffId),
        and(eq(checkouts.staffId, staffId), isNull(checkouts.leadStaffId)),
        eq(checkouts.assistingStaff1Id, staffId),
        eq(checkouts.assistingStaff2Id, staffId),
      )!,
    ];
    const tz = await getStoreTimezone(storeId);
    if (startDate) checkoutConditions.push(gte(checkouts.createdAt, toUtcStart(startDate, tz)));
    if (endDate) checkoutConditions.push(lte(checkouts.createdAt, toUtcEnd(endDate, tz)));

    const rows = await db.select({
      checkout: checkouts,
      order: orders,
      inventoryItem: inventory,
      transactionId: transactions.id,
    })
      .from(orders)
      .innerJoin(checkouts, eq(orders.id, checkouts.orderId))
      .innerJoin(inventory, eq(orders.inventoryId, inventory.id))
      .leftJoin(transactions, and(eq(transactions.checkoutId, checkouts.id), eq(transactions.inventoryId, orders.inventoryId)))
      .where(and(...checkoutConditions))
      .orderBy(desc(checkouts.createdAt));

    const services: any[] = [];
    const products: any[] = [];

    for (const row of rows) {
      let role: string;
      if (row.checkout.leadStaffId === staffId || (!row.checkout.leadStaffId && row.checkout.staffId === staffId)) {
        role = "lead";
      } else if (row.checkout.assistingStaff1Id === staffId) {
        role = "assistant";
      } else {
        role = "assistant";
      }

      const entry = {
        inventoryName: row.inventoryItem.name,
        receiptNumber: row.checkout.receiptNumber,
        transactionId: row.transactionId,
        date: row.checkout.createdAt,
        revenue: this.revenueShare(staffId, row.checkout, row.order.totalPrice),
        role,
      };

      if (row.inventoryItem.type === "service") {
        services.push(entry);
      } else {
        products.push({ ...entry, quantity: row.order.quantity });
      }
    }

    return { services, products };
  }

  async getStaffPerformance(storeId: string, startDate?: string, endDate?: string): Promise<any[]> {

    const activeStaff = await db.select().from(staff).where(and(eq(staff.storeId, storeId), eq(staff.isArchived, false)));

    const checkoutConditions: any[] = [
      eq(checkouts.storeId, storeId),
      eq(checkouts.paymentStatus, "completed"),
      eq(checkouts.isVoided, false),
    ];
    const tz = await getStoreTimezone(storeId);
    if (startDate) checkoutConditions.push(gte(checkouts.createdAt, toUtcStart(startDate, tz)));
    if (endDate) checkoutConditions.push(lte(checkouts.createdAt, toUtcEnd(endDate, tz)));

    const rows = await db.select({
      checkout: checkouts,
      order: orders,
      inventoryItem: inventory,
    })
      .from(orders)
      .innerJoin(checkouts, eq(orders.id, checkouts.orderId))
      .innerJoin(inventory, eq(orders.inventoryId, inventory.id))
      .where(and(...checkoutConditions));

    const attendanceConditions: any[] = [eq(attendanceRecords.storeId, storeId)];
    if (startDate) attendanceConditions.push(gte(attendanceRecords.date, startDate));
    if (endDate) attendanceConditions.push(lte(attendanceRecords.date, endDate));

    const attendanceList = await db.select().from(attendanceRecords).where(and(...attendanceConditions));

    return activeStaff.map(s => {
      const staffCheckouts = rows.filter(r =>
        r.checkout.leadStaffId === s.id ||
        (r.checkout.staffId === s.id && !r.checkout.leadStaffId) ||
        r.checkout.assistingStaff1Id === s.id ||
        r.checkout.assistingStaff2Id === s.id
      );

      const totalRevenue = staffCheckouts.reduce((sum, r) => sum + this.revenueShare(s.id, r.checkout, r.order.totalPrice), 0);
      const servicesCount = staffCheckouts.filter(r => r.inventoryItem.type === "service").length;
      const productsCount = staffCheckouts.filter(r => r.inventoryItem.type === "product").length;

      const staffAttendance = attendanceList.filter(a => a.staffId === s.id);
      const presentDays = staffAttendance.filter(a => a.status === "present").length;
      const absentDays = staffAttendance.filter(a => a.status === "absent").length;
      // Late is a flag on top of "present", not a separate status — a late day is
      // still counted in presentDays above, so this is a subset count, not additive.
      const lateDays = staffAttendance.filter(a => a.isLate).length;

      return {
        id: s.id,
        name: s.name,
        email: s.email,
        role: s.role,
        totalRevenue,
        servicesCount,
        productsCount,
        presentDays,
        absentDays,
        lateDays,
      };
    });
  }
}
