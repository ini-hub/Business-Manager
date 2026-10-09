import type { Express, Request, Response } from "express";
import { z } from "zod";
import { createPartnerTransferSchema, receiveShortfallSchema, settlementTypeEnum, settlementMethodEnum } from "@shared/schema";
import { storage } from "../storage";
import { auditLogger } from "../audit";
import { broadcastDataChange } from "../websocket";
import { PartnerRepository } from "../repositories/PartnerRepository";
import { PartnerTransferRepository, type PartnerCtx } from "../repositories/PartnerTransferRepository";
import { PartnerRuleError } from "../lib/partnerTransfer";
import { staffDetailWithoutMoneyEvents, staffListRow } from "../lib/partnerStaffView";
import { engagementFor, getReputation, onBalanceSettled, onPartnershipActivated, onTransferReceived } from "../services/PartnerEngagementService";
import { sendPartnerInviteEmail } from "../email";
import { getUserId, getClientIp } from "./helpers";
import type { RouteMiddlewares } from "./sales.routes";
import { requirePermission } from "../lib/permissionGate";

const partnerRepo = new PartnerRepository();
const transferRepo = new PartnerTransferRepository();

const ctxOf = (req: Request): PartnerCtx => ({ orgId: (req as any).user?.businessId, userId: getUserId(req) ?? null });

const isStaff = (req: Request) => (req as any).user?.role === "staff";

/** Rule violations are the caller's to fix (400); anything else is ours (500) and is not echoed. */
function fail(res: Response, err: unknown, fallback: string) {
  if (err instanceof PartnerRuleError) return res.status(400).json({ error: err.message });
  if (err instanceof z.ZodError) return res.status(400).json({ error: err.issues[0]?.message ?? "Check the details and try again." });
  console.error(`[partners] ${fallback}`, err);
  return res.status(500).json({ error: fallback });
}

