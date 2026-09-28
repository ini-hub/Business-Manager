import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { capitalContributions, assets, liabilities } from "@shared/schema";
import { AccountingRepository } from "../repositories/AccountingRepository";
import { AccountingService } from "../services/AccountingService";
import { assertTestDatabase, ensureSchema, createFixture, sweepResidue, closePool, type Fixture } from "../test-support/integration-db";

/**
 * Covers the balance-sheet math end to end against a real Postgres, since the
 * numbers being asserted here come from a join across three new tables plus
 * AnalyticsService's all-time P&L — not observable from a pure function.
 *
 * The one invariant worth stress-testing beyond the happy path: retained
 * earnings/ROI must never throw or silently coerce to Infinity/NaN when
 * capital-invested is zero (a store that never recorded any capital) — that's
 * the most likely path a real store hits before anyone fills in Settings →
 * Capital & Assets.
 */

const repo = new AccountingRepository();
const service = new AccountingService();

let fixtures: Fixture[] = [];

async function newFixture() {
  const f = await createFixture();
  fixtures.push(f);
  return f;
}

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
  await sweepResidue();
});

afterEach(async () => {
  for (const f of fixtures) {
    await db.delete(capitalContributions).where(eq(capitalContributions.storeId, f.storeId));
    await db.delete(assets).where(eq(assets.storeId, f.storeId));
    await db.delete(liabilities).where(eq(liabilities.storeId, f.storeId));
    await f.cleanup();
  }
  fixtures = [];
});

afterAll(async () => {
  await sweepResidue();
  await closePool();
});

