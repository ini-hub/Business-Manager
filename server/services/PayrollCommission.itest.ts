import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { organisations, stores, staff, products, inventory, orders, checkouts, payrollEntries } from "@shared/schema";
import { payrollService } from "./PayrollService";
import {
  assertTestDatabase,
  ensureSchema,
  createPeriod,
  sweepResidue,
  closePool,
} from "../test-support/integration-db";

/**
 * The two defects a real payslip surfaced: a store-local sale silently
 * dropped from its own period, and the drill-down disagreeing with the
 * entry it is supposed to be a view of.
 */

let seq = 0;

async function newStore() {
  const tag = `itest-${Date.now()}-${++seq}`;
  const [business] = await db.insert(organisations).values({ name: `Integration Test Co ${tag}` }).returning();
  // Every store in production runs Africa/Lagos (UTC+1) — the zone the live
  // bug was found in, where a UTC bucket key runs a day behind store-local.
  const [store] = await db.insert(stores).values({
    businessId: business.id, name: `Test Store ${tag}`, code: `T${seq}${String(Date.now()).slice(-5)}`,
    timezone: "Africa/Lagos",
  }).returning();
  const [staffMember] = await db.insert(staff).values({
    storeId: store.id, name: "Lead Test", email: `lead-${tag}@example.test`,
    staffNumber: `S-${tag}`, mobileNumber: "08000000000",
    paymentMethod: "hybrid", overridePaymentMethod: true, payPerMonth: 0,
  }).returning();
  const [product] = await db.insert(products).values({ storeId: store.id, name: `Wash ${tag}`, type: "service" }).returning();
  const [item] = await db.insert(inventory).values({
    storeId: store.id, name: `Wash ${tag}`, type: "service", productId: product.id, sellingPrice: 1000,
  }).returning();

  return {
    storeId: store.id,
    staffId: staffMember.id,
    inventoryId: item.id,
    /** One service checkout at a given UTC instant, as `leadStaffId`. */
    async sellAt(createdAt: Date, price = 1000) {
      const [order] = await db.insert(orders).values({
        storeId: store.id, inventoryId: item.id, quantity: 1, totalPrice: price,
      }).returning();
      await db.insert(checkouts).values({
        storeId: store.id, staffId: staffMember.id, leadStaffId: staffMember.id,
        orderId: order.id, totalPrice: price, subtotal: price, createdAt,
      });
    },
    async cleanup() {
      await db.execute(`DELETE FROM checkouts WHERE store_id = '${store.id}'`);
      await db.execute(`DELETE FROM orders WHERE store_id = '${store.id}'`);
      await db.execute(`DELETE FROM payroll_entries WHERE store_id = '${store.id}'`);
      await db.execute(`DELETE FROM payroll_periods WHERE store_id = '${store.id}'`);
      await db.execute(`DELETE FROM inventory WHERE store_id = '${store.id}'`);
      await db.execute(`DELETE FROM products WHERE store_id = '${store.id}'`);
      await db.execute(`DELETE FROM settings WHERE store_id = '${store.id}'`);
      await db.execute(`DELETE FROM staff WHERE store_id = '${store.id}'`);
      await db.execute(`DELETE FROM stores WHERE id = '${store.id}'`);
      await db.execute(`DELETE FROM organisations WHERE id = '${business.id}'`);
    },
  };
}

let cleanups: (() => Promise<void>)[] = [];

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
  await sweepResidue();
});

afterEach(async () => {
  for (const c of cleanups) await c();
  cleanups = [];
});

afterAll(async () => {
  await closePool();
});

