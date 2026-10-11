import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import express from "express";
import http from "http";
import type { AddressInfo } from "net";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { customRoles, users, organisationMembers, storePaymentAccounts } from "@shared/schema";
import { registerRoutes } from "../routes";
import { generateToken } from "../auth";
import { syncFeatureRegistry } from "../lib/featureSync";
import { closePool } from "../test-support/integration-db";
import { partnerTestKit } from "../test-support/partner-fixtures";

/**
 * A custom role is held to the pages it was granted, on the routes that moved to requirePermission:
 * settings updates and the payment-account reports. (Promotions and broadcasts are paid features, so the
 * purchase gate answers first in a test business; their page checks are covered by the source scan in
 * permissionGate.test.ts.)
 */

const kit = partnerTestKit();
let server: http.Server;
let base = "";
const roleBusinesses: string[] = [];
const roleUsers: string[] = [];
const roleStores: string[] = [];

async function api(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: `jwt_token=${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = text;
  try { parsed = JSON.parse(text); } catch { /* leave as text */ }
  return { status: res.status, body: parsed };
}

/** A business plus a login whose role is a custom role holding exactly `permissions`. */
async function withRole(permissions: string[]) {
  const A = await kit.biz({ owner: true });
  const roleName = "buyer";
  await db.insert(customRoles).values({ businessId: A.f.businessId, name: roleName, permissions });
  roleBusinesses.push(A.f.businessId);
  roleStores.push(A.f.storeId);
  const [u] = await db.insert(users).values({
    email: `owner-${roleName}-${A.f.businessId.slice(0, 8)}@example.test`, name: "Custom Role User", role: roleName,
  }).returning();
  roleUsers.push(u.id);
  await db.insert(organisationMembers).values({ userId: u.id, organisationId: A.f.businessId, role: roleName, status: "active" });
  const token = generateToken({ userId: u.id, organisationId: A.f.businessId, role: roleName });
  return { A, token };
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
  for (const id of roleStores.splice(0)) await db.delete(storePaymentAccounts).where(eq(storePaymentAccounts.storeId, id));
  for (const id of roleBusinesses.splice(0)) await db.delete(customRoles).where(eq(customRoles.businessId, id));
  for (const id of roleUsers.splice(0)) {
    await db.delete(organisationMembers).where(eq(organisationMembers.userId, id));
    await db.execute(sql`DELETE FROM users WHERE id = ${id}`);
  }
  await kit.teardown();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closePool();
});

const refused = (status: number) => status === 403;

describe("custom role on the converted routes", () => {
  it("is refused on settings updates without the page", async () => {
    const { A, token } = await withRole(["/customers"]);
    const settings = await api("PUT", "/api/settings", token, { storeId: A.f.storeId });
    expect(settings.status, JSON.stringify(settings.body)).toBe(403);
  });

  it("is not refused on the role check once it holds the page", async () => {
    const { A, token } = await withRole(["/settings"]);
    // Validation may still answer 400; the point is that the role is not what turns it away.
    for (const [method, path] of [["PUT", "/api/settings"]] as const) {
      const res = await api(method, path, token, { storeId: A.f.storeId });
      expect(res.status, `${method} ${path}`).not.toBe(403);
      expect(res.status, `${method} ${path}`).not.toBe(401);
      expect(JSON.stringify(res.body)).not.toMatch(/Only managers and owners/);
    }
  });

  it("holds the payment-account reports to the profit and loss page", async () => {
    const without = await withRole(["/customers"]);
    expect(refused((await api("GET", `/api/reports/payment-accounts?storeId=${without.A.f.storeId}`, without.token)).status)).toBe(true);
    const withPage = await withRole(["/profit-loss"]);
    const ok = await api("GET", `/api/reports/payment-accounts?storeId=${withPage.A.f.storeId}`, withPage.token);
    expect(refused(ok.status)).toBe(false);
  });
});

describe("inactive payment accounts follow the Settings page", () => {
  async function seed(storeId: string) {
    await db.insert(storePaymentAccounts).values([
      { storeId, label: "Active account", kind: "bank", isActive: true },
      { storeId, label: "Retired account", kind: "bank", isActive: false },
    ]);
  }
  const labels = (body: any) => (Array.isArray(body) ? body.map((a: any) => a.label).sort() : body);

  it("shows inactive accounts to a custom role that holds Settings", async () => {
    const { A, token } = await withRole(["/settings"]);
    await seed(A.f.storeId);
    const res = await api("GET", `/api/sales/payment-accounts?storeId=${A.f.storeId}&includeInactive=true`, token);
    expect(res.status).toBe(200);
    expect(labels(res.body)).toEqual(["Active account", "Retired account"]);
  });

  it("hides them from a custom role without Settings, even when asked", async () => {
    const { A, token } = await withRole(["/customers"]);
    await seed(A.f.storeId);
    const res = await api("GET", `/api/sales/payment-accounts?storeId=${A.f.storeId}&includeInactive=true`, token);
    expect(res.status).toBe(200);
    expect(labels(res.body)).toEqual(["Active account"]);
  });

  it("still shows them to the owner, and only active ones when not asked", async () => {
    const { A } = await withRole(["/customers"]);
    await seed(A.f.storeId);
    const owner = generateToken({ userId: A.owner!.id, organisationId: A.f.businessId, role: "owner" });
    const all = await api("GET", `/api/sales/payment-accounts?storeId=${A.f.storeId}&includeInactive=true`, owner);
    expect(labels(all.body)).toEqual(["Active account", "Retired account"]);
    const activeOnly = await api("GET", `/api/sales/payment-accounts?storeId=${A.f.storeId}`, owner);
    expect(labels(activeOnly.body)).toEqual(["Active account"]);
  });
});
