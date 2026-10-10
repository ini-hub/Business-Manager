import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import express from "express";
import http from "http";
import type { AddressInfo } from "net";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { customers, organisations, users } from "@shared/schema";
import { registerRoutes } from "../routes";
import { generateToken } from "../auth";
import { closePool } from "../test-support/integration-db";
import { partnerTestKit } from "../test-support/partner-fixtures";

/**
 * Staff data masking as the client sees it: real logins, the owner's per-role lists in
 * organisations.mask_contact_roles / mask_figures_roles, and the same endpoints for
 * owner (always unmasked) and staff.
 */

const kit = partnerTestKit();
const { biz, addProduct } = kit;

let server: http.Server;
let base = "";

async function api(path: string, token: string) {
  const res = await fetch(`${base}${path}`, { headers: { Cookie: `jwt_token=${token}` } });
  const text = await res.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch { /* leave as text */ }
  return { status: res.status, body };
}
const as = (t: { id: string }, orgId: string, role: "owner" | "manager" | "staff") =>
  generateToken({ userId: t.id, organisationId: orgId, role });

async function shop() {
  const A = await biz({ owner: true, staff: true });
  await db.update(users).set({ businessId: A.f.businessId } as any).where(eq(users.id, A.owner!.id));
  return {
    orgId: A.f.businessId,
    storeId: A.f.storeId,
    owner: as(A.owner!, A.f.businessId, "owner"),
    staff: as(A.staffLogin!, A.f.businessId, "staff"),
  };
}
const setMask = (orgId: string, v: { contact?: string[]; figures?: string[] }) =>
  db.update(organisations).set({ maskContactRoles: v.contact ?? [], maskFiguresRoles: v.figures ?? [] } as any).where(eq(organisations.id, orgId));

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

describe("staff data masking", () => {
  it("masks nothing by default, then masks contact details and cost prices for staff only", async () => {
    const { orgId, storeId, owner, staff } = await shop();
    const tag = Math.random().toString(36).slice(2, 6);
    const [cust] = await db.insert(customers).values({
      storeId, name: `Ada ${tag}`, customerNumber: `M-${tag}`, address: "12 Hidden Rd", mobileNumber: "08031234567",
    } as any).returning();
    await addProduct(storeId, `Widget-${tag}`, 5, 40);

    // Default: nothing masked for anyone.
    let r = await api(`/api/customers/${cust.id}`, staff);
    expect(r.body.mobileNumber).toBe("08031234567");
    r = await api("/api/business", staff);
    expect(r.body.viewerMask).toEqual({ contact: false, figures: false });

    await setMask(orgId, { contact: ["staff"], figures: ["staff"] });

    // Staff: contact masked, name kept, phone-digit search blocked, call surface told via viewerMask.
    r = await api(`/api/customers/${cust.id}`, staff);
    expect(r.body).toMatchObject({ name: `Ada ${tag}`, mobileNumber: "••••", address: "••••" });
    r = await api(`/api/customers?storeId=${storeId}&search=${tag}`, staff);
    expect(r.body.data[0].mobileNumber).toBe("••••");
    r = await api(`/api/customers?storeId=${storeId}&search=0803123`, staff);
    expect(r.body.data).toEqual([]);
    r = await api("/api/business", staff);
    expect(r.body.viewerMask).toEqual({ contact: true, figures: true });

    // Staff: cost price zeroed, selling price untouched.
    r = await api(`/api/inventory?storeId=${storeId}&search=Widget-${tag}`, staff);
    expect(r.status).toBe(200);
    const item = r.body.data[0];
    expect(item.costPrice).toBe(0);
    expect(item.sellingPrice).toBe(80);

    // Owner is never masked.
    r = await api(`/api/customers/${cust.id}`, owner);
    expect(r.body.mobileNumber).toBe("08031234567");
    r = await api(`/api/inventory?storeId=${storeId}&search=Widget-${tag}`, owner);
    expect(r.body.data[0].costPrice).toBe(40);
    r = await api("/api/business", owner);
    expect(r.body.viewerMask).toEqual({ contact: false, figures: false });
  }, 240_000);

  it("a role left off the lists is unmasked, and the two toggles are independent", async () => {
    const { orgId, storeId, staff } = await shop();
    const tag = Math.random().toString(36).slice(2, 6);
    const [cust] = await db.insert(customers).values({
      storeId, name: `Bola ${tag}`, customerNumber: `N-${tag}`, address: "x", mobileNumber: "08099999999",
    } as any).returning();

    await setMask(orgId, { contact: [], figures: ["staff"] });
    let r = await api(`/api/customers/${cust.id}`, staff);
    expect(r.body.mobileNumber).toBe("08099999999");
    r = await api("/api/business", staff);
    expect(r.body.viewerMask).toEqual({ contact: false, figures: true });
  }, 240_000);
});
