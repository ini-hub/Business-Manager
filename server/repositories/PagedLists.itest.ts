import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import { sql } from "drizzle-orm";
import {
  stores, customers, products, inventory, expenseCategories, expenses, expenseLinkedItems, creditEntries,
  attendanceRetroRequests, stockTransfers, cashRegisterSessions,
} from "@shared/schema";
import { storage } from "../storage";
import { attendanceService } from "../services/AttendanceService";
import {
  assertTestDatabase, ensureSchema, createFixture, sweepResidue, closePool, type Fixture,
} from "../test-support/integration-db";

/**
 * The list endpoints now page in SQL. These check the logic-heavy ones against what the old unpaged reads
 * returned (expenses, via getExpenses as the oracle) or against the rules the old code applied after fetching
 * (credit ledger search and overdue handling, pending-first retro requests, archived-by-name, transfer labels).
 */

let f: Fixture;
let otherStoreId: string;
let otherCustomerId: string;

async function clearAll(storeId: string) {
  const s = sql`${storeId}`;
  await db.execute(sql`DELETE FROM expense_linked_items WHERE expense_id IN (SELECT id FROM expenses WHERE store_id = ${s})`);
  await db.execute(sql`DELETE FROM expenses WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM expense_categories WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM repayments WHERE credit_entry_id IN (SELECT id FROM credit_entries WHERE store_id = ${s})`);
  await db.execute(sql`DELETE FROM credit_entries WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM attendance_retro_requests WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM stock_transfers WHERE from_store_id = ${s} OR to_store_id = ${s}`);
  await db.execute(sql`DELETE FROM cash_register_sessions WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM stock_movements WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM inventory WHERE store_id = ${s}`);
  await db.execute(sql`DELETE FROM products WHERE store_id = ${s}`);
}
async function clearResidue() {
  const { rows } = await db.execute(sql`SELECT id FROM stores WHERE name LIKE 'Test Store itest-%' OR name LIKE 'Paged Other %'`);
  for (const r of rows) await clearAll(r.id as string);
  await sweepResidue();
}

const ids = <T extends { id: string }>(rows: T[]) => rows.map((r) => r.id);

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
  await clearResidue();
  f = await createFixture();
  const [other] = await db.insert(stores).values({
    businessId: f.businessId, name: `Paged Other ${Date.now()}`, code: `PO${String(Date.now()).slice(-6)}`, timezone: "Africa/Lagos",
  } as any).returning();
  otherStoreId = other.id;
  const [oc] = await db.insert(customers).values({
    storeId: otherStoreId, name: "Zainab Okafor", customerNumber: `ZO${Date.now()}`, address: "x", mobileNumber: "08031112222",
  } as any).returning();
  otherCustomerId = oc.id;
});

afterAll(async () => {
  if (f) {
    await clearAll(f.storeId);
    await clearAll(otherStoreId);
    await db.execute(sql`DELETE FROM customers WHERE store_id = ${otherStoreId}`);
    await db.execute(sql`DELETE FROM stores WHERE id = ${otherStoreId}`);
    await f.cleanup();
  }
  await clearResidue();
  await closePool();
});

