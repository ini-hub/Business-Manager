import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { auditLogger } from "../audit";
import { getClientIp, broadcastChange } from "./helpers";
import { getStoreTimezone, toUtcStart, toUtcEnd } from "../lib/dateUtils";
import { PAYMENT_ACCOUNT_KINDS } from "@shared/schema";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { listBanks, resolveAccount } from "../lib/paystack";

export type RouteMiddlewares = {
  isAuthenticated: any;
  requireRole: (...roles: any[]) => any;
  requireManagerOrOwner: any;
  checkStoreAccess: (storeId: string, req: Request, res: Response) => Promise<boolean>;
};

const trimmed = (max: number) => z.string().trim().max(max);
const accountBody = z.object({
  label: trimmed(60).min(1),
  kind: z.enum(PAYMENT_ACCOUNT_KINDS).default("bank"),
  bankName: trimmed(80).optional().nullable(),
  bankCode: trimmed(20).optional().nullable(),
  accountNumber: trimmed(40).optional().nullable(),
  accountName: trimmed(100).optional().nullable(),
  isDefault: z.boolean().optional(),
  // Only sent after the lookup service itself was unreachable; the account then saves as unverified.
  allowUnverified: z.boolean().optional(),
});

// 503 carries a machine code so the form can offer "save unverified" instead of just showing text.
const lookupFailure = (status: number, message: string) =>
  status === 503 ? { error: "LOOKUP_UNAVAILABLE", message } : { error: message };

const NUBAN = /^\d{10}$/;

type Lookup =
  | { ok: true; accountName: string }
  | { ok: false; status: 422 | 503; error: string };

// A lookup that just succeeded is trusted for a few minutes, so saving doesn't depend on a second
// provider call (phone-number accounts like OPay/PalmPay often fail or rate-limit on the repeat).
const VERIFIED_TTL_MS = 10 * 60 * 1000;
const recentlyVerified = new Map<string, { accountName: string; at: number }>();
const verifiedKey = (userId: string | undefined, bankCode: string, accountNumber: string) => `${userId ?? ""}|${bankCode}|${accountNumber}`;
function rememberVerified(userId: string | undefined, bankCode: string, accountNumber: string, accountName: string) {
  const now = Date.now();
  recentlyVerified.forEach((v, k) => { if (now - v.at > VERIFIED_TTL_MS) recentlyVerified.delete(k); });
  recentlyVerified.set(verifiedKey(userId, bankCode, accountNumber), { accountName, at: now });
}
function recallVerified(userId: string | undefined, bankCode: string, accountNumber: string): string | null {
  const hit = recentlyVerified.get(verifiedKey(userId, bankCode, accountNumber));
  return hit && Date.now() - hit.at <= VERIFIED_TTL_MS ? hit.accountName : null;
}

/** Asks the bank who owns the account. 422 = the bank says no such account; 503 = we couldn't ask. */
async function lookupAccount(accountNumber: string, bankCode: string, userId?: string): Promise<Lookup> {
  if (!NUBAN.test(accountNumber)) return { ok: false, status: 422, error: "Account number must be 10 digits." };
  const remembered = recallVerified(userId, bankCode, accountNumber);
  if (remembered) return { ok: true, accountName: remembered };
  try {
    const { accountName } = await resolveAccount(accountNumber, bankCode);
    rememberVerified(userId, bankCode, accountNumber, accountName);
    return { ok: true, accountName };
  } catch (err: any) {
    // Only the provider's own "can't resolve" answer means the account doesn't exist; network failures,
    // missing keys, rate limits and provider outages mean we couldn't ask.
    const msg = String(err?.message ?? "");
    console.warn(`[PaymentAccounts] bank lookup failed for bank ${bankCode}: ${err?.name ?? "Error"}: ${msg}`);
    const notFound = /could not resolve|unable to resolve|invalid account|account number|not found|no record/i.test(msg)
      && !/rate|limit|too many|unavailable|timeout|key|configured/i.test(msg);
    const unreachable = !notFound;
    if (unreachable) return { ok: false, status: 503, error: "Couldn't reach the bank lookup service. You can save the account unverified." };
    // The provider's resolver doesn't cover every institution (phone-number accounts such as OPay, PalmPay,
    // Moniepoint and Kuda are often missing), so "not found" can't be a hard block: let the user confirm
    // the name themselves and save it unverified.
    return { ok: false, status: 503, error: "The bank lookup couldn't confirm this account. Phone-number accounts (OPay, PalmPay, Moniepoint, Kuda) are often not covered. If the number and bank are right, type the account name and save it unverified." };
  }
}

