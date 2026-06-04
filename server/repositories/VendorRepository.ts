import { BaseRepository } from "./BaseRepository";
import { db } from "../db";
import {
  vendors,
  vendorBills,
  purchaseOrders,
  type Vendor,
  type InsertVendor,
  type VendorBill,
  type InsertVendorBill,
} from "@shared/schema";
import { eq, and, desc, count } from "drizzle-orm";

export class VendorRepository extends BaseRepository<typeof vendors> {
  constructor() {
    super(vendors);
  }

  async getVendors(storeId: string, includeArchived = false): Promise<Vendor[]> {
    const conditions = includeArchived
      ? eq(vendors.storeId, storeId)
      : and(eq(vendors.storeId, storeId), eq(vendors.isArchived, false));
    return db.select().from(vendors).where(conditions).orderBy(desc(vendors.createdAt));
  }

  async getVendor(id: string): Promise<Vendor | undefined> {
    return this.findById(id);
  }

  async createVendor(data: InsertVendor): Promise<Vendor> {
    const [inserted] = await db.insert(vendors).values(data).returning();
    return inserted;
  }

  async updateVendor(id: string, data: Partial<InsertVendor>): Promise<Vendor | undefined> {
    const [updated] = await db.update(vendors).set(data).where(eq(vendors.id, id)).returning();
    return updated;
  }

  async getVendorDeletionConflicts(id: string): Promise<string | null> {
    const [billCount] = await db
      .select({ n: count() })
      .from(vendorBills)
      .where(eq(vendorBills.vendorId, id));
    if (Number(billCount.n) > 0) {
      return `This vendor has ${billCount.n} bill(s) on record. Delete or reassign them before removing the vendor.`;
    }

    const [poCount] = await db
      .select({ n: count() })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.vendorId, id));
    if (Number(poCount.n) > 0) {
      return `This vendor has ${poCount.n} purchase order(s) on record. Delete or reassign them before removing the vendor.`;
    }

    return null;
  }

  async archiveVendor(id: string): Promise<Vendor | undefined> {
    const [updated] = await db.update(vendors).set({ isArchived: true }).where(eq(vendors.id, id)).returning();
    return updated;
  }

  async restoreVendor(id: string): Promise<Vendor | undefined> {
    const [updated] = await db.update(vendors).set({ isArchived: false }).where(eq(vendors.id, id)).returning();
    return updated;
  }

  async deleteVendor(id: string): Promise<boolean> {
    const [deleted] = await db.delete(vendors).where(eq(vendors.id, id)).returning();
    return !!deleted;
  }

  // Vendor Bills
  async getVendorBills(storeId: string): Promise<(VendorBill & { vendor: Vendor })[]> {
    const rows = await db
      .select({
        bill: vendorBills,
        vendor: vendors,
      })
      .from(vendorBills)
      .innerJoin(vendors, eq(vendorBills.vendorId, vendors.id))
      .where(eq(vendorBills.storeId, storeId))
      .orderBy(desc(vendorBills.createdAt));

    return rows.map((r) => ({
      ...r.bill,
      vendor: r.vendor,
    }));
  }

  async getVendorBill(id: string): Promise<(VendorBill & { vendor: Vendor }) | undefined> {
    const [row] = await db
      .select({
        bill: vendorBills,
        vendor: vendors,
      })
      .from(vendorBills)
      .innerJoin(vendors, eq(vendorBills.vendorId, vendors.id))
      .where(eq(vendorBills.id, id));

    if (!row) return undefined;
    return {
      ...row.bill,
      vendor: row.vendor,
    };
  }

  async createVendorBill(data: InsertVendorBill): Promise<VendorBill> {
    const [inserted] = await db.insert(vendorBills).values(data).returning();
    return inserted;
  }

  async updateVendorBill(id: string, data: Partial<InsertVendorBill>): Promise<VendorBill | undefined> {
    const [updated] = await db.update(vendorBills).set(data).where(eq(vendorBills.id, id)).returning();
    return updated;
  }

  async deleteVendorBill(id: string): Promise<boolean> {
    const [deleted] = await db.delete(vendorBills).where(eq(vendorBills.id, id)).returning();
    return !!deleted;
  }
}
