import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import express from "express";
import http from "http";
import type { AddressInfo } from "net";

// No real mail from a test: the partner invitation sender is replaced, everything else in email.ts is untouched.
vi.mock("../email", async (importOriginal) => {
  const real = await importOriginal<typeof import("../email")>();
  return { ...real, sendPartnerInviteEmail: vi.fn(), sendPartnerReminderEmail: vi.fn(), sendPartnerStatementEmail: vi.fn() };
});

import * as email from "../email";
import { registerRoutes } from "../routes";
import { generateToken } from "../auth";
import { syncFeatureRegistry } from "../lib/featureSync";
import { closePool } from "../test-support/integration-db";
import { partnerTestKit } from "../test-support/partner-fixtures";

/**
 * The same router the app serves, driven the way the client drives it: real logins, real role and
 * store checks, real request validation. The repository suites prove the rules; this proves they are
 * reachable only by the people who should reach them, and that the JSON the screens depend on is what
 * actually comes back.
 */

const kit = partnerTestKit();
const { biz, addProduct, qtyOf, connect } = kit;

let server: http.Server;
let base = "";

type Who = { token: string };
type Res<T = any> = { status: number; body: T };

async function api<T = any>(method: string, path: string, who: Who | null, body?: unknown): Promise<Res<T>> {
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

/** Two partnered businesses, each with an owner login, and A holding some stock. */
async function pair() {
  const A = await biz({ owner: true, staff: true }); const B = await biz({ owner: true, staff: true });
  await connect(A, B);
  const widget = await addProduct(A.f.storeId, "Widget", 10, 61, { sku: "WID-1" });
  return {
    A, B, widget,
    a: as(A.owner!, A.f.businessId), b: as(B.owner!, B.f.businessId),
    aStaff: as(A.staffLogin!, A.f.businessId, "staff"),
    bStaff: as(B.staffLogin!, B.f.businessId, "staff"),
  };
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
  vi.clearAllMocks();
  await kit.teardown();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closePool();
});

describe("access", () => {
  it("refuses anonymous callers and returns them nothing", async () => {
    // The app's shared role guard answers 403 where the plain login guard answers 401; either way, no access.
    for (const [method, path, body] of [["GET", "/api/partners", undefined], ["GET", "/api/partner-transfers", undefined], ["POST", "/api/partner-transfers", {}], ["GET", "/api/partner-ledger", undefined]] as const) {
      const res = await api(method, path, null, body);
      expect([401, 403], `${method} ${path}`).toContain(res.status);
      expect(JSON.stringify(res.body)).not.toMatch(/PT-[A-Z2-9]{6}|partnerships|obligations/);
    }
  });

  it("keeps staff out of everything that moves stock or money", async () => {
    const { aStaff, widget, A, B } = await pair();
    const create = await api("POST", "/api/partner-transfers", aStaff, { partnerOrgId: B.f.businessId, fromStoreId: A.f.storeId, toStoreId: B.f.storeId, kind: "send", items: [{ fromInventoryId: widget.id, quantity: 1 }] });
    expect(create.status).toBe(403);
    expect((await api("POST", "/api/partners/request", aStaff, { code: "PT-XXXXXX" })).status).toBe(403);
    expect((await api("GET", "/api/partner-ledger", aStaff)).status).toBe(403);
  });

  it("will not let one business act from another's store", async () => {
    const { b, widget, A, B } = await pair();
    const res = await api("POST", "/api/partner-transfers", b, { partnerOrgId: A.f.businessId, fromStoreId: A.f.storeId, toStoreId: B.f.storeId, kind: "send", items: [{ fromInventoryId: widget.id, quantity: 1 }] });
    expect(res.status).toBe(403);
    expect(await qtyOf(widget.id)).toMatchObject({ quantity: 10 });
  });
});

