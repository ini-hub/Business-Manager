import { and, eq, isNull, sql } from "drizzle-orm";
import { db, pool } from "../db";
import {
  organisations,
  organisationMembers,
  users,
  subscriptions,
  businessDeletionFeedback,
  DELETION_REASONS,
} from "@shared/schema";
import { revokeOrgSessions } from "./authSessions";
import { invalidateOrgAccess } from "../auth";
import { sendBusinessDeletedEmail } from "../email";
import { z } from "zod";

export const deleteBusinessSchema = z.object({
  confirmName: z.string().trim().min(1),
  reasons: z.array(z.enum(DELETION_REASONS)).min(1, "Pick at least one reason."),
  details: z.string().trim().max(2000).optional(),
  wouldReturn: z.enum(["yes", "maybe", "no"]).optional(),
  contactOk: z.boolean().optional(),
});

export class BusinessDeletionError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Soft-deletes a business on the owner's behalf. Nothing is removed: the row is
 * stamped deleted_at, every session scoped to it is revoked and its members
 * lose access (the membership rows stay). A super admin can still open it and
 * is the only one who can purge it (purgeBusiness) or restore it.
 */
export async function deleteBusinessByOwner(
  organisationId: string,
  ownerUserId: string,
  input: z.infer<typeof deleteBusinessSchema>,
): Promise<void> {
  const [org] = await db.select().from(organisations).where(eq(organisations.id, organisationId));
  if (!org || org.deletedAt) throw new BusinessDeletionError(404, "Business not found.");
  if (input.confirmName.trim().toLowerCase() !== org.name.trim().toLowerCase()) {
    throw new BusinessDeletionError(400, "The name you typed doesn't match this business.");
  }

  const [owner] = await db.select({ email: users.email }).from(users).where(eq(users.id, ownerUserId));
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(organisations)
      .set({
        deletedAt: now,
        deletedByUserId: ownerUserId,
        deletionReason: `Owner request: ${input.reasons.join(", ")}`,
        updatedAt: now,
      })
      .where(and(eq(organisations.id, organisationId), isNull(organisations.deletedAt)));
    // Stop any further renewal charge; the plan simply runs out.
    await tx.update(subscriptions).set({ cancelAtPeriodEnd: true, updatedAt: now }).where(eq(subscriptions.organisationId, organisationId));
    await tx.insert(businessDeletionFeedback).values({
      organisationId,
      organisationName: org.name,
      userId: ownerUserId,
      userEmail: owner?.email ?? null,
      reasons: input.reasons,
      details: input.details || null,
      wouldReturn: input.wouldReturn ?? null,
      contactOk: input.contactOk ?? false,
    });
  });

  await revokeOrgSessions(organisationId, "business_deleted");
  invalidateOrgAccess(organisationId);

  // Best-effort notices; never fail the deletion over an email.
  try {
    const members = await db
      .select({ userId: organisationMembers.userId, role: organisationMembers.role, email: users.email, name: users.name })
      .from(organisationMembers)
      .innerJoin(users, eq(users.id, organisationMembers.userId))
      .where(eq(organisationMembers.organisationId, organisationId));
    for (const m of members) {
      if (!m.email) continue;
      void sendBusinessDeletedEmail(m.email, m.name || "there", org.name, m.userId === ownerUserId ? "owner" : "member");
    }
  } catch (error) {
    console.error("Business deletion notice failed:", error);
  }
}

export async function restoreBusiness(organisationId: string): Promise<void> {
  await db
    .update(organisations)
    .set({ deletedAt: null, deletionReason: null, deletedByUserId: null, updatedAt: new Date() })
    .where(eq(organisations.id, organisationId));
  invalidateOrgAccess(organisationId);
}

export interface FkEdge { child: string; childCol: string; parent: string; parentCol: string; nullable: boolean }

async function loadForeignKeys(tx: Pick<typeof db, "execute">): Promise<Map<string, FkEdge[]>> {
  const res: any = await tx.execute(sql`
    SELECT c.conrelid::regclass::text AS child, ca.attname AS child_col,
           c.confrelid::regclass::text AS parent, pa.attname AS parent_col,
           NOT ca.attnotnull AS nullable
    FROM pg_constraint c
    JOIN pg_attribute ca ON ca.attrelid = c.conrelid AND ca.attnum = c.conkey[1]
    JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = c.confkey[1]
    WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1
      AND c.connamespace = 'public'::regnamespace`);
  const byParent = new Map<string, FkEdge[]>();
  for (const r of res.rows as any[]) {
    const edge: FkEdge = { child: r.child, childCol: r.child_col, parent: r.parent, parentCol: r.parent_col, nullable: r.nullable };
    byParent.set(edge.parent, [...(byParent.get(edge.parent) ?? []), edge]);
  }
  return byParent;
}

const ident = (s: string) => s.split(".").map((p) => (p.startsWith('"') ? p : `"${p}"`)).join(".");

// Tables whose nullable organisation reference means "applies to this business
// only" - nulling it would widen the row to everyone, so those rows are deleted.
const DELETE_NOT_NULL_OUT = new Set(["announcements"]);

/**
 * Builds one SQL script that removes a business and everything hanging off it.
 *
 * It walks the foreign-key graph from organisations along NOT NULL references,
 * parents first, copying each table's affected row ids into a temp table, then
 * deletes the tables in reverse (children first). Nullable references from rows
 * that survive are set to NULL. Every table is visited once - a recursive walk
 * re-visits tables reached by several paths and explodes in statement count.
 */