describe("AccountingService.getBalanceSheet", () => {
  it("returns all zeros and a null ROI for a brand-new store with nothing recorded", async () => {
    const f = await newFixture();
    const sheet = await service.getBalanceSheet(f.storeId);

    expect(sheet.totalAssets).toBe(0);
    expect(sheet.totalLiabilities).toBe(0);
    expect(sheet.totalCapitalInvested).toBe(0);
    expect(sheet.totalWithdrawals).toBe(0);
    expect(sheet.cumulativeNetProfit).toBe(0);
    expect(sheet.retainedEarnings).toBe(0);
    expect(sheet.totalEquity).toBe(0);
    expect(sheet.netWorth).toBe(0);
    // Never a division by zero - null reads on the UI as "—", not NaN/Infinity.
    expect(sheet.roi).toBeNull();
    expect(sheet.assetsByCategory).toEqual([]);
  });

  it("sums multiple assets and liabilities and nets capital against withdrawals", async () => {
    const f = await newFixture();
    await repo.addCapitalContribution({ storeId: f.storeId, type: "capital_injection", amount: 500_000, date: "2026-01-01" } as any);
    await repo.addCapitalContribution({ storeId: f.storeId, type: "capital_injection", amount: 100_000, date: "2026-02-01" } as any);
    await repo.addCapitalContribution({ storeId: f.storeId, type: "withdrawal", amount: 50_000, date: "2026-03-01" } as any);
    await repo.addAsset({ storeId: f.storeId, name: "Opening cash", category: "cash", value: 200_000 } as any);
    await repo.addAsset({ storeId: f.storeId, name: "Fridge", category: "fixed", value: 80_000 } as any);
    await repo.addAsset({ storeId: f.storeId, name: "Fridge #2", category: "fixed", value: 20_000 } as any);
    await repo.addLiability({ storeId: f.storeId, name: "Supplier credit", category: "payable", amount: 30_000 } as any);

    const sheet = await service.getBalanceSheet(f.storeId);

    expect(sheet.totalAssets).toBe(300_000);
    expect(sheet.totalLiabilities).toBe(30_000);
    expect(sheet.totalCapitalInvested).toBe(600_000);
    expect(sheet.totalWithdrawals).toBe(50_000);
    // No sales in this fixture, so cumulative net profit is 0; retained
    // earnings is purely -withdrawals.
    expect(sheet.cumulativeNetProfit).toBe(0);
    expect(sheet.retainedEarnings).toBe(-50_000);
    // totalEquity = (capital - withdrawals) + retainedEarnings = 550,000 - 50,000
    expect(sheet.totalEquity).toBe(500_000);
    expect(sheet.netWorth).toBe(270_000);
    expect(sheet.roi).toBeCloseTo(-50_000 / 600_000, 10);

    const fixedTotal = sheet.assetsByCategory.find((a) => a.category === "fixed")?.total;
    expect(fixedTotal).toBe(100_000);
    const cashTotal = sheet.assetsByCategory.find((a) => a.category === "cash")?.total;
    expect(cashTotal).toBe(200_000);
  });

  it("keeps two stores' balance sheets fully isolated from each other", async () => {
    const a = await newFixture();
    const b = await newFixture();

    await repo.addCapitalContribution({ storeId: a.storeId, type: "capital_injection", amount: 1_000_000, date: "2026-01-01" } as any);
    await repo.addAsset({ storeId: a.storeId, name: "Van", category: "fixed", value: 400_000 } as any);

    await repo.addCapitalContribution({ storeId: b.storeId, type: "capital_injection", amount: 10_000, date: "2026-01-01" } as any);

    const sheetA = await service.getBalanceSheet(a.storeId);
    const sheetB = await service.getBalanceSheet(b.storeId);

    expect(sheetA.totalCapitalInvested).toBe(1_000_000);
    expect(sheetA.totalAssets).toBe(400_000);
    expect(sheetB.totalCapitalInvested).toBe(10_000);
    expect(sheetB.totalAssets).toBe(0);
  });

  it("deleting an asset removes it from the balance sheet immediately", async () => {
    const f = await newFixture();
    const created = await repo.addAsset({ storeId: f.storeId, name: "Laptop", category: "other", value: 15_000 } as any);

    let sheet = await service.getBalanceSheet(f.storeId);
    expect(sheet.totalAssets).toBe(15_000);

    await repo.deleteAsset(created.id);

    sheet = await service.getBalanceSheet(f.storeId);
    expect(sheet.totalAssets).toBe(0);
    expect(sheet.assetsByCategory).toEqual([]);
  });

  it("updating a liability's amount is reflected on the next read", async () => {
    const f = await newFixture();
    const created = await repo.addLiability({ storeId: f.storeId, name: "Loan", category: "loan", amount: 100_000 } as any);

    await repo.updateLiability(created.id, { amount: 40_000 } as any);

    const sheet = await service.getBalanceSheet(f.storeId);
    expect(sheet.totalLiabilities).toBe(40_000);
  });
});

describe("AccountingRepository", () => {
  it("lists capital contributions newest-date-first", async () => {
    const f = await newFixture();
    await repo.addCapitalContribution({ storeId: f.storeId, type: "capital_injection", amount: 1, date: "2026-01-01" } as any);
    await repo.addCapitalContribution({ storeId: f.storeId, type: "capital_injection", amount: 2, date: "2026-03-01" } as any);
    await repo.addCapitalContribution({ storeId: f.storeId, type: "capital_injection", amount: 3, date: "2026-02-01" } as any);

    const list = await repo.listCapitalContributions(f.storeId);
    expect(list.map((c) => c.date)).toEqual(["2026-03-01", "2026-02-01", "2026-01-01"]);
  });

  it("does not return another store's assets or liabilities", async () => {
    const a = await newFixture();
    const b = await newFixture();
    await repo.addAsset({ storeId: a.storeId, name: "A's asset", category: "other", value: 1 } as any);
    await repo.addLiability({ storeId: a.storeId, name: "A's liability", category: "other", amount: 1 } as any);

    expect(await repo.listAssets(b.storeId)).toEqual([]);
    expect(await repo.listLiabilities(b.storeId)).toEqual([]);
  });
});
