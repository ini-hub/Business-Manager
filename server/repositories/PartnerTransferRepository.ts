import { db } from "../db";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import {
  businessPartnerships,
  organisations,
  stores,
  inventory,
  products,
  inventoryRestockEvents,
  profitLoss,
  partnerTransfers,
  partnerTransferItems,
  partnerTransferEvents,
  partnerObligations,
  partnerSettlements,
  type CreatePartnerTransfer,
  type PartnerTransfer,
  type PartnerTransferItem,
  type PartnerObligation,
  type PartnerSettlement,
  type SettlementType,
  type PartnerTransferStatus,
  type ShortfallReason,
} from "@shared/schema";
import {
  PartnerRuleError,
  nextStatus,
  awaiting,
  sideOf,
  lineUnitPrice,
  transferValue,
  receiveOutcome,
  planObligation,
  obligationStatus,
  maxSettleable,
  partnerBalance,
  unreconciledQty,
  type PartnerSide,
  type PartnerKind,
} from "../lib/partnerTransfer";
import { recordStockMovements } from "../lib/stockLedger";

export interface PartnerCtx {
  orgId: string;
  userId: string | null;
}

// A drizzle transaction handle; the repository only ever uses it through the query builder.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const REASON = "Partner Transfer";
const POST_SHIP: PartnerTransferStatus[] = ["shipped", "received", "disputed", "closed"];
const money = (n: number) => Math.round(n * 100) / 100;

async function logEvent(tx: Tx, transferId: string, ctx: PartnerCtx, event: string, detail?: Record<string, unknown>) {
  await tx.insert(partnerTransferEvents).values({ transferId, orgId: ctx.orgId, userId: ctx.userId, event, detail: detail ?? null });
}

async function lockTransfer(tx: Tx, id: string, ctx: PartnerCtx): Promise<{ transfer: PartnerTransfer; side: PartnerSide }> {
  const [transfer] = await tx.select().from(partnerTransfers).where(eq(partnerTransfers.id, id)).for("update");
  const side = transfer ? sideOf(ctx.orgId, transfer) : null;
  // A stranger gets the same answer as a missing row, so ids cannot be probed.
  if (!transfer || !side) throw new PartnerRuleError("Transfer not found.");
  return { transfer, side };
}

async function adjustStock(tx: Tx, args: {
  storeId: string; inventoryId: string; userId: string | null; delta: number; notes: string; transferId: string;
  receipt?: { unitCost: number };
  /** An item created by this very receipt starts life with this stock, so its first ledger row is its opening balance. */
  opening?: boolean;
}) {
  const [inv] = await tx.select().from(inventory).where(eq(inventory.id, args.inventoryId)).for("update");
  if (!inv) throw new PartnerRuleError("An item in this transfer no longer exists.");
  const prev = inv.quantity;
  const next = Math.round((prev + args.delta) * 10_000) / 10_000;
  if (next < 0) throw new PartnerRuleError(`Not enough "${inv.name}" in stock. Available: ${prev}.`);

  // Incoming partner stock is costed at what it was priced at, averaged with what is on the shelf.
  // A plain overwrite would silently re-cost units the receiver already owns.
  let newCost = inv.costPrice;
  if (args.receipt && next > 0) newCost = money((prev * inv.costPrice + args.delta * args.receipt.unitCost) / next);

  await tx.update(inventory).set({ quantity: next, costPrice: newCost }).where(eq(inventory.id, inv.id));
  await recordStockMovements(tx, [{
    storeId: args.storeId,
    inventoryId: inv.id,
    reason: args.opening ? "opening_balance" : args.delta < 0 ? "partner_transfer_out" : "partner_transfer_in",
    before: prev,
    after: next,
    refType: "partner_transfer",
    refId: args.transferId,
    actorUserId: args.userId,
    note: args.notes,
  }]);
  await tx.insert(inventoryRestockEvents).values({
    storeId: args.storeId,
    inventoryId: inv.id,
    userId: args.userId,
    quantityAdded: args.delta,
    previousQuantity: prev,
    newQuantity: next,
    unitCost: args.receipt?.unitCost ?? inv.costPrice,
    previousCostPrice: inv.costPrice,
    newCostPrice: newCost,
    previousSellingPrice: inv.sellingPrice,
    newSellingPrice: inv.sellingPrice,
    costStrategy: args.receipt ? "weighted" : "keep",
    notes: args.notes,
    reason: REASON,
  });

  const [pl] = await tx.select().from(profitLoss).where(and(eq(profitLoss.inventoryId, inv.id), eq(profitLoss.storeId, args.storeId)));
  if (pl) await tx.update(profitLoss).set({ quantityRemaining: next }).where(eq(profitLoss.id, pl.id));
  else await tx.insert(profitLoss).values({ storeId: args.storeId, inventoryId: inv.id, quantityRemaining: next });
}

export class PartnerTransferRepository {
  // ───────────────────────── create ─────────────────────────

  /** Sender-side stock check shared by a send (at offer time) and a request (when the supplier accepts). */
  private checkSendable(inv: { name: string; type: string; isDeleted: boolean; allowFractional: boolean; quantity: number } | undefined, quantity: number) {
    if (!inv || inv.isDeleted) throw new PartnerRuleError("One of the items is not in the sending store.");
    if (inv.type !== "product") throw new PartnerRuleError(`"${inv.name}" is a ${inv.type}; only products can be sent to partners.`);
    if (!inv.allowFractional && !Number.isInteger(quantity)) throw new PartnerRuleError(`"${inv.name}" cannot be sent in fractions.`);
    if (inv.quantity < quantity) throw new PartnerRuleError(`Not enough "${inv.name}" in stock. Available: ${inv.quantity}.`);
  }

