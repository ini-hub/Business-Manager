import { db, pool } from "../db";
import { eq, sql } from "drizzle-orm";
import { inventory, products, users, organisationMembers, stockMovements } from "@shared/schema";
import { PartnerRepository } from "../repositories/PartnerRepository";
import type { PartnerCtx } from "../repositories/PartnerTransferRepository";
import { assertTestDatabase, ensureSchema, createFixture, sweepResidue, type Fixture } from "./integration-db";

/**
 * Shared set-up for the partner-network integration suites: pairs of businesses with a store each,
 * optional owner/manager/staff logins, stock, and a teardown that removes everything they created.
 *
 * The shared fixture's own cleanup knows nothing about partner tables, inventory, the stock ledger,
 * gamification or notifications, and a store cannot be deleted while any of them still reference it.
 */
export function partnerTestKit() {
  const partners = new PartnerRepository();
  let fixtures: Fixture[] = [];
  const storeIds: string[] = [];
  const userIds: string[] = [];

  async function biz(opts: { owner?: boolean; staff?: boolean } = {}) {
    const f = await createFixture();
    fixtures.push(f);
    storeIds.push(f.storeId);
    const ctx: PartnerCtx = { orgId: f.businessId, userId: null };
    const login = async (role: "owner" | "manager" | "staff") => {
      const email = `owner-${role}-${f.businessId.slice(0, 8)}@example.test`;
      const [u] = await db.insert(users).values({ email, name: `Test ${role}`, role }).returning();
      userIds.push(u.id);
      await db.insert(organisationMembers).values({ userId: u.id, organisationId: f.businessId, role, status: "active" });
      // A staff login must be tied to a staff record at the store, as in the app, or store access is refused.
      if (role === "staff") await db.execute(sql`UPDATE staff SET user_id = ${u.id} WHERE id = ${f.staffId}`);
      return { id: u.id, email };
    };
    const owner = opts.owner ? await login("owner") : undefined;
    const staffLogin = opts.staff ? await login("staff") : undefined;
    return { f, ctx, owner, ownerEmail: owner?.email, staffLogin };
  }

  async function addProduct(storeId: string, name: string, qty: number, cost: number, extra: Partial<typeof inventory.$inferInsert> = {}) {
    const [p] = await db.insert(products).values({ storeId, name, type: "product" }).returning();
    const [inv] = await db.insert(inventory).values({ storeId, productId: p.id, name, type: "product", quantity: qty, costPrice: cost, sellingPrice: cost * 2, ...extra }).returning();
    // As createInventoryItem does: a new item's starting stock is its first ledger row.
    if (inv.quantity !== 0) {
      await db.insert(stockMovements).values({
        storeId, inventoryId: inv.id, reason: "opening_balance", quantityBefore: 0, quantityAfter: inv.quantity, delta: inv.quantity, note: "test opening stock",
      });
    }
    return inv;
  }

  const qtyOf = async (id: string) => (await db.select().from(inventory).where(eq(inventory.id, id)))[0];

  async function connect(a: { ctx: PartnerCtx }, b: { ctx: PartnerCtx }) {
    const code = await partners.ensurePartnerCode(b.ctx.orgId);
    const req = await partners.request(a.ctx.orgId, null, code);
    return partners.respond(req.id, b.ctx.orgId, null, true);
  }

  async function purge(stores: string[], orgs: string[]) {
    const list = (xs: string[]) => sql.join(xs.map((i) => sql`${i}`), sql`, `);
    if (stores.length) {
      const transfers = sql`SELECT id FROM partner_transfers WHERE from_store_id IN (${list(stores)}) OR to_store_id IN (${list(stores)})`;
      await db.execute(sql`DELETE FROM partner_settlements WHERE obligation_id IN (SELECT id FROM partner_obligations WHERE transfer_id IN (${transfers}))`);
      await db.execute(sql`DELETE FROM partner_obligations WHERE transfer_id IN (${transfers})`);
      await db.execute(sql`DELETE FROM partner_transfer_events WHERE transfer_id IN (${transfers})`);
      await db.execute(sql`DELETE FROM partner_transfer_items WHERE transfer_id IN (${transfers})`);
      await db.execute(sql`DELETE FROM partner_transfers WHERE from_store_id IN (${list(stores)}) OR to_store_id IN (${list(stores)})`);
    }
    if (orgs.length) {
      await db.execute(sql`DELETE FROM partner_statement_log WHERE org_id IN (${list(orgs)})`);
      await db.execute(sql`DELETE FROM partner_invites WHERE org_id IN (${list(orgs)})`);
      await db.execute(sql`DELETE FROM business_partnerships WHERE requester_org_id IN (${list(orgs)}) OR addressee_org_id IN (${list(orgs)})`);
    }
    for (const id of stores) {
      await db.execute(sql`DELETE FROM notifications WHERE store_id = ${id}`);
      await db.execute(sql`DELETE FROM gamification_badge_awards WHERE store_id = ${id}`);
      await db.execute(sql`DELETE FROM gamification_points_ledger WHERE store_id = ${id}`);
      await db.execute(sql`DELETE FROM stock_movements WHERE store_id = ${id}`);
      await db.execute(sql`DELETE FROM inventory_restock_events WHERE store_id = ${id}`);
      await db.execute(sql`DELETE FROM profit_loss WHERE store_id = ${id}`);
      await db.execute(sql`DELETE FROM inventory WHERE store_id = ${id}`);
      await db.execute(sql`DELETE FROM products WHERE store_id = ${id}`);
    }
  }

  async function deleteUsers(ids: string[]) {
    for (const id of ids) {
      await db.execute(sql`UPDATE staff SET user_id = NULL WHERE user_id = ${id}`);
      await db.delete(organisationMembers).where(eq(organisationMembers.userId, id));
      await db.delete(users).where(eq(users.id, id));
    }
  }

  /** Call from beforeAll. Clears whatever an interrupted run left behind, then the shared fixture's own residue. */
  async function setup() {
    assertTestDatabase();
    await ensureSchema();
    const { rows } = await pool.query<{ id: string; business_id: string }>(`SELECT id, business_id FROM stores WHERE name LIKE 'Test Store itest-%'`);
    await purge(rows.map((r) => r.id), Array.from(new Set(rows.map((r) => r.business_id))));
    const stale = await pool.query<{ id: string }>(`SELECT id FROM users WHERE email LIKE 'owner-%@example.test'`);
    await deleteUsers(stale.rows.map((r) => r.id));
    await sweepResidue();
  }

  /** Call from afterEach. */
  async function teardown() {
    await purge(storeIds.splice(0), fixtures.map((f) => f.businessId));
    await deleteUsers(userIds.splice(0));
    for (const f of fixtures) await f.cleanup();
    fixtures = [];
  }

  /**
   * The stock ledger's own reconciliation rules (scripts/stock-ledger-parity.ts), scoped to some stores:
   * stock equals the sum of its movements, movements chain, and every item has an opening balance.
   * Returns the problems found, so a test can assert there are none.
   */
  async function ledgerProblems(forStores: string[]): Promise<string[]> {
    const list = sql.join(forStores.map((i) => sql`${i}`), sql`, `);
    const problems: string[] = [];
    const drift = await db.execute(sql`
      SELECT i.name, i.quantity::text AS quantity, COALESCE(SUM(m.delta), 0)::text AS ledger FROM inventory i
      LEFT JOIN stock_movements m ON m.inventory_id = i.id WHERE i.store_id IN (${list})
      GROUP BY i.id HAVING abs(i.quantity - COALESCE(SUM(m.delta), 0)) > 0.0001`);
    for (const r of drift.rows as any[]) problems.push(`L1 ${r.name}: stock ${r.quantity}, ledger ${r.ledger}`);
    const breaks = await db.execute(sql`
      SELECT reason, before::text, expected::text FROM (
        SELECT reason, quantity_before AS before, LAG(quantity_after) OVER (PARTITION BY inventory_id ORDER BY created_at, id) AS expected
        FROM stock_movements WHERE store_id IN (${list})) t
      WHERE expected IS NOT NULL AND abs(before - expected) > 0.0001`);
    for (const r of breaks.rows as any[]) problems.push(`L3 ${r.reason}: started at ${r.before}, previous ended at ${r.expected}`);
    const noOpening = await db.execute(sql`
      SELECT i.name FROM inventory i WHERE i.store_id IN (${list})
        AND NOT EXISTS (SELECT 1 FROM stock_movements m WHERE m.inventory_id = i.id AND m.reason = 'opening_balance')`);
    for (const r of noOpening.rows as any[]) problems.push(`L4 ${r.name}: no opening balance`);
    return problems;
  }

  return { partners, biz, addProduct, qtyOf, connect, setup, teardown, ledgerProblems };
}
