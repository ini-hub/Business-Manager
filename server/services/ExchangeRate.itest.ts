import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { exchangeRates, payrollPeriods } from "@shared/schema";
import { MissingRateError } from "@shared/exchange-rates";
import { exchangeRateService } from "./ExchangeRateService";
import { storage } from "../storage";
import {
  assertTestDatabase, ensureSchema, createFixture, createPeriod, closePool, type Fixture,
} from "../test-support/integration-db";

/**
 * Owner-entered, effective-dated rates and their freeze onto an approved payroll period.
 * No sweepResidue(): the shared test DB can hold another run's live fixtures.
 */

let fixtures: Fixture[] = [];

async function newFixture() {
  const f = await createFixture();
  fixtures.push(f);
  return f;
}

const set = (f: Fixture, from: string, to: string, rate: number, effectiveFrom: string) =>
  exchangeRateService.set({ businessId: f.businessId, from, to, rate, effectiveFrom });

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
});

afterEach(async () => {
  for (const f of fixtures) {
    await db.delete(exchangeRates).where(eq(exchangeRates.businessId, f.businessId));
    await db.delete(payrollPeriods).where(eq(payrollPeriods.storeId, f.storeId));
    await f.cleanup();
  }
  fixtures = [];
});

afterAll(async () => {
  await closePool();
});

describe("exchange rates", () => {
  it("resolves the latest rate on or before the date, per ordered pair", async () => {
    const f = await newFixture();
    await set(f, "GHS", "NGN", 100, "2026-01-01");
    await set(f, "GHS", "NGN", 110, "2026-06-01");

    expect((await exchangeRateService.resolve(f.businessId, "GHS", "NGN", "2026-05-31"))?.rate).toBe(100);
    expect((await exchangeRateService.resolve(f.businessId, "GHS", "NGN", "2026-06-01"))?.rate).toBe(110);
    expect(await exchangeRateService.resolve(f.businessId, "GHS", "NGN", "2025-12-31")).toBeNull();
    // The other direction was never entered and is never derived.
    expect(await exchangeRateService.resolve(f.businessId, "NGN", "GHS", "2026-06-01")).toBeNull();
    expect((await exchangeRateService.resolve(f.businessId, "NGN", "NGN", "2026-06-01"))?.rate).toBe(1);
  });

  it("replaces the rate for the same pair and date instead of adding a second", async () => {
    const f = await newFixture();
    await set(f, "GHS", "NGN", 100, "2026-01-01");
    await set(f, "GHS", "NGN", 105.123456789, "2026-01-01");
    const rows = await exchangeRateService.list(f.businessId);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].rate)).toBe(105.12345679); // stored to 8 places
  });

  it("require() throws MissingRateError naming the pair and date", async () => {
    const f = await newFixture();
    await expect(exchangeRateService.require(f.businessId, "GHS", "NGN", "2026-06-30"))
      .rejects.toBeInstanceOf(MissingRateError);
  });

  it("rejects an invalid rate and keeps businesses separate", async () => {
    const a = await newFixture();
    const b = await newFixture();
    await expect(set(a, "GHS", "NGN", 0, "2026-01-01")).rejects.toThrow(/greater than zero/);
    await expect(set(a, "NGN", "NGN", 1, "2026-01-01")).rejects.toThrow(/different/);
    await set(a, "GHS", "NGN", 100, "2026-01-01");
    expect(await exchangeRateService.resolve(b.businessId, "GHS", "NGN", "2026-06-01")).toBeNull();
  });

  it("removes a rate only within its own business", async () => {
    const a = await newFixture();
    const b = await newFixture();
    const row = await set(a, "GHS", "NGN", 100, "2026-01-01");
    expect(await exchangeRateService.remove(b.businessId, row.id)).toBeUndefined();
    expect(await exchangeRateService.remove(a.businessId, row.id)).toBeDefined();
  });

  it("an approved period keeps the rates it was approved with, whatever is edited afterwards", async () => {
    const f = await newFixture();
    await set(f, "GHS", "NGN", 100, "2026-01-01");
    const period = await createPeriod(f.storeId, "2026-06-01", "2026-06-30");

    const snapshot = await exchangeRateService.snapshotFor(f.businessId, "NGN", period.endDate);
    expect(snapshot).toHaveLength(1);
    await storage.updatePayrollPeriodStatus(period.id, "approved", undefined, undefined, snapshot);

    // The owner now corrects the rate and adds a later one.
    await set(f, "GHS", "NGN", 999, "2026-01-01");
    await set(f, "GHS", "NGN", 120, "2026-06-15");

    const [stored] = await db.select().from(payrollPeriods).where(eq(payrollPeriods.id, period.id));
    const frozen = stored.ratesSnapshot as Array<{ fromCurrency: string; toCurrency: string; rate: number; effectiveFrom: string }>;
    expect(frozen).toHaveLength(1);
    expect(frozen[0].rate).toBe(100);
    // Conversions for the approved period read the frozen rows, not the edited table.
    expect((await exchangeRateService.resolve(f.businessId, "GHS", "NGN", "2026-06-20", frozen))?.rate).toBe(100);
    // Without the snapshot the live table now answers differently, which is exactly what the freeze prevents.
    expect((await exchangeRateService.resolve(f.businessId, "GHS", "NGN", "2026-06-20"))?.rate).toBe(120);
  });

  it("snapshotFor includes only rates converting into the store currency and effective by the period end", async () => {
    const f = await newFixture();
    await set(f, "GHS", "NGN", 100, "2026-01-01");
    await set(f, "GHS", "NGN", 130, "2026-07-01"); // after the period
    await set(f, "NGN", "GHS", 0.01, "2026-01-01"); // wrong direction for an NGN store
    const snap = await exchangeRateService.snapshotFor(f.businessId, "NGN", "2026-06-30");
    expect(snap.map((r) => `${r.fromCurrency}>${r.toCurrency}@${r.effectiveFrom}`)).toEqual(["GHS>NGN@2026-01-01"]);
  });
});
