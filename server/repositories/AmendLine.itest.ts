import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  staff, products, inventory, orders, checkouts, transactions, returnLogs, users,
} from "@shared/schema";
import { storage } from "../storage";
import {
  assertTestDatabase,
  ensureSchema,
  createFixture,
  createPeriod,
  sweepResidue,
  closePool,
  type Fixture,
} from "../test-support/integration-db";

/**
 * SalesRepository.amendLine — post-sale edit of one receipt line.
 *
 * Money and stock must move through the return + addendum paths in ONE
 * transaction; staff/split edits must move no money at all.
 */

const repo = storage; // through storage: importing a repository directly trips the storage import cycle
let seq = 0;
let cleanups: (() => Promise<void>)[] = [];

async function scene() {
  const fx: Fixture = await createFixture();
  const tag = `${Date.now()}-${++seq}`;
  // return_logs.user_id and restock events reference users.
  const [actor] = await db.insert(users).values({ name: "Amend Tester", email: `amend-${tag}@example.test` }).returning();
  const [second] = await db.insert(staff).values({
    storeId: fx.storeId, name: "Second Test", email: `second-${tag}@example.test`,
    staffNumber: `S2-${tag}`, mobileNumber: "08000000001",
    paymentMethod: "hybrid", overridePaymentMethod: true, payPerMonth: 0,
  }).returning();

  const [svcProduct] = await db.insert(products).values({ storeId: fx.storeId, name: `Wash ${tag}`, type: "service" }).returning();
  const [wash] = await db.insert(inventory).values({
    storeId: fx.storeId, name: `Wash ${tag}`, type: "service", productId: svcProduct.id, sellingPrice: 1000,
  }).returning();
  const [colour] = await db.insert(inventory).values({
    storeId: fx.storeId, name: `Colour ${tag}`, type: "service", productId: svcProduct.id, sellingPrice: 3000,
  }).returning();

  const [goodsProduct] = await db.insert(products).values({ storeId: fx.storeId, name: `Oil ${tag}`, type: "product" }).returning();
  const [oil] = await db.insert(inventory).values({
    storeId: fx.storeId, name: `Oil ${tag}`, type: "product", productId: goodsProduct.id, sellingPrice: 500, quantity: 10,
  }).returning();

  async function sell(inventoryId: string, quantity: number, unitPrice: number, createdAt = new Date(), lead: string | null = fx.staffId) {
    const total = unitPrice * quantity;
    const [order] = await db.insert(orders).values({
      storeId: fx.storeId, inventoryId, quantity, totalPrice: total,
    }).returning();
    const [checkout] = await db.insert(checkouts).values({
      storeId: fx.storeId, staffId: fx.staffId, leadStaffId: lead, orderId: order.id,
      receiptNumber: `AMEND-${tag}`, totalPrice: total, subtotal: total, totalCharged: total,
      paymentMethod: "cash", paymentStatus: "completed", createdAt,
    }).returning();
    await db.insert(transactions).values({
      storeId: fx.storeId, customerId: fx.customerId, inventoryId, checkoutId: checkout.id, amount: total, transactionDate: createdAt,
    });
    return { order, checkout };
  }

  cleanups.push(async () => {
    for (const t of ["return_logs", "transactions", "checkouts", "orders", "profit_loss", "inventory_restock_events"]) {
      await db.execute(sql.raw(`DELETE FROM ${t} WHERE store_id = '${fx.storeId}'`));
    }
    await db.execute(sql.raw(`DELETE FROM stock_movements WHERE store_id = '${fx.storeId}'`));
    await db.execute(sql.raw(`DELETE FROM inventory WHERE store_id = '${fx.storeId}'`));
    await db.execute(sql.raw(`DELETE FROM users WHERE id = '${actor.id}'`));
    await db.execute(sql.raw(`DELETE FROM products WHERE store_id = '${fx.storeId}'`));
    await fx.cleanup();
  });

  return { fx, second, wash, colour, oil, sell, userId: actor.id };
}

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
  await sweepResidue();
});

afterEach(async () => {
  for (const c of cleanups.reverse()) await c();
  cleanups = [];
});

afterAll(async () => {
  await closePool();
});

const reason = "Corrected at the till";

