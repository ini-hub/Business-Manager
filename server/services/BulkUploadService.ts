import { storage } from "../storage";
import { insertStaffSchema, auditLogBatches, type AuditLogBatchKind } from "@shared/schema";
import { z } from "zod";
import { auditLogger } from "../audit";
import { db } from "../db";
import { eq } from "drizzle-orm";

type BulkResult = { success: number; failed: number; errors: { row: number; message: string }[] };

export class BulkUploadService {
  /**
   * Creates an audit_log_batches row for a CSV import so every row it creates
   * can be correlated back to one reviewable "this import happened" unit —
   * including rows that failed, whose errors are otherwise only visible in the
   * API response and lost once the client discards it.
   */
  private async createImportBatch(
    storeId: string,
    kind: AuditLogBatchKind,
    initiatedBy: string | undefined,
    totalCount: number
  ): Promise<string | undefined> {
    const store = await storage.getStore(storeId);
    if (!store) return undefined;
    const [batch] = await db.insert(auditLogBatches).values({
      businessId: store.businessId,
      initiatedBy,
      kind,
      label: `${kind} — ${totalCount} row${totalCount !== 1 ? "s" : ""}`,
      totalCount,
    }).returning();
    return batch?.id;
  }

  private async completeImportBatch(batchId: string | undefined, result: BulkResult): Promise<void> {
    if (!batchId) return;
    await db.update(auditLogBatches).set({
      successCount: result.success,
      failedCount: result.failed,
      details: result.errors.length ? { errors: result.errors } : null,
      completedAt: new Date(),
    }).where(eq(auditLogBatches.id, batchId));
  }

  /**
   * Groups flat CSV rows that share a reference-column value into one logical record with
   * multiple line items (e.g. one purchase order spread across several rows). Rows with a
   * blank reference are treated as their own single-row group.
   */
  private groupRows<T extends Record<string, string>>(
    rows: T[],
    refKey: string
  ): { ref: string; rows: T[]; rowNumbers: number[] }[] {
    const groups = new Map<string, { rows: T[]; rowNumbers: number[] }>();
    const order: string[] = [];

    rows.forEach((row, i) => {
      const ref = (row[refKey] || "").trim() || `__row_${i}`;
      if (!groups.has(ref)) {
        groups.set(ref, { rows: [], rowNumbers: [] });
        order.push(ref);
      }
      const group = groups.get(ref)!;
      group.rows.push(row);
      group.rowNumbers.push(i + 2); // +2 accounts for the header row and 1-indexing
    });

    return order.map((ref) => ({ ref, ...groups.get(ref)! }));
  }

