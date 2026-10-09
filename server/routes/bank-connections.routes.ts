import type { Express } from "express";
import { z } from "zod";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { BankConnection } from "@shared/schema";
import { storage } from "../storage";
import { auditLogger } from "../audit";
import { getClientIp } from "./helpers";
import { exchangeCode, fetchTransactions, getMonoPublicKey, isMonoConfigured, isValidMonoWebhook, type MonoTransaction } from "../lib/mono";
import type { RouteMiddlewares } from "./payment-accounts.routes";

const MAX_PAGES = 10;
const FIRST_SYNC_DAYS = 30;
// Overlap re-reads recent history so a transaction posted late is still caught; ingest is idempotent.
const RESYNC_OVERLAP_MS = 2 * 24 * 60 * 60 * 1000;

async function syncConnection(conn: BankConnection) {
  const since = conn.lastSyncedAt
    ? new Date(conn.lastSyncedAt.getTime() - RESYNC_OVERLAP_MS)
    : new Date(Date.now() - FIRST_SYNC_DAYS * 24 * 60 * 60 * 1000);
  const all: MonoTransaction[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { items, hasNext } = await fetchTransactions(conn.providerAccountId, { start: since, page });
    all.push(...items);
    if (!hasNext) break;
  }
  return storage.bankFeedRepo.ingest(conn, all);
}

export function registerBankConnectionRoutes(app: Express, { isAuthenticated, requireManagerOrOwner, checkStoreAccess }: RouteMiddlewares): void {
  const syncLimiter = rateLimit({
    windowMs: 60_000,
    max: 6,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: any) => {
      const userId = req.user?.userId ?? req.user?.id;
      return userId != null ? String(userId) : ipKeyGenerator(req.ip ?? "");
    },
    message: { error: "Too many syncs. Please wait a moment." },
  });

  app.get("/api/sales/bank-connections/config", isAuthenticated, requireManagerOrOwner, (_req, res) => {
    res.json({ configured: isMonoConfigured(), publicKey: isMonoConfigured() ? getMonoPublicKey() : null });
  });

  app.get("/api/sales/bank-connections", isAuthenticated, requireManagerOrOwner, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) return res.status(400).json({ error: "Store ID is required." });
      if (!(await checkStoreAccess(storeId, req, res))) return;
      res.json(await storage.bankFeedRepo.listForStore(storeId));
    } catch {
      res.status(500).json({ error: "Could not fetch bank connections." });
    }
  });

  app.get("/api/sales/bank-connections/unmatched", isAuthenticated, requireManagerOrOwner, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) return res.status(400).json({ error: "Store ID is required." });
      if (!(await checkStoreAccess(storeId, req, res))) return;
      res.json(await storage.bankFeedRepo.unmatchedCredits(storeId));
    } catch {
      res.status(500).json({ error: "Could not fetch unmatched credits." });
    }
  });

  app.post("/api/sales/bank-connections", isAuthenticated, requireManagerOrOwner, syncLimiter, async (req, res) => {
    try {
      if (!isMonoConfigured()) return res.status(503).json({ error: "Bank linking isn't set up on this platform yet." });
      const parsed = z.object({ storeId: z.string().min(1), paymentAccountId: z.string().min(1), code: z.string().min(1) }).safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Store, account and link code are required." });
      const { storeId, paymentAccountId, code } = parsed.data;
      if (!(await checkStoreAccess(storeId, req, res))) return;
      const account = await storage.paymentAccountRepo.get(paymentAccountId);
      if (!account || account.storeId !== storeId || account.kind !== "bank" || !account.isActive) {
        return res.status(400).json({ error: "Pick an active bank account of this store." });
      }
      const existing = (await storage.bankFeedRepo.listForStore(storeId)).find((c) => c.paymentAccountId === paymentAccountId);
      if (existing) return res.status(409).json({ error: "That account is already linked. Disconnect it first." });

      const providerAccountId = await exchangeCode(code);
      const conn = await storage.bankFeedRepo.create({ storeId, paymentAccountId, providerAccountId, userId: (req as any).user?.id });
      auditLogger.log({ action: "BANK_CONNECTION_CREATE", resource: "bank_connection", resourceId: conn.id, userId: (req as any).user?.id, ip: getClientIp(req), status: "success", details: { storeId, paymentAccountId } });
      // The link is useful even if the first pull fails; the manager can sync again.
      const result = await syncConnection(conn).catch(() => null);
      res.status(201).json({ connection: conn, sync: result });
    } catch (err: any) {
      res.status(500).json({ error: err?.message?.startsWith("Mono") ? err.message : "Could not link the bank account." });
    }
  });

  app.post("/api/sales/bank-connections/:id/sync", isAuthenticated, requireManagerOrOwner, syncLimiter, async (req, res) => {
    try {
      const conn = await storage.bankFeedRepo.get(req.params.id);
      if (!conn || conn.status === "disconnected") return res.status(404).json({ error: "Bank connection not found." });
      if (!(await checkStoreAccess(conn.storeId, req, res))) return;
      if (conn.status === "reauth_required") return res.status(409).json({ error: "The bank needs you to reconnect this account." });
      res.json(await syncConnection(conn));
    } catch (err: any) {
      res.status(502).json({ error: err?.message || "Could not sync with the bank." });
    }
  });

  app.delete("/api/sales/bank-connections/:id", isAuthenticated, requireManagerOrOwner, async (req, res) => {
    try {
      const conn = await storage.bankFeedRepo.get(req.params.id);
      if (!conn) return res.status(404).json({ error: "Bank connection not found." });
      if (!(await checkStoreAccess(conn.storeId, req, res))) return;
      await storage.bankFeedRepo.setStatus(conn.id, "disconnected");
      auditLogger.log({ action: "BANK_CONNECTION_DELETE", resource: "bank_connection", resourceId: conn.id, userId: (req as any).user?.id, ip: getClientIp(req), status: "success", details: { storeId: conn.storeId } });
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: "Could not disconnect the bank account." });
    }
  });

  // Unauthenticated by design: Mono calls it, proven by the shared-secret header. Event names and the
  // location of the account id are matched loosely and must be checked against real sandbox payloads.
  app.post("/api/webhooks/mono", async (req, res) => {
    const header = req.headers["mono-webhook-secret"];
    if (!isValidMonoWebhook(typeof header === "string" ? header : undefined)) {
      auditLogger.logSecurityEvent("mono_webhook_invalid_secret", undefined, getClientIp(req), {});
      return res.status(401).json({ error: "Invalid webhook secret" });
    }
    // Acknowledge first: Mono retries anything that isn't a 2xx, and a slow sync shouldn't trigger that.
    res.status(200).json({ received: true });
    try {
      const event = String(req.body?.event ?? "");
      const data = req.body?.data ?? {};
      const providerAccountId = data?.account?.id ?? data?.account_id ?? data?.id;
      if (typeof providerAccountId !== "string") return;
      const conn = await storage.bankFeedRepo.getByProviderAccount(providerAccountId);
      if (!conn || conn.status === "disconnected") return;
      if (/unlink/i.test(event)) await storage.bankFeedRepo.setStatus(conn.id, "disconnected");
      else if (/reauth/i.test(event)) await storage.bankFeedRepo.setStatus(conn.id, "reauth_required");
      else if (/account_updated|transactions/i.test(event)) await syncConnection(conn);
    } catch (err) {
      console.error("Mono webhook processing failed:", err);
    }
  });
}