describe("expenses", () => {
  it("returns the same rows as the unpaged read for every type filter, page by page", async () => {
    const [category] = await db.insert(expenseCategories).values({ storeId: f.storeId, name: "Misc" } as any).returning();
    const mk = async (name: string, o: { type?: "product" | "service"; date: string }) => {
      const [product] = await db.insert(products).values({ storeId: f.storeId, name, type: o.type ?? "product" } as any).returning();
      const [item] = await db.insert(inventory).values({
        storeId: f.storeId, productId: product.id, name, type: o.type ?? "product", costPrice: 1, sellingPrice: 2, quantity: 1,
      } as any).returning();
      return { product, item, date: o.date };
    };
    const svc = await mk("Cut", { type: "service", date: "2026-03-05" });
    const prod = await mk("Gel", { type: "product", date: "2026-03-06" });
    const add = (title: string, date: string, extra: Record<string, unknown> = {}) =>
      db.insert(expenses).values({ storeId: f.storeId, title, categoryId: category.id, date, amount: 100, ...extra } as any).returning().then((r) => r[0]);

    await add("A general", "2026-03-01");
    await add("B general", "2026-03-02");
    const c = await add("C linked via table", "2026-03-03");
    await db.insert(expenseLinkedItems).values({ expenseId: c.id, productId: prod.product.id } as any);
    await add("D legacy service", "2026-03-04", { inventoryId: svc.item.id });
    await add("E legacy product", "2026-03-05", { inventoryId: prod.item.id });
    await add("F outside range", "2025-01-01");

    for (const type of [undefined, "all", "general", "linked", "service", "product"] as const) {
      const want = await storage.getExpenses(f.storeId, "2026-03-01", "2026-03-31", type as any);
      const all = await storage.getExpensesPage(f.storeId, { startDate: "2026-03-01", endDate: "2026-03-31", type: type as any }, { limit: 100, offset: 0 });
      expect(all.total).toBe(want.length);
      expect(ids(all.rows).sort()).toEqual(ids(want).sort());
    }

    // Paging walks the whole set once, newest first, with no repeats.
    const seen: string[] = [];
    for (let offset = 0; ; offset += 2) {
      const page = await storage.getExpensesPage(f.storeId, { startDate: "2026-03-01", endDate: "2026-03-31" }, { limit: 2, offset });
      seen.push(...ids(page.rows));
      if (offset + 2 >= page.total) break;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    const first = await storage.getExpensesPage(f.storeId, { startDate: "2026-03-01", endDate: "2026-03-31" }, { limit: 1, offset: 0 });
    expect(first.rows[0].title).toBe("E legacy product"); // 2026-03-05 is the newest
    expect(first.rows[0].linkedProducts).toEqual([]);
    const linked = await storage.getExpensesPage(f.storeId, { type: "linked", startDate: "2026-03-01", endDate: "2026-03-31" }, { limit: 10, offset: 0 });
    expect(linked.rows.find((r) => r.title.startsWith("C"))?.linkedProducts).toHaveLength(1);
  });
});

describe("credit ledger", () => {
  it("searches name and phone in the query, pages across stores, and counts what it filters", async () => {
    const entry = (storeId: string, customerId: string, o: Record<string, unknown> = {}) =>
      db.insert(creditEntries).values({ storeId, customerId, amountOwed: 5000, outstandingBalance: 5000, ...o } as any).returning().then((r) => r[0]);
    await entry(f.storeId, f.customerId);
    await entry(f.storeId, f.customerId);
    await entry(otherStoreId, otherCustomerId, { status: "settled", outstandingBalance: 0 });
    // Past its due date and still owing: reported as overdue, as before.
    await entry(otherStoreId, otherCustomerId, { status: "owing", dueDate: new Date(Date.now() - 5 * 86400000) });

    const repo = storage.creditRepo;
    const everything = await repo.getCreditLedger([f.storeId, otherStoreId], {}, { limit: 100, offset: 0 });
    expect(everything.total).toBe(4);
    expect(everything.rows).toHaveLength(4);

    const firstPage = await repo.getCreditLedger([f.storeId, otherStoreId], {}, { limit: 3, offset: 0 });
    const secondPage = await repo.getCreditLedger([f.storeId, otherStoreId], {}, { limit: 3, offset: 3 });
    expect(firstPage.rows).toHaveLength(3);
    expect(secondPage.rows).toHaveLength(1);
    expect(new Set([...ids(firstPage.rows), ...ids(secondPage.rows)]).size).toBe(4);
    expect(firstPage.total).toBe(4);
    expect(secondPage.total).toBe(4);

    // Search by name (any case) and by phone digits; the total follows the filter.
    const byName = await repo.getCreditLedger([f.storeId, otherStoreId], { search: "zainab" }, { limit: 100, offset: 0 });
    expect(byName.total).toBe(2);
    expect(byName.rows.every((r) => r.customer.name === "Zainab Okafor")).toBe(true);
    const byPhone = await repo.getCreditLedger([f.storeId, otherStoreId], { search: "0803111" }, { limit: 100, offset: 0 });
    expect(byPhone.total).toBe(2);
    expect((await repo.getCreditLedger([f.storeId, otherStoreId], { search: "%" }, { limit: 100, offset: 0 })).total).toBe(0); // a literal %

    const overdue = everything.rows.filter((r) => r.status === "overdue");
    expect(overdue).toHaveLength(1);
    const settledOnly = await repo.getCreditLedger(otherStoreId, { status: ["settled"] }, { limit: 100, offset: 0 });
    expect(settledOnly.total).toBe(1);
    expect((await repo.getCreditLedger([], {}, { limit: 10, offset: 0 })).total).toBe(0);
  });
});

describe("missed clock-in requests", () => {
  it("lists pending requests first so an old one cannot be buried on a later page", async () => {
    const mk = (date: string, status: string, ago: number) =>
      db.insert(attendanceRetroRequests).values({
        storeId: f.storeId, staffId: f.staffId, date, requestedAt: new Date(), reason: "battery", status, createdAt: new Date(Date.now() - ago * 86400000),
      } as any).returning().then((r) => r[0]);
    const oldPending = await mk("2026-01-02", "pending", 60);
    await mk("2026-03-01", "approved", 1);
    await mk("2026-03-02", "rejected", 2);
    const newPending = await mk("2026-03-03", "pending", 3);

    const page1 = await attendanceService.listRetroRequestsPage(f.storeId, {}, { limit: 2, offset: 0 });
    expect(page1.total).toBe(4);
    expect(ids(page1.rows).sort()).toEqual([oldPending.id, newPending.id].sort()); // both pending, despite one being 60 days old
    expect(page1.rows[0].id).toBe(newPending.id); // newest pending first
    const page2 = await attendanceService.listRetroRequestsPage(f.storeId, {}, { limit: 2, offset: 2 });
    expect(page2.rows.map((r: any) => r.status).sort()).toEqual(["approved", "rejected"]);
    const onlyPending = await attendanceService.listRetroRequestsPage(f.storeId, { status: "pending" }, { limit: 10, offset: 0 });
    expect(onlyPending.total).toBe(2);
  });
});

describe("archived products", () => {
  it("finds an archived name directly and pages the archive", async () => {
    const mkArchived = async (name: string) =>
      (await db.insert(products).values({ storeId: f.storeId, name, type: "product", isDeleted: true, deletedAt: new Date() } as any).returning())[0];
    await mkArchived("Old Shampoo");
    await mkArchived("Old Towel");
    await db.insert(products).values({ storeId: f.storeId, name: "Live Item", type: "product" } as any);

    expect((await storage.findArchivedProductByName(f.storeId, "old SHAMPOO"))?.id).toBeTruthy();
    expect(await storage.findArchivedProductByName(f.storeId, "Live Item")).toBeUndefined();
    expect(await storage.findArchivedProductByName(otherStoreId, "Old Shampoo")).toBeUndefined();

    const page = await storage.getArchivedProductsPage(f.storeId, { limit: 1, offset: 0 });
    expect(page.total).toBe(2);
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0].name).toBe("Old Shampoo"); // by name
    expect(Array.isArray(page.rows[0].variants)).toBe(true);
  });
});

