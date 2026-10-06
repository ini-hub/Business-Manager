import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { db } from "../db";
import { eq, sql } from "drizzle-orm";
import { customers, storeCreditTransactions } from "@shared/schema";
import { storage } from "../storage";
import {
  assertTestDatabase, ensureSchema, createFixture, sweepResidue, closePool, type Fixture,
} from "../test-support/integration-db";

/**
 * What the database holds after numbers are added, corrected and merged. Pure functions can't observe
 * these: the properties are that customers.mobile_number always mirrors the primary row, that a lookup by
 * ANY number finds the one profile, and that a merge keeps every number and every kind of balance.
 */

let fixtures: Fixture[] = [];
let seq = 0;
const num = () => `803${String(Date.now()).slice(-4)}${String(++seq).padStart(3, "0")}`;

async function newStore() {
  const f = await createFixture();
  fixtures.push(f);
  return f;
}

const make = (storeId: string, name: string, mobileNumber = "") =>
  storage.createCustomer({ storeId, name, address: "", mobileNumber, countryCode: "NG", customerNumber: "" } as any);

// The shared fixture teardown does not know about store credit history, which the merge test writes.
const clearCreditRows = () =>
  db.execute(sql`DELETE FROM store_credit_transactions WHERE store_id IN (SELECT id FROM stores WHERE name LIKE 'Test Store itest-%')`);

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
  await clearCreditRows();
  await sweepResidue();
});

afterEach(async () => {
  await clearCreditRows();
  for (const f of fixtures) await f.cleanup();
  fixtures = [];
});

afterAll(async () => {
  await clearCreditRows();
  await sweepResidue();
  await closePool();
});

describe("numbers on one profile", () => {
  it("finds the customer by any number and keeps mobile_number on the primary", async () => {
    const f = await newStore();
    const a = num(), b = num();
    const c = await make(f.storeId, "Amaka Obi", a);
    expect(c.mobileNumber).toBe(a);

    await storage.addCustomerPhone(c.id, b);
    expect((await storage.findCustomerByPhone(f.storeId, b))?.id).toBe(c.id);
    expect((await storage.findCustomerByPhone(f.storeId, a))?.id).toBe(c.id);
    expect((await storage.getCustomer(c.id))!.mobileNumber).toBe(a);

    const phones = await storage.getCustomerPhones(c.id);
    await storage.setPrimaryCustomerPhone(c.id, phones.find(p => p.number === b)!.id);
    expect((await storage.getCustomer(c.id))!.mobileNumber).toBe(b);
  });

  it("promotes another number when the primary is removed, and clears the mirror when none are left", async () => {
    const f = await newStore();
    const a = num(), b = num();
    const c = await make(f.storeId, "Chidi Eze", a);
    await storage.addCustomerPhone(c.id, b);

    const [primary] = (await storage.getCustomerPhones(c.id)).filter(p => p.isPrimary);
    await storage.removeCustomerPhone(c.id, primary.id);
    expect((await storage.getCustomer(c.id))!.mobileNumber).toBe(b);

    const [last] = await storage.getCustomerPhones(c.id);
    await storage.removeCustomerPhone(c.id, last.id);
    expect((await storage.getCustomer(c.id))!.mobileNumber).toBeNull();
    expect(await storage.getCustomerPhones(c.id)).toHaveLength(0);
  });

  it("treats the edit form's phone field as a correction of the primary, not an extra number", async () => {
    const f = await newStore();
    const typo = num(), fixed = num();
    const c = await make(f.storeId, "Ngozi Ade", typo);
    await storage.updateCustomer(c.id, { mobileNumber: fixed } as any);

    const phones = await storage.getCustomerPhones(c.id);
    expect(phones.map(p => p.number)).toEqual([fixed]);
    expect((await storage.getCustomer(c.id))!.mobileNumber).toBe(fixed);
  });

  it("names the profile that already owns a number", async () => {
    const f = await newStore();
    const a = num();
    const owner = await make(f.storeId, "Tunde Bello", a);
    const other = await make(f.storeId, "Tunde B");
    expect((await storage.findCustomerPhoneOwner(f.storeId, a, other.id))?.id).toBe(owner.id);
    expect(await storage.findCustomerPhoneOwner(f.storeId, a, owner.id)).toBeUndefined();
  });
});