  /** The limit caps what the debtor may owe the creditor at once, counting the transfer being agreed. */
  private async assertCreditRoom(partnershipId: string, creditorOrgId: string, debtorOrgId: string, value: number, who: "you" | "them") {
    const [p] = await db.select({ limit: businessPartnerships.tradeCreditLimit }).from(businessPartnerships).where(eq(businessPartnerships.id, partnershipId));
    if (p?.limit == null) return;
    const [row] = await db.select({
      open: sql<number>`coalesce(sum(${partnerObligations.amountDue} - ${partnerObligations.amountSettled}), 0)::float8`,
    }).from(partnerObligations).where(and(
      eq(partnerObligations.creditorOrgId, creditorOrgId),
      eq(partnerObligations.debtorOrgId, debtorOrgId),
      eq(partnerObligations.status, "open"),
    ));
    if (money((row?.open ?? 0) + value) > p.limit) {
      throw new PartnerRuleError(who === "you"
        ? `This would take what you owe past the agreed credit limit of ${p.limit}.`
        : `This would take what they owe you past the agreed credit limit of ${p.limit}.`);
    }
  }

  async create(ctx: PartnerCtx, input: CreatePartnerTransfer): Promise<PartnerTransfer> {
    if (input.fromStoreId === input.toStoreId) throw new PartnerRuleError("Choose a different store.");
    const isRequest = input.kind === "request";

    // A request is made by the receiver, so the caller's own side flips. Keys are namespaced by the
    // requester: the unique index is per sender, and one business must never be able to look up
    // another's transfer by guessing a key.
    const storedKey = input.idempotencyKey ? (isRequest ? `req:${ctx.orgId}:${input.idempotencyKey}` : input.idempotencyKey) : null;
    if (storedKey) {
      const [existing] = await db.select().from(partnerTransfers).where(and(
        eq(partnerTransfers.idempotencyKey, storedKey),
        isRequest ? eq(partnerTransfers.toOrgId, ctx.orgId) : eq(partnerTransfers.fromOrgId, ctx.orgId),
      ));
      if (existing) return existing;
    }

    const [fromStore] = await db.select().from(stores).where(eq(stores.id, input.fromStoreId));
    const [toStore] = await db.select().from(stores).where(eq(stores.id, input.toStoreId));
    const fromOrgId = isRequest ? input.partnerOrgId : ctx.orgId;
    const toOrgId = isRequest ? ctx.orgId : input.partnerOrgId;
    if (!fromStore || fromStore.businessId !== fromOrgId || !fromStore.isActive) {
      throw new PartnerRuleError(isRequest ? "That store cannot supply partner requests." : "You can only send from your own store.");
    }
    if (!toStore || toStore.businessId !== toOrgId || !toStore.isActive) {
      throw new PartnerRuleError(isRequest ? "You can only request stock for your own store." : "That store cannot receive partner transfers.");
    }
    if (!isRequest && !toStore.acceptsPartnerTransfers) throw new PartnerRuleError("That store cannot receive partner transfers.");

    const [partnership] = await db.select().from(businessPartnerships).where(and(
      eq(businessPartnerships.status, "active"),
      or(
        and(eq(businessPartnerships.requesterOrgId, ctx.orgId), eq(businessPartnerships.addresseeOrgId, input.partnerOrgId)),
        and(eq(businessPartnerships.requesterOrgId, input.partnerOrgId), eq(businessPartnerships.addresseeOrgId, ctx.orgId)),
      ),
    ));
    if (!partnership) throw new PartnerRuleError("You are not partners with that business.");

    type Line = {
      fromInventoryId: string | null; toInventoryId: string | null; name: string; sku: string | null; barcode: string | null;
      unit: string | null; quantity: number; unitCostSnapshot: number; agreedUnitPrice: number | null;
    };
    let lines: Line[];

    if (!isRequest) {
      const ids = input.items.map((i) => i.fromInventoryId!);
      if (new Set(ids).size !== ids.length) throw new PartnerRuleError("Each item can only appear once in a transfer.");
      const invRows = await db.select().from(inventory).where(and(eq(inventory.storeId, input.fromStoreId), inArray(inventory.id, ids)));
      const byId = new Map(invRows.map((r) => [r.id, r]));
      lines = input.items.map((i) => {
        const inv = byId.get(i.fromInventoryId!);
        this.checkSendable(inv, i.quantity);
        return {
          fromInventoryId: inv!.id, toInventoryId: null, name: inv!.name, sku: inv!.sku, barcode: inv!.barcode, unit: inv!.unit,
          quantity: i.quantity, unitCostSnapshot: inv!.costPrice, agreedUnitPrice: i.agreedUnitPrice ?? null,
        };
      });
      const total = transferValue(lines, "offered");
      if (input.settlementType !== "none") await this.assertCreditRoom(partnership.id, ctx.orgId, input.partnerOrgId, total, "them");
    } else {
      // The requester cannot see the supplier's stock, so a line is either one of their own items
      // (which gives the supplier a precise name and sku to match) or free text.
      const ownIds = input.items.map((i) => i.toInventoryId).filter((x): x is string => !!x);
      if (new Set(ownIds).size !== ownIds.length) throw new PartnerRuleError("Each item can only appear once in a request.");
      const own = ownIds.length ? await db.select().from(inventory).where(and(eq(inventory.storeId, input.toStoreId), inArray(inventory.id, ownIds))) : [];
      const ownById = new Map(own.map((r) => [r.id, r]));
      // A supplier item may only be named directly if the supplier chose to share it with partners.
      const supplierIds = input.items.map((i) => i.fromInventoryId).filter((x): x is string => !!x);
      if (new Set(supplierIds).size !== supplierIds.length) throw new PartnerRuleError("Each item can only appear once in a request.");
      const shared = supplierIds.length
        ? await db.select().from(inventory).where(and(eq(inventory.storeId, input.fromStoreId), inArray(inventory.id, supplierIds), eq(inventory.sharedWithPartners, true), eq(inventory.type, "product"), eq(inventory.isDeleted, false)))
        : [];
      const sharedById = new Map(shared.map((r) => [r.id, r]));
      lines = input.items.map((i) => {
        const theirs = i.fromInventoryId ? sharedById.get(i.fromInventoryId) : undefined;
        if (i.fromInventoryId && !theirs) throw new PartnerRuleError("That item is not shared with partners.");
        const mine = i.toInventoryId ? ownById.get(i.toInventoryId) : undefined;
        if (i.toInventoryId && (!mine || mine.isDeleted || mine.type !== "product")) throw new PartnerRuleError("One of the items is not a product in your store.");
        const name = (theirs?.name ?? mine?.name ?? i.name ?? "").trim();
        if (!name) throw new PartnerRuleError("Name the item you need.");
        const fractional = (theirs ?? mine)?.allowFractional;
        if ((theirs ?? mine) && !fractional && !Number.isInteger(i.quantity)) throw new PartnerRuleError(`"${name}" cannot be requested in fractions.`);
        // The supplier's cost is never copied here; it is snapshotted only when they accept.
        return {
          fromInventoryId: theirs?.id ?? null, toInventoryId: mine?.id ?? null, name, sku: theirs?.sku ?? mine?.sku ?? null,
          barcode: theirs?.barcode ?? mine?.barcode ?? null, unit: theirs?.unit ?? mine?.unit ?? null, quantity: i.quantity,
          unitCostSnapshot: 0, agreedUnitPrice: i.agreedUnitPrice ?? null,
        };
      });
    }

    const agreedTotal = transferValue(lines, "offered");

    return db.transaction(async (tx) => {
      const [transfer] = await tx.insert(partnerTransfers).values({
        partnershipId: partnership.id,
        fromOrgId,
        toOrgId,
        fromStoreId: input.fromStoreId,
        toStoreId: input.toStoreId,
        kind: input.kind,
        status: isRequest ? "requested" : "offered",
        settlementType: input.settlementType,
        agreedTotal,
        dueDate: input.settlementType === "none" ? null : (input.dueDate ?? null),
        notes: input.notes ?? null,
        idempotencyKey: storedKey,
        createdByUserId: ctx.userId,
      }).returning();

      await tx.insert(partnerTransferItems).values(lines.map((l) => ({ transferId: transfer.id, ...l })));
      await logEvent(tx, transfer.id, ctx, isRequest ? "requested" : "offered", { settlementType: input.settlementType, agreedTotal, itemCount: lines.length });
      return transfer;
    });
  }

