import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import express from "express";
import http from "http";
import type { AddressInfo } from "net";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { users } from "@shared/schema";
import { registerRoutes } from "../routes";
import { generateToken } from "../auth";
import { closePool } from "../test-support/integration-db";
import { partnerTestKit } from "../test-support/partner-fixtures";
import { runWithRequestStats } from "../lib/queryCounter";
import { loadEntitlementsPayload, loadAuthUser, loadActiveBusiness, loadVisibleStores, buildSessionAuthUser } from "../lib/shellData";
import { storage } from "../storage";
import { completeLoginForUser } from "../lib/authFlow";
import { runWithRequestMemo } from "../lib/requestMemo";

/**
 * GET /api/bootstrap must be exactly the shell endpoints it replaces, for every role, and the shell loaders
 * must stay within a statement budget: on a remote database each statement is a round trip, so an N+1
 * regression here is a user-visible slowdown.
 */

const kit = partnerTestKit();
const { biz } = kit;

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
    ownerId: A.owner!.id,
    owner: as(A.owner!, A.f.businessId, "owner"),
    staff: as(A.staffLogin!, A.f.businessId, "staff"),
  };
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

describe("GET /api/bootstrap", () => {
  it("returns, per section, exactly what the individual shell endpoints return", async () => {
    const { owner, staff } = await shop();
    for (const token of [owner, staff]) {
      const boot = await api("/api/bootstrap", token);
      expect(boot.status).toBe(200);
      const [user, business, stores, entitlements, consent, orgs] = await Promise.all([
        api("/api/auth/user", token),
        api("/api/business", token),
        api("/api/stores", token),
        api("/api/entitlements", token),
        api("/api/legal/consent-status", token),
        api("/api/auth/organisations", token),
      ]);
      const sections = boot.body;
      for (const key of ["user", "business", "stores", "entitlements", "consent", "organisations"]) {
        expect(sections[key].ok, key).toBe(true);
      }
      expect(sections.user.data).toEqual(user.body);
      expect(sections.business.data).toEqual(business.body);
      expect(sections.stores.data).toEqual(stores.body);
      expect(sections.entitlements.data).toEqual(entitlements.body);
      expect(sections.consent.data).toEqual(consent.body);
      expect(sections.organisations.data).toEqual(orgs.body);
    }
  }, 240_000);

  it("is not cacheable and rejects an unauthenticated caller", async () => {
    const { owner } = await shop();
    const res = await fetch(`${base}/api/bootstrap`, { headers: { Cookie: `jwt_token=${owner}` } });
    expect(res.headers.get("cache-control")).toContain("no-store");
    const anon = await fetch(`${base}/api/bootstrap`);
    expect(anon.status).toBe(401);
  }, 120_000);
});

describe("shell statement budget", () => {
  it("loads the entitlements payload within budget", async () => {
    const { orgId, ownerId } = await shop();
    const stats = { queries: 0 };
    await runWithRequestStats(stats, () => loadEntitlementsPayload({ id: ownerId, role: "owner", businessId: orgId }));
    // Was ~50 before the shell was deduplicated; 33 measured here. Under vitest the catalog/flag TTL caches
    // are disabled (server/lib/ttlCache.ts), so production issues fewer. Raise only with a reason.
    expect(stats.queries).toBeLessThanOrEqual(36);
  }, 120_000);

  it("loads the whole bootstrap shell in one request within budget, sharing the business row", async () => {
    const { orgId, ownerId } = await shop();
    const req: any = { user: { id: ownerId, userId: ownerId, role: "owner", businessId: orgId, organisationId: orgId } };
    const stats = { queries: 0 };
    await runWithRequestStats(stats, () =>
      runWithRequestMemo(async () => {
        await Promise.all([loadAuthUser(req), loadActiveBusiness(req), loadVisibleStores(req), loadEntitlementsPayload(req.user)]);
      }),
    );
    console.log(`bootstrap shell statements: ${stats.queries}`);
    // Entitlements alone is ~33 (caches off); the rest of the shell must stay small on top of it.
    expect(stats.queries).toBeLessThanOrEqual(50);
  }, 120_000);
});

describe("sign-in session user", () => {
  // The sign-in responses carry `authUser` so the client skips a refetch; it must be exactly what
  // /api/auth/user returns for the session that sign-in just issued, for every role.
  it("buildSessionAuthUser equals loadAuthUser for the same session", async () => {
    const A = await biz({ owner: true, staff: true });
    const orgId = A.f.businessId;
    for (const [who, role] of [[A.owner!, "owner"], [A.staffLogin!, "staff"]] as const) {
      const [row] = await db.select().from(users).where(eq(users.id, who.id));
      const member = await storage.getOrganisationMember(who.id, orgId);
      const business = await storage.getBusinessById(orgId);
      const built = await buildSessionAuthUser(row, business, member!, orgId);
      const loaded = await loadAuthUser({ user: { userId: who.id, id: who.id, organisationId: orgId, role } } as any);
      expect(built).not.toBeNull();
      // JSON round trip: the client sees both as JSON, so Date vs string is not a difference.
      expect(JSON.parse(JSON.stringify(built))).toEqual(JSON.parse(JSON.stringify(loaded)));
    }
  }, 240_000);
});

describe("single-organisation login", () => {
  // completeLoginForUser is the tail of POST /api/auth/login (and the consent / activation paths). For a
  // user in exactly one organisation it issues the session itself and now returns `authUser`.
  it("returns an authUser equal to /api/auth/user for the session it just issued", async () => {
    const A = await biz({ owner: true });
    const orgId = A.f.businessId;
    const [row] = await db.select().from(users).where(eq(users.id, A.owner!.id));
    const members = (await storage.getOrganisationsByUserId(row.id)).filter((m: any) => m.status === "active");
    expect(members).toHaveLength(1); // the premise: one organisation, so no selection step

    let body: any;
    const res: any = { cookie: () => res, status: () => res, json: (b: any) => { body = b; return res; } };
    const req: any = { headers: {}, ip: "127.0.0.1" };
    try {
      await completeLoginForUser(row, req, res);
    } finally {
      // The login issued a real session row; the fixture cannot delete the user while it exists.
      await db.execute(sql`DELETE FROM auth_sessions WHERE user_id = ${row.id}`);
    }

    expect(body.message).toBe("Login successful.");
    expect(body.authUser).toBeTruthy();
    const loaded = await loadAuthUser({ user: { userId: row.id, id: row.id, organisationId: orgId, role: "owner" } } as any);
    expect(JSON.parse(JSON.stringify(body.authUser))).toEqual(JSON.parse(JSON.stringify(loaded)));
    // And it is what the client needs to render the app without another request.
    expect(body.authUser.businessId).toBe(orgId);
    expect(body.authUser.role).toBe("owner");
  }, 240_000);
});
