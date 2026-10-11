import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import express from "express";
import http from "http";
import type { AddressInfo } from "net";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { stores, staff } from "@shared/schema";
import { registerRoutes } from "../routes";
import { generateToken } from "../auth";
import { syncFeatureRegistry } from "../lib/featureSync";
import { closePool } from "../test-support/integration-db";
import { partnerTestKit } from "../test-support/partner-fixtures";

/**
 * A business with stores in two currencies, driven through the real router: editing a store's currency,
 * the per-currency scope on business-wide totals, the consolidated balance sheet, and a
 * staff member who works at both stores.
 */

const kit = partnerTestKit();
let server: http.Server;
let base = "";
const extraStores: string[] = [];

async function api(method: string, path: string, token: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: `jwt_token=${token}`, ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = text;
  try { parsed = JSON.parse(text); } catch { /* leave as text */ }
  return { status: res.status, body: parsed };
}

/** The fixture's NGN store plus a second store in GHS with two staff rows of its own. */
async function mixedBusiness() {
  const A = await kit.biz({ owner: true, staff: true });
  const tag = `itest-mc-${Date.now()}`;
  const [ghs] = await db.insert(stores).values({
    businessId: A.f.businessId, name: `Test Store ${tag}`, code: `G${String(Date.now()).slice(-6)}`,
    currency: "GHS", country: "GH", timezone: "Africa/Accra",
  }).returning();
  extraStores.push(ghs.id);
  for (const n of [1, 2]) {
    await db.insert(staff).values({
      storeId: ghs.id, name: `Kofi ${n}`, email: `kofi${n}-${tag}@example.test`, staffNumber: `K-${tag}-${n}`,
      mobileNumber: `0800000${n}${String(Date.now()).slice(-4)}`, payPerMonth: 1000,
    });
  }
  const owner = generateToken({ userId: A.owner!.id, organisationId: A.f.businessId, role: "owner" });
  const staffToken = generateToken({ userId: A.staffLogin!.id, organisationId: A.f.businessId, role: "staff" });
  return { A, ghs, owner, staffToken };
}

beforeAll(async () => {
  await kit.setup();
  await syncFeatureRegistry();
  const app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 180_000);

afterEach(async () => {
  for (const id of extraStores.splice(0)) {
    await db.execute(sql`DELETE FROM stock_movements WHERE store_id = ${id}`);
    await db.execute(sql`DELETE FROM inventory WHERE store_id = ${id}`);
    await db.execute(sql`DELETE FROM products WHERE store_id = ${id}`);
    await db.execute(sql`DELETE FROM staff WHERE store_id = ${id}`);
    await db.execute(sql`DELETE FROM store_counters WHERE store_id = ${id}`);
    await db.execute(sql`DELETE FROM stores WHERE id = ${id}`);
  }
  await kit.teardown();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closePool();
});

describe("stores in different currencies", () => {
  it("lets an owner set a store to any currency, so a business can trade in several", async () => {
    const { ghs, owner } = await mixedBusiness();
    const usd = await api("PATCH", `/api/stores/${ghs.id}`, owner, { currency: "USD" });
    expect(usd.status).toBe(200);
    expect(usd.body.currency).toBe("USD");
  });
});

describe("business-wide totals scoped to one currency", () => {
  it("splits dashboard staff counts by currency and the parts add up to the whole", async () => {
    const { A, owner } = await mixedBusiness();
    const biz = A.f.businessId;
    const all = await api("GET", `/api/dashboard/stats?businessId=${biz}`, owner);
    const ngn = await api("GET", `/api/dashboard/stats?businessId=${biz}&currency=NGN`, owner);
    const ghs = await api("GET", `/api/dashboard/stats?businessId=${biz}&currency=GHS`, owner);
    expect([all.status, ngn.status, ghs.status]).toEqual([200, 200, 200]);
    expect(ghs.body.totalStaff).toBe(2);
    expect(ngn.body.totalStaff).toBeGreaterThanOrEqual(1);
    expect(ngn.body.totalStaff + ghs.body.totalStaff).toBe(all.body.totalStaff);
  });

  it("returns an empty summary for a currency the business does not use", async () => {
    const { A, owner } = await mixedBusiness();
    const none = await api("GET", `/api/dashboard/stats?businessId=${A.f.businessId}&currency=USD`, owner);
    expect(none.status).toBe(200);
    expect(none.body.totalStaff).toBe(0);
    expect(none.body.totalRevenue).toBe(0);
  });
});

describe("consolidated balance sheet", () => {
  it("returns one total per currency and one sheet per store", async () => {
    const { owner, ghs, A } = await mixedBusiness();
    const res = await api("GET", "/api/accounting/balance-sheet?storeId=all", owner);
    expect(res.status).toBe(200);
    expect(res.body.consolidated).toBe(true);
    expect(res.body.currencies.map((c: any) => c.currency).sort()).toEqual(["GHS", "NGN"]);
    for (const c of res.body.currencies) expect(c.storeCount).toBe(1);
    expect(res.body.stores.map((s: any) => s.storeId).sort()).toEqual([A.f.storeId, ghs.id].sort());
  });
});

describe("staff who work at several stores", () => {
  it("reach every store they hold a staff row in, and only those", async () => {
    const { A, ghs, staffToken } = await mixedBusiness();
    // Before: the staff login only has a row at the first store.
    const before = await api("GET", "/api/accounting/balance-sheet?storeId=all", staffToken);
    expect(before.status).toBe(200);
    expect(before.body.stores.map((s: any) => s.storeId)).toEqual([A.f.storeId]);

    await db.insert(staff).values({
      storeId: ghs.id, userId: A.staffLogin!.id, name: "Shared Staff", email: `shared-${Date.now()}@example.test`,
      staffNumber: `SH-${Date.now()}`, mobileNumber: `0801${String(Date.now()).slice(-7)}`, payPerMonth: 1000,
    });
    const after = await api("GET", "/api/accounting/balance-sheet?storeId=all", staffToken);
    expect(after.body.stores.map((s: any) => s.storeId).sort()).toEqual([A.f.storeId, ghs.id].sort());
  });
});

describe("consolidated lists are scoped to the requested currency", () => {
  const names = (body: any) => (body?.data ?? body ?? []).map((p: any) => p.name).sort();

  it("returns only the stores of that currency for storeId=all, and everything without a scope", async () => {
    const { A, ghs, owner } = await mixedBusiness();
    await kit.addProduct(A.f.storeId, "Naira widget", 5, 100);
    await kit.addProduct(ghs.id, "Cedi widget", 5, 10);

    const unscoped = await api("GET", "/api/products?storeId=all", owner);
    expect(unscoped.status).toBe(200);
    expect(names(unscoped.body)).toEqual(["Cedi widget", "Naira widget"]);

    const ngn = await api("GET", "/api/products?storeId=all", owner, undefined, { "x-scope-currency": "NGN" });
    expect(names(ngn.body)).toEqual(["Naira widget"]);

    const cedi = await api("GET", "/api/products?storeId=all", owner, undefined, { "x-scope-currency": "GHS" });
    expect(names(cedi.body)).toEqual(["Cedi widget"]);
  });

  it("applies the scope to the business-wide dashboard totals too", async () => {
    const { A, owner } = await mixedBusiness();
    const ghs = await api("GET", `/api/dashboard/stats?businessId=${A.f.businessId}`, owner, undefined, { "x-scope-currency": "GHS" });
    expect(ghs.body.totalStaff).toBe(2);
  });
});
