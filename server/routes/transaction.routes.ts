import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { isAuthenticated } from "../auth";
import {
  insertBusinessSchema,
  insertStoreSchema,
  insertCustomerSchema,
  insertStaffSchema,
  insertInventorySchema,
  insertPromotionSchema,
  insertCustomRoleSchema,
  insertStoreIntegrationSchema,
  insertExpenseSchema,
  type UserRole,
  orders,
  checkouts,
  promotions,
  transactions,
  customers,
  inventory,
  staff,
  customRoles,
  taxRates,
  repayments,
  expenses,
  cashDrops,
  creditEntries,
  cashRegisterSessions,
} from "@shared/schema";
import { z } from "zod";
import { db } from "../db";
import { eq, and, gte, lte, gt, count, desc } from "drizzle-orm";
import { sanitizeString, sanitizeUUID, sanitizeNumber, sanitizeBoolean, sanitizePhoneNumber, sanitizeStoreCode } from "../sanitize";
import { auditLogger } from "../audit";
import { bulkUploadService } from "../services/BulkUploadService";
import { analyticsService } from "../services/AnalyticsService";
import { getUserId, getClientIp, formatZodErrors, checkBusinessAccess, getUserStores, verifyStoreAccess, verifyRecordStoreAccess, triggerAutoRecalculate } from './helpers';

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
    const firstTx = group[0];
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
    const uniqueNames = Array.from(new Set(group.map((t: any) => t.inventory?.name).filter(Boolean)));
    const joinedNames = uniqueNames.join(", ");
    const hasService = group.some((t: any) => t.inventory?.type === "service");
    result.push({
      ...firstTx, amount: totalAmount,
      inventory: { ...firstTx.inventory, name: joinedNames, type: hasService ? "service" : "product" },
      checkout: { ...firstTx.checkout, totalPrice: totalTotalPrice, subtotal: totalSubtotal, discountAmount: totalDiscountAmount, quantity: totalQuantity, returnedQuantity: totalReturnedQuantity, refundedAmount: totalRefundedAmount, totalCharged: totalTotalCharged },
    });
  }
  return result;
}

export function registerTransactionRoutes(app: Express, { isAuthenticated: _isAuth, requireRole, requireManagerOrOwner, checkStoreAccess }: RouteMiddlewares): void {
  // ========== TRANSACTIONS ==========
  app.get("/api/transactions", async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) {
        return res.status(400).json({ error: "Please select a store first." });
      }

      const page = parseInt(req.query.page as string) || 0;
      const limit = parseInt(req.query.limit as string) || 0;

      if (storeId === "all") {
        const stores = await getUserStores(req);
        if (stores.length === 0) return res.json(page > 0 && limit > 0 ? { transactions: [], total: 0, pages: 0 } : []);

        const allTxs = await Promise.all(
          stores.map(s => storage.getTransactions(s.id))
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
            transactions: paginated,
            total: grouped.length,
            pages: Math.ceil(grouped.length / limit),
          });
        }

        grouped.sort((a, b) => new Date(b.transactionDate).getTime() - new Date(a.transactionDate).getTime());
        return res.json(grouped);
      }

      if (!(await checkStoreAccess(storeId, req, res))) return;

      if (page > 0 && limit > 0) {
        const search = req.query.search as string;
        const txs = await storage.getTransactions(storeId);
        let grouped = groupTransactions(txs);

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

      const txs = await storage.getTransactions(storeId);
      res.json(groupTransactions(txs));
    } catch (error) {
      res.status(500).json({ error: "We couldn't load your transactions. Please try again." });
    }
  });

  app.get("/api/customers/:id/transactions", async (req, res) => {
    try {
      const txs = await storage.getTransactionsByCustomer(req.params.id);
      res.json(groupTransactions(txs));
    } catch (error) {
      res.status(500).json({ error: "We couldn't load customer transactions. Please try again." });
    }
  });

  // ─── GET receipt payload ─────────────────────────────────────────────────
  app.get("/api/transactions/:checkoutId/receipt", async (req: any, res) => {
    try {
      const { checkoutId } = req.params;
      const payload = await storage.getReceiptPayload(checkoutId);
      if (!payload) return res.status(404).json({ error: "Transaction not found." });
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
      if (!result.success) return res.status(400).json({ error: result.message });
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
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Could not update payment status." });
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
        return res.status(400).json({ error: result.message });
      }

      // If refund method is cash, integrate with active cash register session
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

      res.json({ success: true, message: result.message, returnLogIds: result.returnLogIds });
    } catch (error) {
      console.error("Process Return API Error:", error);
      res.status(500).json({ error: "Could not process return." });
    }
  });

  app.get("/api/customers/:id/store-credit", async (req: any, res) => {
    try {
      const { id } = req.params;
      const transactionsList = await storage.getStoreCreditTransactions(id);
      res.json(transactionsList);
    } catch (error) {
      console.error("Store Credit API Error:", error);
      res.status(500).json({ error: "Could not load store credit balance history." });
    }
  });
  // ---------- 1. PARTIAL RETURNS ----------
  app.post("/api/transactions/:checkoutId/return", requireRole("owner", "manager"), async (req: any, res) => {
    try {
      const { checkoutId } = req.params;
      const { orderId, quantity, refundAmount, refundMethod, reason, staffId } = req.body;
      
      if (!orderId || quantity === undefined || refundAmount === undefined || !refundMethod) {
        return res.status(400).json({ error: "Missing required fields for processing return." });
      }

      // Retrieve receipt payload first to verify store access
      const payload = await storage.getReceiptPayload(checkoutId);
      if (!payload) {
        return res.status(404).json({ error: "Transaction not found." });
      }
      const checkout = payload.items[0]?.checkout;
      if (!checkout) {
        return res.status(404).json({ error: "Checkout not found." });
      }

      if (!(await checkStoreAccess(checkout.storeId, req, res))) return;

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
        reason: reason || "Legacy return",
        userId: req.user?.id || "",
        staffId: staffId || "",
      });

      if (!result.success) {
        return res.status(400).json({ error: result.message });
      }

      res.json(result);
    } catch (error) {
      console.error("Return error:", error);
      res.status(500).json({ error: (error as Error).message || "Could not process return." });
    }
  });

}
