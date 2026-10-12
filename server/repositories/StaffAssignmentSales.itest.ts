import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import { inventory, products, cashRegisterSessions, staffStoreAssignments } from "@shared/schema";
import { storage } from "../storage";
import {
  assertTestDatabase, ensureSchema, createFixture, closePool, type Fixture,
} from "../test-support/integration-db";

/**
 * A sale is valid for a staff member homed at the store or holding an active assignment there
 * (staff_store_assignments); an archived assignment, or none, is refused.
 */

let fixtures: Fixture[] = [];

async function clearSales(storeId: string) {
  const s = sql`${storeId}`;
  await db.execute(sql`DELETE FROM gamification_points_ledger WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM gamification_badge_awards WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM gamification_streaks WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM sale_payment_legs WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM store_credit_transactions WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM checkout_idempotency_keys WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM transactions WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM checkouts WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM order_consumables WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM orders WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM profit_loss WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM notifications WHERE store_id = ${s}`).catch(() => undefined);
  await db.execute(sql`DELETE FROM cash_drops WHERE session_id IN (SELECT id FROM cash_register_sessions WHERE store_id = ${s})`);
  await db.execute(sql`DELETE FROM cash_register_sessions WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM inventory_batches WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM store_counters WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM inventory WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM products WHERE store_id = ${s}`);
}

async function setup() {
  const home = await createFixture();
  const shop = await createFixture();
  fixtures.push(home, shop);
  const [product] = await db.insert(products).values({ storeId: shop.storeId, name: "Item", type: "product" }).returning();
  const [item] = await db.insert(inventory).values({
    storeId: shop.storeId, productId: product.id, name: "Item", type: "product",
    costPrice: 400, sellingPrice: 500, quantity: 50,
  }).returning();
  await db.insert(cashRegisterSessions).values({ storeId: shop.storeId, status: "open", openingFloat: 0, expectedCash: 0 });
  // The seller is homed at `home` and sells at `shop`.
  const sell = () => storage.processCheckout({
    storeId: shop.storeId, customerId: shop.customerId, staffId: home.staffId,
    items: [{ inventoryId: item.id, quantity: 1 }], paymentMethod: "cash",
  } as any);
  return { home, shop, sell };
}

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
});

afterEach(async () => {
  for (const f of fixtures) await clearSales(f.storeId);
  for (const f of fixtures) await f.cleanup();
  fixtures = [];
});

afterAll(async () => {
  await closePool();
});

describe("sale validity with store assignments", () => {
  it("refuses a seller who is neither homed at nor assigned to the store", async () => {
    const { sell } = await setup();
    const refused = await sell();
    expect(refused.success).toBe(false);
    expect(refused.message).toMatch(/does not belong to this store branch/);
  });

  it("accepts a seller with an active assignment, and refuses again once it is archived", async () => {
    const { home, shop, sell } = await setup();
    await db.insert(staffStoreAssignments).values({
      staffId: home.staffId, storeId: shop.storeId, staffNumber: `AS-${Date.now()}`,
    });
    const ok = await sell();
    expect(ok.message).toBe("Sale completed successfully");
    expect(ok.success).toBe(true);

    await db.update(staffStoreAssignments).set({ isArchived: true }).where(and(
      eq(staffStoreAssignments.staffId, home.staffId), eq(staffStoreAssignments.storeId, shop.storeId),
    ));
    const refused = await sell();
    expect(refused.success).toBe(false);
    expect(refused.message).toMatch(/does not belong to this store branch/);
  });
});
