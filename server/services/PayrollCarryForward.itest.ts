import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { payrollPeriods, payrollEntries, payrollDeductions, staff } from "@shared/schema";
import { payrollService } from "./PayrollService";
import {
  assertTestDatabase, ensureSchema, createFixture, createPeriod, sweepResidue, closePool, type Fixture,
} from "../test-support/integration-db";

/**
 * A shortfall left in a paid period is carried into the next one as a "carry_forward" deduction, one line per
 * person however many earlier periods left something owing. Recalculating must never duplicate it.
 */

let fixtures: Fixture[] = [];

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
  await sweepResidue();
});

afterEach(async () => {
  for (const f of fixtures) await f.cleanup();
  fixtures = [];
});

afterAll(async () => {
  await closePool();
});

async function paidPeriod(f: Fixture, start: string, end: string, owed: Array<[staffId: string, amount: number]>) {
  const p = await createPeriod(f.storeId, start, end);
  await db.update(payrollPeriods).set({ status: "paid", paidAt: new Date() }).where(eq(payrollPeriods.id, p.id));
  for (const [staffId, amount] of owed) {
    await db.insert(payrollEntries).values({ periodId: p.id, storeId: f.storeId, staffId, carryForwardAmount: amount } as any);
  }
  return p;
}

describe("carry-forward deductions", () => {
  it("adds one line per person from earlier paid periods, and does not duplicate on recalculation", async () => {
    const f = await createFixture();
    fixtures.push(f);
    const [b] = await db.insert(staff).values({
      storeId: f.storeId, name: "Second Person", email: `cf-${Date.now()}@test.local`,
      staffNumber: "CF2", mobileNumber: "08000000099", payPerMonth: 50000,
    } as any).returning();

    // A is owed from two earlier periods, B from one.
    await paidPeriod(f, "2098-10-01", "2098-10-31", [[f.staffId, 1000], [b.id, 500]]);
    await paidPeriod(f, "2098-11-01", "2098-11-30", [[f.staffId, 2000]]);
    const current = await createPeriod(f.storeId, "2099-01-01", "2099-01-31");

    const lines = async () =>
      db.select().from(payrollDeductions).where(and(eq(payrollDeductions.periodId, current.id), eq(payrollDeductions.type, "carry_forward")));

    await payrollService.calculatePayrollForPeriod(current.id);
    const first = await lines();
    expect(first.filter((l) => l.staffId === f.staffId)).toHaveLength(1);
    expect(first.filter((l) => l.staffId === b.id)).toHaveLength(1);
    expect([1000, 2000]).toContain(Number(first.find((l) => l.staffId === f.staffId)!.amount));
    expect(Number(first.find((l) => l.staffId === b.id)!.amount)).toBe(500);
    expect(first.every((l) => l.label.startsWith("Balance carried from"))).toBe(true);

    // Recalculating (it runs on every sale and attendance change) adds nothing more.
    await payrollService.calculatePayrollForPeriod(current.id);
    await payrollService.calculatePayrollForPeriod(current.id);
    expect(await lines()).toHaveLength(first.length);

    // Every person got exactly one entry from the single multi-row upsert, and recalculation updated rather than duplicated them.
    const entries = await db.select().from(payrollEntries).where(eq(payrollEntries.periodId, current.id));
    expect(entries.map((e) => e.staffId).sort()).toEqual([f.staffId, b.id].sort());
  });
});
