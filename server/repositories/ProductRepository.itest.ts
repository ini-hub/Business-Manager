import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { products, inventory, orders, checkouts } from "@shared/schema";
import {
  assertTestDatabase,
  ensureSchema,
  createFixture,
  sweepResidue,
  closePool,
  type Fixture,
} from "../test-support/integration-db";
import { ProductRepository } from "./ProductRepository";

/**
 * The POS quick-pick ranking, against real Postgres.
 *
 * Worth an integration test rather than a unit one: every rule that matters
 * here — that a void stops counting, that a fully returned line doesn't earn a
 * slot, that the window cuts off — lives in the SQL itself, so a mock of the
 * query would only assert that the mock was written to match.
 */

const repo = new ProductRepository();

let fx: Fixture;
/** Product-group ids by the label used in each test. */
const groupIds = new Map<string, string>();
/** Sellable variant per group. */
const variantIds = new Map<string, string>();

/** One product group with a single variant, ready to be sold. */
async function makeProduct(label: string): Promise<void> {
  const name = `QuickPick ${label} ${Date.now()}`;
  const [group] = await db.insert(products).values({
    storeId: fx.storeId,
    name,
    type: "product",
  }).returning();
  const [variant] = await db.insert(inventory).values({
    storeId: fx.storeId,
    productId: group.id,
    name,
    type: "product",
    costPrice: 100,
    sellingPrice: 250,
    quantity: 500,
  }).returning();
  groupIds.set(label, group.id);
  variantIds.set(label, variant.id);
}

/** One completed sale line for a group, `daysAgo` in the past. */
async function sell(
  label: string,
  opts: { quantity?: number; daysAgo?: number; returned?: number; voided?: boolean; pending?: boolean } = {},
): Promise<void> {
  const quantity = opts.quantity ?? 1;
  const [order] = await db.insert(orders).values({
    storeId: fx.storeId,
    inventoryId: variantIds.get(label)!,
    quantity,
    returnedQuantity: opts.returned ?? 0,
    totalPrice: quantity * 250,
  }).returning();

  const createdAt = new Date(Date.now() - (opts.daysAgo ?? 0) * 24 * 60 * 60 * 1000);
  await db.insert(checkouts).values({
    storeId: fx.storeId,
    staffId: fx.staffId,
    orderId: order.id,
    totalPrice: quantity * 250,
    paymentStatus: opts.pending ? "pending" : "completed",
    isVoided: opts.voided ?? false,
    createdAt,
  });
}

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
  await sweepResidue();
  fx = await createFixture();
});

afterAll(async () => {
  if (fx) {
    // createFixture's teardown doesn't know about catalogue or sale rows, and
    // both hold FKs to the store, so they go first.
    await db.execute(sql`DELETE FROM checkouts WHERE store_id = ${fx.storeId}`);
    await db.execute(sql`DELETE FROM orders WHERE store_id = ${fx.storeId}`);
    await db.execute(sql`DELETE FROM inventory WHERE store_id = ${fx.storeId}`);
    await db.execute(sql`DELETE FROM products WHERE store_id = ${fx.storeId}`);
    await fx.cleanup();
  }
  await closePool();
});

describe("getTopSellingProductIds", () => {
  it("ranks by how often an item is rung up, not by units moved", async () => {
    await makeProduct("frequent");
    await makeProduct("bulk");

    // Sold three times, six units total.
    await sell("frequent");
    await sell("frequent", { quantity: 2 });
    await sell("frequent", { quantity: 3 });
    // One wholesale line, five hundred units. The cashier touched it once.
    await sell("bulk", { quantity: 500 });

    const ids = await repo.getTopSellingProductIds(fx.storeId, 30, 10);
    expect(ids.indexOf(groupIds.get("frequent")!)).toBeLessThan(
      ids.indexOf(groupIds.get("bulk")!),
    );
  });

  it("ignores voided, pending, out-of-window and fully returned sales", async () => {
    await makeProduct("voided");
    await makeProduct("pending");
    await makeProduct("stale");
    await makeProduct("returned");

    await sell("voided", { voided: true });
    await sell("pending", { pending: true });
    await sell("stale", { daysAgo: 90 });
    await sell("returned", { quantity: 2, returned: 2 });

    const ids = await repo.getTopSellingProductIds(fx.storeId, 30, 50);
    for (const label of ["voided", "pending", "stale", "returned"]) {
      expect(ids).not.toContain(groupIds.get(label)!);
    }
  });

  it("counts a partial return as a sale that still happened", async () => {
    await makeProduct("partial");
    await sell("partial", { quantity: 5, returned: 2 });

    const ids = await repo.getTopSellingProductIds(fx.storeId, 30, 50);
    expect(ids).toContain(groupIds.get("partial")!);
  });

  it("honours the window and the limit", async () => {
    const wide = await repo.getTopSellingProductIds(fx.storeId, 365, 50);
    expect(wide).toContain(groupIds.get("stale")!);

    const capped = await repo.getTopSellingProductIds(fx.storeId, 365, 2);
    expect(capped).toHaveLength(2);
    // The most-rung-up item keeps the top slot as the list is trimmed.
    expect(capped[0]).toBe(groupIds.get("frequent")!);
  });

  it("returns nothing for a store that has sold nothing", async () => {
    const other = await createFixture();
    try {
      expect(await repo.getTopSellingProductIds(other.storeId, 30, 10)).toEqual([]);
    } finally {
      await other.cleanup();
    }
  });
});