describe("stock transfers and register sessions", () => {
  it("labels each transfer's stores without reading every store, and counts both directions", async () => {
    await db.insert(stockTransfers).values({ fromStoreId: f.storeId, toStoreId: otherStoreId } as any);
    await db.insert(stockTransfers).values({ fromStoreId: otherStoreId, toStoreId: f.storeId } as any);
    const page = await storage.stockTransferRepo.getStockTransfersPage(f.storeId, { limit: 1, offset: 0 });
    expect(page.total).toBe(2);
    expect(page.rows).toHaveLength(1);
    expect([page.rows[0].fromStore.id, page.rows[0].toStore.id].sort()).toEqual([f.storeId, otherStoreId].sort());
    const all = await storage.stockTransferRepo.getStockTransfersPage(f.storeId, { limit: 10, offset: 0 });
    const old = await storage.stockTransferRepo.getStockTransfers(f.storeId);
    expect(ids(all.rows).sort()).toEqual(ids(old).sort());
  });

  it("pages register sessions across stores, newest first", async () => {
    for (let i = 0; i < 3; i++) {
      await db.insert(cashRegisterSessions).values({ storeId: f.storeId, status: "closed", openingFloat: 0, expectedCash: 0, openedAt: new Date(Date.now() - i * 86400000) } as any);
    }
    await db.insert(cashRegisterSessions).values({ storeId: otherStoreId, status: "closed", openingFloat: 0, expectedCash: 0, openedAt: new Date(Date.now() + 1000) } as any);
    const page = await storage.cashRegisterRepo.getSessionsPage([f.storeId, otherStoreId], { limit: 2, offset: 0 });
    expect(page.total).toBe(4);
    expect(page.rows[0].storeId).toBe(otherStoreId); // newest overall
    expect((await storage.cashRegisterRepo.getSessionsPage(f.storeId, { limit: 10, offset: 0 })).total).toBe(3);
  });
});

