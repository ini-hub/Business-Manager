import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import express from "express";
import http from "http";
import type { AddressInfo } from "net";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { vendors, purchaseOrders, purchaseOrderItems, expenses, featureCatalog, orgFeatureEntitlements } from "@shared/schema";
import { registerRoutes } from "../routes";
import { generateToken } from "../auth";
import { syncFeatureRegistry } from "../lib/featureSync";
import { closePool } from "../test-support/integration-db";
import { partnerTestKit } from "../test-support/partner-fixtures";

/**
 * Archive, delete and write-off as the client calls them: real logins, real role and store checks.
 * The service and guard have their own suite (StockWriteOff.itest.ts); this proves the routes enforce
 * them, and that a refusal leaves the stock and the item untouched.
 */

const kit = partnerTestKit();
const { biz, addProduct, qtyOf } = kit;

let server: http.Server;
let base = "";
const stores: string[] = [];
const orgs: string[] = [];

type Who = { token: string };
async function api(method: string, path: string, who: Who | null, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(who ? { Cookie: `jwt_token=${who.token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = text;
  try { parsed = JSON.parse(text); } catch { /* leave as text */ }
  return { status: res.status, body: parsed };
}
const as = (t: { id: string }, orgId: string, role: "owner" | "manager" | "staff" = "owner"): Who =>
  ({ token: generateToken({ userId: t.id, organisationId: orgId, role }) });

/** Archive & Delete Items is a paid feature, so a test business has to hold it, as a customer would. */
async function grantArchiveFeature(orgId: string) {
  const [feature] = await db.select().from(featureCatalog).where(eq(featureCatalog.key, "inventory_archive_delete"));
  await db.insert(orgFeatureEntitlements).values({ organisationId: orgId, featureId: feature.id, status: "active", source: "admin_grant" });
  orgs.push(orgId);
}

async function shop() {
  const A = await biz({ owner: true, staff: true });
  stores.push(A.f.storeId);
  await grantArchiveFeature(A.f.businessId);
  const item = await addProduct(A.f.storeId, `Arch-${Math.random().toString(36).slice(2, 7)}`, 10, 50);
  return { A, item, owner: as(A.owner!, A.f.businessId), staff: as(A.staffLogin!, A.f.businessId, "staff") };
}

/** An ordered purchase order that lists the item, which is what blocks archiving. */
async function openPo(storeId: string, inventoryId: string) {
  const [vendor] = await db.insert(vendors).values({ storeId, name: "Route vendor" } as any).returning();
  const [po] = await db.insert(purchaseOrders).values({ storeId, vendorId: vendor.id, poNumber: `PO-${Math.random().toString(36).slice(2, 8)}`, status: "ordered" } as any).returning();
  await db.insert(purchaseOrderItems).values({ poId: po.id, inventoryId, quantity: 5, unitCost: 50, totalCost: 250 } as any);
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
  // The kit removes inventory but knows nothing about purchase orders or expenses, which reference it.
  for (const storeId of stores.splice(0)) {
    const s = sql`${storeId}`;
    await db.execute(sql`DELETE FROM purchase_order_items WHERE po_id IN (SELECT id FROM purchase_orders WHERE store_id = ${s})`);
    for (const t of ["purchase_orders", "vendors", "expenses", "expense_categories", "profit_loss"]) {
      await db.execute(sql`DELETE FROM ${sql.raw(t)} WHERE store_id = ${s}`);
    }
  }
  for (const orgId of orgs.splice(0)) await db.delete(orgFeatureEntitlements).where(eq(orgFeatureEntitlements.organisationId, orgId));
  await kit.teardown();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closePool();
});

describe("archive", () => {
  it("archives an item that still has stock, leaving the stock recorded", async () => {
    const { item, owner } = await shop();
    const res = await api("POST", `/api/inventory/${item.id}/archive`, owner);
    expect(res.status).toBe(204);
    const row = await qtyOf(item.id);
    expect(row.isDeleted).toBe(true);
    expect(Number(row.quantity)).toBe(10);
  });

  it("refuses with a reason while an open purchase order lists the item", async () => {
    const { A, item, owner } = await shop();
    await openPo(A.f.storeId, item.id);
    const res = await api("POST", `/api/inventory/${item.id}/archive`, owner);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Can't archive.*1 open purchase order/);
    expect(res.body.blockers).toEqual([{ kind: "purchase_order", count: 1 }]);
    expect((await qtyOf(item.id)).isDeleted).toBe(false);
  });
});

describe("delete", () => {
  it("refuses a never-sold item that is on an open purchase order", async () => {
    const { A, item, owner } = await shop();
    await openPo(A.f.storeId, item.id);
    const res = await api("DELETE", `/api/inventory/${item.id}`, owner);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Can't delete/);
    expect((await qtyOf(item.id)).isDeleted).toBe(false);
  });

  it("deletes a never-sold item with nothing pointing at it", async () => {
    const { item, owner } = await shop();
    expect((await api("DELETE", `/api/inventory/${item.id}`, owner)).status).toBe(204);
    expect((await qtyOf(item.id)).isDeleted).toBe(true);
  });
});

describe("write-off", () => {
  it("zeroes the stock, books the loss, and archives when asked", async () => {
    const { A, item, owner } = await shop();
    const res = await api("POST", `/api/inventory/${item.id}/write-off`, owner, { reason: "damaged", note: "water", recordAsLoss: true, archive: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ quantityWrittenOff: 10, lossRecorded: 500, archived: true });
    const row = await qtyOf(item.id);
    expect(Number(row.quantity)).toBe(0);
    expect(row.isDeleted).toBe(true);
    const loss = await db.select().from(expenses).where(eq(expenses.storeId, A.f.storeId));
    expect(loss.map((e) => e.amount)).toEqual([500]);
    expect(await kit.ledgerProblems([A.f.storeId])).toEqual([]);
  });

  it("changes nothing when the archive half is blocked by an open purchase order", async () => {
    const { A, item, owner } = await shop();
    await openPo(A.f.storeId, item.id);
    const res = await api("POST", `/api/inventory/${item.id}/write-off`, owner, { reason: "expired", recordAsLoss: true, archive: true });
    expect(res.status).toBe(409);
    expect(Number((await qtyOf(item.id)).quantity)).toBe(10);
    expect(await db.select().from(expenses).where(eq(expenses.storeId, A.f.storeId))).toHaveLength(0);
  });

  it("rejects staff, other businesses, bad reasons and a missing note", async () => {
    const { item, owner, staff } = await shop();
    const body = { reason: "damaged", recordAsLoss: true, archive: false };
    expect((await api("POST", `/api/inventory/${item.id}/write-off`, staff, body)).status).toBe(403);
    expect((await api("POST", `/api/inventory/${item.id}/write-off`, null, body)).status).toBeGreaterThanOrEqual(401);

    const other = await biz({ owner: true });
    stores.push(other.f.storeId);
    await grantArchiveFeature(other.f.businessId);
    const stranger = as(other.owner!, other.f.businessId);
    expect((await api("POST", `/api/inventory/${item.id}/write-off`, stranger, body)).status).toBe(403);

    expect((await api("POST", `/api/inventory/${item.id}/write-off`, owner, { ...body, reason: "boredom" })).status).toBe(400);
    const noNote = await api("POST", `/api/inventory/${item.id}/write-off`, owner, { ...body, reason: "other" });
    expect(noNote.status).toBe(400);
    expect(noNote.body.error).toMatch(/note/i);
    expect(Number((await qtyOf(item.id)).quantity)).toBe(10);
  });
});
