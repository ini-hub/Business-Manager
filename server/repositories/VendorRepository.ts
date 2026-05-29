import { BaseRepository } from "./BaseRepository";
import { db } from "../db";
import {
  vendors,
  vendorBills,
  type Vendor,
  type InsertVendor,
  type VendorBill,
  type InsertVendorBill,
} from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

export class VendorRepository extends BaseRepository<typeof vendors> {
  constructor() {
    super(vendors);
  }

  async getVendors(storeId: string): Promise<Vendor[]> {
    return db.select().from(vendors).where(eq(vendors.storeId, storeId)).orderBy(desc(vendors.createdAt));
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
