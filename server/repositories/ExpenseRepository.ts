import { BaseRepository } from "./BaseRepository";
import { db } from "../db";
import {
  expenses,
  expenseCategories,
  expenseLinkedItems,
  inventory,
  products,
  payrollPeriods,
  payrollEntries,
  type Expense,
  type InsertExpense,
  type ExpenseCategory,
  type InsertExpenseCategory,
  type ExpenseWithCategory,
} from "@shared/schema";
import { eq, and, gte, lte, asc, desc, inArray } from "drizzle-orm";

export type ExpenseWithLinks = ExpenseWithCategory & {
  linkedProducts: { productId: string; productName: string }[];
  allocationDriver: string;
};

export class ExpenseRepository extends BaseRepository<typeof expenses> {
  constructor() {
    super(expenses);
  }

  async getExpenseCategories(storeId: string): Promise<ExpenseCategory[]> {
    return db.select().from(expenseCategories).where(eq(expenseCategories.storeId, storeId)).orderBy(asc(expenseCategories.name));
  }

  async createExpenseCategory(data: InsertExpenseCategory): Promise<ExpenseCategory> {
    const [inserted] = await db.insert(expenseCategories).values(data).returning();
    return inserted;
  }

  async updateExpenseCategory(id: string, name: string): Promise<ExpenseCategory> {
    const [updated] = await db.update(expenseCategories)
      .set({ name })
      .where(eq(expenseCategories.id, id))
      .returning();
    return updated;
  }

  async deleteExpenseCategory(id: string): Promise<void> {
    const associatedExpenses = await db.select()
      .from(expenses)
      .where(eq(expenses.categoryId, id))
      .limit(1);

    if (associatedExpenses.length > 0) {
      throw new Error("conflict:Cannot delete expense category. It may be in use.");
    }

    await db.delete(expenseCategories).where(eq(expenseCategories.id, id));
  }

  // Attach linked product arrays to a batch of expenses in one query
  private async attachLinkedProducts(expenseList: any[]): Promise<ExpenseWithLinks[]> {
    if (expenseList.length === 0) return expenseList as ExpenseWithLinks[];

    const expenseIds = expenseList.map(e => e.id);
    const links = await db.select({
      expenseId: expenseLinkedItems.expenseId,
      productId: expenseLinkedItems.productId,
      productName: products.name,
    })
      .from(expenseLinkedItems)
      .leftJoin(products, eq(expenseLinkedItems.productId, products.id))
      .where(inArray(expenseLinkedItems.expenseId, expenseIds));

    const linkMap = new Map<string, { productId: string; productName: string }[]>();
    for (const l of links) {
      if (!linkMap.has(l.expenseId)) linkMap.set(l.expenseId, []);
      linkMap.get(l.expenseId)!.push({ productId: l.productId, productName: l.productName ?? "" });
    }

    return expenseList.map(e => ({
      ...e,
      linkedProducts: linkMap.get(e.id) ?? [],
      allocationDriver: e.allocationDriver ?? "count",
    })) as ExpenseWithLinks[];
  }

  async getExpenses(
    storeId: string,
    startDate?: string,
    endDate?: string,
    type?: "all" | "general" | "linked" | "service" | "product",
    inventoryId?: string
  ): Promise<ExpenseWithLinks[]> {
    let conditions = [eq(expenses.storeId, storeId), eq(expenses.isDeleted, false)];
    if (startDate) conditions.push(gte(expenses.date, startDate));
    if (endDate) conditions.push(lte(expenses.date, endDate));
    if (inventoryId && inventoryId !== "none" && inventoryId !== "all") {
      conditions.push(eq(expenses.inventoryId, inventoryId));
    }

    const rows = await db.select({
      expense: expenses,
      category: expenseCategories,
      inventory: inventory,
    })
      .from(expenses)
      .leftJoin(expenseCategories, eq(expenses.categoryId, expenseCategories.id))
      .leftJoin(inventory, eq(expenses.inventoryId, inventory.id))
      .where(and(...conditions))
      .orderBy(desc(expenses.date));

    let mapped = rows.map(r => ({
      ...r.expense,
      category: r.category!,
      inventory: r.inventory || undefined,
    }));

    if (type && type !== "all") {
      if (type === "general") {
        // general = no legacy inventoryId AND no linked items (checked after attach)
      } else if (type === "linked") {
        // linked = has legacy inventoryId OR has linked items (checked after attach)
      } else if (type === "service") {
        mapped = mapped.filter(e => (e as any).inventory?.type === "service");
      } else if (type === "product") {
        mapped = mapped.filter(e => (e as any).inventory?.type === "product");
      }
    }

    const withLinks = await this.attachLinkedProducts(mapped);

    // Apply general/linked filter now that we have linkedProducts
    if (type === "general") {
      return withLinks.filter(e => !e.inventoryId && e.linkedProducts.length === 0);
    }
    if (type === "linked") {
      return withLinks.filter(e => !!e.inventoryId || e.linkedProducts.length > 0);
    }

    return withLinks;
  }