  // ───────────────────────── lifecycle ─────────────────────────

  /**
   * Answering the opening move. For a send the receiver accepts, mapping each line onto one of
   * their own items (or null to create it on receipt). For a request the supplier accepts, mapping
   * each requested line onto one of theirs, and may cut quantities or drop a line (quantity 0) but
   * never ask for more than was requested. A price the requester already set is not the supplier's
   * to change; only a blank one can be filled in.
   */
  async accept(ctx: PartnerCtx, id: string, input: {
    mapping?: Record<string, string | null>;
    lines?: Record<string, { inventoryId?: string | null; quantity?: number; agreedUnitPrice?: number | null }>;
  } = {}): Promise<PartnerTransfer> {
    return db.transaction(async (tx) => {
      const { transfer, side } = await lockTransfer(tx, id, ctx);
      const kind = transfer.kind as PartnerKind;
      const status = nextStatus("accept", transfer.status as PartnerTransferStatus, side, kind);
      const items = await tx.select().from(partnerTransferItems).where(eq(partnerTransferItems.transferId, id));
      const detail: Record<string, unknown> = {};

      if (kind === "send") {
        const mapping = input.mapping ?? {};
        const mine = await tx.select().from(inventory).where(and(eq(inventory.storeId, transfer.toStoreId), eq(inventory.type, "product"), eq(inventory.isDeleted, false)));
        const mineById = new Map(mine.map((m) => [m.id, m]));
        const claimed = new Set<string>();

        for (const item of items) {
          let target: string | null;
          if (Object.prototype.hasOwnProperty.call(mapping, item.id)) {
            target = mapping[item.id];
            if (target && !mineById.has(target)) throw new PartnerRuleError(`"${item.name}" was matched to an item that is not in your store.`);
          } else {
            // Auto-match on identifiers a business sets deliberately before falling back to the name.
            const hit =
              (item.sku && mine.find((m) => m.sku === item.sku)) ||
              (item.barcode && mine.find((m) => m.barcode === item.barcode)) ||
              mine.find((m) => m.name.trim().toLowerCase() === item.name.trim().toLowerCase());
            target = hit ? hit.id : null;
          }
          if (target) {
            if (claimed.has(target)) throw new PartnerRuleError("Two lines cannot be matched to the same item of yours.");
            claimed.add(target);
          }
          await tx.update(partnerTransferItems).set({ toInventoryId: target }).where(eq(partnerTransferItems.id, item.id));
        }
      } else {
        const lines = input.lines ?? {};
        const mine = await tx.select().from(inventory).where(and(eq(inventory.storeId, transfer.fromStoreId), eq(inventory.type, "product"), eq(inventory.isDeleted, false)));
        const mineById = new Map(mine.map((m) => [m.id, m]));
        const claimed = new Set<string>();
        const kept: { quantity: number; unitCostSnapshot: number; agreedUnitPrice: number | null }[] = [];
        let adjusted = false;

        for (const item of items) {
          const choice = lines[item.id] ?? {};
          const quantity = choice.quantity ?? item.quantity;
          if (!(quantity >= 0) || quantity > item.quantity) throw new PartnerRuleError(`You can supply at most ${item.quantity} of "${item.name}", the amount requested.`);
          if (quantity === 0) {
            adjusted = true;
            await tx.delete(partnerTransferItems).where(eq(partnerTransferItems.id, item.id));
            continue;
          }
          if (quantity !== item.quantity) adjusted = true;

          const hit = choice.inventoryId
            ? mineById.get(choice.inventoryId)
            : (item.fromInventoryId && mineById.get(item.fromInventoryId)) || (item.sku && mine.find((m) => m.sku === item.sku)) ||
              (item.barcode && mine.find((m) => m.barcode === item.barcode)) ||
              mine.find((m) => m.name.trim().toLowerCase() === item.name.trim().toLowerCase());
          if (!hit) throw new PartnerRuleError(`Choose which of your items covers "${item.name}".`);
          if (claimed.has(hit.id)) throw new PartnerRuleError("Two lines cannot be matched to the same item of yours.");
          claimed.add(hit.id);
          this.checkSendable(hit, quantity);

          if (item.agreedUnitPrice != null && choice.agreedUnitPrice != null && choice.agreedUnitPrice !== item.agreedUnitPrice) {
            throw new PartnerRuleError(`The requester already set a price for "${item.name}". Decline and have them re-request to change it.`);
          }
          const price = item.agreedUnitPrice ?? choice.agreedUnitPrice ?? null;
          await tx.update(partnerTransferItems).set({
            fromInventoryId: hit.id,
            quantity,
            unitCostSnapshot: hit.costPrice,
            agreedUnitPrice: price,
            sku: item.sku ?? hit.sku,
            barcode: item.barcode ?? hit.barcode,
            unit: item.unit ?? hit.unit,
          }).where(eq(partnerTransferItems.id, item.id));
          kept.push({ quantity, unitCostSnapshot: hit.costPrice, agreedUnitPrice: price });
        }
        if (kept.length === 0) throw new PartnerRuleError("Keep at least one item, or decline the request.");

        const total = transferValue(kept, "offered");
        if (transfer.settlementType !== "none") await this.assertCreditRoom(transfer.partnershipId, transfer.fromOrgId, transfer.toOrgId, total, "them");
        await tx.update(partnerTransfers).set({ agreedTotal: total }).where(eq(partnerTransfers.id, id));
        detail.adjusted = adjusted;
        detail.agreedTotal = total;
      }

      const now = new Date();
      const [row] = await tx.update(partnerTransfers)
        .set({ status, acceptedAt: now, acceptedByUserId: ctx.userId, updatedAt: now })
        .where(eq(partnerTransfers.id, id)).returning();
      await logEvent(tx, id, ctx, "accepted", detail);
      return row;
    });
  }