export function buildPurgeScript(organisationId: string, edges: FkEdge[]): { script: string; tables: string[] } {
  const byParent = new Map<string, FkEdge[]>();
  const byChild = new Map<string, FkEdge[]>();
  for (const e of edges) {
    byParent.set(e.parent, [...(byParent.get(e.parent) ?? []), e]);
    byChild.set(e.child, [...(byChild.get(e.child) ?? []), e]);
  }

  // Reachable set: organisations plus everything that must go with it.
  const reachable = new Set<string>(["organisations"]);
  const queue = ["organisations"];
  while (queue.length) {
    const t = queue.shift()!;
    for (const e of byParent.get(t) ?? []) {
      const deleteIt = !e.nullable || DELETE_NOT_NULL_OUT.has(e.child);
      if (deleteIt && !reachable.has(e.child)) { reachable.add(e.child); queue.push(e.child); }
    }
  }

  // Parents-first order. Row membership (temp-table creation) only follows the
  // edges that define it; deletion order also honours the nullable ones.
  const sortParentsFirst = (useEdge: (e: FkEdge) => boolean): string[] => {
    const incoming = new Map<string, number>();
    for (const t of Array.from(reachable)) incoming.set(t, 0);
    const used = edges.filter((e) => reachable.has(e.child) && reachable.has(e.parent) && e.child !== e.parent && useEdge(e));
    for (const e of used) incoming.set(e.child, (incoming.get(e.child) ?? 0) + 1);
    const out: string[] = [];
    const ready = Array.from(reachable).filter((t) => incoming.get(t) === 0);
    while (ready.length) {
      const t = ready.shift()!;
      out.push(t);
      for (const e of used) {
        if (e.parent !== t) continue;
        const n = (incoming.get(e.child) ?? 0) - 1;
        incoming.set(e.child, n);
        if (n === 0) ready.push(e.child);
      }
    }
    for (const t of Array.from(reachable)) if (!out.includes(t)) out.push(t);
    return out;
  };
  const isMembershipEdge = (e: FkEdge) => !e.nullable || DELETE_NOT_NULL_OUT.has(e.child);
  const order = sortParentsFirst(isMembershipEdge);
  const deleteOrder = sortParentsFirst(() => true).reverse();

  const tmp = new Map(order.map((t, i) => [t, `_purge_${i}`]));
  const id = organisationId.replace(/'/g, "''");
  const stmts: string[] = [];

  for (const t of order) {
    const cols = Array.from(new Set((byParent.get(t) ?? []).map((e) => e.parentCol))).map(ident);
    const select = ["ctid AS _rid", ...cols].join(", ");
    let where: string;
    if (t === "organisations") {
      where = `${ident("id")} = '${id}'`;
    } else {
      const conds = (byChild.get(t) ?? [])
        .filter((e) => reachable.has(e.parent) && e.parent !== t && (!e.nullable || DELETE_NOT_NULL_OUT.has(t)))
        .map((e) => `${ident(e.childCol)} IN (SELECT ${ident(e.parentCol)} FROM ${tmp.get(e.parent)})`);
      where = conds.length ? conds.join(" OR ") : "false";
    }
    stmts.push(`CREATE TEMP TABLE ${tmp.get(t)} ON COMMIT DROP AS SELECT ${select} FROM ${ident(t)} WHERE ${where}`);
  }

  // Surviving rows that merely mention the business (or a deleted row) lose the reference.
  for (const e of edges) {
    if (!e.nullable || !reachable.has(e.parent) || reachable.has(e.child)) continue;
    stmts.push(`UPDATE ${ident(e.child)} SET ${ident(e.childCol)} = NULL WHERE ${ident(e.childCol)} IN (SELECT ${ident(e.parentCol)} FROM ${tmp.get(e.parent)})`);
  }

  for (const t of deleteOrder) {
    stmts.push(`DELETE FROM ${ident(t)} WHERE ctid IN (SELECT _rid FROM ${tmp.get(t)})`);
  }
  // Plain-column references with no foreign key.
  stmts.push(`DELETE FROM auth_sessions WHERE organisation_id = '${id}'`);
  stmts.push(`UPDATE users SET business_id = NULL WHERE business_id = '${id}'`);
  return { script: stmts.join(";\n"), tables: order };
}

/**
 * Permanently removes a business and everything hanging off it, in one
 * transaction: it either all goes or nothing does. Only callable for an
 * already soft-deleted business, and the route requires super_admin.
 */
export async function purgeBusiness(organisationId: string): Promise<{ name: string; tablesTouched: number }> {
  const [org] = await db.select().from(organisations).where(eq(organisations.id, organisationId));
  if (!org) throw new BusinessDeletionError(404, "Business not found.");
  if (!org.deletedAt) throw new BusinessDeletionError(409, "Only a deleted business can be permanently removed.");

  // A dedicated connection: the whole script goes over the simple query
  // protocol as a single round trip instead of hundreds.
  const client = await pool.connect();
  let tables: string[];
  try {
    const fks = await loadForeignKeys(db);
    const built = buildPurgeScript(org.id, Array.from(fks.values()).flat());
    tables = built.tables;
    await client.query("BEGIN");
    await client.query(built.script);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  invalidateOrgAccess(organisationId);
  return { name: org.name, tablesTouched: tables.length };
}
