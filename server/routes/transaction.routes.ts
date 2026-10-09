import { parsePage, paginated } from "../lib/pagination";
import type { Express, Request, Response } from "express";
import { checkoutInScope, resolveTransactionScope } from "../lib/transactionAccess";
import { storage } from "../storage";
import { auditLogger } from "../audit";
import { getCheckoutMoneyDetails } from "../lib/checkoutAuditDetails";
import { getClientIp, getUserStores, broadcastChange, getAuditContext } from './helpers';
import { staffCreditDeductionService } from "../services/StaffCreditDeductionService";

export type RouteMiddlewares = {
  isAuthenticated: any;
  requireRole: (...roles: any[]) => any;
  requireManagerOrOwner: any;
  checkStoreAccess: (storeId: string, req: Request, res: Response) => Promise<boolean>;
};

export function groupTransactions(txs: any[]): any[] {
  const groupedMap = new Map<string, any[]>();
  for (const tx of txs) {
    const key = tx.checkout?.receiptNumber || tx.checkoutId || tx.id;
    if (!groupedMap.has(key)) groupedMap.set(key, []);
    groupedMap.get(key)!.push(tx);
  }
  const result: any[] = [];
  for (const [_key, group] of Array.from(groupedMap.entries())) {
    if (group.length === 0) continue;
    if (group.length === 1) { result.push(group[0]); continue; }
    // Prefer the oldest non-addendum checkout as the receipt representative so the
    // transaction list links to the original sale, not an addendum appended later.
    const firstTx = group.find((t: any) => !t.checkout?.isAddendum) ?? group[group.length - 1];
    let totalAmount = 0, totalTotalPrice = 0, totalTotalCharged = 0, totalQuantity = 0;
    let totalReturnedQuantity = 0, totalRefundedAmount = 0, totalSubtotal = 0, totalDiscountAmount = 0, totalTaxRefunded = 0, totalLossAmount = 0;
    for (const item of group) {
      totalAmount += Number(item.amount) || 0;
      totalTotalPrice += Number(item.checkout?.totalPrice) || 0;
      totalTotalCharged += Number(item.checkout?.totalCharged) || 0;
      totalQuantity += Number(item.checkout?.quantity) || 0;
      totalReturnedQuantity += Number(item.checkout?.returnedQuantity) || 0;
      totalRefundedAmount += Number(item.checkout?.refundedAmount) || 0;
      totalSubtotal += Number(item.checkout?.subtotal) || 0;
      totalDiscountAmount += Number(item.checkout?.discountAmount) || 0;
      totalTaxRefunded += Number(item.checkout?.taxRefunded) || 0;
      totalLossAmount += Number(item.checkout?.lossAmount) || 0;
    }
    const hasService = group.some((t: any) => t.inventory?.type === "service");
    const hasProduct = group.some((t: any) => t.inventory?.type === "product");
    const basketType = hasService && hasProduct ? "mixed" : hasService ? "service" : "product";
    // Pick lead/assisting staff from whichever checkout in the group has them set
    // (product checkouts have null lead staff even within a mixed receipt)
    const leadStaffId = group.find((t: any) => t.checkout?.leadStaffId)?.checkout?.leadStaffId ?? firstTx.checkout?.leadStaffId ?? null;
    const assistingStaff1Id = group.find((t: any) => t.checkout?.assistingStaff1Id)?.checkout?.assistingStaff1Id ?? firstTx.checkout?.assistingStaff1Id ?? null;
    const assistingStaff2Id = group.find((t: any) => t.checkout?.assistingStaff2Id)?.checkout?.assistingStaff2Id ?? firstTx.checkout?.assistingStaff2Id ?? null;
    // Union of every distinct staff id across ALL line items in the group, not just
    // the representative one above — a receipt with multiple services can have a
    // different lead staff per service, and each of them must count as active.
    const serviceStaffIds = Array.from(new Set(
      group.flatMap((t: any) => [
        t.checkout?.leadStaffId,
        t.checkout?.assistingStaff1Id,
        t.checkout?.assistingStaff2Id,
      ]).filter(Boolean)
    ));
    result.push({
      ...firstTx,
      amount: totalAmount,
      inventory: { ...firstTx.inventory, type: basketType },
      checkout: {
        ...firstTx.checkout,
        leadStaffId,
        assistingStaff1Id,
        assistingStaff2Id,
        serviceStaffIds,
        totalPrice: totalTotalPrice,
        subtotal: totalSubtotal,
        discountAmount: totalDiscountAmount,
        quantity: totalQuantity,
        returnedQuantity: totalReturnedQuantity,
        refundedAmount: totalRefundedAmount,
        taxRefunded: totalTaxRefunded,
        lossAmount: totalLossAmount,
        totalCharged: totalTotalCharged,
        basketItemCount: group.length,
      },
    });
  }
  return result;
}