  async reject(ctx: PartnerCtx, id: string, reason: string | null): Promise<PartnerTransfer> {
    return this.simpleMove(ctx, id, "reject", "rejected", { rejectionReason: reason }, { reason });
  }

  async cancel(ctx: PartnerCtx, id: string): Promise<PartnerTransfer> {
    return this.simpleMove(ctx, id, "cancel", "cancelled", {}, {});
  }

  private async simpleMove(ctx: PartnerCtx, id: string, action: "reject" | "cancel", event: string, set: Partial<PartnerTransfer>, detail: Record<string, unknown>) {
    return db.transaction(async (tx) => {
      const { transfer, side } = await lockTransfer(tx, id, ctx);
      const status = nextStatus(action, transfer.status as PartnerTransferStatus, side, transfer.kind as PartnerKind);
      const [row] = await tx.update(partnerTransfers).set({ ...set, status, updatedAt: new Date() }).where(eq(partnerTransfers.id, id)).returning();
      await logEvent(tx, id, ctx, event, detail);
      return row;
    });
  }

  /** Stock leaves the sender here, not at offer time, so an unanswered offer never ties up their shelf. */
  async ship(ctx: PartnerCtx, id: string): Promise<PartnerTransfer> {
    return db.transaction(async (tx) => {
      const { transfer, side } = await lockTransfer(tx, id, ctx);
      const status = nextStatus("ship", transfer.status as PartnerTransferStatus, side, transfer.kind as PartnerKind);
      const items = await tx.select().from(partnerTransferItems).where(eq(partnerTransferItems.transferId, id));
      const [toStore] = await tx.select({ name: stores.name }).from(stores).where(eq(stores.id, transfer.toStoreId));

      for (const item of items) {
        if (!item.fromInventoryId) throw new PartnerRuleError(`"${item.name}" has not been matched to an item of yours yet.`);
        await adjustStock(tx, {
          storeId: transfer.fromStoreId,
          inventoryId: item.fromInventoryId,
          userId: ctx.userId,
          delta: -item.quantity,
          transferId: id,
          notes: `Shipped to partner ${toStore?.name ?? ""} (transfer ${id.slice(0, 8)})`.trim(),
        });
      }

      const now = new Date();
      const [row] = await tx.update(partnerTransfers)
        .set({ status, shippedAt: now, shippedByUserId: ctx.userId, updatedAt: now })
        .where(eq(partnerTransfers.id, id)).returning();
      await logEvent(tx, id, ctx, "shipped");
      return row;
    });
  }

  /** Receiver confirms what actually arrived. Anything short parks the transfer in `disputed` until the sender resolves it. */
  async receive(
    ctx: PartnerCtx, id: string, confirmed: Record<string, number> = {},
    reasons: Record<string, { reason: ShortfallReason; note?: string | null }> = {},
  ): Promise<PartnerTransfer> {
    return db.transaction(async (tx) => {
      const { transfer, side } = await lockTransfer(tx, id, ctx);
      nextStatus("receive", transfer.status as PartnerTransferStatus, side, transfer.kind as PartnerKind);
      const items = await tx.select().from(partnerTransferItems).where(eq(partnerTransferItems.transferId, id));

      const outcome = receiveOutcome(items.map((i) => ({
        id: i.id,
        quantity: i.quantity,
        confirmed: Object.prototype.hasOwnProperty.call(confirmed, i.id) ? Number(confirmed[i.id]) : i.quantity,
      })));
      const confirmedById = new Map(items.map((i) => [i.id, Object.prototype.hasOwnProperty.call(confirmed, i.id) ? Number(confirmed[i.id]) : i.quantity]));
      const [fromStore] = await tx.select({ name: stores.name }).from(stores).where(eq(stores.id, transfer.fromStoreId));

      const withConfirmed: (PartnerTransferItem & { confirmedQuantity: number })[] = [];
      for (const item of items) {
        const qty = confirmedById.get(item.id)!;
        withConfirmed.push({ ...item, confirmedQuantity: qty });
        // Why a line came up short matters to the sender: damaged goods are not coming back to their shelf.
        const why = qty < item.quantity ? reasons[item.id] : undefined;
        await tx.update(partnerTransferItems)
          .set({ confirmedQuantity: qty, shortfallReason: why?.reason ?? (qty < item.quantity ? "missing" : null), shortfallNote: why?.note?.trim() || null })
          .where(eq(partnerTransferItems.id, item.id));
        if (qty <= 0) continue;

        const { id: toInventoryId, created } = await this.resolveReceiverItem(tx, transfer, item);
        if (toInventoryId !== item.toInventoryId) {
          await tx.update(partnerTransferItems).set({ toInventoryId }).where(eq(partnerTransferItems.id, item.id));
        }
        await adjustStock(tx, {
          storeId: transfer.toStoreId,
          inventoryId: toInventoryId,
          userId: ctx.userId,
          delta: qty,
          transferId: id,
          notes: `Received from partner ${fromStore?.name ?? ""} (transfer ${id.slice(0, 8)})`.trim(),
          receipt: { unitCost: lineUnitPrice(item) },
          opening: created,
        });
      }

      const confirmedValue = transferValue(withConfirmed, "confirmed");
      const plan = planObligation(transfer.settlementType as SettlementType, withConfirmed);
      if (plan) {
        await tx.insert(partnerObligations).values({
          transferId: id,
          creditorOrgId: transfer.fromOrgId,
          debtorOrgId: transfer.toOrgId,
          kind: plan.kind,
          amountDue: plan.amountDue,
          dueDate: transfer.dueDate,
        });
      }

      const now = new Date();
      const [row] = await tx.update(partnerTransfers)
        .set({ status: outcome.status, agreedTotal: confirmedValue, receivedAt: now, receivedByUserId: ctx.userId, updatedAt: now })
        .where(eq(partnerTransfers.id, id)).returning();
      await logEvent(tx, id, ctx, outcome.status, {
        confirmedValue,
        shortfall: outcome.shortfall.map((x) => ({ ...x, reason: reasons[x.id]?.reason ?? "missing", note: reasons[x.id]?.note ?? null })),
      });
      return row;
    });
  }

