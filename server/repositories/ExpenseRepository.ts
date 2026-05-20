import { BaseRepository } from "./BaseRepository";
import { db } from "../db";
import {
  expenses,
  expenseCategories,
  inventory,
  payrollPeriods,
  payrollEntries,
  type Expense,
  type InsertExpense,
  type ExpenseCategory,
  type InsertExpenseCategory,
  type ExpenseWithCategory,
} from "@shared/schema";
import { eq, and, gte, lte, asc, desc } from "drizzle-orm";

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

  async getExpenses(
    storeId: string,
    startDate?: string,
    endDate?: string,
    type?: "all" | "general" | "linked" | "service" | "product",
    inventoryId?: string
  ): Promise<ExpenseWithCategory[]> {
    let conditions = [eq(expenses.storeId, storeId)];
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
    })) as ExpenseWithCategory[];

    if (type && type !== "all") {
      if (type === "general") {
        mapped = mapped.filter(e => !e.inventoryId);
      } else if (type === "linked") {
        mapped = mapped.filter(e => !!e.inventoryId);
      } else if (type === "service") {
        mapped = mapped.filter(e => e.inventory?.type === "service");
      } else if (type === "product") {
        mapped = mapped.filter(e => e.inventory?.type === "product");
      }
    }

    return mapped;
  }

  async updateExpense(id: string, data: Partial<InsertExpense>): Promise<Expense> {
    const [updated] = await db.update(expenses)
      .set(data)
      .where(eq(expenses.id, id))
      .returning();
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

  async createExpense(data: InsertExpense): Promise<Expense> {
    const [inserted] = await db.insert(expenses).values(data).returning();
    return inserted;
  }

  async deleteExpense(id: string): Promise<void> {
    await db.delete(expenses).where(eq(expenses.id, id));
  }
}