describe("day bucketing", () => {
  // The exact live defect: a UTC calendar-date key does not match the
  // store-local `dateRange`, so on the period's first day the sale drops out
  // entirely rather than merely being misclassified.
  it("keeps a sale made just after store-local midnight inside its period", async () => {
    const fx = await newStore();
    cleanups.push(fx.cleanup);
    const period = await createPeriod(fx.storeId, "2026-08-01", "2026-08-31");

    // 2026-08-01T00:30 Africa/Lagos (UTC+1) is 2026-07-31T23:30Z — the old
    // `toISOString().split("T")[0]` bucket key was "2026-07-31", which is not
    // in an 08-01..08-31 dateRange.
    await fx.sellAt(new Date("2026-07-31T23:30:00.000Z"), 1000);

    const [entry] = await payrollService.calculatePayrollForPeriod(period.id);

    expect((entry.calculationDetails as any)?.totalServiceRevenueContribution).toBe(1000);
    expect(entry.activeDays).toBe(1);
  });

  it("keeps the drill-down's day in step with the same store-local bucket", async () => {
    const fx = await newStore();
    cleanups.push(fx.cleanup);
    const period = await createPeriod(fx.storeId, "2026-08-01", "2026-08-31");
    await fx.sellAt(new Date("2026-07-31T23:30:00.000Z"), 1000);

    await payrollService.calculatePayrollForPeriod(period.id);
    const drilldown = await payrollService.getPayrollDrillDown(period.id, fx.staffId);

    const day = drilldown.dailySummary.find(d => d.date === "2026-08-01");
    expect(day?.revenueShare).toBe(1000);
  });
});

describe("drill-down reconciliation", () => {
  // The second live defect: the drill-down used to report its own commission
  // total (price × commissionSplitStaffShare × role share) instead of a view
  // of the stored entry, so it disagreed with the "Gross Commission" card on
  // the same screen.
  it("reconciles to the exact stored grossCommission, not a second calculation", async () => {
    const fx = await newStore();
    cleanups.push(fx.cleanup);
    const period = await createPeriod(fx.storeId, "2026-08-01", "2026-08-31");
    // Enough revenue to clear the default ₦1,000/day active-transport offset
    // (formula_b, the store default) and leave something commissionable.
    await fx.sellAt(new Date("2026-08-05T10:00:00.000Z"), 5000);

    const [entry] = await payrollService.calculatePayrollForPeriod(period.id);
    const drilldown = await payrollService.getPayrollDrillDown(period.id, fx.staffId);

    expect(entry.grossCommission).toBeGreaterThan(0);
    expect(drilldown.reconciliation?.grossCommission).toBe(entry.grossCommission);

    const totalRevenueShare = drilldown.transactions.reduce((s, t) => s + t.revenueShare, 0);
    expect(totalRevenueShare).toBe((entry.calculationDetails as any)?.totalServiceRevenueContribution);
  });

  it("reports null reconciliation before the period has ever been calculated", async () => {
    const fx = await newStore();
    cleanups.push(fx.cleanup);
    const period = await createPeriod(fx.storeId, "2026-08-01", "2026-08-31");
    await fx.sellAt(new Date("2026-08-05T10:00:00.000Z"), 5000);

    const drilldown = await payrollService.getPayrollDrillDown(period.id, fx.staffId);

    expect(drilldown.reconciliation).toBeNull();
  });

  // The exact live case: revenue share below the transport already paid.
  it("floors at zero and explains the offset, both on the entry and the drill-down", async () => {
    const fx = await newStore();
    cleanups.push(fx.cleanup);
    const period = await createPeriod(fx.storeId, "2026-08-26", "2026-08-31");
    await fx.sellAt(new Date("2026-08-29T21:56:55.000Z"), 1000);

    const [entry] = await payrollService.calculatePayrollForPeriod(period.id);
    const drilldown = await payrollService.getPayrollDrillDown(period.id, fx.staffId);

    expect(entry.grossCommission).toBe(0);
    expect((entry.calculationDetails as any)?.commissionExplanation?.code).toBe("offset_by_transport");
    expect(drilldown.reconciliation?.explanation.code).toBe("offset_by_transport");
    expect(drilldown.reconciliation?.grossCommission).toBe(0);
  });
});