  /** The receiver's item for a line: the one chosen at accept, else an existing name match, else a new one. */
  private async resolveReceiverItem(tx: Tx, transfer: PartnerTransfer, item: PartnerTransferItem): Promise<{ id: string; created: boolean }> {
    if (item.toInventoryId) {
      const [mapped] = await tx.select({ id: inventory.id, isDeleted: inventory.isDeleted, storeId: inventory.storeId }).from(inventory).where(eq(inventory.id, item.toInventoryId));
      if (mapped && !mapped.isDeleted && mapped.storeId === transfer.toStoreId) return { id: mapped.id, created: false };
    }
    const [byName] = await tx.select({ id: inventory.id }).from(inventory).where(and(
      eq(inventory.storeId, transfer.toStoreId), eq(inventory.type, "product"), eq(inventory.name, item.name),
    ));
    if (byName) return { id: byName.id, created: false };

    const [source] = item.fromInventoryId ? await tx.select().from(inventory).where(eq(inventory.id, item.fromInventoryId)) : [];
    const [existingProduct] = await tx.select({ id: products.id }).from(products).where(and(
      eq(products.storeId, transfer.toStoreId), eq(products.type, "product"), eq(products.name, item.name),
    ));
    const productId = existingProduct?.id ?? (await tx.insert(products).values({
      storeId: transfer.toStoreId, name: item.name, type: "product",
    }).returning({ id: products.id }))[0].id;

    // A SKU is unique per store; leave it off rather than fail the whole receipt on a clash.
    let sku: string | null = item.sku;
    if (sku) {
      const [clash] = await tx.select({ id: inventory.id }).from(inventory).where(and(eq(inventory.storeId, transfer.toStoreId), eq(inventory.sku, sku)));
      if (clash) sku = null;
    }
    const [created] = await tx.insert(inventory).values({
      storeId: transfer.toStoreId,
      productId,
      name: item.name,
      type: "product",
      costPrice: lineUnitPrice(item),
      sellingPrice: source?.sellingPrice ?? 0,
      quantity: 0,
      allowFractional: source?.allowFractional ?? false,
      unit: item.unit,
      sku,
      barcode: item.barcode,
    }).returning({ id: inventory.id });
    return { id: created.id, created: true };
  }

  /** Sender settles a dispute: put the missing stock back on their shelf, or write it off. */
  async resolveDispute(ctx: PartnerCtx, id: string, returnToStock: boolean): Promise<PartnerTransfer> {
    return db.transaction(async (tx) => {
      const { transfer, side } = await lockTransfer(tx, id, ctx);
      const status = nextStatus("resolve", transfer.status as PartnerTransferStatus, side, transfer.kind as PartnerKind);
      const items = await tx.select().from(partnerTransferItems).where(eq(partnerTransferItems.transferId, id));
      const shortfall: { name: string; quantity: number }[] = [];
      for (const item of items) {
        const short = Math.round((item.quantity - (item.confirmedQuantity ?? 0)) * 10_000) / 10_000;
        if (short <= 0) continue;
        shortfall.push({ name: item.name, quantity: short });
        // Damaged goods are on the receiver's side and stay written off; only missing stock can come back to the shelf.
        if (returnToStock && item.fromInventoryId && item.shortfallReason !== "damaged") {
          await adjustStock(tx, {
            storeId: transfer.fromStoreId, inventoryId: item.fromInventoryId, userId: ctx.userId, delta: short, transferId: id,
            notes: `Shortfall returned to stock (transfer ${id.slice(0, 8)})`,
          });
        }
      }
      const [row] = await tx.update(partnerTransfers).set({ status, updatedAt: new Date() }).where(eq(partnerTransfers.id, id)).returning();
      await logEvent(tx, id, ctx, "dispute_resolved", { returnToStock, shortfall });
      return row;
    });
  }

  /** Archive a received transfer once nothing is still owed on it. */
  async close(ctx: PartnerCtx, id: string): Promise<PartnerTransfer> {
    return db.transaction(async (tx) => {
      const { transfer, side } = await lockTransfer(tx, id, ctx);
      const status = nextStatus("close", transfer.status as PartnerTransferStatus, side, transfer.kind as PartnerKind);
      const [open] = await tx.select({ id: partnerObligations.id }).from(partnerObligations)
        .where(and(eq(partnerObligations.transferId, id), eq(partnerObligations.status, "open")));
      if (open) throw new PartnerRuleError("This transfer still has an unsettled balance.");
      const [row] = await tx.update(partnerTransfers).set({ status, updatedAt: new Date() }).where(eq(partnerTransfers.id, id)).returning();
      await logEvent(tx, id, ctx, "closed");
      return row;
    });
  }

