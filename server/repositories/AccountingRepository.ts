import { db } from "../db";
import {
  capitalContributions,
  assets,
  liabilities,
  type InsertCapitalContribution,
  type InsertAsset,
  type InsertLiability,
} from "@shared/schema";
import { eq, desc } from "drizzle-orm";

export class AccountingRepository {
  async listCapitalContributions(storeId: string) {
    return db.select().from(capitalContributions).where(eq(capitalContributions.storeId, storeId)).orderBy(desc(capitalContributions.date));
  }

  async addCapitalContribution(data: InsertCapitalContribution) {
    const [row] = await db.insert(capitalContributions).values(data).returning();
    return row;
  }

  async listAssets(storeId: string) {
    return db.select().from(assets).where(eq(assets.storeId, storeId)).orderBy(desc(assets.createdAt));
  }

  async addAsset(data: InsertAsset) {
    const [row] = await db.insert(assets).values(data).returning();
    return row;
  }

  async updateAsset(id: string, data: Partial<InsertAsset>) {
    const [row] = await db.update(assets).set({ ...data, updatedAt: new Date() }).where(eq(assets.id, id)).returning();
    return row;
  }

  async deleteAsset(id: string) {
    await db.delete(assets).where(eq(assets.id, id));
  }

  async getAsset(id: string) {
    const [row] = await db.select().from(assets).where(eq(assets.id, id));
    return row;
  }

  async listLiabilities(storeId: string) {
    return db.select().from(liabilities).where(eq(liabilities.storeId, storeId)).orderBy(desc(liabilities.createdAt));
  }

  async addLiability(data: InsertLiability) {
    const [row] = await db.insert(liabilities).values(data).returning();
    return row;
  }

  async updateLiability(id: string, data: Partial<InsertLiability>) {
    const [row] = await db.update(liabilities).set({ ...data, updatedAt: new Date() }).where(eq(liabilities.id, id)).returning();
    return row;
  }

  async deleteLiability(id: string) {
    await db.delete(liabilities).where(eq(liabilities.id, id));
  }

  async getLiability(id: string) {
    const [row] = await db.select().from(liabilities).where(eq(liabilities.id, id));
    return row;
  }
}