describe("customers", () => {
  it("pages in SQL, searches names and numbers, hides archived by default, and folds a shared number into one row across stores", async () => {
    const mk = (storeId: string, name: string, n: string, o: Record<string, unknown> = {}) =>
      db.insert(customers).values({ storeId, name, customerNumber: n, address: "x", ...o } as any).returning().then((r) => r[0]);
    const tag = String(Date.now()).slice(-6);
    const shared = await mk(f.storeId, "Zainab Okafor", `CP1-${tag}`, { mobileNumber: "08031112222" }); // same person as the other store's
    await mk(f.storeId, "Bayo Archived", `CP2-${tag}`, { mobileNumber: "08033330001", isArchived: true });
    await mk(f.storeId, "Cee Nonumber", `CP3-${tag}`);
    await mk(otherStoreId, "Cee Nonumber", `CP4-${tag}`); // no number: stays a separate row

    const one = await storage.getCustomersPage([f.storeId], {}, { limit: 100, offset: 0 });
    const names = one.rows.map((r) => r.name);
    expect(names).toContain("Zainab Okafor");
    expect(names).not.toContain("Bayo Archived");
    expect(one.total).toBe(one.rows.length);
    expect((await storage.getCustomersPage([f.storeId], { includeArchived: true }, { limit: 100, offset: 0 })).rows.map((r) => r.name)).toContain("Bayo Archived");

    // Search: name, number and customer number.
    expect((await storage.getCustomersPage([f.storeId], { search: "okaf" }, { limit: 10, offset: 0 })).rows.map((r) => r.id)).toEqual([shared.id]);
    expect((await storage.getCustomersPage([f.storeId], { search: "08031112222" }, { limit: 10, offset: 0 })).total).toBe(1);
    expect((await storage.getCustomersPage([f.storeId], { search: `CP3-${tag}` }, { limit: 10, offset: 0 })).total).toBe(1);

    // Paging walks every row once with a stable total.
    const seen: string[] = [];
    for (let offset = 0; ; offset += 2) {
      const page = await storage.getCustomersPage([f.storeId], {}, { limit: 2, offset });
      seen.push(...page.rows.map((r) => r.id));
      if (offset + 2 >= page.total) break;
    }
    expect(seen).toHaveLength(one.total);
    expect(new Set(seen).size).toBe(one.total);

    // Across stores the shared number is one row naming both stores; the numberless pair stays two rows.
    const all = await storage.getCustomersPage([f.storeId, otherStoreId], {}, { limit: 100, offset: 0 });
    const zainab = all.rows.filter((r) => r.name === "Zainab Okafor");
    expect(zainab).toHaveLength(1);
    expect(zainab[0].storeName?.split(", ")).toHaveLength(2);
    expect(all.rows.filter((r) => r.name === "Cee Nonumber")).toHaveLength(2);
    const allPaged: string[] = [];
    for (let offset = 0; ; offset += 2) {
      const page = await storage.getCustomersPage([f.storeId, otherStoreId], {}, { limit: 2, offset });
      allPaged.push(...page.rows.map((r) => r.id));
      if (offset + 2 >= page.total) break;
    }
    expect(allPaged.sort()).toEqual(all.rows.map((r) => r.id).sort());
  });
});

describe("products, inventory and staff", () => {
  it("page across stores in a stable order and cover every row once", async () => {
    const mkProduct = async (storeId: string, name: string) => {
      const [p] = await db.insert(products).values({ storeId, name, type: "product" } as any).returning();
      await db.insert(inventory).values({ storeId, productId: p.id, name, type: "product", costPrice: 1, sellingPrice: 2, quantity: 1 } as any);
      return p;
    };
    // Same name in both stores: only the id tie-break keeps the page boundaries from repeating or dropping one.
    const tie = `Tie${Date.now()}`;
    for (const n of [tie, "Oil"]) await mkProduct(f.storeId, n === "Oil" ? `Oil${tie}` : n);
    for (const n of [tie, "Brush", "Comb"]) await mkProduct(otherStoreId, n === "Brush" ? `Brush${tie}` : n === "Comb" ? `Comb${tie}` : n);

    const both = [f.storeId, otherStoreId];
    const whole = await storage.getProductsPaginated(both, { page: 1, limit: 100 });
    expect(whole.pagination.total).toBe(whole.data.length);

    const seen: string[] = [];
    for (let page = 1; ; page++) {
      const r = await storage.getProductsPaginated(both, { page, limit: 2 });
      seen.push(...r.data.map((p: any) => p.id));
      if (!r.pagination.hasMore) break;
    }
    expect(seen).toEqual(whole.data.map((p: any) => p.id));
    expect(new Set(seen).size).toBe(whole.pagination.total);
    expect(whole.data.every((p: any) => Array.isArray(p.variants))).toBe(true);
    expect((await storage.getProductsPaginated(both, { page: 1, limit: 100, search: `brush${tie}` })).pagination.total).toBe(1);

    const invWhole = await storage.getInventoryForStores(both, { page: 1, limit: 100 });
    const invSeen: string[] = [];
    for (let page = 1; ; page++) {
      const r = await storage.getInventoryForStores(both, { page, limit: 2 });
      invSeen.push(...r.data.map((i) => i.id));
      if (!r.pagination.hasMore) break;
    }
    expect(invSeen).toEqual(invWhole.data.map((i) => i.id));

    const staffWhole = await storage.getStaffPaginated(f.storeId, { page: 1, limit: 100, includeArchived: true });
    expect(staffWhole.data.map((s) => s.id)).toContain(f.staffId);
  });
});
