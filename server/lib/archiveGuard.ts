import { db } from "../db";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  purchaseOrders, purchaseOrderItems, stockTransfers, stockTransferItems, stockAudits, stockAuditItems, inventory,
} from "@shared/schema";

// Archiving hides an item from every list. That is fine for stock sitting on a shelf, but not for stock that
// an open document still points at: the purchase order, transfer or count would be left referencing an item
// nobody can open. Anything listed here has to be finished or cancelled first.
const OPEN_PO_STATUSES = ["draft", "ordered", "partially_received"];
const OPEN_TRANSFER_STATUSES = ["requested", "pending", "accepted", "scheduled", "delivered"];

export interface ArchiveBlocker {
  kind: "purchase_order" | "stock_transfer" | "stock_audit";
  count: number;
}

const LABELS: Record<ArchiveBlocker["kind"], [string, string]> = {
  purchase_order: ["open purchase order", "open purchase orders"],
  stock_transfer: ["pending stock transfer", "pending stock transfers"],
  stock_audit: ["unfinished stock count", "unfinished stock counts"],
};

export async function findArchiveBlockers(inventoryIds: string[]): Promise<ArchiveBlocker[]> {
  if (inventoryIds.length === 0) return [];
  const [pos, transfers, audits] = await Promise.all([
    db.select({ n: sql<number>`count(distinct ${purchaseOrders.id})::int` })
      .from(purchaseOrderItems)
      .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderItems.poId))
      .where(and(inArray(purchaseOrderItems.inventoryId, inventoryIds), inArray(purchaseOrders.status, OPEN_PO_STATUSES))),
    db.select({ n: sql<number>`count(distinct ${stockTransfers.id})::int` })
      .from(stockTransferItems)
      .innerJoin(stockTransfers, eq(stockTransfers.id, stockTransferItems.transferId))
      .where(and(inArray(stockTransferItems.inventoryId, inventoryIds), inArray(stockTransfers.status, OPEN_TRANSFER_STATUSES))),
    db.select({ n: sql<number>`count(distinct ${stockAudits.id})::int` })
      .from(stockAuditItems)
      .innerJoin(stockAudits, eq(stockAudits.id, stockAuditItems.auditId))
      .where(and(inArray(stockAuditItems.inventoryId, inventoryIds), eq(stockAudits.status, "draft"))),
  ]);
  const blockers: ArchiveBlocker[] = [];
  if (pos[0]?.n) blockers.push({ kind: "purchase_order", count: pos[0].n });
  if (transfers[0]?.n) blockers.push({ kind: "stock_transfer", count: transfers[0].n });
  if (audits[0]?.n) blockers.push({ kind: "stock_audit", count: audits[0].n });
  return blockers;
}

export function describeArchiveBlockers(blockers: ArchiveBlocker[], verb: "archive" | "delete" = "archive"): string {
  const parts = blockers.map((b) => `${b.count} ${LABELS[b.kind][b.count === 1 ? 0 : 1]}`);
  return `Can't ${verb} this item yet: it's on ${parts.join(", ")}. Finish or cancel ${blockers.length === 1 && blockers[0].count === 1 ? "it" : "them"} first.`;
}

/** Ids to check for an archive request: the item itself, or every live variant of a product group. */
export async function archiveTargetIds(productId: string): Promise<string[]> {
  const rows = await db.select({ id: inventory.id }).from(inventory)
    .where(and(eq(inventory.productId, productId), eq(inventory.isDeleted, false)));
  return rows.map((r) => r.id);
}
