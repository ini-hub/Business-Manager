import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import { inventory, products, expenses, stockMovements, vendors, purchaseOrders, purchaseOrderItems } from "@shared/schema";
import { writeOffStock, WriteOffError } from "./StockWriteOffService";
import { findArchiveBlockers } from "../lib/archiveGuard";
import { assertTestDatabase, ensureSchema, createFixture, closePool, type Fixture } from "../test-support/integration-db";

let f: Fixture;
let productId: string;

async function item(values: Record<string, unknown>) {
  const name = `wo-${Math.random().toString(36).slice(2, 8)}`;
  const [row] = await db.insert(inventory).values({
    storeId: f.storeId, productId, name, type: "product", costPrice: 50, sellingPrice: 100, quantity: 10, ...values,
  } as any).returning();
  return row;
}

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
  f = await createFixture();
  const [p] = await db.insert(products).values({ storeId: f.storeId, name: "Write-off product", type: "product" } as any).returning();
  productId = p.id;
});

/** Everything this file creates, scoped to its own store. Order matters: children before parents. */
async function clearStore(storeId: string) {
  const s = sql`${storeId}`;
  await db.execute(sql`DELETE FROM purchase_order_items WHERE po_id IN (SELECT id FROM purchase_orders WHERE store_id = ${s})`);
  for (const t of ["purchase_orders", "vendors", "stock_movements", "expenses", "expense_categories", "profit_loss", "inventory", "products"]) {
    await db.execute(sql`DELETE FROM ${sql.raw(t)} WHERE store_id = ${s}`);
  }
}

afterAll(async () => {
  if (f) {
    await clearStore(f.storeId);
    await f.cleanup();
  }
  await closePool();
});

describe("writeOffStock", () => {
  it("zeroes the stock, writes one ledger row, books the loss at cost and archives", async () => {
    const it1 = await item({});
    const r = await writeOffStock({ inventoryId: it1.id, reason: "damaged", note: "dropped", recordAsLoss: true, archive: true });
    expect(r.quantityWrittenOff).toBe(10);
    expect(r.lossRecorded).toBe(500);

    const [after] = await db.select().from(inventory).where(eq(inventory.id, it1.id));
    expect(Number(after.quantity)).toBe(0);
    expect(after.isDeleted).toBe(true);

    const moves = await db.select().from(stockMovements).where(and(eq(stockMovements.inventoryId, it1.id), eq(stockMovements.reason, "write_off")));
    expect(moves).toHaveLength(1);
    expect(Number(moves[0].delta)).toBe(-10);
    // The ledger invariant the parity gate asserts: quantity = SUM(delta), and the move chains from the prior quantity.
    const { rows } = await db.execute(sql`SELECT COALESCE(SUM(delta), 0)::float8 AS total FROM stock_movements WHERE inventory_id = ${it1.id}`);
    expect(Number(rows[0].total) + 10).toBe(Number(after.quantity)); // the fixture row was inserted with 10 and no opening movement
    expect(Number(moves[0].quantityBefore)).toBe(10);
    expect(Number(moves[0].quantityAfter)).toBe(0);

    const exp = await db.select().from(expenses).where(and(eq(expenses.storeId, f.storeId), eq(expenses.title, `Stock written off — ${it1.name}`)));
    expect(exp).toHaveLength(1);
    expect(exp[0].amount).toBe(500);
    expect(exp[0].costClass).toBe("overhead");
    expect(exp[0].paymentMethod).toBe("non_cash");
  });

  it("books no loss when the owner opts out, and keeps the item active when not archiving", async () => {
    const it2 = await item({});
    const r = await writeOffStock({ inventoryId: it2.id, reason: "expired", recordAsLoss: false, archive: false });
    expect(r.lossRecorded).toBe(0);
    const [after] = await db.select().from(inventory).where(eq(inventory.id, it2.id));
    expect(after.isDeleted).toBe(false);
    expect(Number(after.quantity)).toBe(0);
  });

  it("does not charge an expensed supply twice, but does charge a metered one to Direct Supplies", async () => {
    const expensed = await item({ type: "supply", costingMode: "expensed", sellingPrice: 0 });
    expect((await writeOffStock({ inventoryId: expensed.id, reason: "lost_or_stolen", recordAsLoss: true, archive: false })).lossRecorded).toBe(0);

    const metered = await item({ type: "supply", costingMode: "metered", sellingPrice: 0 });
    const r = await writeOffStock({ inventoryId: metered.id, reason: "damaged", recordAsLoss: true, archive: false });
    expect(r.lossRecorded).toBe(500);
    const [exp] = await db.select().from(expenses).where(and(eq(expenses.storeId, f.storeId), eq(expenses.title, `Stock written off — ${metered.name}`)));
    expect(exp.costClass).toBe("direct_supply");
  });

  it("refuses an empty item, a service, and 'other' without a note", async () => {
    const empty = await item({ quantity: 0 });
    await expect(writeOffStock({ inventoryId: empty.id, reason: "damaged", recordAsLoss: true, archive: false })).rejects.toBeInstanceOf(WriteOffError);
    const service = await item({ type: "service" });
    await expect(writeOffStock({ inventoryId: service.id, reason: "damaged", recordAsLoss: true, archive: false })).rejects.toBeInstanceOf(WriteOffError);
    const stocked = await item({});
    await expect(writeOffStock({ inventoryId: stocked.id, reason: "other", recordAsLoss: true, archive: false })).rejects.toBeInstanceOf(WriteOffError);
    const [still] = await db.select().from(inventory).where(eq(inventory.id, stocked.id));
    expect(Number(still.quantity)).toBe(10);
  });
});

describe("findArchiveBlockers", () => {
  it("reports an open purchase order and clears once it is received", async () => {
    const stocked = await item({});
    expect(await findArchiveBlockers([stocked.id])).toEqual([]);

    const [vendor] = await db.insert(vendors).values({ storeId: f.storeId, name: "Blocker vendor" } as any).returning();
    const [po] = await db.insert(purchaseOrders).values({ storeId: f.storeId, vendorId: vendor.id, poNumber: `PO-${Date.now()}`, status: "ordered" } as any).returning();
    await db.insert(purchaseOrderItems).values({ poId: po.id, inventoryId: stocked.id, quantity: 5, unitCost: 50, totalCost: 250 } as any);

    expect(await findArchiveBlockers([stocked.id])).toEqual([{ kind: "purchase_order", count: 1 }]);

    await db.update(purchaseOrders).set({ status: "received" }).where(eq(purchaseOrders.id, po.id));
    expect(await findArchiveBlockers([stocked.id])).toEqual([]);
  });
});
