import { db } from "../db";
import { and, eq } from "drizzle-orm";
import { inventory, profitLoss } from "@shared/schema";
import { adjustStock } from "../lib/stockLedger";
import { getStoreTimezone } from "../lib/dateUtils";
import { localDateString, postWriteOffExpense } from "./SupplyCostingService";

export const WRITE_OFF_REASONS = ["damaged", "expired", "lost_or_stolen", "other"] as const;
export type WriteOffReason = typeof WRITE_OFF_REASONS[number];

const REASON_LABEL: Record<WriteOffReason, string> = {
  damaged: "Damaged",
  expired: "Expired",
  lost_or_stolen: "Lost or stolen",
  other: "Other",
};

export class WriteOffError extends Error {}

export interface WriteOffInput {
  inventoryId: string;
  reason: WriteOffReason;
  note?: string | null;
  /** Book the cost as a P&L loss. Ignored (nothing to book) for expensed supplies, which were charged on purchase. */
  recordAsLoss: boolean;
  /** Hide the item once the stock is gone. */
  archive: boolean;
  actorUserId?: string | null;
}

export interface WriteOffResult {
  quantityWrittenOff: number;
  lossRecorded: number;
  archived: boolean;
  storeId: string;
  item: { id: string; name: string; costPrice: number };
  reasonLabel: string;
}

/**
 * Zeroes an item's stock as a write-off. The row is locked first so the quantity written off is exactly
 * what the ledger records, even if a sale lands at the same moment. Stock movement, optional loss expense
 * and optional archive commit or roll back together.
 */
export async function writeOffStock(input: WriteOffInput): Promise<WriteOffResult> {
  const reasonLabel = REASON_LABEL[input.reason];
  const note = input.note?.trim() || null;
  if (input.reason === "other" && !note) throw new WriteOffError("Add a note explaining the write-off.");

  return db.transaction(async (tx) => {
    const [item] = await tx.select().from(inventory).where(eq(inventory.id, input.inventoryId)).for("update");
    if (!item || item.isDeleted) throw new WriteOffError("This item no longer exists.");
    if (item.type === "service") throw new WriteOffError("Services don't have stock to write off.");
    const quantity = Number(item.quantity);
    if (!(quantity > 0)) throw new WriteOffError("There is no stock to write off.");

    await adjustStock(tx, {
      storeId: item.storeId,
      inventoryId: item.id,
      reason: "write_off",
      delta: -quantity,
      refType: "write_off",
      actorUserId: input.actorUserId ?? null,
      note: note ? `${reasonLabel}: ${note}` : reasonLabel,
    });

    // Keep the per-item P&L row's remaining quantity in step, as restock and sales do.
    await tx.update(profitLoss).set({ quantityRemaining: 0 })
      .where(and(eq(profitLoss.inventoryId, item.id), eq(profitLoss.storeId, item.storeId)));

    let lossRecorded = 0;
    if (input.recordAsLoss) {
      const tz = await getStoreTimezone(item.storeId);
      lossRecorded = await postWriteOffExpense(tx, {
        storeId: item.storeId,
        item,
        quantity,
        date: localDateString(tz),
        reason: note ? `${reasonLabel}: ${note}` : reasonLabel,
      });
    }

    if (input.archive) {
      await tx.update(inventory).set({ isDeleted: true, deletedAt: new Date() }).where(eq(inventory.id, item.id));
    }

    return {
      quantityWrittenOff: quantity,
      lossRecorded,
      archived: input.archive,
      storeId: item.storeId,
      item: { id: item.id, name: item.name, costPrice: Number(item.costPrice) },
      reasonLabel,
    };
  });
}
