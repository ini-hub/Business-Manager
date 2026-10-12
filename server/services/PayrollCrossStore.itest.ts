import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { db } from "../db";
import { eq } from "drizzle-orm";
import {
  organisations, stores, staff, staffStoreAssignments, products, inventory, orders, checkouts,
  attendanceRecords, exchangeRates, payrollPeriods,
} from "@shared/schema";
import { MissingRateError } from "@shared/exchange-rates";
import { payrollService } from "./PayrollService";
import { exchangeRateService } from "./ExchangeRateService";
import { storage } from "../storage";
import { assertTestDatabase, ensureSchema, createPeriod, closePool } from "../test-support/integration-db";

/**
 * A person is paid by their HOME store for work at every store they are assigned to, with the home store's
 * settings; money in another currency is converted at a stored rate and a missing rate stops the run.
 * No sweepResidue(): the shared test DB can hold another run's live fixtures.
 */

let seq = 0;
const cleanups: Array<() => Promise<void>> = [];

async function world(opts: { awayCurrency?: string } = {}) {
  const tag = `xs-${Date.now()}-${++seq}`;
  const [business] = await db.insert(organisations).values({ name: `Integration Test Co ${tag}` }).returning();
  const mkStore = async (label: string, currency: string) => {
    const [s] = await db.insert(stores).values({
      businessId: business.id, name: `Test Store ${tag}-${label}`, code: `X${seq}${label}${String(Date.now()).slice(-4)}`,
      timezone: "Africa/Lagos", currency,
    }).returning();
    const [product] = await db.insert(products).values({ storeId: s.id, name: `Wash ${label}`, type: "service" }).returning();
    const [item] = await db.insert(inventory).values({
      storeId: s.id, name: `Wash ${label}`, type: "service", productId: product.id, sellingPrice: 100,
    }).returning();
    return { ...s, itemId: item.id };
  };
  const home = await mkStore("H", "NGN");
  const away = await mkStore("B", opts.awayCurrency ?? "NGN");

  const mkStaff = async (storeId: string, label: string) => {
    const [m] = await db.insert(staff).values({
      storeId, name: `Person ${label}`, email: `${label}-${tag}@example.test`, staffNumber: `S-${label}-${tag}`,
      mobileNumber: `080${label === "X" ? "1" : "2"}${String(Date.now()).slice(-6)}`,
      paymentMethod: "hybrid", overridePaymentMethod: true, payPerMonth: 0,
    }).returning();
    await db.insert(staffStoreAssignments).values({ staffId: m.id, storeId, staffNumber: m.staffNumber, role: m.role });
    return m;
  };
  const x = await mkStaff(home.id, "X"); // homed at H, works at B
  const y = await mkStaff(away.id, "Y"); // homed at B

  const assignXToAway = (isArchived = false) =>
    db.insert(staffStoreAssignments).values({ staffId: x.id, storeId: away.id, staffNumber: `AW-${tag}`, isArchived });

  async function sell(store: typeof home, staffId: string, price: number, at: string) {
    const [order] = await db.insert(orders).values({
      storeId: store.id, inventoryId: store.itemId, quantity: 1, totalPrice: price,
    }).returning();
    await db.insert(checkouts).values({
      storeId: store.id, staffId, leadStaffId: staffId, orderId: order.id,
      totalPrice: price, subtotal: price, createdAt: new Date(at),
    });
  }

  cleanups.push(async () => {
    const ids = [home.id, away.id];
    for (const id of ids) {
      for (const t of ["checkouts", "orders", "attendance_records", "payroll_deductions", "payroll_entries", "payroll_periods", "inventory", "products", "settings"]) {
        await db.execute(`DELETE FROM ${t} WHERE store_id = '${id}'` as any);
      }
    }
    await db.delete(exchangeRates).where(eq(exchangeRates.businessId, business.id));
    await db.execute(`DELETE FROM staff_store_assignments WHERE store_id IN ('${home.id}','${away.id}')` as any);
    await db.execute(`DELETE FROM staff WHERE store_id IN ('${home.id}','${away.id}')` as any);
    await db.execute(`DELETE FROM stores WHERE id IN ('${home.id}','${away.id}')` as any);
    await db.execute(`DELETE FROM organisations WHERE id = '${business.id}'` as any);
  });

  return { business, home, away, x, y, sell, assignXToAway };
}

const revenueOf = (entry: any) => (entry.calculationDetails as any)?.totalServiceRevenueContribution;

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
});

afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

afterAll(async () => {
  await closePool();
});

// Midday Lagos on 2026-06-10, inside a June period.
const DAY = "2026-06-10T11:00:00.000Z";