  // ───────────────────────── settlement terms ─────────────────────────

  /**
   * Sender sets or proposes how this transfer will be settled. While it is still only
   * an offer the sender may simply set it, because the receiver has not committed yet.
   * After that, terms are a proposal the receiver has to agree to, so nobody can be
   * handed a debt they never accepted.
   */
  async proposeSettlement(ctx: PartnerCtx, id: string, type: SettlementType, dueDate: Date | null): Promise<PartnerTransfer> {
    return db.transaction(async (tx) => {
      const { transfer, side } = await lockTransfer(tx, id, ctx);
      const isRequest = transfer.kind === "request";
      // The party who opened the transfer may still set its terms outright; the other has to propose.
      const opener: PartnerSide = isRequest ? "receiver" : "sender";
      if (side !== "sender" && !(isRequest && side === "receiver" && transfer.status === "requested")) {
        throw new PartnerRuleError("Only the sender can propose settlement terms.");
      }
      if (["rejected", "cancelled"].includes(transfer.status)) throw new PartnerRuleError(`A ${transfer.status} transfer has nothing to settle.`);
      const [ob] = await tx.select().from(partnerObligations).where(eq(partnerObligations.transferId, id));
      if (ob) throw new PartnerRuleError("Settlement terms are already agreed for this transfer.");
      if (type === transfer.settlementType) throw new PartnerRuleError("Those are already the terms.");

      if (side === opener && ["offered", "requested"].includes(transfer.status)) {
        const [row] = await tx.update(partnerTransfers)
          .set({ settlementType: type, dueDate: type === "none" ? null : dueDate, updatedAt: new Date() })
          .where(eq(partnerTransfers.id, id)).returning();
        await logEvent(tx, id, ctx, "settlement_set", { type, dueDate });
        return row;
      }
      if (type === "none") throw new PartnerRuleError("Terms cannot be taken back once the transfer has been accepted.");
      if (transfer.settlementType !== "none") throw new PartnerRuleError("Settlement terms are already agreed for this transfer.");
      const [row] = await tx.update(partnerTransfers)
        .set({ proposedSettlementType: type, proposedDueDate: dueDate, updatedAt: new Date() })
        .where(eq(partnerTransfers.id, id)).returning();
      await logEvent(tx, id, ctx, "settlement_proposed", { type, dueDate });
      return row;
    });
  }

  async respondSettlement(ctx: PartnerCtx, id: string, accept: boolean): Promise<PartnerTransfer> {
    return db.transaction(async (tx) => {
      const { transfer, side } = await lockTransfer(tx, id, ctx);
      if (side !== "receiver") throw new PartnerRuleError("Only the receiving business can answer a settlement proposal.");
      const proposed = transfer.proposedSettlementType as SettlementType | null;
      if (!proposed) throw new PartnerRuleError("There is no settlement proposal to answer.");

      if (!accept) {
        const [row] = await tx.update(partnerTransfers)
          .set({ proposedSettlementType: null, proposedDueDate: null, updatedAt: new Date() })
          .where(eq(partnerTransfers.id, id)).returning();
        await logEvent(tx, id, ctx, "settlement_declined", { type: proposed });
        return row;
      }

      const [row] = await tx.update(partnerTransfers).set({
        settlementType: proposed, dueDate: transfer.proposedDueDate,
        proposedSettlementType: null, proposedDueDate: null, updatedAt: new Date(),
      }).where(eq(partnerTransfers.id, id)).returning();

      // If goods have already been received the debt starts now; otherwise receipt will create it.
      if (["received", "disputed", "closed"].includes(transfer.status)) {
        const items = await tx.select().from(partnerTransferItems).where(eq(partnerTransferItems.transferId, id));
        const plan = planObligation(proposed, items);
        if (plan) {
          await tx.insert(partnerObligations).values({
            transferId: id, creditorOrgId: transfer.fromOrgId, debtorOrgId: transfer.toOrgId,
            kind: plan.kind, amountDue: plan.amountDue, dueDate: transfer.proposedDueDate,
          });
        }
      }
      await logEvent(tx, id, ctx, "settlement_agreed", { type: proposed });
      return row;
    });
  }

  // ───────────────────────── obligations & settlements ─────────────────────────

  private async lockObligation(tx: Tx, id: string, ctx: PartnerCtx): Promise<{ ob: PartnerObligation; role: "creditor" | "debtor" }> {
    const [ob] = await tx.select().from(partnerObligations).where(eq(partnerObligations.id, id)).for("update");
    const role = ob ? (ob.creditorOrgId === ctx.orgId ? "creditor" : ob.debtorOrgId === ctx.orgId ? "debtor" : null) : null;
    if (!ob || !role) throw new PartnerRuleError("Balance not found.");
    return { ob, role };
  }

  private async applySettlement(tx: Tx, ob: PartnerObligation, amount: number): Promise<PartnerObligation> {
    const settled = money(ob.amountSettled + amount);
    const [row] = await tx.update(partnerObligations)
      .set({ amountSettled: settled, status: obligationStatus(ob.amountDue, settled), updatedAt: new Date() })
      .where(eq(partnerObligations.id, ob.id)).returning();
    return row;
  }