describe("amendLine", () => {
  it("staff/split only: reassigns lead + assistant and moves no money", async () => {
    const { fx, second, wash, sell, userId } = await scene();
    const { checkout } = await sell(wash.id, 1, 1000);

    const r = await repo.amendLine({
      lineCheckoutId: checkout.id,
      staff: { leadStaffId: second.id, assistingStaff1Id: fx.staffId },
      commissionSplit: "equal",
      reason,
      userId,
    });

    expect(r.message).toBe("Line updated.");
    expect(r.mode).toBe("staff");
    const [row] = await db.select().from(checkouts).where(eq(checkouts.id, checkout.id));
    expect(row.leadStaffId).toBe(second.id);
    expect(row.assistingStaff1Id).toBe(fx.staffId);
    expect(row.commissionSplit).toBe("equal");
    const logs = await db.select().from(returnLogs).where(eq(returnLogs.storeId, fx.storeId));
    expect(logs).toHaveLength(0);
  });

  it("solo performer is always standard, whatever split is sent", async () => {
    const { fx, wash, sell, userId } = await scene();
    const { checkout } = await sell(wash.id, 1, 1000);

    const r = await repo.amendLine({
      lineCheckoutId: checkout.id,
      staff: { leadStaffId: fx.staffId },
      commissionSplit: "equal",
      reason,
      userId,
    });
    expect(r.message).toBe("Line updated.");
    const [row] = await db.select().from(checkouts).where(eq(checkouts.id, checkout.id));
    expect(row.commissionSplit).toBe("standard");
  });

  it("price change replaces the line: original fully returned, replacement at the original sale date", async () => {
    const { fx, second, wash, sell, userId } = await scene();
    const saleDate = new Date(Date.now() - 3 * 86_400_000);
    const { order, checkout } = await sell(wash.id, 1, 1000, saleDate);

    const r = await repo.amendLine({
      lineCheckoutId: checkout.id,
      unitPrice: 1500,
      staff: { leadStaffId: second.id },
      settlementMethod: "transfer",
      reason,
      userId,
    });

    expect(r.message).toBe("Line updated.");
    expect(r.mode).toBe("replace");

    const [oldOrder] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(oldOrder.returnedQuantity).toBe(1);

    const lines = await db.select().from(checkouts).where(eq(checkouts.receiptNumber, checkout.receiptNumber));
    const added = lines.find((c) => c.isAddendum);
    expect(added).toBeDefined();
    expect(added!.totalPrice).toBe(1500);
    expect(added!.leadStaffId).toBe(second.id);
    expect(added!.paymentMethod).toBe("transfer");
    // Booked into the period the sale belongs to, not today.
    expect(new Date(added!.createdAt).toDateString()).toBe(saleDate.toDateString());

    const logs = await db.select().from(returnLogs).where(eq(returnLogs.storeId, fx.storeId));
    expect(logs).toHaveLength(1);
    expect(logs[0].refundMethod).toBe("transfer");
    expect(logs[0].refundAmount).toBe(1000);
  });

  it("swapping to another service books the replacement against that item", async () => {
    const { fx, wash, colour, sell, userId } = await scene();
    const { checkout } = await sell(wash.id, 1, 1000);

    const r = await repo.amendLine({
      lineCheckoutId: checkout.id,
      inventoryId: colour.id,
      unitPrice: 3000,
      staff: { leadStaffId: fx.staffId },
      settlementMethod: "cash",
      reason,
      userId,
    });
    expect(r.message).toBe("Line updated.");

    const lines = await db.select({ c: checkouts, o: orders }).from(checkouts)
      .innerJoin(orders, eq(checkouts.orderId, orders.id))
      .where(eq(checkouts.receiptNumber, checkout.receiptNumber));
    const added = lines.find((l) => l.c.isAddendum);
    expect(added?.o.inventoryId).toBe(colour.id);
  });

  it("quantity down on a product is a partial return and restocks", async () => {
    const { fx, oil, sell, userId } = await scene();
    const { order, checkout } = await sell(oil.id, 3, 500);

    const r = await repo.amendLine({
      lineCheckoutId: checkout.id,
      quantity: 2,
      staff: {},
      settlementMethod: "cash",
      reason,
      userId,
    });
    expect(r.message).toBe("Line updated.");
    expect(r.mode).toBe("partial_return");
    expect(r.cashRefund).toBe(500);

    const [o] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(o.returnedQuantity).toBe(1);
    const [stock] = await db.select().from(inventory).where(eq(inventory.id, oil.id));
    expect(stock.quantity).toBe(11);

    // No replacement line for a pure quantity reduction.
    const lines = await db.select().from(checkouts).where(eq(checkouts.storeId, fx.storeId));
    expect(lines.filter((c) => c.isAddendum)).toHaveLength(0);
  });

  it("refuses a money change without a settlement method, and changes nothing", async () => {
    const { wash, sell, fx, userId } = await scene();
    const { order, checkout } = await sell(wash.id, 1, 1000);

    const r = await repo.amendLine({
      lineCheckoutId: checkout.id, unitPrice: 2000, staff: { leadStaffId: fx.staffId }, reason, userId,
    });
    expect(r.success).toBe(false);
    const [o] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(o.returnedQuantity).toBe(0);
  });

  it("refuses credit as the settlement for a replaced line", async () => {
    const { wash, sell, fx, userId } = await scene();
    const { checkout } = await sell(wash.id, 1, 1000);
    const r = await repo.amendLine({
      lineCheckoutId: checkout.id, unitPrice: 2000, staff: { leadStaffId: fx.staffId },
      settlementMethod: "credit", reason, userId,
    });
    expect(r.success).toBe(false);
  });

  it("rejects a staff member from another store, and a service with no lead", async () => {
    const { wash, sell, fx, userId } = await scene();
    const other = await scene();
    const { checkout } = await sell(wash.id, 1, 1000);

    const foreign = await repo.amendLine({
      lineCheckoutId: checkout.id, staff: { leadStaffId: other.fx.staffId }, reason, userId,
    });
    expect(foreign.success).toBe(false);

    const noLead = await repo.amendLine({
      lineCheckoutId: checkout.id, staff: {}, reason, userId,
    });
    expect(noLead.success).toBe(false);
    const [row] = await db.select().from(checkouts).where(eq(checkouts.id, checkout.id));
    expect(row.leadStaffId).toBe(fx.staffId);
  });

  it("is refused when the sale sits in a finalized payroll period", async () => {
    const { fx, second, wash, sell, userId } = await scene();
    const saleDate = new Date();
    const { checkout } = await sell(wash.id, 1, 1000, saleDate);
    const day = saleDate.toISOString().slice(0, 10);
    const period = await createPeriod(fx.storeId, day, day);
    await db.execute(sql`UPDATE payroll_periods SET status = 'approved' WHERE id = ${period.id}`);

    const r = await repo.amendLine({
      lineCheckoutId: checkout.id, staff: { leadStaffId: second.id }, reason, userId,
    });
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/payroll period/i);
    const [row] = await db.select().from(checkouts).where(and(eq(checkouts.id, checkout.id)));
    expect(row.leadStaffId).toBe(fx.staffId);
  });
});
