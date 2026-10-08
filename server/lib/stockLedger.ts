import { eq, sql } from "drizzle-orm";
import { inventory, stockMovements, type StockMovementReason, type InsertStockMovement } from "@shared/schema";

// Inventory quantity is numeric(14,4); anything finer than that is float noise from JS arithmetic.
const SCALE = 1e4;
const round4 = (n: number) => Math.round(n * SCALE) / SCALE;

export interface StockMove {
  storeId: string;
  inventoryId: string;
  reason: StockMovementReason;
  /** Quantity on the row before this change. */
  before: number;
  /** Quantity on the row after this change. */
  after: number;
  refType?: string | null;
  refId?: string | null;
  actorUserId?: string | null;
  actorStaffId?: string | null;
  note?: string | null;
}

/** Anything with Drizzle's insert, i.e. the db or a transaction. */
type Insertable = { insert: (table: typeof stockMovements) => { values: (rows: InsertStockMovement[]) => PromiseLike<unknown> } };

/**
 * Turns before/after pairs into ledger rows. Moves that change nothing are dropped, and when the
 * same item moves twice in one batch the rows are kept in order (each is a real step).
 */
export function buildStockMovements(moves: StockMove[]): InsertStockMovement[] {
  const rows: InsertStockMovement[] = [];
  for (const m of moves) {
    const before = round4(m.before);
    const after = round4(m.after);
    const delta = round4(after - before);
    if (delta === 0) continue;
    rows.push({
      storeId: m.storeId,
      inventoryId: m.inventoryId,
      reason: m.reason,
      quantityBefore: before,
      quantityAfter: after,
      delta,
      refType: m.refType ?? null,
      refId: m.refId ?? null,
      actorUserId: m.actorUserId ?? null,
      actorStaffId: m.actorStaffId ?? null,
      note: m.note ?? null,
    });
  }
  return rows;
}

/**
 * Writes the ledger rows for stock that changed. Call it with the SAME transaction as the
 * inventory.quantity update, so the ledger and the stock can never disagree.
 */
export async function recordStockMovements(tx: Insertable, moves: StockMove[]): Promise<void> {
  const rows = buildStockMovements(moves);
  if (rows.length === 0) return;
  await tx.insert(stockMovements).values(rows);
}

type Updatable = Insertable & {
  update: (table: typeof inventory) => {
    set: (v: Record<string, unknown>) => {
      // Method syntax (bivariant) so Drizzle's `where(SQL | undefined)` is assignable.
      where(c: any): { returning: (cols: any) => PromiseLike<Array<{ quantity: unknown }>> };
    };
  };
};

export type StockAdjustment = Omit<StockMove, "before" | "after"> & { delta: number };

/**
 * Applies a relative change to inventory.quantity and records it in one step. The database does
 * the arithmetic (`quantity + delta`) and hands back the new value, so "before" is exact even when
 * the caller never read the row. Returns the new quantity.
 */
export async function adjustStock(tx: Updatable, adj: StockAdjustment): Promise<number> {
  const [row] = await tx.update(inventory)
    .set({ quantity: sql`${inventory.quantity} + ${adj.delta}` })
    .where(eq(inventory.id, adj.inventoryId))
    .returning({ quantity: inventory.quantity });
  if (!row) throw new Error(`Cannot adjust stock: inventory item ${adj.inventoryId} not found`);
  const after = Number(row.quantity);
  await recordStockMovements(tx, [{ ...adj, before: after - adj.delta, after }]);
  return after;
}
