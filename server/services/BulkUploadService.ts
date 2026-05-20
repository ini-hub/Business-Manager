import { storage } from "../storage";
import { insertStaffSchema } from "@shared/schema";
import { z } from "zod";

export class BulkUploadService {
  /**
   * Imports a list of staff members into a store
   */
  public async importStaff(
    data: any[],
    storeId: string
  ): Promise<{ success: number; failed: number; errors: { row: number; message: string }[] }> {
    const result = { success: 0, failed: 0, errors: [] as { row: number; message: string }[] };

    for (let i = 0; i < data.length; i++) {
      try {
        const row = data[i];
        const parsed = insertStaffSchema.parse({
          storeId,
          name: row.name,
          staffNumber: row.staffNumber,
          mobileNumber: row.mobileNumber,
          payPerMonth: parseFloat(row.payPerMonth) || 0,
          signedContract: row.signedContract === "true" || row.signedContract === true,
        });
        await storage.createStaff(parsed);
        result.success++;
      } catch (error) {
        result.failed++;
        const message = error instanceof z.ZodError
          ? error.errors.map(e => e.message).join(", ")
          : "Invalid data";
        result.errors.push({ row: i + 2, message });
      }
    }

    return result;
  }

  /**
   * Imports a list of expenses into a store, automatically resolving or creating categories
   */
  public async importExpenses(
    rawExpenses: any[],
    storeId: string
  ): Promise<{ success: number; failed: number; errors: { row: number; message: string }[] }> {
    // Pre-load all expense categories to resolve by name
    const categories = await storage.getExpenseCategories(storeId);
    const catMap = new Map(categories.map(c => [c.name.toLowerCase().trim(), c.id]));

    const results = { success: 0, failed: 0, errors: [] as { row: number; message: string }[] };

    for (let i = 0; i < rawExpenses.length; i++) {
      const expense = rawExpenses[i];
      const rowNum = i + 1;
      try {
        if (!expense.description || !expense.amount) {
          results.failed++;
          results.errors.push({ row: rowNum, message: `Missing description or amount.` });
          continue;
        }

        let categoryId = expense.categoryId;
        const rawCat = expense.category || expense.categoryName || "";
        const catLower = rawCat.toLowerCase().trim();
        
        if (!categoryId && catLower) {
          if (catMap.has(catLower)) {
            categoryId = catMap.get(catLower);
          } else {
            const newCat = await storage.createExpenseCategory({
              storeId,
              name: rawCat.trim(),
            });
            categoryId = newCat.id;
            catMap.set(catLower, newCat.id);
          }
        }

        if (!categoryId) {
          results.failed++;
          results.errors.push({ row: rowNum, message: `Category is required (specify a category name or ID).` });
          continue;
        }

        await storage.createExpense({
          title: expense.description,
          amount: Number(expense.amount),
          categoryId,
          storeId,
          date: expense.date
            ? new Date(expense.date).toISOString().split('T')[0]
            : new Date().toISOString().split('T')[0],
        });
        results.success++;
      } catch (err: any) {
        results.failed++;
        results.errors.push({ row: rowNum, message: err.message });
      }
    }

    return results;
  }
}

export const bulkUploadService = new BulkUploadService();