/**
 * One page of receipts, newest first. Which receipts exist, the viewer's staff scope, the search and the
 * paging all run in SQL (storage.getReceiptPage); only the lines on the requested page are then loaded in
 * full and merged into receipts exactly as before, so the response shape is unchanged.
 */
async function pageOfReceipts(storeIds: string[], filters: { startDate?: Date; endDate?: Date; customerId?: string }, scope: Set<string> | null, search: string | undefined, page: number, limit: number) {
  const { keys, lineIds, total } = await storage.getReceiptPage(storeIds, {
    ...filters,
    scope,
    search: search || undefined,
    offset: (page - 1) * limit,
    limit,
  });
  const full = groupTransactions(await storage.getTransactionsByIds(lineIds));
  const byKey = new Map(full.map(g => [g.checkout?.receiptNumber || g.checkoutId || g.id, g]));
  const groups = keys.map(k => byKey.get(k)).filter(Boolean) as typeof full;
  // One statement for the page's payment legs, so the ledger can show and filter on the account a sale paid into.
  const legs = await storage.paymentAccountRepo.getLegSummariesForReceipts(storeIds, groups.map(g => g.checkout?.receiptNumber).filter(Boolean) as string[]);
  const legsByReceipt = new Map<string, typeof legs>();
  for (const l of legs) {
    const k = `${l.storeId}:${l.receiptNumber}`;
    legsByReceipt.set(k, [...(legsByReceipt.get(k) ?? []), l]);
  }
  const data = groups.map(g => ({
    ...g,
    paymentLegs: (legsByReceipt.get(`${g.checkout?.storeId}:${g.checkout?.receiptNumber}`) ?? [])
      .map(({ storeId: _s, receiptNumber: _r, ...leg }) => leg),
  }));
  return { data, total };
}