/**
 * For a bank account with a bank code, the account name comes from the bank, never from the client.
 * Returns the fields to store, or an error response to send.
 */
async function verifiedFields(
  d: { bankCode?: string | null; accountNumber?: string | null; accountName?: string | null; allowUnverified?: boolean },
  userId?: string,
): Promise<{ fields: { accountName?: string | null; accountVerifiedAt: Date | null } } | { status: number; error: string }> {
  if (!d.bankCode || !d.accountNumber) return { fields: { accountVerifiedAt: null } };
  const found = await lookupAccount(d.accountNumber, d.bankCode, userId);
  if (found.ok) return { fields: { accountName: found.accountName, accountVerifiedAt: new Date() } };
  if (found.status === 503 && d.allowUnverified && d.accountName) return { fields: { accountVerifiedAt: null } };
  return { status: found.status, error: found.error };
}

export function registerPaymentAccountRoutes(app: Express, { isAuthenticated, requireManagerOrOwner, checkStoreAccess }: RouteMiddlewares): void {
  // Each lookup is a billable-ish call to the provider, so keep a tight per-user ceiling.
  const resolveLimiter = rateLimit({
    windowMs: 60_000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: any) => {
      const userId = req.user?.userId ?? req.user?.id;
      return userId != null ? String(userId) : ipKeyGenerator(req.ip ?? "");
    },
    message: { error: "Too many account lookups. Please wait a moment." },
  });

  app.get("/api/sales/banks", isAuthenticated, requireManagerOrOwner, async (_req, res) => {
    try {
      res.json(await listBanks());
    } catch {
      res.status(503).json({ error: "Couldn't load the bank list." });
    }
  });

  app.post("/api/sales/payment-accounts/resolve", isAuthenticated, requireManagerOrOwner, resolveLimiter, async (req, res) => {
    const parsed = z.object({ accountNumber: z.string().trim(), bankCode: z.string().trim().min(1) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Bank and account number are required." });
    const found = await lookupAccount(parsed.data.accountNumber, parsed.data.bankCode, (req as any).user?.id);
    if (!found.ok) return res.status(found.status).json(lookupFailure(found.status, found.error));
    res.json({ accountName: found.accountName });
  });

  // Any staff member can read the active accounts (needed at checkout); managers also see inactive ones.
  app.get("/api/sales/payment-accounts", isAuthenticated, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) return res.status(400).json({ error: "Store ID is required." });
      if (!(await checkStoreAccess(storeId, req, res))) return;
      const role = (req as any).user?.role;
      const includeInactive = req.query.includeInactive === "true" && (role === "owner" || role === "manager");
      res.json(await storage.paymentAccountRepo.list(storeId, { includeInactive }));
    } catch {
      res.status(500).json({ error: "Could not fetch payment accounts." });
    }
  });

  app.post("/api/sales/payment-accounts", isAuthenticated, requireManagerOrOwner, async (req, res) => {
    try {
      const storeId = req.body?.storeId as string;
      if (!storeId) return res.status(400).json({ error: "Store ID is required." });
      if (!(await checkStoreAccess(storeId, req, res))) return;
      const parsed = accountBody.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid account." });
      const { allowUnverified, ...data } = parsed.data;
      if (data.kind === "bank") {
        const v = await verifiedFields({ ...data, allowUnverified }, (req as any).user?.id);
        if ("error" in v) return res.status(v.status).json(lookupFailure(v.status, v.error));
        Object.assign(data, v.fields);
      } else {
        data.bankCode = null;
      }
      const row = await storage.paymentAccountRepo.create({ ...data, storeId });
      auditLogger.log({ action: "PAYMENT_ACCOUNT_CREATE", resource: "payment_account", resourceId: row.id, userId: (req as any).user?.id, ip: getClientIp(req), status: "success", details: { storeId, label: row.label } });
      res.status(201).json(row);
    } catch {
      res.status(500).json({ error: "Could not create payment account." });
    }
  });

  app.patch("/api/sales/payment-accounts/:id", isAuthenticated, requireManagerOrOwner, async (req, res) => {
    try {
      const existing = await storage.paymentAccountRepo.get(req.params.id);
      if (!existing) return res.status(404).json({ error: "Payment account not found." });
      if (!(await checkStoreAccess(existing.storeId, req, res))) return;
      const parsed = accountBody.partial().extend({ isActive: z.boolean().optional() }).safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid account." });
      const { allowUnverified, ...data } = parsed.data;
      // Re-resolve whenever the number or bank changes, so the stored name can't drift from the account.
      const touchesBank = data.bankCode !== undefined || data.accountNumber !== undefined || data.accountName !== undefined;
      if (touchesBank && (data.kind ?? existing.kind) === "bank") {
        const v = await verifiedFields({
          bankCode: data.bankCode !== undefined ? data.bankCode : existing.bankCode,
          accountNumber: data.accountNumber !== undefined ? data.accountNumber : existing.accountNumber,
          accountName: data.accountName ?? existing.accountName,
          allowUnverified,
        }, (req as any).user?.id);
        if ("error" in v) return res.status(v.status).json(lookupFailure(v.status, v.error));
        Object.assign(data, v.fields);
      }
      const row = await storage.paymentAccountRepo.update(existing.id, existing.storeId, data);
      auditLogger.log({ action: "PAYMENT_ACCOUNT_UPDATE", resource: "payment_account", resourceId: existing.id, userId: (req as any).user?.id, ip: getClientIp(req), status: "success", details: data });
      res.json(row);
    } catch {
      res.status(500).json({ error: "Could not update payment account." });
    }
  });

  // Per-account reconciliation of transfer and payment-link money.
  app.get("/api/reports/payment-accounts", isAuthenticated, requireManagerOrOwner, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) return res.status(400).json({ error: "Store ID is required." });
      if (!(await checkStoreAccess(storeId, req, res))) return;
      const tz = await getStoreTimezone(storeId);
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;
      const start = startDate ? toUtcStart(startDate, tz) : new Date(Date.now() - 30 * 86400000);
      const end = endDate ? toUtcEnd(endDate, tz) : new Date();
      res.json(await storage.paymentAccountRepo.reconcile(storeId, start, end));
    } catch {
      res.status(500).json({ error: "Could not build the payment account report." });
    }
  });

  // VAT collected vs given back through returns, with bank cross-checks when an account is linked.
  app.get("/api/reports/tax-returns", isAuthenticated, requireManagerOrOwner, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) return res.status(400).json({ error: "Store ID is required." });
      if (!(await checkStoreAccess(storeId, req, res))) return;
      const tz = await getStoreTimezone(storeId);
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;
      const start = startDate ? toUtcStart(startDate, tz) : new Date(Date.now() - 30 * 86400000);
      const end = endDate ? toUtcEnd(endDate, tz) : new Date();
      res.json(await storage.bankFeedRepo.taxReturnsSummary(storeId, start, end));
    } catch {
      res.status(500).json({ error: "Could not build the tax and returns report." });
    }
  });

  // Receipt legs, so receipts and transaction details can show account + confirmation state.
  app.get("/api/sales/receipts/:receiptNumber/payment-legs", isAuthenticated, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) return res.status(400).json({ error: "Store ID is required." });
      if (!(await checkStoreAccess(storeId, req, res))) return;
      res.json(await storage.paymentAccountRepo.getLegsForReceipt(storeId, req.params.receiptNumber));
    } catch {
      res.status(500).json({ error: "Could not fetch payment details." });
    }
  });

  // Mark pending transfers as having landed (cashier or manager checked the bank/POS).
  app.post("/api/sales/payment-legs/confirm", isAuthenticated, requireManagerOrOwner, async (req, res) => {
    try {
      const body = z.object({ storeId: z.string(), legIds: z.array(z.string()).min(1).max(200) }).parse(req.body);
      if (!(await checkStoreAccess(body.storeId, req, res))) return;
      const userId = (req as any).user?.id;
      const count = await storage.paymentAccountRepo.confirmLegs(body.storeId, body.legIds, userId);
      auditLogger.log({ action: "PAYMENT_LEG_CONFIRM", resource: "payment_leg", resourceId: body.legIds[0], userId, ip: getClientIp(req), status: "success", details: { count, legIds: body.legIds } });
      broadcastChange(req, "sales", body.storeId, "updated");
      res.json({ confirmed: count });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: "Invalid request." });
      res.status(500).json({ error: "Could not confirm payments." });
    }
  });
}