  async getExpenseById(id: string): Promise<ExpenseWithLinks | null> {
    const rows = await db.select({
      expense: expenses,
      category: expenseCategories,
      inventory: inventory,
    })
      .from(expenses)
      .leftJoin(expenseCategories, eq(expenses.categoryId, expenseCategories.id))
      .leftJoin(inventory, eq(expenses.inventoryId, inventory.id))
      .where(eq(expenses.id, id))
      .limit(1);

    if (rows.length === 0) return null;
    const r = rows[0];
    const base = { ...r.expense, category: r.category!, inventory: r.inventory || undefined };
    const [withLinks] = await this.attachLinkedProducts([base]);
    return withLinks;
  }

  async createExpense(data: InsertExpense & { linkedProductIds?: string[]; allocationDriver?: string }): Promise<Expense> {
    const { linkedProductIds, allocationDriver, ...expenseData } = data as any;

    const [inserted] = await db.transaction(async tx => {
      const [exp] = await tx.insert(expenses).values({
        ...expenseData,
        allocationDriver: allocationDriver ?? "count",
      }).returning();

      if (linkedProductIds && linkedProductIds.length > 0) {
        await tx.insert(expenseLinkedItems).values(
          linkedProductIds.map((pid: string) => ({ expenseId: exp.id, productId: pid }))
        ).onConflictDoNothing();
      }

      return [exp];
    });

    return inserted;
  }

  async updateExpense(id: string, data: Partial<InsertExpense> & { linkedProductIds?: string[]; allocationDriver?: string }): Promise<Expense> {
    const { linkedProductIds, allocationDriver, ...expenseData } = data as any;

    const [updated] = await db.transaction(async tx => {
      const updateData: any = { ...expenseData };
      if (allocationDriver !== undefined) updateData.allocationDriver = allocationDriver;

      const [exp] = await tx.update(expenses)
        .set(updateData)
        .where(eq(expenses.id, id))
        .returning();

      if (linkedProductIds !== undefined) {
        await tx.delete(expenseLinkedItems).where(eq(expenseLinkedItems.expenseId, id));
        if (linkedProductIds.length > 0) {
          await tx.insert(expenseLinkedItems).values(
            linkedProductIds.map((pid: string) => ({ expenseId: id, productId: pid }))
          ).onConflictDoNothing();
        }
      }

      return [exp];
    });

    return updated;
  }

  async getPaidPayrollExpenses(storeId: string, startDate?: string, endDate?: string): Promise<{ label: string; amount: number }[]> {
    const conditions: any[] = [
      eq(payrollPeriods.storeId, storeId),
      eq(payrollPeriods.status, "paid")
    ];
    if (startDate) conditions.push(gte(payrollPeriods.endDate, startDate));
    if (endDate) conditions.push(lte(payrollPeriods.startDate, endDate));

    const paidPeriods = await db.select().from(payrollPeriods).where(and(...conditions));
    const payrollDetails = [];

    for (const period of paidPeriods) {
      const entries = await db.select().from(payrollEntries).where(eq(payrollEntries.periodId, period.id));
      const periodTotal = entries.reduce((sum, entry) => sum + entry.netPay, 0);
      payrollDetails.push({
        label: `Payroll — ${new Date(period.startDate).toLocaleDateString()} to ${new Date(period.endDate).toLocaleDateString()}`,
        amount: periodTotal
      });
    }
    return payrollDetails;
  }

  async deleteExpense(id: string): Promise<void> {
    await db.update(expenses).set({ isDeleted: true, deletedAt: new Date() }).where(eq(expenses.id, id));
  }
}