export function registerTransactionRoutes(app: Express, { isAuthenticated, requireRole, requireManagerOrOwner, checkStoreAccess }: RouteMiddlewares): void {
  // ========== TRANSACTIONS ==========

  app.get("/api/transactions", isAuthenticated, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) {
        return res.status(400).json({ error: "Please select a store first." });
      }

      // Always one page of receipts, newest first (page 1 at the default size when none is asked for): the
      // list grows with every sale and must never come back whole. Screens that need every receipt walk the
      // pages (client/src/lib/paginated.ts).
      const pageReq = parsePage(req.query);

      // Parse optional server-side date filters
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
      if ((startDate && Number.isNaN(startDate.getTime())) || (endDate && Number.isNaN(endDate.getTime()))) {
        return res.status(400).json({ error: "That date range isn't valid. Please check the dates and try again." });
      }
      const filters = { startDate, endDate };
      const search = req.query.search as string | undefined;

      if (storeId === "all") {
        const stores = await getUserStores(req);
        if (stores.length === 0) return res.json(paginated([], 0, pageReq));

        // Non-owner/manager users only see their own checkouts (business setting).
        const scope = await resolveTransactionScope((req as any).user, stores.map(s => s.id));
        const { data, total } = await pageOfReceipts(stores.map(s => s.id), filters, scope, search, pageReq.page, pageReq.limit);
        return res.json(paginated(data, total, pageReq));
      }

      if (!(await checkStoreAccess(storeId, req, res))) return;

      const scope = await resolveTransactionScope((req as any).user, [storeId]);
      const { data, total } = await pageOfReceipts([storeId], filters, scope, search, pageReq.page, pageReq.limit);
      res.json(paginated(data, total, pageReq));
    } catch (error) {
      res.status(500).json({ error: "We couldn't load your transactions. Please try again." });
    }
  });

  // ─── GET single transaction by ID ─────────────────────────────────────────
  app.get("/api/transactions/:id", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const tx = await storage.getTransactionById(id);
      if (!tx) return res.status(404).json({ error: "Transaction not found." });

      // Verify the requesting user has access to the transaction's store
      if (!(await checkStoreAccess(tx.storeId, req, res))) return;

      const scope = await resolveTransactionScope(req.user, [tx.storeId]);
      if (scope && !checkoutInScope(tx.checkout, scope)) {
        return res.status(403).json({ error: "You can only view transactions you took part in." });
      }

      res.json(tx);
    } catch (error) {
      res.status(500).json({ error: "Could not load transaction." });
    }
  });

  app.get("/api/customers/:id/transactions", isAuthenticated, async (req: any, res) => {
    try {
      const pageReq = parsePage(req.query);
      const customer = await storage.getCustomer(req.params.id);
      // A customer belongs to one store; an unknown customer simply has no transactions.
      if (!customer) return res.json(paginated([], 0, pageReq));
      if (!(await checkStoreAccess(customer.storeId, req, res))) return;

      // This customer's receipts, newest first, one page at a time (a regular can have thousands).
      const scope = await resolveTransactionScope(req.user, [customer.storeId]);
      const { data, total } = await pageOfReceipts([customer.storeId], { customerId: customer.id }, scope, undefined, pageReq.page, pageReq.limit);
      res.json(paginated(data, total, pageReq));
    } catch (error) {
      res.status(500).json({ error: "We couldn't load customer transactions. Please try again." });
    }
  });

  // ─── GET receipt payload ─────────────────────────────────────────────────
  app.get("/api/transactions/:checkoutId/receipt", isAuthenticated, async (req: any, res) => {
    try {
      const { checkoutId } = req.params;
      const payload = await storage.getReceiptPayload(checkoutId);
      if (!payload) return res.status(404).json({ error: "Transaction not found." });
      if (!(await checkStoreAccess(payload.checkout.storeId, req, res))) return;
      const scope = await resolveTransactionScope(req.user, [payload.checkout.storeId]);
      // A merged receipt has one checkout per line, so being on any line counts.
      const receiptCheckouts = [payload.checkout, ...((payload as any).items ?? []).map((i: any) => i.checkout)];
      if (scope && !receiptCheckouts.some((c: any) => checkoutInScope(c, scope))) {
        return res.status(403).json({ error: "You can only view receipts for transactions you took part in." });
      }
      const paymentLegs = await storage.paymentAccountRepo.getLegsForReceipt(payload.checkout.storeId, payload.checkout.receiptNumber);
      res.json({ ...payload, paymentLegs });
    } catch (error) {
      console.error("Receipt API Error:", error);
      res.status(500).json({ error: "Could not load receipt data." });
    }
  });

  // ─── Void a transaction ──────────────────────────────────────────────────
  app.post("/api/transactions/:checkoutId/void", requireRole("owner", "manager"), async (req: any, res) => {
    try {
      const { checkoutId } = req.params;
      const { reason } = req.body;
      if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
        return res.status(400).json({ error: "A void reason is required." });
      }
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized." });

      const result = await storage.voidCheckout(checkoutId, reason.trim(), userId);
      if (!result.success) {
        auditLogger.log({
          action: "TRANSACTION_VOID",
          resource: "checkout",
          resourceId: checkoutId,
          userId,
          ip: getClientIp(req),
          status: "failure",
          errorMessage: result.message,
          details: { reason: reason.trim() },
        });
        return res.status(400).json({ error: result.message });
      }

      auditLogger.log({
        action: "TRANSACTION_VOID",
        resource: "checkout",
        resourceId: checkoutId,
        userId,
        ip: getClientIp(req),
        status: "success",
        details: { reason: reason.trim(), ...(await getCheckoutMoneyDetails([checkoutId]).catch(() => ({}))) },
      });

      // The void may have cancelled a staff member's own debt (a checkout rung
      // up as Credit against their linked customer profile). Re-clamp any open
      // payroll proposal resting on it — best-effort, same as a repayment or a
      // write-off: the void has already committed, so a failure here must not
      // fail this response.
      if (result.voidedStoreId && result.voidedCreditCustomerIds?.length) {
        for (const customerId of result.voidedCreditCustomerIds) {
          try {
            await staffCreditDeductionService.syncOpenPeriodsForCustomer(result.voidedStoreId, customerId);
          } catch (e) {
            console.error("Failed to re-sync payroll after voiding a credit sale:", e);
          }
        }
        broadcastChange(req, "credit", result.voidedStoreId, "updated");
        broadcastChange(req, "payroll", result.voidedStoreId, "updated");
      }

      broadcastChange(req, "sales", undefined, "voided");
      res.json({ success: true, message: result.message, payrollWarning: result.payrollWarning });
    } catch (error) {
      res.status(500).json({ error: "Could not void transaction." });
    }
  });

  // ─── Update payment method/status ────────────────────────────────────────
  app.patch("/api/transactions/:checkoutId/payment-status", requireRole("owner", "manager"), async (req: any, res) => {
    try {
      const { checkoutId } = req.params;
      const { paymentMethod, paymentStatus, accountId } = req.body;
      const validMethods = ["cash", "transfer", "pos", "flutterwave"];
      const validStatuses = ["completed", "pending"];
      if (!validMethods.includes(paymentMethod)) return res.status(400).json({ error: "Invalid payment method." });
      if (!validStatuses.includes(paymentStatus)) return res.status(400).json({ error: "Invalid payment status." });

      const ok = await storage.updateCheckoutPaymentMethod(checkoutId, paymentMethod, paymentStatus, {
        accountId: paymentMethod === "transfer" && typeof accountId === "string" ? accountId : undefined,
        actorUserId: req.user?.id,
      });
      if (ok === "bad_account") return res.status(400).json({ error: "The selected payment account is not active for this store." });
      if (!ok) return res.status(404).json({ error: "Transaction not found." });

      auditLogger.log({
        action: "PAYMENT_UPDATE",
        resource: "checkout",
        resourceId: checkoutId,
        userId: req.user?.id,
        ip: getClientIp(req),
        status: "success",
        details: { paymentMethod, paymentStatus },
      });

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Could not update payment status." });
    }
  });

  // ─── Edit transaction date (post-sale correction) ────────────────────────
  app.patch("/api/transactions/:checkoutId/date", requireRole("owner"), async (req: any, res) => {
    try {
      const { checkoutId } = req.params;
      const { newDate } = req.body;
      if (!newDate || !/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
        return res.status(400).json({ error: "A valid date (YYYY-MM-DD) is required." });
      }
      const today = new Date().toISOString().slice(0, 10);
      if (newDate > today) {
        return res.status(400).json({ error: "Transaction date cannot be in the future." });
      }
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized." });

      const result = await storage.updateTransactionDate({ checkoutId, newDate, updatedByUserId: userId });

      if (!result.success) {
        const isPayrollLocked = /payroll period/i.test(result.message);
        const ctx = await getAuditContext(req, { storeId: result.storeId });
        auditLogger.logEvent(ctx, "TRANSACTION_DATE_EDIT", "checkout", checkoutId, "failure", {
          errorMessage: result.message,
          details: { attemptedNewDate: newDate },
        });
        return res.status(400).json({
          error: result.message,
          code: isPayrollLocked ? "PAYROLL_LOCKED" : undefined,
        });
      }

      const ctx = await getAuditContext(req, { storeId: result.storeId });
      auditLogger.logEvent(ctx, "TRANSACTION_DATE_EDIT", "checkout", checkoutId, "success", {
        previousValues: { transactionDate: result.previousDate, receiptNumber: result.receiptNumber, affectedCheckoutIds: result.affectedCheckoutIds },
        newValues: { transactionDate: result.newDate },
        changedFields: ["transactionDate", "createdAt"],
      });

      broadcastChange(req, "sales", result.storeId, "updated");
      res.json({ success: true, message: result.message });
    } catch (error) {
      res.status(500).json({ error: "Could not update transaction date." });
    }
  });

  // ─── Correct who performed each service (post-sale correction) ───────────
  app.patch("/api/transactions/:checkoutId/staff", requireRole("owner", "manager"), async (req: any, res) => {
    try {
      const { checkoutId } = req.params;
      const raw = req.body?.assignments;
      if (!Array.isArray(raw) || raw.length === 0) {
        return res.status(400).json({ error: "At least one service assignment is required." });
      }
      const assignments = raw.map((a: any) => ({
        checkoutId: String(a?.checkoutId ?? ""),
        staffIds: Array.isArray(a?.staffIds) ? a.staffIds.map(String) : [],
      }));
      if (assignments.some((a) => !a.checkoutId)) {
        return res.status(400).json({ error: "Invalid assignment." });
      }
      if (!req.user?.id) return res.status(401).json({ error: "Unauthorized." });

      const result = await storage.updateServiceStaff({ checkoutId, assignments });
      const ctx = await getAuditContext(req, { storeId: result.storeId });
      if (!result.success) {
        auditLogger.logEvent(ctx, "TRANSACTION_STAFF_EDIT", "checkout", checkoutId, "failure", {
          errorMessage: result.message,
        });
        return res.status(400).json({ error: result.message });
      }

      auditLogger.logEvent(ctx, "TRANSACTION_STAFF_EDIT", "checkout", checkoutId, "success", {
        previousValues: { receiptNumber: result.receiptNumber, staffByLine: result.previousValues },
        newValues: { staffByLine: result.newValues },
        changedFields: ["leadStaffId", "assistingStaff1Id", "assistingStaff2Id"],
      });

      broadcastChange(req, "sales", result.storeId, "updated");
      res.json({ success: true, message: result.message });
    } catch (error) {
      res.status(500).json({ error: "Could not update staff." });
    }
  });

  // ─── Add missed item (addendum) ──────────────────────────────────────────
  app.post("/api/transactions/:checkoutId/addendum", requireRole("owner", "manager"), async (req: any, res) => {
    try {
      const { checkoutId } = req.params;
      const { inventoryId, quantity, customPrice, staffId, leadStaffId, assistingStaff1Id, assistingStaff2Id, paymentMethod, reason } = req.body;
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized." });

      const validPaymentMethods = ["cash", "transfer", "credit", "store_credit"];
      if (!inventoryId || !quantity || quantity <= 0 || !staffId || !paymentMethod || !reason?.trim()) {
        return res.status(400).json({ error: "Missing required fields." });
      }
      if (!validPaymentMethods.includes(paymentMethod)) {
        return res.status(400).json({ error: "Invalid payment method. Use cash, transfer, credit, or store_credit." });
      }

      const result = await storage.processAddendum({
        originalCheckoutId: checkoutId,
        inventoryId,
        quantity: Number(quantity),
        customPrice: customPrice != null ? Number(customPrice) : undefined,
        staffId,
        leadStaffId: leadStaffId || undefined,
        assistingStaff1Id: assistingStaff1Id || undefined,
        assistingStaff2Id: assistingStaff2Id || undefined,
        paymentMethod,
        reason: reason.trim(),
        userId,
      });

      if (!result.success) {
        auditLogger.log({
          action: "TRANSACTION_ADDENDUM",
          resource: "checkout",
          resourceId: checkoutId,
          userId,
          ip: getClientIp(req),
          status: "failure",
          errorMessage: result.message,
          details: { inventoryId, quantity, paymentMethod, reason: reason.trim() },
        });
        return res.status(400).json({ error: result.message });
      }

      auditLogger.log({
        action: "TRANSACTION_ADDENDUM",
        resource: "checkout",
        resourceId: checkoutId,
        userId,
        ip: getClientIp(req),
        status: "success",
        details: { inventoryId, quantity, paymentMethod, reason: reason.trim(), newCheckoutId: result.checkoutId },
      });

      broadcastChange(req, "sales", undefined, "addendum");
      res.json({ success: true, checkoutId: result.checkoutId, payrollWarning: result.payrollWarning });
    } catch (error) {
      res.status(500).json({ error: "Could not add item to receipt." });
    }
  });

  // ========== POS RETURNS & STORE CREDITS ==========

  app.post("/api/sales/returns", requireRole("owner", "manager"), async (req: any, res) => {
    try {
      const { storeId, checkoutId, items, refundMethod, refundAmount, reason, staffId } = req.body;
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized." });

      if (!storeId || !checkoutId || !items || !Array.isArray(items) || items.length === 0 || !refundMethod || refundAmount === undefined || !reason) {
        return res.status(400).json({ error: "Missing required return parameters." });
      }

      if (!(await checkStoreAccess(storeId, req, res))) return;

      const result = await storage.processReturn({
        storeId,
        checkoutId,
        items,
        refundMethod,
        refundAmount: Number(refundAmount),
        reason: reason.trim(),
        userId,
        staffId: staffId || "",
      });

      if (!result.success) {
        auditLogger.log({
          action: "TRANSACTION_RETURN",
          resource: "checkout",
          resourceId: checkoutId,
          userId,
          ip: getClientIp(req),
          status: "failure",
          errorMessage: result.message,
          details: { refundMethod, refundAmount: Number(refundAmount), reason: reason.trim() },
        });
        return res.status(400).json({ error: result.message });
      }

      auditLogger.log({
        action: "TRANSACTION_RETURN",
        resource: "checkout",
        resourceId: checkoutId,
        userId,
        ip: getClientIp(req),
        status: "success",
        details: { refundMethod, refundAmount: Number(refundAmount), reason: reason.trim(), returnLogIds: result.returnLogIds },
      });

      // Integrate cash refund with the active register session
      if (refundMethod === "cash") {
        try {
          const activeSession = await storage.cashRegisterRepo.getActiveSession(storeId);
          if (activeSession) {
            await storage.cashRegisterRepo.recordCashDrop({
              sessionId: activeSession.id,
              amount: Number(refundAmount),
              droppedByUserId: userId,
              notes: `Refund payout for return on receipt ID ${checkoutId}`,
            });
          }
        } catch (drawerErr) {
          console.error("Failed to update cash register session for cash return:", drawerErr);
        }
      }

      broadcastChange(req, "sales", storeId, "returned");
      broadcastChange(req, "inventory", storeId, "returned");
      res.json({ success: true, message: result.message, returnLogIds: result.returnLogIds });
    } catch (error) {
      console.error("Process Return API Error:", error);
      res.status(500).json({ error: "Could not process return." });
    }
  });

  app.get("/api/customers/:id/store-credit", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const transactionsList = await storage.getStoreCreditTransactions(id);
      res.json(transactionsList);
    } catch (error) {
      console.error("Store Credit API Error:", error);
      res.status(500).json({ error: "Could not load store credit balance history." });
    }
  });

  // ---------- PARTIAL RETURNS ----------
  app.post("/api/transactions/:checkoutId/return", requireRole("owner", "manager"), async (req: any, res) => {
    try {
      const { checkoutId } = req.params;
      const { orderId, quantity, refundAmount, refundMethod, reason, staffId } = req.body;

      if (!orderId || quantity === undefined || refundAmount === undefined || !refundMethod) {
        return res.status(400).json({ error: "Missing required fields for processing return." });
      }
      if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
        return res.status(400).json({ error: "A return reason is required." });
      }

      const payload = await storage.getReceiptPayload(checkoutId);
      if (!payload) return res.status(404).json({ error: "Transaction not found." });
      const checkout = payload.items[0]?.checkout;
      if (!checkout) return res.status(404).json({ error: "Checkout not found." });

      if (!(await checkStoreAccess(checkout.storeId, req, res))) return;

      const userId = req.user?.id || "";
      const result = await storage.processReturn({
        storeId: checkout.storeId,
        checkoutId,
        items: [{
          orderId,
          quantity: Number(quantity),
          restock: true,
        }],
        refundMethod,
        refundAmount: Number(refundAmount),
        reason: reason.trim(),
        userId,
        staffId: staffId || "",
      });

      if (!result.success) {
        return res.status(400).json({ error: result.message });
      }

      auditLogger.log({
        action: "TRANSACTION_RETURN",
        resource: "checkout",
        resourceId: checkoutId,
        userId,
        ip: getClientIp(req),
        status: "success",
        details: { refundMethod, refundAmount: Number(refundAmount), reason: reason.trim() },
      });

      res.json(result);
    } catch (error) {
      console.error("Return error:", error);
      res.status(500).json({ error: (error as Error).message || "Could not process return." });
    }
  });
}
