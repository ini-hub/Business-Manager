import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { z } from "zod";
import { auditLogger } from "../audit";
import { getUserId, getClientIp, checkBusinessAccess, getUserStores, verifyStoreAccess, broadcastChange } from './helpers';

export type RouteMiddlewares = {
  isAuthenticated: any;
  requireRole: (...roles: any[]) => any;
  requireManagerOrOwner: any;
  checkStoreAccess: (storeId: string, req: Request, res: Response) => Promise<boolean>;
};

function groupTransactions(txs: any[]): any[] {
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
    let totalReturnedQuantity = 0, totalRefundedAmount = 0, totalSubtotal = 0, totalDiscountAmount = 0;
    for (const item of group) {
      totalAmount += Number(item.amount) || 0;
      totalTotalPrice += Number(item.checkout?.totalPrice) || 0;
      totalTotalCharged += Number(item.checkout?.totalCharged) || 0;
      totalQuantity += Number(item.checkout?.quantity) || 0;
      totalReturnedQuantity += Number(item.checkout?.returnedQuantity) || 0;
      totalRefundedAmount += Number(item.checkout?.refundedAmount) || 0;
      totalSubtotal += Number(item.checkout?.subtotal) || 0;
      totalDiscountAmount += Number(item.checkout?.discountAmount) || 0;
    }
    const hasService = group.some((t: any) => t.inventory?.type === "service");
    const hasProduct = group.some((t: any) => t.inventory?.type === "product");
    const basketType = hasService && hasProduct ? "mixed" : hasService ? "service" : "product";
    // Pick lead/assisting staff from whichever checkout in the group has them set
    // (product checkouts have null lead staff even within a mixed receipt)
    const leadStaffId = group.find((t: any) => t.checkout?.leadStaffId)?.checkout?.leadStaffId ?? firstTx.checkout?.leadStaffId ?? null;
    const assistingStaff1Id = group.find((t: any) => t.checkout?.assistingStaff1Id)?.checkout?.assistingStaff1Id ?? firstTx.checkout?.assistingStaff1Id ?? null;
    const assistingStaff2Id = group.find((t: any) => t.checkout?.assistingStaff2Id)?.checkout?.assistingStaff2Id ?? firstTx.checkout?.assistingStaff2Id ?? null;
    result.push({
      ...firstTx,
      amount: totalAmount,
      inventory: { ...firstTx.inventory, type: basketType },
      checkout: {
        ...firstTx.checkout,
        leadStaffId,
        assistingStaff1Id,
        assistingStaff2Id,
        totalPrice: totalTotalPrice,
        subtotal: totalSubtotal,
        discountAmount: totalDiscountAmount,
        quantity: totalQuantity,
        returnedQuantity: totalReturnedQuantity,
        refundedAmount: totalRefundedAmount,
        totalCharged: totalTotalCharged,
        basketItemCount: group.length,
      },
    });
  }
  return result;
}

export function registerTransactionRoutes(app: Express, { isAuthenticated, requireRole, requireManagerOrOwner, checkStoreAccess }: RouteMiddlewares): void {
  // ========== TRANSACTIONS ==========

  app.get("/api/transactions", isAuthenticated, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) {
        return res.status(400).json({ error: "Please select a store first." });
      }

      const page = parseInt(req.query.page as string) || 0;
      const limit = parseInt(req.query.limit as string) || 0;

      // Parse optional server-side date filters
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
      const filters = { startDate, endDate };

      if (storeId === "all") {
        const stores = await getUserStores(req);
        if (stores.length === 0) {
          return res.json(page > 0 && limit > 0 ? { transactions: [], total: 0, pages: 0 } : []);
        }

        const allTxs = await Promise.all(
          stores.map(s => storage.getTransactions(s.id, filters))
        );
        let merged = allTxs.flat();
        let grouped = groupTransactions(merged);

        if (page > 0 && limit > 0) {
          const search = req.query.search as string;
          if (search) {
            const sLower = search.toLowerCase();
            grouped = grouped.filter(tx =>
              String(tx.checkout?.receiptNumber || "").toLowerCase().includes(sLower) ||
              String(tx.id || "").toLowerCase().includes(sLower) ||
              String(tx.inventory?.name || "").toLowerCase().includes(sLower) ||
              String(tx.customer?.name || "").toLowerCase().includes(sLower)
            );
          }
          grouped.sort((a, b) => new Date(b.transactionDate).getTime() - new Date(a.transactionDate).getTime());
          const start = (page - 1) * limit;
          const paginated = grouped.slice(start, start + limit);
          return res.json({
            data: paginated,
            pagination: {
              total: grouped.length,
              page,
              limit,
              totalPages: Math.ceil(grouped.length / limit),
              hasMore: page < Math.ceil(grouped.length / limit),
            },
          });
        }

        grouped.sort((a, b) => new Date(b.transactionDate).getTime() - new Date(a.transactionDate).getTime());
        return res.json(grouped);
      }

      if (!(await checkStoreAccess(storeId, req, res))) return;

      const txs = await storage.getTransactions(storeId, filters);
      let grouped = groupTransactions(txs);

      if (page > 0 && limit > 0) {
        const search = req.query.search as string;
        if (search) {
          const sLower = search.toLowerCase();
          grouped = grouped.filter(tx =>
            String(tx.checkout?.receiptNumber || "").toLowerCase().includes(sLower) ||
            String(tx.id || "").toLowerCase().includes(sLower) ||
            String(tx.inventory?.name || "").toLowerCase().includes(sLower) ||
            String(tx.customer?.name || "").toLowerCase().includes(sLower)
          );
        }
        const total = grouped.length;
        const offset = (page - 1) * limit;
        const paginatedData = grouped.slice(offset, offset + limit);
        const totalPages = Math.max(1, Math.ceil(total / limit));

        return res.json({
          data: paginatedData,
          pagination: {
            total,
            page,
            limit,
            totalPages,
            hasMore: page < totalPages,
          },
        });
      }

      res.json(grouped);
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

      res.json(tx);
    } catch (error) {
      res.status(500).json({ error: "Could not load transaction." });
    }
  });

  app.get("/api/customers/:id/transactions", isAuthenticated, async (req: any, res) => {
    try {
      const txs = await storage.getTransactionsByCustomer(req.params.id);

      // Verify the user has access to at least one store for this customer's transactions
      if (txs.length > 0) {
        const storeId = txs[0].storeId;
        if (!(await checkStoreAccess(storeId, req, res))) return;
      }

      res.json(groupTransactions(txs));
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
      res.json(payload);
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
        details: { reason: reason.trim() },
      });

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
      const { paymentMethod, paymentStatus } = req.body;
      const validMethods = ["cash", "transfer", "pos", "flutterwave"];
      const validStatuses = ["completed", "pending"];
      if (!validMethods.includes(paymentMethod)) return res.status(400).json({ error: "Invalid payment method." });
      if (!validStatuses.includes(paymentStatus)) return res.status(400).json({ error: "Invalid payment status." });

      const ok = await storage.updateCheckoutPaymentMethod(checkoutId, paymentMethod, paymentStatus);
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
