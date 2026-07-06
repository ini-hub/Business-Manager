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
import { getUserId, getClientIp, formatZodErrors, checkBusinessAccess, getUserStores, verifyStoreAccess, verifyRecordStoreAccess, triggerAutoRecalculate, broadcastChange } from './helpers';

export type RouteMiddlewares = {
  isAuthenticated: any;
  requireRole: (...roles: any[]) => any;
  requireManagerOrOwner: any;
  checkStoreAccess: (storeId: string, req: Request, res: Response) => Promise<boolean>;
};

export function registerCashRoutes(app: Express, { isAuthenticated, requireRole, requireManagerOrOwner, checkStoreAccess }: RouteMiddlewares): void {
  // ---------- 2. CASH DRAWER MANAGEMENT ----------
  // Get Active Session for Store
  app.get("/api/cash-register/session", isAuthenticated, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) return res.status(400).json({ error: "Store ID is required." });
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const session = await storage.cashRegisterRepo.getActiveSession(storeId);
      res.json(session || null);
    } catch (error) {
      res.status(500).json({ error: "Could not fetch active register session." });
    }
  });

  // Get All Sessions for Store
  app.get("/api/cash-register/sessions", isAuthenticated, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) return res.status(400).json({ error: "Store ID is required." });
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const sessions = await storage.cashRegisterRepo.getSessions(storeId);
      res.json(sessions);
    } catch (error) {
      res.status(500).json({ error: "Could not fetch register sessions." });
    }
  });

  // Open Register Session
  app.post("/api/cash-register/open", isAuthenticated, async (req, res) => {
    try {
      const { storeId, openingFloat, notes } = req.body;
      if (!storeId || openingFloat === undefined) {
        return res.status(400).json({ error: "Store ID and opening float are required." });
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized." });

      const session = await storage.cashRegisterRepo.openSession({
        storeId,
        openedByUserId: userId,
        openingFloat: Number(openingFloat),
        notes,
      });
      auditLogger.log({ action: "CASH_REGISTER_OPEN", resource: "cash_register", resourceId: session.id, userId, ip: getClientIp(req), status: "success", details: { storeId, openingFloat } });
      broadcastChange(req, "cash", storeId, "opened");
      res.status(201).json(session);
    } catch (error) {
      const err = error as Error;
      if (err.message.startsWith("conflict:")) {
        return res.status(409).json({ error: err.message.substring(9) });
      }
      res.status(500).json({ error: err.message || "Could not open register session." });
    }
  });

  // Record Cash Drop
  app.post("/api/cash-register/drop", isAuthenticated, async (req, res) => {
    try {
      const { sessionId, amount, notes } = req.body;
      if (!sessionId || amount === undefined) {
        return res.status(400).json({ error: "Session ID and amount are required." });
      }

      const session = await storage.cashRegisterRepo.findById(sessionId);
      if (!session) return res.status(404).json({ error: "Register session not found." });
      if (!(await checkStoreAccess(session.storeId, req, res))) return;

      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized." });

      const drop = await storage.cashRegisterRepo.recordCashDrop({
        sessionId,
        amount: Number(amount),
        droppedByUserId: userId,
        notes,
      });
      auditLogger.log({ action: "CASH_DROP", resource: "cash_register", resourceId: sessionId, userId, ip: getClientIp(req), status: "success", details: { sessionId, amount } });
      broadcastChange(req, "cash", session.storeId, "drop");
      res.status(201).json(drop);
    } catch (error) {
      const err = error as Error;
      if (err.message.startsWith("bad_request:")) {
        return res.status(400).json({ error: err.message.substring(12) });
      }
      res.status(500).json({ error: err.message || "Could not record cash drop." });
    }
  });

  // Get Cash Drops for Session
  app.get("/api/cash-register/sessions/:sessionId/drops", isAuthenticated, async (req, res) => {
    try {
      const { sessionId } = req.params;
      const session = await storage.cashRegisterRepo.findById(sessionId);
      if (!session) return res.status(404).json({ error: "Session not found." });
      if (!(await checkStoreAccess(session.storeId, req, res))) return;

      const drops = await storage.cashRegisterRepo.getSessionDrops(sessionId);
      res.json(drops);
    } catch (error) {
      res.status(500).json({ error: "Could not fetch cash drops." });
    }
  });

  // Close Register Session
  app.post("/api/cash-register/close", isAuthenticated, async (req, res) => {
    try {
      const { sessionId, actualCash, notes } = req.body;
      if (!sessionId || actualCash === undefined) {
        return res.status(400).json({ error: "Session ID and actual cash count are required." });
      }

      const session = await storage.cashRegisterRepo.findById(sessionId);
      if (!session) return res.status(404).json({ error: "Register session not found." });
      if (!(await checkStoreAccess(session.storeId, req, res))) return;

      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized." });

      const closed = await storage.cashRegisterRepo.closeSession(sessionId, {
        closedByUserId: userId,
        actualCash: Number(actualCash),
        notes,
      });
      auditLogger.log({ action: "CASH_REGISTER_CLOSE", resource: "cash_register", resourceId: sessionId, userId, ip: getClientIp(req), status: "success", details: { sessionId, actualCash } });
      broadcastChange(req, "cash", session.storeId, "closed");
      res.json(closed);
    } catch (error) {
      const err = error as Error;
      if (err.message.startsWith("bad_request:")) {
        return res.status(400).json({ error: err.message.substring(12) });
      }
      res.status(500).json({ error: err.message || "Could not close register session." });
    }
  });

}