describe("similar names", () => {
  it("matches the same words in any order, or a longer name containing them, but not a stranger", async () => {
    const f = await newStore();
    const ada = await make(f.storeId, "Ada Obi", num());
    await make(f.storeId, "Bola Johnson", num());

    const ids = async (name: string) => (await storage.findSimilarCustomers(f.storeId, name)).map(c => c.id);
    expect(await ids("obi ada")).toEqual([ada.id]);
    expect(await ids("Ada Chidi Obi")).toEqual([ada.id]);
    expect(await ids("Ada Johnson")).toEqual([]);
  });
});

describe("merging two profiles", () => {
  it("keeps every number, adds points and store credit, and archives the duplicate", async () => {
    const f = await newStore();
    const a = num(), b = num(), c2 = num();
    const keep = await make(f.storeId, "Kemi Alade", a);
    const dup = await make(f.storeId, "Kemi A", b);
    await storage.addCustomerPhone(dup.id, c2);

    await db.update(customers).set({ loyaltyPoints: 10, storeCreditBalance: 1500.5 }).where(eq(customers.id, keep.id));
    await db.update(customers).set({ loyaltyPoints: 5, storeCreditBalance: 499.5 }).where(eq(customers.id, dup.id));
    await db.insert(storeCreditTransactions).values({ customerId: dup.id, storeId: f.storeId, amount: 499.5, type: "manual_adjustment" });

    const merged = await storage.mergeCustomers(keep.id, dup.id, { name: "Kemi Alade" });

    expect(merged.loyaltyPoints).toBe(15);
    expect(merged.storeCreditBalance).toBe(2000);
    expect(merged.mobileNumber).toBe(a);

    const numbers = (await storage.getCustomerPhones(keep.id)).map(p => p.number).sort();
    expect(numbers).toEqual([a, b, c2].sort());
    expect((await storage.getCustomerPhones(keep.id)).filter(p => p.isPrimary).map(p => p.number)).toEqual([a]);

    // Any of the three numbers now finds the one live profile.
    for (const n of [a, b, c2]) expect((await storage.findCustomerByPhone(f.storeId, n))?.id).toBe(keep.id);

    const [archived] = await db.select().from(customers).where(eq(customers.id, dup.id));
    expect(archived.isArchived).toBe(true);
    expect(archived.mergedIntoId).toBe(keep.id);

    const credit = await db.select().from(storeCreditTransactions).where(eq(storeCreditTransactions.customerId, keep.id));
    expect(credit).toHaveLength(1);
  });

  it("carries a number that only exists on mobile_number (imported customers)", async () => {
    const f = await newStore();
    const a = num(), legacy = num();
    const keep = await make(f.storeId, "Seun Ola", a);
    const dup = await make(f.storeId, "Seun O");
    // An imported customer: has a number, but no customer_phones row.
    await db.update(customers).set({ mobileNumber: legacy }).where(eq(customers.id, dup.id));

    await storage.mergeCustomers(keep.id, dup.id);
    expect((await storage.getCustomerPhones(keep.id)).map(p => p.number).sort()).toEqual([a, legacy].sort());
  });

  it("refuses to retire a profile linked to a staff member, or to merge a profile into itself", async () => {
    const f = await newStore();
    const plain = await make(f.storeId, "Plain Person", num());
    await expect(storage.mergeCustomers(plain.id, f.customerId)).rejects.toThrow(/staff member/i);
    await expect(storage.mergeCustomers(plain.id, plain.id)).rejects.toThrow(/different customers/i);
  });
});
