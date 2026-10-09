import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import express from "express";
import http from "http";
import type { AddressInfo } from "net";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { customers, users } from "@shared/schema";
import { registerRoutes } from "../routes";
import { generateToken } from "../auth";
import { closePool } from "../test-support/integration-db";
import { partnerTestKit } from "../test-support/partner-fixtures";

/**
 * The catalog lists and the two summary endpoints as the client calls them: real logins, the page envelope,
 * the page-size cap, storeId=all, and the role checks.
 */

const kit = partnerTestKit();
const { biz, addProduct } = kit;

let server: http.Server;
let base = "";

async function api(path: string, token: string | null) {
  const res = await fetch(`${base}${path}`, { headers: token ? { Cookie: `jwt_token=${token}` } : {} });
  const text = await res.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch { /* leave as text */ }
  return { status: res.status, body };
}
const as = (t: { id: string }, orgId: string, role: "owner" | "manager" | "staff" = "owner") =>
  generateToken({ userId: t.id, organisationId: orgId, role });

async function shop() {
  const A = await biz({ owner: true, staff: true });
  // storeId=all resolves the caller's stores through their user row's business, which the kit's login leaves unset.
  await db.update(users).set({ businessId: A.f.businessId } as any).where(eq(users.id, A.owner!.id));
  return { A, owner: as(A.owner!, A.f.businessId), staff: as(A.staffLogin!, A.f.businessId, "staff"), storeId: A.f.storeId };
}

beforeAll(async () => {
  await kit.setup();
  const app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 180_000);

afterEach(async () => { await kit.teardown(); });
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closePool();
});

const envelope = (body: any) => {
  expect(Array.isArray(body.data)).toBe(true);
  expect(body.pagination).toEqual(expect.objectContaining({ total: expect.any(Number), page: expect.any(Number), limit: expect.any(Number), totalPages: expect.any(Number), hasMore: expect.any(Boolean) }));
};

describe("catalog lists", () => {
  it("products and inventory come back one page at a time and walk to the full set, for one store and for all", async () => {
    const { A, owner, storeId } = await shop();
    const names = ["P1", "P2", "P3", "P4", "P5"].map((n) => `${n}-${Math.random().toString(36).slice(2, 6)}`);
    for (const n of names) await addProduct(storeId, n, 5, 10);

    // Each request costs several round trips on the shared test DB, so the walk is done once, on the widest case.
    for (const [path, scope] of [["products", storeId], ["inventory", storeId], ["products", "all"]] as const) {
      const first = await api(`/api/${path}?storeId=${scope}&limit=2`, owner);
      expect(first.status).toBe(200);
      envelope(first.body);
      expect(first.body.data).toHaveLength(2);
      expect(first.body.pagination).toMatchObject({ total: 5, page: 1, limit: 2, totalPages: 3, hasMore: true });
      if (scope === "all") expect(first.body.data[0].storeName).toBeTruthy();
    }
    const seen: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const r = await api(`/api/products?storeId=all&limit=2&page=${page}`, owner);
      seen.push(...r.body.data.map((x: any) => x.id));
    }
    expect(new Set(seen).size).toBe(5);
    // No page or limit means page 1 at the default size, never the whole table; the limit is capped at 200.
    const dflt = await api(`/api/products?storeId=${storeId}`, owner);
    expect(dflt.body.pagination).toMatchObject({ page: 1, limit: 50 });
    const capped = await api(`/api/products?storeId=${storeId}&limit=100000`, owner);
    expect(capped.body.pagination.limit).toBe(200);
    expect((await api(`/api/products?storeId=${storeId}&search=${names[2]}`, owner)).body.pagination.total).toBe(1);
    void A;
  }, 240_000);

  it("customers hide archived by default and search on the server", async () => {
    const { owner, storeId } = await shop();
    const tag = Math.random().toString(36).slice(2, 6);
    const mk = (name: string, n: string, o: Record<string, unknown> = {}) =>
      db.insert(customers).values({ storeId, name, customerNumber: `${n}-${tag}`, address: "x", ...o } as any);
    await mk(`Kemi ${tag}`, "K1");
    await mk(`Old ${tag}`, "K2", { isArchived: true });

    const live = await api(`/api/customers?storeId=${storeId}&search=${tag}`, owner);
    envelope(live.body);
    expect(live.body.data.map((c: any) => c.name)).toEqual([`Kemi ${tag}`]);
    const all = await api(`/api/customers?storeId=${storeId}&search=${tag}&includeArchived=true`, owner);
    expect(all.body.pagination.total).toBe(2);
  });

  it("staff list is paged, never exposes the login id, and redacts wages for a staff-role caller", async () => {
    const { owner, staff, storeId } = await shop();
    const asOwner = await api(`/api/staff?storeId=${storeId}`, owner);
    envelope(asOwner.body);
    expect(asOwner.body.data.length).toBeGreaterThan(0);
    expect(asOwner.body.data.every((s: any) => !("userId" in s))).toBe(true);
    expect(asOwner.body.data.some((s: any) => s.payPerMonth > 0)).toBe(true);

    const asStaff = await api(`/api/staff?storeId=${storeId}`, staff);
    expect(asStaff.status).toBe(200);
    expect(asStaff.body.data.every((s: any) => s.payPerMonth === 0)).toBe(true);
  });

  it("requires a login", async () => {
    const { storeId } = await shop();
    for (const path of ["products", "inventory", "customers", "staff"]) {
      expect((await api(`/api/${path}?storeId=${storeId}`, null)).status).toBe(401);
    }
  });
});

describe("summary endpoints", () => {
  it("vat-monthly and service-days answer managers and owners, and refuse staff", async () => {
    const { owner, staff, storeId } = await shop();
    const vat = await api(`/api/reports/vat-monthly?storeId=${storeId}`, owner);
    expect(vat.status).toBe(200);
    expect(Array.isArray(vat.body.months)).toBe(true);
    const days = await api(`/api/attendance/service-days?storeId=${storeId}&startDate=2020-01-01&endDate=2020-01-31`, owner);
    expect(days.status).toBe(200);
    expect(days.body).toEqual({ days: [] });

    expect([401, 403]).toContain((await api(`/api/reports/vat-monthly?storeId=${storeId}`, staff)).status);
    expect([401, 403]).toContain((await api(`/api/attendance/service-days?storeId=${storeId}`, staff)).status);
    expect((await api(`/api/reports/vat-monthly`, owner)).status).toBe(400);
  });

  it("refuses a store the caller does not belong to", async () => {
    const mine = await shop();
    const other = await shop();
    expect([403, 404]).toContain((await api(`/api/reports/vat-monthly?storeId=${other.storeId}`, mine.owner)).status);
    expect([403, 404]).toContain((await api(`/api/products?storeId=${other.storeId}`, mine.owner)).status);
  });
});