describe("routing", () => {
  it("serves the fixed paths rather than reading them as an organisation id", async () => {
    const { a, A } = await pair();
    const standing = await api("GET", "/api/partners/engagement", a);
    expect(standing.status).toBe(200);
    expect(standing.body).toHaveProperty("badges");
    expect(standing.body.reputation.label).toBe("new");

    const shared = await api("GET", `/api/partners/shared-items?storeId=${A.f.storeId}`, a);
    expect(shared.status).toBe(200);
    expect(shared.body).toEqual({ inventoryIds: [] });
  });

  it("gives each business a code and lists partners with their standing", async () => {
    const { a, B } = await pair();
    const res = await api("GET", "/api/partners", a);
    expect(res.status).toBe(200);
    expect(res.body.code).toMatch(/^PT-[A-Z2-9]{6}$/);
    expect(res.body.partnerships).toHaveLength(1);
    expect(res.body.partnerships[0]).toMatchObject({ status: "active", direction: "outgoing", partner: { id: B.f.businessId }, reputation: { label: "new" } });
  });
});

describe("a send, end to end over HTTP", () => {
  it("offers, accepts, ships, receives short, resolves, and each side sees only what it should", async () => {
    const { a, b, widget, A, B } = await pair();

    const created = await api("POST", "/api/partner-transfers", a, {
      partnerOrgId: B.f.businessId, fromStoreId: A.f.storeId, toStoreId: B.f.storeId, kind: "send", settlementType: "payable",
      idempotencyKey: "http-send-key-1", items: [{ fromInventoryId: widget.id, quantity: 4, agreedUnitPrice: 100 }],
    });
    expect(created.status).toBe(201);
    const id = created.body.id;
    expect((await api("POST", "/api/partner-transfers", a, {
      partnerOrgId: B.f.businessId, fromStoreId: A.f.storeId, toStoreId: B.f.storeId, kind: "send", settlementType: "payable",
      idempotencyKey: "http-send-key-1", items: [{ fromInventoryId: widget.id, quantity: 4, agreedUnitPrice: 100 }],
    })).body.id).toBe(id); // a retry returns the same transfer

    // The receiving side sees the transfer, but not the sender's cost or inventory ids.
    const asReceiver = await api("GET", `/api/partner-transfers/${id}`, b);
    expect(asReceiver.status).toBe(200);
    expect(asReceiver.body.side).toBe("receiver");
    expect(asReceiver.body.items[0]).not.toHaveProperty("unitCostSnapshot");
    expect(asReceiver.body.items[0]).not.toHaveProperty("fromInventoryId");

    // The sender cannot answer their own offer.
    expect((await api("POST", `/api/partner-transfers/${id}/accept`, a, {})).status).toBe(400);
    expect((await api("POST", `/api/partner-transfers/${id}/accept`, b, {})).status).toBe(200);
    expect((await api("POST", `/api/partner-transfers/${id}/ship`, b)).status).toBe(400); // the receiver cannot ship
    expect((await api("POST", `/api/partner-transfers/${id}/ship`, a)).status).toBe(200);
    expect(await qtyOf(widget.id)).toMatchObject({ quantity: 6 });

    // Exactly the body the receive dialog posts.
    const lineId = asReceiver.body.items[0].id;
    const received = await api("POST", `/api/partner-transfers/${id}/receive`, b, {
      confirmed: { [lineId]: 3 }, shortfalls: { [lineId]: { reason: "damaged", note: "crushed" } },
    });
    expect(received.status).toBe(200);
    expect(received.body.status).toBe("disputed");

    const view = await api("GET", `/api/partner-transfers/${id}`, a);
    expect(view.body.items[0]).toMatchObject({ confirmedQuantity: 3, shortfallReason: "damaged", shortfallNote: "crushed" });
    expect(view.body.obligation.amountDue).toBe(300);

    const resolved = await api("POST", `/api/partner-transfers/${id}/resolve`, a, { returnToStock: true });
    expect(resolved.status).toBe(200);
    expect(await qtyOf(widget.id)).toMatchObject({ quantity: 6 }); // damaged goods do not come back

    const ledgerA = await api("GET", "/api/partner-ledger", a);
    expect(ledgerA.body.totals).toEqual({ owedToMe: 300, iOwe: 0 });
    const ledgerB = await api("GET", "/api/partner-ledger", b);
    expect(ledgerB.body.totals).toEqual({ owedToMe: 0, iOwe: 300 });
  });

  it("tracks a payment the debtor reports until the creditor confirms it", async () => {
    const { a, b, widget, A, B } = await pair();
    const id = (await api("POST", "/api/partner-transfers", a, {
      partnerOrgId: B.f.businessId, fromStoreId: A.f.storeId, toStoreId: B.f.storeId, kind: "send", settlementType: "payable",
      items: [{ fromInventoryId: widget.id, quantity: 2, agreedUnitPrice: 100 }],
    })).body.id;
    await api("POST", `/api/partner-transfers/${id}/accept`, b, {});
    await api("POST", `/api/partner-transfers/${id}/ship`, a);
    await api("POST", `/api/partner-transfers/${id}/receive`, b, {});
    const ob = (await api("GET", `/api/partner-transfers/${id}`, b)).body.obligation;

    const paid = await api("POST", `/api/partner-ledger/obligations/${ob.id}/settlements`, b, { amount: 200, method: "transfer", reference: "TX-1" });
    expect(paid.status).toBe(201);
    expect(paid.body.status).toBe("pending");
    expect((await api("POST", `/api/partner-ledger/settlements/${paid.body.id}/answer`, b, { accept: true })).status).toBe(400); // cannot confirm your own payment
    expect((await api("POST", `/api/partner-ledger/settlements/${paid.body.id}/answer`, a, { accept: true })).status).toBe(200);
    expect((await api("GET", `/api/partner-transfers/${id}`, a)).body.obligation.status).toBe("settled");
  });
});