  /**
   * Imports a list of staff members into a store
   */
  public async importStaff(
    data: any[],
    storeId: string,
    userId?: string
  ): Promise<BulkResult> {
    const result: BulkResult = { success: 0, failed: 0, errors: [] };
    const batchId = await this.createImportBatch(storeId, "csv_import_staff", userId, data.length);

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
        const created = await storage.createStaff(parsed);
        auditLogger.log({ action: "CREATE", resource: "staff", resourceId: created.id, userId, status: "success", channel: "import", batchId });
        result.success++;
      } catch (error) {
        result.failed++;
        const message = error instanceof z.ZodError
          ? error.errors.map(e => e.message).join(", ")
          : "Invalid data";
        result.errors.push({ row: i + 2, message });
      }
    }

    await this.completeImportBatch(batchId, result);
    return result;
  }

  /**
   * Imports a list of expenses into a store, automatically resolving or creating categories
   */
  public async importExpenses(
    rawExpenses: any[],
    storeId: string,
    userId?: string
  ): Promise<BulkResult> {
    // Pre-load all expense categories to resolve by name
    const categories = await storage.getExpenseCategories(storeId);
    const catMap = new Map(categories.map(c => [c.name.toLowerCase().trim(), c.id]));

    const results: BulkResult = { success: 0, failed: 0, errors: [] };
    const batchId = await this.createImportBatch(storeId, "csv_import_expense", userId, rawExpenses.length);

    for (let i = 0; i < rawExpenses.length; i++) {
      const expense = rawExpenses[i];
      const rowNum = i + 2; // matches the header-row-aware numbering used by every other bulk importer
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

        const created = await storage.createExpense({
          title: expense.description,
          amount: Number(expense.amount),
          categoryId,
          storeId,
          date: expense.date
            ? new Date(expense.date).toISOString().split('T')[0]
            : new Date().toISOString().split('T')[0],
        });
        auditLogger.log({ action: "CREATE", resource: "expense", resourceId: created.id, userId, status: "success", channel: "import", batchId });
        results.success++;
      } catch (err: any) {
        results.failed++;
        results.errors.push({ row: rowNum, message: err.message });
      }
    }

    await this.completeImportBatch(batchId, results);
    return results;
  }

  /**
   * Imports a flat list of vendors into a store.
   */
  public async importVendors(
    data: Record<string, string>[],
    storeId: string,
    userId?: string
  ): Promise<BulkResult> {
    const result: BulkResult = { success: 0, failed: 0, errors: [] };
    const batchId = await this.createImportBatch(storeId, "csv_import_vendor", userId, data.length);

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const rowNum = i + 2;
      try {
        const name = (row.name || "").trim();
        if (!name) throw new Error("Vendor name is required.");

        const created = await storage.vendorRepo.createVendor({
          storeId,
          name,
          contactName: row.contactPerson || row.contactName || undefined,
          email: row.email || undefined,
          phone: row.phone || undefined,
          address: row.address || undefined,
          notes: row.category ? `Category: ${row.category}` : undefined,
        });
        auditLogger.log({ action: "CREATE", resource: "vendor", resourceId: created.id, userId, status: "success", channel: "import", batchId });
        result.success++;
      } catch (err: any) {
        result.failed++;
        result.errors.push({ row: rowNum, message: err.message || "Invalid data" });
      }
    }

    await this.completeImportBatch(batchId, result);
    return result;
  }

  /**
   * Imports a flat list of tax rates into a store.
   */
  public async importTaxRates(
    data: Record<string, string>[],
    storeId: string,
    userId?: string
  ): Promise<BulkResult> {
    const result: BulkResult = { success: 0, failed: 0, errors: [] };

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const rowNum = i + 2;
      try {
        const name = (row.name || "").trim();
        const rate = Number(row.rate);
        if (!name) throw new Error("Tax rate name is required.");
        if (!Number.isFinite(rate) || rate < 0) throw new Error("A valid, non-negative rate is required.");

        const created = await storage.taxRateRepo.createTaxRate({
          storeId,
          name,
          rate,
          isDefault: row.isDefault === "true",
        });
        auditLogger.logDataModification("tax_rate", created.id, userId, "CREATE", true);
        result.success++;
      } catch (err: any) {
        result.failed++;
        result.errors.push({ row: rowNum, message: err.message || "Invalid data" });
      }
    }

    return result;
  }

  /**
   * Imports a flat list of credit sale entries, resolving customers by name.
   */
  public async importCreditEntries(
    data: Record<string, string>[],
    storeId: string,
    userId?: string
  ): Promise<BulkResult> {
    const result: BulkResult = { success: 0, failed: 0, errors: [] };
    const customers = await storage.getCustomers(storeId);
    const customerMap = new Map(customers.map(c => [c.name.toLowerCase().trim(), c.id]));

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const rowNum = i + 2;
      try {
        const customerName = (row.customerName || row.customer || "").trim();
        const customerId = row.customerId || customerMap.get(customerName.toLowerCase());
        if (!customerId) throw new Error(`Customer "${customerName}" was not found.`);

        const amountOwed = Number(row.amount || row.amountOwed);
        if (!Number.isFinite(amountOwed) || amountOwed <= 0) throw new Error("A valid amount is required.");

        const created = await storage.creditRepo.createCreditEntry({
          storeId,
          customerId,
          amountOwed,
          amountPaidUpfront: 0,
          outstandingBalance: amountOwed,
          dueDate: row.dueDate ? new Date(row.dueDate) : null,
          description: row.notes || row.description || undefined,
          status: "owing",
        });
        auditLogger.logDataModification("credit_entry", created.id, userId, "CREATE", true);
        result.success++;
      } catch (err: any) {
        result.failed++;
        result.errors.push({ row: rowNum, message: err.message || "Invalid data" });
      }
    }

    return result;
  }

  /**
   * Imports purchase orders from grouped CSV rows (rows sharing a `poRef` become one PO's
   * line items), resolving vendor and product names against the store's existing records.
   */
  public async importPurchaseOrders(
    data: Record<string, string>[],
    storeId: string,
    userId?: string
  ): Promise<BulkResult> {
    const result: BulkResult = { success: 0, failed: 0, errors: [] };
    const vendors = await storage.vendorRepo.getVendors(storeId, false);
    const vendorMap = new Map(vendors.map(v => [v.name.toLowerCase().trim(), v.id]));
    const inventoryItems = await storage.getInventory(storeId);
    const inventoryMap = new Map(inventoryItems.map(p => [p.name.toLowerCase().trim(), p.id]));

    const groups = this.groupRows(data, "poRef");
    for (const group of groups) {
      const firstRow = group.rows[0];
      try {
        const vendorName = (firstRow.vendorName || firstRow.vendor || "").trim();
        const vendorId = firstRow.vendorId || vendorMap.get(vendorName.toLowerCase());
        if (!vendorId) throw new Error(`Vendor "${vendorName}" was not found.`);

        const items = group.rows.map((row) => {
          const productName = (row.productName || row.sku || "").trim();
          const inventoryId = row.inventoryId || inventoryMap.get(productName.toLowerCase());
          if (!inventoryId) throw new Error(`Product "${productName}" was not found.`);
          const quantity = Number(row.quantity);
          const unitCost = Number(row.unitCost);
          if (!Number.isFinite(quantity) || quantity <= 0) throw new Error(`Invalid quantity for "${productName}".`);
          if (!Number.isFinite(unitCost) || unitCost < 0) throw new Error(`Invalid unit cost for "${productName}".`);
          return { inventoryId, quantity, unitCost, totalCost: quantity * unitCost };
        });

        const poNumber = group.ref.startsWith("__row_") ? `PO-${Date.now()}-${group.rowNumbers[0]}` : group.ref;
        const created = await storage.purchaseOrderRepo.createPurchaseOrder({
          storeId,
          vendorId,
          poNumber,
          expectedDelivery: firstRow.expectedDate ? new Date(firstRow.expectedDate) : null,
          status: "draft",
          items,
        });
        auditLogger.logDataModification("purchase_order", created.id, userId, "CREATE", true);
        result.success++;
      } catch (err: any) {
        result.failed++;
        result.errors.push({ row: group.rowNumbers[0], message: err.message || "Invalid data" });
      }
    }

    return result;
  }

  /**
   * Imports quotes from grouped CSV rows (rows sharing a `quoteRef` become one quote's line
   * items), resolving the customer and product names against the store's existing records.
   */
  public async importQuotes(
    data: Record<string, string>[],
    storeId: string,
    userId?: string
  ): Promise<BulkResult> {
    const result: BulkResult = { success: 0, failed: 0, errors: [] };
    const customers = await storage.getCustomers(storeId);
    const customerMap = new Map(customers.map(c => [c.name.toLowerCase().trim(), c.id]));
    const inventoryItems = await storage.getInventory(storeId);
    const inventoryMap = new Map(inventoryItems.map(p => [p.name.toLowerCase().trim(), p.id]));

    const groups = this.groupRows(data, "quoteRef");
    for (const group of groups) {
      const firstRow = group.rows[0];
      try {
        const customerName = (firstRow.customerName || firstRow.customer || "").trim();
        const customerId = firstRow.customerId || (customerName ? customerMap.get(customerName.toLowerCase()) : undefined);

        const items = group.rows.map((row) => {
          const productName = (row.productName || row.sku || "").trim();
          const inventoryId = row.inventoryId || inventoryMap.get(productName.toLowerCase());
          if (!inventoryId) throw new Error(`Product "${productName}" was not found.`);
          const quantity = Number(row.quantity) || 1;
          const unitPrice = Number(row.unitPrice) || 0;
          return { inventoryId, quantity, unitPrice };
        });

        const quoteRef = group.ref.startsWith("__row_") ? `Q-${Date.now()}-${group.rowNumbers[0]}` : group.ref;
        const created = await storage.quoteRepo.createQuote({
          storeId,
          customerId: customerId || null,
          quoteRef,
          notes: firstRow.notes || null,
          validUntil: firstRow.validUntil ? new Date(firstRow.validUntil) : null,
          status: "draft",
          items,
        });
        auditLogger.logDataModification("quote", created.id, userId, "CREATE", true);
        result.success++;
      } catch (err: any) {
        result.failed++;
        result.errors.push({ row: group.rowNumbers[0], message: err.message || "Invalid data" });
      }
    }

    return result;
  }

  /**
   * Imports stock transfers from grouped CSV rows (rows sharing a `transferRef` become one
   * transfer's line items). `fromStoreId` is always the caller-supplied `storeId` — the CSV's
   * own from/to columns are validated by the route handler, not trusted for cross-store writes.
   */
  public async importStockTransfers(
    data: Record<string, string>[],
    storeId: string,
    userId?: string
  ): Promise<BulkResult> {
    const result: BulkResult = { success: 0, failed: 0, errors: [] };
    const inventoryItems = await storage.getInventory(storeId);
    const inventoryMap = new Map(inventoryItems.map(p => [p.name.toLowerCase().trim(), p.id]));

    const groups = this.groupRows(data, "transferRef");
    for (const group of groups) {
      const firstRow = group.rows[0];
      try {
        const toStoreId = (firstRow.toStoreId || "").trim();
        if (!toStoreId) throw new Error("toStoreId is required.");
        if (toStoreId === storeId) throw new Error("Destination store must differ from the source store.");

        const items = group.rows.map((row) => {
          const productName = (row.productName || row.sku || "").trim();
          const inventoryId = row.inventoryId || inventoryMap.get(productName.toLowerCase());
          if (!inventoryId) throw new Error(`Product "${productName}" was not found in the source store.`);
          const quantity = Number(row.quantity);
          if (!Number.isFinite(quantity) || quantity <= 0) throw new Error(`Invalid quantity for "${productName}".`);
          return { inventoryId, quantity };
        });

        const created = await storage.stockTransferRepo.createStockTransfer({
          fromStoreId: storeId,
          toStoreId,
          notes: firstRow.notes || null,
          status: "pending",
          items,
        });
        auditLogger.logDataModification("stock_transfer", created.id, userId, "CREATE", true);
        result.success++;
      } catch (err: any) {
        result.failed++;
        result.errors.push({ row: group.rowNumbers[0], message: err.message || "Invalid data" });
      }
    }

    return result;
  }

  /**
   * Imports bookings from grouped CSV rows (rows sharing a `bookingRef` become one booking's
   * service items; a blank ref imports as a standalone single-service booking).
   */
  public async importBookings(
    data: Record<string, string>[],
    storeId: string,
    userId?: string
  ): Promise<BulkResult> {
    const result: BulkResult = { success: 0, failed: 0, errors: [] };
    const customers = await storage.getCustomers(storeId);
    const customerMap = new Map(customers.map(c => [c.name.toLowerCase().trim(), c.id]));
    const staffList = await storage.getStaffList(storeId);
    const staffMap = new Map(staffList.map(s => [s.name.toLowerCase().trim(), s.id]));
    const inventoryItems = await storage.getInventory(storeId);
    const inventoryMap = new Map(inventoryItems.map(p => [p.name.toLowerCase().trim(), p.id]));

    const groups = this.groupRows(data, "bookingRef");
    for (const group of groups) {
      const firstRow = group.rows[0];
      try {
        const customerName = (firstRow.customerName || firstRow.customer || "").trim();
        const customerId = firstRow.customerId || customerMap.get(customerName.toLowerCase());
        if (!customerId) throw new Error(`Customer "${customerName}" was not found.`);

        const staffName = (firstRow.staffName || firstRow.staff || "").trim();
        const leadStaffId = firstRow.staffId || (staffName ? staffMap.get(staffName.toLowerCase()) : undefined);

        const dateStr = (firstRow.date || "").trim();
        const timeStr = (firstRow.time || "00:00").trim();
        const scheduledAt = dateStr ? new Date(`${dateStr}T${timeStr}`) : null;
        if (!dateStr || !scheduledAt || Number.isNaN(scheduledAt.getTime())) {
          throw new Error("A valid date is required.");
        }

        const items = group.rows.map((row) => {
          const serviceName = (row.serviceName || row.service || "").trim();
          const inventoryId = row.inventoryId || inventoryMap.get(serviceName.toLowerCase());
          if (!inventoryId) throw new Error(`Service "${serviceName}" was not found.`);
          const price = Number(row.price) || 0;
          return { inventoryId, quantity: 1, unitPrice: price, totalPrice: price };
        });
        const subtotal = items.reduce((sum, item) => sum + item.totalPrice, 0);

        const bookingRef = group.ref.startsWith("__row_") ? `BK-${Date.now()}-${group.rowNumbers[0]}` : group.ref;
        const created = await storage.createBooking({
          storeId,
          customerId,
          bookingRef,
          type: "appointment",
          status: "pending",
          scheduledAt,
          leadStaffId: leadStaffId || undefined,
          subtotal,
          totalPrice: subtotal,
          reminderPreference: "whatsapp",
          bookingItems: items,
        } as any);
        auditLogger.logDataModification("booking", created.id, userId, "CREATE", true);
        result.success++;
      } catch (err: any) {
        result.failed++;
        result.errors.push({ row: group.rowNumbers[0], message: err.message || "Invalid data" });
      }
    }

    return result;
  }
}

export const bulkUploadService = new BulkUploadService();