export function registerPartnerRoutes(app: Express, { isAuthenticated, requireManagerOrOwner, checkStoreAccess }: RouteMiddlewares): void {
  /**
   * Tell the other business: staff of the affected store get a notification naming who it is from,
   * and open screens refresh. Awards are best-effort and never block the action that earned them.
   */
  async function tellCounterparty(t: { fromOrgId: string; toOrgId: string; fromStoreId: string; toStoreId: string }, me: string, message: string) {
    const [otherOrg, otherStore] = me === t.fromOrgId ? [t.toOrgId, t.toStoreId] : [t.fromOrgId, t.fromStoreId];
    try {
      const myName = await partnerRepo.orgName(me);
      await storage.notifyAllStaff(otherStore, "partner_transfer", `${myName} ${message}`);
    } catch (err) {
      console.error("[partners] notify failed", err);
    }
    broadcastDataChange(otherOrg, "partner-transfer", otherStore, "mutated");
  }

  const bestEffort = (label: string, fn: () => Promise<unknown>) => fn().catch((e) => console.error(`[partners] ${label} failed`, e));

  const refresh = (req: Request, t: { fromStoreId: string; toStoreId: string }) => {
    const org = (req as any).user?.businessId;
    if (org) {
      broadcastDataChange(org, "partner-transfer", t.fromStoreId, "mutated");
      broadcastDataChange(org, "partner-transfer", t.toStoreId, "mutated");
    }
  };

  const audit = (req: Request, action: string, resourceId: string, details?: Record<string, unknown>) =>
    auditLogger.log({ action, resource: "partner_transfer", resourceId, userId: getUserId(req), ip: getClientIp(req), status: "success", details });

  // ───────────── partnerships ─────────────

  app.get("/api/partners", requirePermission("/partners"), async (req, res) => {
    try {
      const { orgId } = ctxOf(req);
      const [code, partnerships] = await Promise.all([partnerRepo.ensurePartnerCode(orgId), partnerRepo.list(orgId)]);
      // A partner's track record is shown only for active partners; everyone else has none worth showing.
      const withStanding = await Promise.all(partnerships.map(async (p) => (
        p.status === "active" ? { ...p, reputation: await getReputation(p.partner.id) } : p
      )));
      res.json({ code, partnerships: withStanding });
    } catch (err) { fail(res, err, "Could not load partners."); }
  });

  app.get("/api/partners/engagement", requirePermission("/partners"), async (req, res) => {
    try {
      res.json(await engagementFor(ctxOf(req).orgId));
    } catch (err) { fail(res, err, "Could not load your partner standing."); }
  });

  app.post("/api/partners/invite", requirePermission("/partners"), async (req, res) => {
    try {
      const b = z.object({ email: z.string().trim().min(3).max(200), note: z.string().trim().max(300).nullable().optional() }).parse(req.body);
      const ctx = ctxOf(req);
      const { email } = await partnerRepo.recordInvite(ctx.orgId, ctx.userId, b.email);
      const [code, businessName] = await Promise.all([partnerRepo.ensurePartnerCode(ctx.orgId), partnerRepo.orgName(ctx.orgId)]);
      const me = (req as any).user;
      sendPartnerInviteEmail(email, { fromBusiness: businessName, fromName: me?.name ?? null, code, note: b.note ?? null });
      res.status(201).json({ invited: email });
    } catch (err) { fail(res, err, "Could not send the invitation."); }
  });

  // The items this store has chosen to share with partners.
  app.get("/api/partners/shared-items", requirePermission("/partners"), async (req, res) => {
    try {
      const storeId = z.string().min(1).parse(req.query.storeId);
      if (!(await checkStoreAccess(storeId, req, res))) return;
      res.json({ inventoryIds: await partnerRepo.getSharedItemIds(storeId) });
    } catch (err) { fail(res, err, "Could not load shared items."); }
  });

  app.put("/api/partners/shared-items", requirePermission("/partners"), async (req, res) => {
    try {
      const b = z.object({ storeId: z.string().min(1), inventoryIds: z.array(z.string()).max(2000) }).parse(req.body);
      if (!(await checkStoreAccess(b.storeId, req, res))) return;
      const count = await partnerRepo.setSharedItems(b.storeId, b.inventoryIds);
      audit(req, "PARTNER_SHARED_ITEMS_SET", b.storeId, { count });
      res.json({ shared: count });
    } catch (err) { fail(res, err, "Could not save shared items."); }
  });

  app.post("/api/partners/request", requirePermission("/partners"), async (req, res) => {
    try {
      const { code } = z.object({ code: z.string().min(1, "Enter a partner code.") }).parse(req.body);
      const ctx = ctxOf(req);
      const row = await partnerRepo.request(ctx.orgId, ctx.userId, code);
      const other = row.requesterOrgId === ctx.orgId ? row.addresseeOrgId : row.requesterOrgId;
      broadcastDataChange(other, "partner", undefined, "mutated");
      broadcastDataChange(ctx.orgId, "partner", undefined, "mutated");
      if (row.status === "active") void bestEffort("partnership award", () => onPartnershipActivated(row.id));
      res.status(201).json(row);
    } catch (err) { fail(res, err, "Could not send the partner request."); }
  });

  app.post("/api/partners/:id/respond", requirePermission("/partners"), async (req, res) => {
    try {
      const { accept } = z.object({ accept: z.boolean() }).parse(req.body);
      const ctx = ctxOf(req);
      const row = await partnerRepo.respond(req.params.id, ctx.orgId, ctx.userId, accept);
      broadcastDataChange(row.requesterOrgId, "partner", undefined, "mutated");
      broadcastDataChange(row.addresseeOrgId, "partner", undefined, "mutated");
      if (row.status === "active") void bestEffort("partnership award", () => onPartnershipActivated(row.id));
      res.json(row);
    } catch (err) { fail(res, err, "Could not answer the request."); }
  });

  app.post("/api/partners/:id/revoke", requirePermission("/partners"), async (req, res) => {
    try {
      const row = await partnerRepo.revoke(req.params.id, ctxOf(req).orgId);
      broadcastDataChange(row.requesterOrgId, "partner", undefined, "mutated");
      broadcastDataChange(row.addresseeOrgId, "partner", undefined, "mutated");
      res.json(row);
    } catch (err) { fail(res, err, "Could not end the partnership."); }
  });

  app.put("/api/partners/:id/credit-limit", requirePermission("/partners"), async (req, res) => {
    try {
      const { limit } = z.object({ limit: z.number().min(0).nullable() }).parse(req.body);
      const row = await partnerRepo.setTradeCreditLimit(req.params.id, ctxOf(req).orgId, limit);
      broadcastDataChange(row.requesterOrgId, "partner", undefined, "mutated");
      broadcastDataChange(row.addresseeOrgId, "partner", undefined, "mutated");
      res.json(row);
    } catch (err) { fail(res, err, "Could not save the credit limit."); }
  });

  app.get("/api/partners/:orgId/catalog", requirePermission("/partners"), async (req, res) => {
    try {
      const storeId = z.string().min(1).parse(req.query.storeId);
      res.json(await partnerRepo.listSharedCatalog(ctxOf(req).orgId, req.params.orgId, storeId));
    } catch (err) { fail(res, err, "Could not load the partner's shared items."); }
  });

  app.get("/api/partners/:orgId/stores", requirePermission("/partners"), async (req, res) => {
    try {
      res.json(await partnerRepo.listPartnerStores(ctxOf(req).orgId, req.params.orgId));
    } catch (err) { fail(res, err, "Could not load partner stores."); }
  });

  // ───────────── transfers ─────────────

  // Store staff may look at what is coming and going at their own store, without prices or balances.
  // Managers and owners see the whole business.
  app.get("/api/partner-transfers", isAuthenticated, async (req, res) => {
    try {
      const storeId = typeof req.query.storeId === "string" ? req.query.storeId : undefined;
      if (isStaff(req) && !storeId) return res.status(400).json({ error: "Choose a store." });
      if (storeId && !(await checkStoreAccess(storeId, req, res))) return;
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const rows = await transferRepo.list(ctxOf(req).orgId, { storeId, status });
      res.json(isStaff(req) ? rows.map(staffListRow) : rows);
    } catch (err) { fail(res, err, "Could not load partner transfers."); }
  });

  app.get("/api/partner-transfers/:id", isAuthenticated, async (req, res) => {
    try {
      const t = await transferRepo.get(ctxOf(req).orgId, req.params.id);
      if (!t) return res.status(404).json({ error: "Transfer not found." });
      if (isStaff(req)) {
        // Staff are tied to one store, so they only see transfers that touch it.
        const ownStore = t.side === "sender" ? t.fromStoreId : t.toStoreId;
        if (!(await checkStoreAccess(ownStore, req, res))) return;
        return res.json(staffDetailWithoutMoneyEvents(t));
      }
      res.json(t);
    } catch (err) { fail(res, err, "Could not load the transfer."); }
  });

  app.post("/api/partner-transfers", requirePermission("/partners"), async (req, res) => {
    try {
      const input = createPartnerTransferSchema.parse(req.body);
      // The caller acts for the store that opens the transfer: the sender when sending, the receiver when requesting.
      const ownStore = input.kind === "request" ? input.toStoreId : input.fromStoreId;
      if (!(await checkStoreAccess(ownStore, req, res))) return;
      const ctx = ctxOf(req);
      const created = await transferRepo.create(ctx, input);
      audit(req, input.kind === "request" ? "PARTNER_TRANSFER_REQUEST" : "PARTNER_TRANSFER_CREATE", created.id, { partnerOrgId: input.partnerOrgId, settlementType: created.settlementType, itemCount: input.items.length });
      refresh(req, created);
      const mine = await storage.getStore(ownStore);
      await tellCounterparty(created, ctx.orgId, input.kind === "request"
        ? `(${mine?.name ?? "a branch"}) is asking you for stock. Review it under Partners.`
        : `(${mine?.name ?? "a branch"}) wants to send you stock. Review it under Partners.`);
      res.status(201).json(created);
    } catch (err) { fail(res, err, "Could not create the transfer."); }
  });

  /**
   * Loads a transfer for an action and checks the caller can act for their own store on it.
   * Which side may take which step is the repository's rule; this only proves the caller
   * belongs to the store they are acting from. Returns null after responding when they may not proceed.
   */
  async function actor(req: Request, res: Response, needsActivePartnership = false) {
    const ctx = ctxOf(req);
    const t = await transferRepo.get(ctx.orgId, req.params.id);
    if (!t) { res.status(404).json({ error: "Transfer not found." }); return null; }
    if (!(await checkStoreAccess(t.side === "sender" ? t.fromStoreId : t.toStoreId, req, res))) return null;
    if (needsActivePartnership && !(await partnerRepo.getActiveBetween(t.fromOrgId, t.toOrgId))) {
      res.status(400).json({ error: "You are no longer partners with this business, so this step cannot go ahead." });
      return null;
    }
    return { ctx, t };
  }

  const stepRoute = (
    path: string, needsActive: boolean, event: string, message: string,
    run: (a: { ctx: PartnerCtx; req: Request }) => Promise<{ fromStoreId: string; toStoreId: string; fromOrgId: string; toOrgId: string; id: string; status: string }>,
    opts: { staffOk?: boolean } = {},
  ) => app.post(`/api/partner-transfers/:id/${path}`, opts.staffOk ? isAuthenticated : requirePermission("/partners"), async (req, res) => {
    try {
      const a = await actor(req, res, needsActive);
      if (!a) return;
      const updated = await run({ ctx: a.ctx, req });
      audit(req, event, updated.id);
      refresh(req, updated);
      await tellCounterparty(updated, a.ctx.orgId, message);
      // A transfer row carries its value; staff get back only that it worked.
      res.json(isStaff(req) ? { id: updated.id, status: updated.status } : updated);
    } catch (err) { fail(res, err, "Could not update the transfer."); }
  });

  const acceptBody = z.object({
    mapping: z.record(z.string().nullable()).optional(),
    lines: z.record(z.object({
      inventoryId: z.string().nullable().optional(),
      quantity: z.number().min(0).optional(),
      agreedUnitPrice: z.number().min(0).nullable().optional(),
    })).optional(),
  });

  stepRoute("accept", true, "PARTNER_TRANSFER_ACCEPT", "accepted the transfer.",
    ({ ctx, req }) => transferRepo.accept(ctx, req.params.id, acceptBody.parse(req.body ?? {})));
  stepRoute("reject", false, "PARTNER_TRANSFER_REJECT", "declined the transfer.",
    ({ ctx, req }) => transferRepo.reject(ctx, req.params.id, z.object({ reason: z.string().trim().max(500).optional() }).parse(req.body ?? {}).reason ?? null));
  stepRoute("cancel", false, "PARTNER_TRANSFER_CANCEL", "cancelled the transfer.",
    ({ ctx, req }) => transferRepo.cancel(ctx, req.params.id));
  stepRoute("ship", true, "PARTNER_TRANSFER_SHIP", "has shipped your stock. Confirm it when it arrives.",
    ({ ctx, req }) => transferRepo.ship(ctx, req.params.id));
  stepRoute("receive", false, "PARTNER_TRANSFER_RECEIVE", "confirmed receiving the stock.",
    async ({ ctx, req }) => {
      const b = z.object({ confirmed: z.record(z.number().min(0)).optional(), shortfalls: receiveShortfallSchema.optional() }).parse(req.body ?? {});
      const done = await transferRepo.receive(ctx, req.params.id, b.confirmed, b.shortfalls);
      void bestEffort("transfer award", () => onTransferReceived(done));
      return done;
    }, { staffOk: true });
  stepRoute("resolve", false, "PARTNER_TRANSFER_RESOLVE", "settled the shortfall on the transfer.",
    ({ ctx, req }) => transferRepo.resolveDispute(ctx, req.params.id, z.object({ returnToStock: z.boolean() }).parse(req.body).returnToStock));
  stepRoute("close", false, "PARTNER_TRANSFER_CLOSE", "closed the transfer.",
    ({ ctx, req }) => transferRepo.close(ctx, req.params.id));
  stepRoute("settlement", false, "PARTNER_TRANSFER_TERMS", "set or proposed how a transfer will be settled. Review it.",
    ({ ctx, req }) => {
      const b = z.object({ type: z.enum(settlementTypeEnum), dueDate: z.coerce.date().nullable().optional() }).parse(req.body);
      return transferRepo.proposeSettlement(ctx, req.params.id, b.type, b.dueDate ?? null);
    });
  stepRoute("settlement/respond", false, "PARTNER_TRANSFER_TERMS_ANSWER", "answered your settlement proposal.",
    ({ ctx, req }) => transferRepo.respondSettlement(ctx, req.params.id, z.object({ accept: z.boolean() }).parse(req.body).accept));

  // ───────────── ledger ─────────────

  app.get("/api/partner-ledger", requirePermission("/partners"), async (req, res) => {
    try {
      res.json(await transferRepo.ledger(ctxOf(req).orgId));
    } catch (err) { fail(res, err, "Could not load the partner ledger."); }
  });

  async function notifyOrgOfObligation(req: Request, obligationTransferId: string, message: string) {
    const ctx = ctxOf(req);
    const t = await transferRepo.get(ctx.orgId, obligationTransferId);
    if (!t) return;
    refresh(req, t);
    await tellCounterparty(t, ctx.orgId, message);
  }

  app.post("/api/partner-ledger/obligations/:id/settlements", requirePermission("/partners"), async (req, res) => {
    try {
      const b = z.object({
        amount: z.number().positive().optional(),
        method: z.enum(settlementMethodEnum),
        reference: z.string().trim().max(200).nullable().optional(),
        notes: z.string().trim().max(500).nullable().optional(),
        returnTransferId: z.string().nullable().optional(),
      }).parse(req.body);
      const row = await transferRepo.recordSettlement(ctxOf(req), req.params.id, b);
      audit(req, "PARTNER_SETTLEMENT_RECORD", row.id, { amount: row.amount, method: row.method });
      void bestEffort("settlement award", () => onBalanceSettled(row.obligationId));
      const ob = (await transferRepo.ledger(ctxOf(req).orgId)).obligations.find((o) => o.id === row.obligationId);
      if (ob) await notifyOrgOfObligation(req, ob.transferId, row.status === "pending" ? "says they paid. Confirm it in the partner ledger." : "recorded a payment.");
      res.status(201).json(row);
    } catch (err) { fail(res, err, "Could not record the payment."); }
  });

  app.post("/api/partner-ledger/settlements/:id/answer", requirePermission("/partners"), async (req, res) => {
    try {
      const { accept } = z.object({ accept: z.boolean() }).parse(req.body);
      const row = await transferRepo.answerSettlement(ctxOf(req), req.params.id, accept);
      audit(req, accept ? "PARTNER_SETTLEMENT_CONFIRM" : "PARTNER_SETTLEMENT_REJECT", row.id);
      if (accept) void bestEffort("settlement award", () => onBalanceSettled(row.obligationId));
      const ob = (await transferRepo.ledger(ctxOf(req).orgId)).obligations.find((o) => o.id === row.obligationId);
      if (ob) await notifyOrgOfObligation(req, ob.transferId, accept ? "confirmed your payment." : "did not accept your payment record. Check the ledger.");
      res.json(row);
    } catch (err) { fail(res, err, "Could not answer the payment."); }
  });

  app.post("/api/partner-ledger/obligations/:id/waive", requirePermission("/partners"), async (req, res) => {
    try {
      const row = await transferRepo.waive(ctxOf(req), req.params.id);
      audit(req, "PARTNER_BALANCE_WAIVE", row.id);
      await notifyOrgOfObligation(req, row.transferId, "waived what you owed on a transfer.");
      res.json(row);
    } catch (err) { fail(res, err, "Could not waive the balance."); }
  });
}