describe("a request, end to end over HTTP", () => {
  it("asks from a shared item, is reviewed and fulfilled by the supplier", async () => {
    const { a, b, widget, A, B } = await pair();
    expect((await api("PUT", "/api/partners/shared-items", a, { storeId: A.f.storeId, inventoryIds: [widget.id] })).body).toEqual({ shared: 1 });

    const catalog = await api("GET", `/api/partners/${A.f.businessId}/catalog?storeId=${A.f.storeId}`, b);
    expect(catalog.status).toBe(200);
    expect(catalog.body).toEqual([expect.objectContaining({ id: widget.id, name: "Widget", inStock: true })]);
    expect(catalog.body[0]).not.toHaveProperty("costPrice");

    const asked = await api("POST", "/api/partner-transfers", b, {
      partnerOrgId: A.f.businessId, fromStoreId: A.f.storeId, toStoreId: B.f.storeId, kind: "request", settlementType: "none",
      items: [{ fromInventoryId: widget.id, quantity: 5 }],
    });
    expect(asked.status).toBe(201);
    expect(asked.body.status).toBe("requested");
    const id = asked.body.id;

    expect((await api("POST", `/api/partner-transfers/${id}/accept`, b, {})).status).toBe(400); // the requester cannot approve it
    const line = (await api("GET", `/api/partner-transfers/${id}`, a)).body.items[0];
    // Exactly the body the supplier's review dialog posts: supply less than asked.
    const accepted = await api("POST", `/api/partner-transfers/${id}/accept`, a, { lines: { [line.id]: { inventoryId: widget.id, quantity: 3 } } });
    expect(accepted.status).toBe(200);
    expect(accepted.body.status).toBe("accepted");
    expect((await api("POST", `/api/partner-transfers/${id}/ship`, a)).status).toBe(200);
    expect((await api("POST", `/api/partner-transfers/${id}/receive`, b, {})).status).toBe(200);
    expect(await qtyOf(widget.id)).toMatchObject({ quantity: 7 });
  });

  it("will not take a request for an item that was not shared", async () => {
    const { b, widget, A, B } = await pair();
    const res = await api("POST", "/api/partner-transfers", b, {
      partnerOrgId: A.f.businessId, fromStoreId: A.f.storeId, toStoreId: B.f.storeId, kind: "request", settlementType: "none",
      items: [{ fromInventoryId: widget.id, quantity: 1 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not shared/);
  });
});

describe("validation", () => {
  it("explains what is wrong in words, as a 400", async () => {
    const { a, A, B } = await pair();
    const base = { partnerOrgId: B.f.businessId, fromStoreId: A.f.storeId, toStoreId: B.f.storeId, kind: "send" };
    const none = await api("POST", "/api/partner-transfers", a, { ...base, items: [] });
    expect(none.status).toBe(400);
    expect(none.body.error).toMatch(/at least one item/i);

    const noItem = await api("POST", "/api/partner-transfers", a, { ...base, items: [{ quantity: 1 }] });
    expect(noItem.status).toBe(400);
    expect(noItem.body.error).toMatch(/choose an item/i);

    expect((await api("POST", "/api/partners/request", a, { code: "PT-NOPE00" })).body.error).toMatch(/No business/);
    expect((await api("POST", "/api/partners/invite", a, { email: "nonsense" })).status).toBe(400);
  });

  it("does not leak internals on an unexpected failure", async () => {
    const { a } = await pair();
    const res = await api("GET", "/api/partner-transfers/not-a-real-id", a);
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/select|from "|stack/i);
  });
});

describe("partners and invitations", () => {
  it("connects by code, answers a request, ends the link, and tells a stranger nothing", async () => {
    const A = await biz({ owner: true }); const B = await biz({ owner: true }); const C = await biz({ owner: true });
    const a = as(A.owner!, A.f.businessId), b = as(B.owner!, B.f.businessId), c = as(C.owner!, C.f.businessId);
    const code = (await api("GET", "/api/partners", b)).body.code;

    const sent = await api("POST", "/api/partners/request", a, { code });
    expect(sent.status).toBe(201);
    expect(sent.body.status).toBe("pending");

    expect((await api("POST", `/api/partners/${sent.body.id}/respond`, a, { accept: true })).status).toBe(400); // the asker cannot answer
    expect((await api("POST", `/api/partners/${sent.body.id}/respond`, c, { accept: true })).status).toBe(400); // nor can a stranger
    expect((await api("POST", `/api/partners/${sent.body.id}/respond`, b, { accept: true })).body.status).toBe("active");

    expect((await api("GET", `/api/partners/${B.f.businessId}/stores`, c)).status).toBe(400); // not partners with B
    const stores = await api("GET", `/api/partners/${B.f.businessId}/stores`, a);
    expect(stores.body.map((s: any) => s.id)).toEqual([B.f.storeId]);

    expect((await api("POST", `/api/partners/${sent.body.id}/revoke`, c)).status).toBe(400);
    expect((await api("POST", `/api/partners/${sent.body.id}/revoke`, a)).body.status).toBe("revoked");
  });

  it("emails an invitation once, with the sender's code", async () => {
    const A = await biz({ owner: true });
    const a = as(A.owner!, A.f.businessId);
    const first = await api("POST", "/api/partners/invite", a, { email: "Friend@Example.test", note: "Let's trade stock" });
    expect(first.status).toBe(201);
    expect(email.sendPartnerInviteEmail).toHaveBeenCalledTimes(1);
    const [to, details] = (email.sendPartnerInviteEmail as any).mock.calls[0];
    expect(to).toBe("friend@example.test");
    expect(details.code).toMatch(/^PT-/);
    expect(details.note).toBe("Let's trade stock");

    expect((await api("POST", "/api/partners/invite", a, { email: "friend@example.test" })).status).toBe(400);
    expect(email.sendPartnerInviteEmail).toHaveBeenCalledTimes(1);
  });
});

describe("store staff", () => {
  /** A payable transfer A -> B, shipped and waiting at B's door. */
  async function shipped() {
    const p = await pair();
    const id = (await api("POST", "/api/partner-transfers", p.a, {
      partnerOrgId: p.B.f.businessId, fromStoreId: p.A.f.storeId, toStoreId: p.B.f.storeId, kind: "send", settlementType: "payable",
      items: [{ fromInventoryId: p.widget.id, quantity: 4, agreedUnitPrice: 123 }],
    })).body.id;
    await api("POST", `/api/partner-transfers/${id}/accept`, p.b, {});
    await api("POST", `/api/partner-transfers/${id}/ship`, p.a);
    return { ...p, id };
  }

  it("sees what is coming and going at their own store, but no prices, terms or balances", async () => {
    const { bStaff, B, id } = await shipped();
    const list = await api("GET", `/api/partner-transfers?storeId=${B.f.storeId}`, bStaff);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ id, status: "shipped", side: "receiver" });

    const detail = await api("GET", `/api/partner-transfers/${id}`, bStaff);
    expect(detail.status).toBe(200);
    expect(detail.body.items[0]).toMatchObject({ name: "Widget", quantity: 4 });
    const json = JSON.stringify([list.body, detail.body]);
    for (const hidden of ["agreedTotal", "agreedUnitPrice", "unitPrice", "unitCostSnapshot", "settlementType", "obligation", "123", "492", "payable"]) {
      expect(json, hidden).not.toContain(hidden);
    }
  });

  it("confirms a delivery at their own store, and gets back no figures", async () => {
    const { bStaff, widget, b, id } = await shipped();
    const line = (await api("GET", `/api/partner-transfers/${id}`, bStaff)).body.items[0];
    const done = await api("POST", `/api/partner-transfers/${id}/receive`, bStaff, { confirmed: { [line.id]: 4 } });
    expect(done.status).toBe(200);
    expect(done.body).toEqual({ id, status: "received" });
    expect(await qtyOf(widget.id)).toMatchObject({ quantity: 6 });
    // The money consequence is still there for the people who may see it.
    expect((await api("GET", `/api/partner-transfers/${id}`, b)).body.obligation.amountDue).toBe(492);
  });

  it("cannot accept, ship, set terms, or open the ledger", async () => {
    const { aStaff, bStaff, id } = await shipped();
    for (const [who, path] of [[bStaff, "accept"], [aStaff, "ship"], [aStaff, "settlement"], [bStaff, "settlement/respond"], [aStaff, "cancel"]] as const) {
      expect((await api("POST", `/api/partner-transfers/${id}/${path}`, who, {})).status, path).toBe(403);
    }
    expect((await api("GET", "/api/partner-ledger", bStaff)).status).toBe(403);
    // Partner list (it carries credit limits) and standing are not for the storefront either.
    expect((await api("GET", "/api/partners", bStaff)).status).toBe(403);
    expect((await api("GET", "/api/partners/engagement", bStaff)).status).toBe(403);
  });

  it("cannot confirm a delivery for the store that sent it, or for a store that is not theirs", async () => {
    const { aStaff, A, B, id } = await shipped();
    const line = (await api("GET", `/api/partner-transfers/${id}`, aStaff)).body.items[0];
    expect((await api("POST", `/api/partner-transfers/${id}/receive`, aStaff, { confirmed: { [line.id]: 4 } })).status).toBe(400); // the sender does not receive
    expect((await api("GET", `/api/partner-transfers?storeId=${B.f.storeId}`, aStaff)).status).toBe(403); // another business's store
    expect((await api("GET", `/api/partner-transfers`, aStaff)).status).toBe(400); // staff must name their store
    expect((await api("GET", `/api/partner-transfers?storeId=${A.f.storeId}`, aStaff)).status).toBe(200);
  });

  it("does not let a stranger's staff see another business's transfer", async () => {
    const { id } = await shipped();
    const C = await biz({ owner: true, staff: true });
    const cStaff = as(C.staffLogin!, C.f.businessId, "staff");
    expect((await api("GET", `/api/partner-transfers/${id}`, cStaff)).status).toBe(404);
    expect((await api("POST", `/api/partner-transfers/${id}/receive`, cStaff, {})).status).toBe(404);
  });
});
