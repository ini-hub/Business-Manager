import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { hrEstateBeneficiaries, hrDependants } from "@shared/schema";
import { estateBeneficiaryService } from "./EstateBeneficiaryService";
import { assertTestDatabase, ensureSchema, createFixture, sweepResidue, closePool, type Fixture } from "../test-support/integration-db";

/**
 * The property under test - "percentages across a staff member's
 * beneficiary rows never exceed 100%" - is enforced with a row lock inside
 * a transaction (see EstateBeneficiaryService), not a DB constraint, so it
 * has to be exercised against a real database to mean anything.
 */

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
    await db.delete(hrEstateBeneficiaries).where(eq(hrEstateBeneficiaries.staffId, f.staffId));
    await db.delete(hrDependants).where(eq(hrDependants.staffId, f.staffId));
    await f.cleanup();
  }
  fixtures = [];
});

afterAll(async () => {
  await sweepResidue();
  await closePool();
});

describe("EstateBeneficiaryService", () => {
  it("accepts beneficiaries that sum to exactly 100%", async () => {
    const f = await newFixture();
    const first = await estateBeneficiaryService.createBeneficiary(f.staffId, { name: "Alice", percentage: 60 });
    const second = await estateBeneficiaryService.createBeneficiary(f.staffId, { name: "Bob", percentage: 40 });
    expect(first.kind).toBe("ok");
    expect(second.kind).toBe("ok");

    const rows = await estateBeneficiaryService.listBeneficiaries(f.staffId);
    expect(rows.reduce((sum, r) => sum + Number(r.percentage), 0)).toBe(100);
  });

  it("refuses a beneficiary that would push the total over 100%", async () => {
    const f = await newFixture();
    await estateBeneficiaryService.createBeneficiary(f.staffId, { name: "Alice", percentage: 70 });
    const outcome = await estateBeneficiaryService.createBeneficiary(f.staffId, { name: "Bob", percentage: 40 });
    expect(outcome.kind).toBe("exceeds_100");

    const rows = await estateBeneficiaryService.listBeneficiaries(f.staffId);
    expect(rows).toHaveLength(1);
  });

  it("allows an update that keeps the total at or under 100%, refuses one that would not", async () => {
    const f = await newFixture();
    const created = await estateBeneficiaryService.createBeneficiary(f.staffId, { name: "Alice", percentage: 50 });
    if (created.kind !== "ok") throw new Error("setup failed");
    await estateBeneficiaryService.createBeneficiary(f.staffId, { name: "Bob", percentage: 30 });

    const okUpdate = await estateBeneficiaryService.updateBeneficiary(f.staffId, created.beneficiary.id, { name: "Alice", percentage: 65 });
    expect(okUpdate.kind).toBe("ok");

    const badUpdate = await estateBeneficiaryService.updateBeneficiary(f.staffId, created.beneficiary.id, { name: "Alice", percentage: 80 });
    expect(badUpdate.kind).toBe("exceeds_100");
  });

  it("scopes the 100% total to one staff member at a time", async () => {
    const f1 = await newFixture();
    const f2 = await newFixture();
    await estateBeneficiaryService.createBeneficiary(f1.staffId, { name: "Alice", percentage: 90 });
    const outcome = await estateBeneficiaryService.createBeneficiary(f2.staffId, { name: "Carol", percentage: 90 });
    expect(outcome.kind).toBe("ok");
  });
});