  /**
   * Record money paid or goods returned against an obligation. Whoever is owed counts it
   * immediately; if the debtor records it, it waits for the creditor to confirm, so
   * nobody can mark their own debt paid unilaterally.
   */
  async recordSettlement(ctx: PartnerCtx, obligationId: string, input: {
    amount?: number; method: string; reference?: string | null; notes?: string | null; returnTransferId?: string | null;
  }): Promise<PartnerSettlement> {
    return db.transaction(async (tx) => {
      const { ob, role } = await this.lockObligation(tx, obligationId, ctx);
      if (ob.status !== "open") throw new PartnerRuleError(`This balance is already ${ob.status}.`);

      const [pending] = await tx.select({ sum: sql<number>`coalesce(sum(${partnerSettlements.amount}), 0)::float8` })
        .from(partnerSettlements).where(and(eq(partnerSettlements.obligationId, ob.id), eq(partnerSettlements.status, "pending")));
      const room = maxSettleable(ob.amountDue, money(ob.amountSettled + (pending?.sum ?? 0)));

      let amount = input.amount;
      if (input.returnTransferId) {
        // A goods return is a partner transfer back the other way, valued at what it carried.
        const [ret] = await tx.select().from(partnerTransfers).where(eq(partnerTransfers.id, input.returnTransferId));
        if (!ret || ret.fromOrgId !== ob.debtorOrgId || ret.toOrgId !== ob.creditorOrgId) {
          throw new PartnerRuleError("That return is not a transfer from you to the business you owe.");
        }
        if (!POST_SHIP.includes(ret.status as PartnerTransferStatus) || ret.status === "shipped") {
          throw new PartnerRuleError("The returning transfer must be received before it counts.");
        }
        const [used] = await tx.select({ id: partnerSettlements.id }).from(partnerSettlements)
          .where(and(eq(partnerSettlements.returnTransferId, ret.id), inArray(partnerSettlements.status, ["pending", "confirmed"])));
        if (used) throw new PartnerRuleError("That transfer has already been counted against a balance.");
        if (amount == null) {
          const retItems = await tx.select().from(partnerTransferItems).where(eq(partnerTransferItems.transferId, ret.id));
          amount = Math.min(transferValue(retItems, "confirmed"), room);
        }
      }
      if (amount == null || !(amount > 0)) throw new PartnerRuleError("Enter an amount greater than zero.");
      amount = money(amount);
      if (amount > room) throw new PartnerRuleError(`That is more than is still owed (${room}).`);

      const confirmedNow = role === "creditor";
      const [settlement] = await tx.insert(partnerSettlements).values({
        obligationId: ob.id,
        amount,
        method: input.method,
        returnTransferId: input.returnTransferId ?? null,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
        recordedByOrgId: ctx.orgId,
        recordedByUserId: ctx.userId,
        status: confirmedNow ? "confirmed" : "pending",
        confirmedAt: confirmedNow ? new Date() : null,
      }).returning();
      if (confirmedNow) await this.applySettlement(tx, ob, amount);
      await logEvent(tx, ob.transferId, ctx, confirmedNow ? "settlement_recorded" : "settlement_claimed", { amount, method: input.method });
      return settlement;
    });
  }

  async answerSettlement(ctx: PartnerCtx, settlementId: string, accept: boolean): Promise<PartnerSettlement> {
    return db.transaction(async (tx) => {
      const [s] = await tx.select().from(partnerSettlements).where(eq(partnerSettlements.id, settlementId)).for("update");
      if (!s) throw new PartnerRuleError("Payment not found.");
      const { ob, role } = await this.lockObligation(tx, s.obligationId, ctx);
      if (role !== "creditor") throw new PartnerRuleError("Only the business that is owed can confirm a payment.");
      if (s.status !== "pending") throw new PartnerRuleError(`This payment is already ${s.status}.`);
      const [row] = await tx.update(partnerSettlements)
        .set({ status: accept ? "confirmed" : "rejected", confirmedAt: accept ? new Date() : null })
        .where(eq(partnerSettlements.id, s.id)).returning();
      if (accept) await this.applySettlement(tx, ob, s.amount);
      await logEvent(tx, ob.transferId, ctx, accept ? "settlement_confirmed" : "settlement_rejected", { amount: s.amount });
      return row;
    });
  }

  async waive(ctx: PartnerCtx, obligationId: string): Promise<PartnerObligation> {
    return db.transaction(async (tx) => {
      const { ob, role } = await this.lockObligation(tx, obligationId, ctx);
      if (role !== "creditor") throw new PartnerRuleError("Only the business that is owed can waive a balance.");
      if (ob.status !== "open") throw new PartnerRuleError(`This balance is already ${ob.status}.`);
      const [row] = await tx.update(partnerObligations)
        .set({ status: obligationStatus(ob.amountDue, ob.amountSettled, true), updatedAt: new Date() })
        .where(eq(partnerObligations.id, ob.id)).returning();
      await logEvent(tx, ob.transferId, ctx, "balance_waived", { remaining: money(ob.amountDue - ob.amountSettled) });
      return row;
    });
  }

  // ───────────────────────── reads ─────────────────────────

  async list(orgId: string, opts: { storeId?: string; status?: string } = {}) {
    const involved = or(eq(partnerTransfers.fromOrgId, orgId), eq(partnerTransfers.toOrgId, orgId))!;
    const conds = [involved];
    if (opts.storeId) conds.push(or(eq(partnerTransfers.fromStoreId, opts.storeId), eq(partnerTransfers.toStoreId, opts.storeId))!);
    if (opts.status) conds.push(eq(partnerTransfers.status, opts.status));
    const rows = await db.select().from(partnerTransfers).where(and(...conds)).orderBy(desc(partnerTransfers.createdAt)).limit(200);
    if (!rows.length) return [];

    const orgIds = Array.from(new Set(rows.flatMap((r) => [r.fromOrgId, r.toOrgId])));
    const storeIds = Array.from(new Set(rows.flatMap((r) => [r.fromStoreId, r.toStoreId])));
    const [orgs, storeRows, obs] = await Promise.all([
      db.select({ id: organisations.id, name: organisations.name }).from(organisations).where(inArray(organisations.id, orgIds)),
      db.select({ id: stores.id, name: stores.name }).from(stores).where(inArray(stores.id, storeIds)),
      db.select().from(partnerObligations).where(inArray(partnerObligations.transferId, rows.map((r) => r.id))),
    ]);
    const orgName = new Map(orgs.map((o) => [o.id, o.name]));
    const storeName = new Map(storeRows.map((s) => [s.id, s.name]));
    const obByTransfer = new Map(obs.map((o) => [o.transferId, o]));

    return rows.map((r) => {
      const side = sideOf(orgId, r)!;
      const ob = obByTransfer.get(r.id);
      return {
        ...r,
        side,
        // Whether the next step belongs to this business, so each side can see what is waiting on it.
        yourTurn: awaiting(r.status as PartnerTransferStatus, r.kind as PartnerKind) === side,
        fromOrgName: orgName.get(r.fromOrgId) ?? "",
        toOrgName: orgName.get(r.toOrgId) ?? "",
        fromStoreName: storeName.get(r.fromStoreId) ?? "",
        toStoreName: storeName.get(r.toStoreId) ?? "",
        obligation: ob ? { id: ob.id, kind: ob.kind, amountDue: ob.amountDue, amountSettled: ob.amountSettled, status: ob.status } : null,
      };
    });
  }

