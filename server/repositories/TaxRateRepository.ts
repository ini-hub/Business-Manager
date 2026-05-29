import { BaseRepository } from "./BaseRepository";
import { db } from "../db";
import { taxRates, type TaxRate, type InsertTaxRate } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

export class TaxRateRepository extends BaseRepository<typeof taxRates> {
  constructor() {
    super(taxRates);
  }

  async getTaxRates(storeId: string): Promise<TaxRate[]> {
    return db.select().from(taxRates).where(eq(taxRates.storeId, storeId)).orderBy(desc(taxRates.createdAt));
  }

  async createTaxRate(data: InsertTaxRate): Promise<TaxRate> {
    return db.transaction(async (tx) => {
      // If this is set as default, unset other default rates first
      if (data.isDefault) {
        await tx
          .update(taxRates)
          .set({ isDefault: false })
          .where(eq(taxRates.storeId, data.storeId));
      }

      const [inserted] = await tx.insert(taxRates).values(data).returning();
      return inserted;
    });
  }

  async updateTaxRate(id: string, data: Partial<InsertTaxRate>): Promise<TaxRate | undefined> {
    return db.transaction(async (tx) => {
      const [current] = await tx.select().from(taxRates).where(eq(taxRates.id, id));
      if (!current) return undefined;

      // If toggled to default, unset all others in this store first
      if (data.isDefault) {
        await tx
          .update(taxRates)
          .set({ isDefault: false })
          .where(eq(taxRates.storeId, current.storeId));
      }

      const [updated] = await tx
        .update(taxRates)
        .set(data)
        .where(eq(taxRates.id, id))
        .returning();

      return updated;
    });
  }

  async deleteTaxRate(id: string): Promise<boolean> {
    const [deleted] = await db.delete(taxRates).where(eq(taxRates.id, id)).returning();
    return !!deleted;
  }
}