describe("payroll across assigned stores (same currency)", () => {
  it("pays the home store's person for sales at an assigned store, and not at the store they only visit", async () => {
    const w = await world();
    await w.assignXToAway();
    await w.sell(w.away, w.x.id, 5_000, DAY);
    await w.sell(w.home, w.x.id, 1_000, DAY);

    const homePeriod = await createPeriod(w.home.id, "2026-06-01", "2026-06-30");
    const homeEntries = await payrollService.calculatePayrollForPeriod(homePeriod.id);
    expect(homeEntries.map((e) => e.staffId)).toEqual([w.x.id]);
    expect(revenueOf(homeEntries[0])).toBe(6_000);

    // The away store's payroll covers its own people only: X is not homed there, so nothing is paid twice.
    const awayPeriod = await createPeriod(w.away.id, "2026-06-01", "2026-06-30");
    const awayEntries = await payrollService.calculatePayrollForPeriod(awayPeriod.id);
    expect(awayEntries.map((e) => e.staffId)).toEqual([w.y.id]);
    expect(revenueOf(awayEntries[0])).toBe(0);
  });

  it("ignores sales at a store the person is not (or no longer) assigned to", async () => {
    const w = await world();
    await w.sell(w.home, w.x.id, 1_000, DAY);
    await w.assignXToAway(true); // archived
    await w.sell(w.away, w.x.id, 5_000, DAY);

    const period = await createPeriod(w.home.id, "2026-06-01", "2026-06-30");
    const [entry] = await payrollService.calculatePayrollForPeriod(period.id);
    expect(revenueOf(entry)).toBe(1_000);
  });

  it("counts a day once when attendance exists at both stores, present at either meaning present", async () => {
    const w = await world();
    await w.assignXToAway();
    await db.insert(attendanceRecords).values([
      { storeId: w.home.id, staffId: w.x.id, date: "2026-06-10", status: "absent" },
      { storeId: w.away.id, staffId: w.x.id, date: "2026-06-10", status: "present" },
    ]);
    const period = await createPeriod(w.home.id, "2026-06-10", "2026-06-10");
    const [entry] = await payrollService.calculatePayrollForPeriod(period.id);
    expect(entry.passiveDays).toBe(1);
    expect(entry.absentDays).toBe(0);
  });

  it("drill-down shows the same revenue the entry was paid on", async () => {
    const w = await world();
    await w.assignXToAway();
    await w.sell(w.away, w.x.id, 5_000, DAY);
    const period = await createPeriod(w.home.id, "2026-06-01", "2026-06-30");
    const [entry] = await payrollService.calculatePayrollForPeriod(period.id);
    const drill = await payrollService.getPayrollDrillDown(period.id, w.x.id);
    const total = drill.transactions.reduce((n, t) => n + t.revenueShare, 0);
    expect(total).toBe(revenueOf(entry));
    expect(total).toBe(5_000);
  });
});

describe("payroll across currencies", () => {
  it("converts the away store's sales at the rate in force on the sale date", async () => {
    const w = await world({ awayCurrency: "GHS" });
    await w.assignXToAway();
    await exchangeRateService.set({ businessId: w.business.id, from: "GHS", to: "NGN", rate: 100, effectiveFrom: "2026-01-01" });
    await exchangeRateService.set({ businessId: w.business.id, from: "GHS", to: "NGN", rate: 110, effectiveFrom: "2026-06-05" });
    await w.sell(w.away, w.x.id, 50, "2026-06-02T11:00:00.000Z"); // 50 * 100
    await w.sell(w.away, w.x.id, 50, DAY);                         // 50 * 110
    await w.sell(w.home, w.x.id, 1_000, DAY);                      // already NGN

    const period = await createPeriod(w.home.id, "2026-06-01", "2026-06-30");
    const [entry] = await payrollService.calculatePayrollForPeriod(period.id);
    expect(revenueOf(entry)).toBe(5_000 + 5_500 + 1_000);
    expect(JSON.stringify((entry.calculationDetails as any)?.formulaSteps ?? [])).toContain("converted to NGN");

    const drill = await payrollService.getPayrollDrillDown(period.id, w.x.id);
    expect(drill.transactions.reduce((n, t) => n + t.revenueShare, 0)).toBe(11_500);
  });

  it("stops the run with MissingRateError when no rate is set, instead of guessing", async () => {
    const w = await world({ awayCurrency: "GHS" });
    await w.assignXToAway();
    await w.sell(w.away, w.x.id, 50, DAY);
    const period = await createPeriod(w.home.id, "2026-06-01", "2026-06-30");
    await expect(payrollService.calculatePayrollForPeriod(period.id)).rejects.toBeInstanceOf(MissingRateError);
  });

  it("does not need a rate for sales nobody on this payroll took part in", async () => {
    const w = await world({ awayCurrency: "GHS" });
    await w.assignXToAway();
    await w.sell(w.away, w.y.id, 50, DAY); // Y's own sale at the away store
    const period = await createPeriod(w.home.id, "2026-06-01", "2026-06-30");
    const [entry] = await payrollService.calculatePayrollForPeriod(period.id);
    expect(revenueOf(entry)).toBe(0);
  });

  it("an approved period recalculates on the rates frozen at approval, not on later edits", async () => {
    const w = await world({ awayCurrency: "GHS" });
    await w.assignXToAway();
    await exchangeRateService.set({ businessId: w.business.id, from: "GHS", to: "NGN", rate: 100, effectiveFrom: "2026-01-01" });
    await w.sell(w.away, w.x.id, 50, DAY);

    const period = await createPeriod(w.home.id, "2026-06-01", "2026-06-30");
    const snapshot = await exchangeRateService.snapshotFor(w.business.id, "NGN", period.endDate);
    await storage.updatePayrollPeriodStatus(period.id, "approved", undefined, undefined, snapshot);

    // The owner edits the rate afterwards.
    await exchangeRateService.set({ businessId: w.business.id, from: "GHS", to: "NGN", rate: 999, effectiveFrom: "2026-01-01" });

    const [entry] = await payrollService.calculatePayrollForPeriod(period.id);
    expect(revenueOf(entry)).toBe(5_000);

    // A pending period would have used the new rate.
    const [stored] = await db.select().from(payrollPeriods).where(eq(payrollPeriods.id, period.id));
    await db.update(payrollPeriods).set({ status: "pending" }).where(eq(payrollPeriods.id, stored.id));
    const [live] = await payrollService.calculatePayrollForPeriod(period.id);
    expect(revenueOf(live)).toBe(49_950);
  });
});