  /** One transfer as seen by `orgId`. The receiver never sees the sender's cost or their inventory ids. */
  async get(orgId: string, id: string) {
    const [transfer] = await db.select().from(partnerTransfers).where(eq(partnerTransfers.id, id));
    const side = transfer ? sideOf(orgId, transfer) : null;
    if (!transfer || !side) return null;

    const [items, events, [ob], orgs, storeRows] = await Promise.all([
      db.select().from(partnerTransferItems).where(eq(partnerTransferItems.transferId, id)),
      db.select().from(partnerTransferEvents).where(eq(partnerTransferEvents.transferId, id)).orderBy(partnerTransferEvents.createdAt),
      db.select().from(partnerObligations).where(eq(partnerObligations.transferId, id)),
      db.select({ id: organisations.id, name: organisations.name }).from(organisations).where(inArray(organisations.id, [transfer.fromOrgId, transfer.toOrgId])),
      db.select({ id: stores.id, name: stores.name }).from(stores).where(inArray(stores.id, [transfer.fromStoreId, transfer.toStoreId])),
    ]);
    const settlements = ob ? await db.select().from(partnerSettlements).where(eq(partnerSettlements.obligationId, ob.id)).orderBy(partnerSettlements.createdAt) : [];
    const orgName = new Map(orgs.map((o) => [o.id, o.name]));
    const storeName = new Map(storeRows.map((s) => [s.id, s.name]));

    return {
      ...transfer,
      side,
      yourTurn: awaiting(transfer.status as PartnerTransferStatus, transfer.kind as PartnerKind) === side,
      fromOrgName: orgName.get(transfer.fromOrgId) ?? "",
      toOrgName: orgName.get(transfer.toOrgId) ?? "",
      fromStoreName: storeName.get(transfer.fromStoreId) ?? "",
      toStoreName: storeName.get(transfer.toStoreId) ?? "",
      items: items.map((i) => {
        const { unitCostSnapshot, fromInventoryId, toInventoryId, ...shared } = i;
        const base = { ...shared, unitPrice: lineUnitPrice(i) };
        // Each side sees only its own inventory reference; cost stays with the sender.
        return side === "sender" ? { ...base, unitCostSnapshot, fromInventoryId } : { ...base, toInventoryId };
      }),
      events,
      obligation: ob ?? null,
      settlements,
    };
  }

  /** What each partner owes or is owed, plus every open balance behind the totals. */
  async ledger(orgId: string) {
    const obs = await db.select().from(partnerObligations)
      .where(or(eq(partnerObligations.creditorOrgId, orgId), eq(partnerObligations.debtorOrgId, orgId)))
      .orderBy(desc(partnerObligations.createdAt)).limit(500);
    if (!obs.length) return { partners: [], obligations: [], totals: { owedToMe: 0, iOwe: 0 } };

    const partnerOf = (o: PartnerObligation) => (o.creditorOrgId === orgId ? o.debtorOrgId : o.creditorOrgId);
    const partnerIds = Array.from(new Set(obs.map(partnerOf)));
    const orgs = await db.select({ id: organisations.id, name: organisations.name }).from(organisations).where(inArray(organisations.id, partnerIds));
    const name = new Map(orgs.map((o) => [o.id, o.name]));

    const partners = partnerIds.map((pid) => {
      const mine = obs.filter((o) => partnerOf(o) === pid);
      return {
        partnerOrgId: pid,
        name: name.get(pid) ?? "Unknown business",
        balance: partnerBalance(orgId, mine), // positive: they owe me
        openCount: mine.filter((o) => o.status === "open").length,
      };
    });
    const open = obs.filter((o) => o.status === "open");
    const totals = {
      owedToMe: money(open.filter((o) => o.creditorOrgId === orgId).reduce((s, o) => s + o.amountDue - o.amountSettled, 0)),
      iOwe: money(open.filter((o) => o.debtorOrgId === orgId).reduce((s, o) => s + o.amountDue - o.amountSettled, 0)),
    };
    return {
      partners,
      totals,
      obligations: obs.map((o) => ({
        ...o,
        role: o.creditorOrgId === orgId ? ("creditor" as const) : ("debtor" as const),
        partnerName: name.get(partnerOf(o)) ?? "Unknown business",
        remaining: money(o.amountDue - o.amountSettled),
      })),
    };
  }

  /** Reconciliation view for a transfer, one row per line. `unreconciled` should always be 0. */
  async stockAccounting(transferId: string) {
    const [t] = await db.select().from(partnerTransfers).where(eq(partnerTransfers.id, transferId));
    if (!t) return [];
    const items = await db.select().from(partnerTransferItems).where(eq(partnerTransferItems.transferId, transferId));
    const shippedStatus = POST_SHIP.includes(t.status as PartnerTransferStatus);
    return items.map((i) => {
      const shipped = shippedStatus ? i.quantity : 0;
      const received = i.confirmedQuantity ?? 0;
      const inTransit = t.status === "shipped" ? i.quantity : 0;
      const shortfall = i.confirmedQuantity == null ? 0 : Math.round((i.quantity - i.confirmedQuantity) * 10_000) / 10_000;
      return { itemId: i.id, shipped, received, inTransit, shortfall, unreconciled: unreconciledQty({ shipped, received, inTransit, shortfall }) };
    });
  }
}
