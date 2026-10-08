import { db } from "../db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  stores,
  organisationMembers,
  users,
  partnerInvites,
  partnerTransfers,
  businessPartnerships,
  gamificationBadgeAwards,
  gamificationPointsLedger,
} from "@shared/schema";
import { POINTS_RULES } from "@shared/gamification/badges";
import { gamificationRepository } from "../repositories/GamificationRepository";
import { reputation, type ReputationStats } from "../lib/partnerEngagement";

const MOVED = sql`('received', 'disputed', 'closed')`;

/**
 * Track record of a business across all its partner dealings, as the pure `reputation` rule wants
 * it. Counted at org level, because a partner is judging the business, not one of its branches.
 */
export async function partnerStats(orgId: string): Promise<ReputationStats> {
  const { rows } = await db.execute(sql`
    SELECT
      (SELECT count(*) FROM partner_transfers t WHERE t.to_org_id = ${orgId} AND t.status IN ${MOVED})::int AS received,
      (SELECT count(*) FROM partner_transfers t WHERE t.to_org_id = ${orgId} AND t.status IN ${MOVED}
         AND NOT EXISTS (SELECT 1 FROM partner_transfer_items i WHERE i.transfer_id = t.id AND i.confirmed_quantity < i.quantity))::int AS received_complete,
      (SELECT count(*) FROM partner_transfers t WHERE (t.from_org_id = ${orgId} OR t.to_org_id = ${orgId}) AND t.status IN ${MOVED})::int AS completed,
      (SELECT count(*) FROM partner_obligations o WHERE o.debtor_org_id = ${orgId} AND o.status = 'settled')::int AS settled,
      (SELECT count(*) FROM partner_obligations o WHERE o.debtor_org_id = ${orgId} AND o.status = 'settled'
         AND (o.due_date IS NULL OR coalesce((SELECT max(s.confirmed_at) FROM partner_settlements s WHERE s.obligation_id = o.id AND s.status = 'confirmed'), o.updated_at) <= o.due_date + interval '1 day'))::int AS settled_on_time,
      (SELECT count(*) FROM partner_obligations o WHERE o.debtor_org_id = ${orgId} AND o.status = 'open' AND o.due_date IS NOT NULL AND o.due_date < now())::int AS overdue_open
  `);
  const r = rows[0] as Record<string, number>;
  return {
    received: r.received ?? 0,
    receivedComplete: r.received_complete ?? 0,
    settled: r.settled ?? 0,
    settledOnTime: r.settled_on_time ?? 0,
    overdueOpen: r.overdue_open ?? 0,
    completedTransfers: r.completed ?? 0,
  };
}

export async function getReputation(orgId: string) {
  const stats = await partnerStats(orgId);
  return { ...reputation(stats), completedTransfers: stats.completedTransfers };
}

async function storeTransferCount(storeId: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(partnerTransfers).where(and(
    sql`(${partnerTransfers.fromStoreId} = ${storeId} OR ${partnerTransfers.toStoreId} = ${storeId})`,
    sql`${partnerTransfers.status} IN ${MOVED}`,
  ));
  return row?.n ?? 0;
}

/** Goods have changed hands: reward both branches, and hand out the milestone badges they have now earned. */
export async function onTransferReceived(transfer: { id: string; fromStoreId: string; toStoreId: string }): Promise<void> {
  for (const storeId of [transfer.fromStoreId, transfer.toStoreId]) {
    await gamificationRepository.awardOnce(storeId, storeId, POINTS_RULES.partner_transfer_completed, "partner_transfer_completed", "partner_transfer", transfer.id);
    const n = await storeTransferCount(storeId);
    if (n >= 1) await gamificationRepository.grantOwnerBadge(storeId, "partner_first_share");
    if (n >= 5) await gamificationRepository.grantOwnerBadge(storeId, "partner_trusted_trader");
  }
}

/** A balance was cleared: if the debtor has now cleared three on time, their branch earns the badge. */
export async function onBalanceSettled(obligationId: string): Promise<void> {
  const { rows } = await db.execute(sql`
    SELECT o.debtor_org_id AS org, t.to_store_id AS store FROM partner_obligations o
    JOIN partner_transfers t ON t.id = o.transfer_id WHERE o.id = ${obligationId} AND o.status = 'settled'`);
  const row = rows[0] as { org: string; store: string } | undefined;
  if (!row) return;
  const stats = await partnerStats(row.org);
  if (stats.settledOnTime >= 3) await gamificationRepository.grantOwnerBadge(row.store, "partner_reliable_settler");
}

async function emailsOfOrg(orgId: string): Promise<string[]> {
  const rows = await db.select({ email: users.email }).from(organisationMembers)
    .innerJoin(users, eq(organisationMembers.userId, users.id))
    .where(and(eq(organisationMembers.organisationId, orgId), inArray(organisationMembers.role, ["owner", "manager"])));
  return rows.flatMap((r) => (r.email ? [r.email.toLowerCase()] : []));
}

async function mainStoreOf(orgId: string): Promise<string | undefined> {
  const rows = await db.select({ id: stores.id, isMain: stores.isMain }).from(stores).where(eq(stores.businessId, orgId));
  return (rows.find((r) => r.isMain) ?? rows[0])?.id;
}

/**
 * Two businesses became partners. If either had emailed the other's owner an invitation, that
 * invitation worked: credit the inviter, once. Matching on the invited address means a business
 * cannot claim credit for a partner it did not actually bring in.
 */
export async function onPartnershipActivated(partnershipId: string): Promise<void> {
  const [p] = await db.select().from(businessPartnerships).where(eq(businessPartnerships.id, partnershipId));
  if (!p || p.status !== "active") return;

  for (const [inviter, invitee] of [[p.requesterOrgId, p.addresseeOrgId], [p.addresseeOrgId, p.requesterOrgId]] as const) {
    const theirEmails = await emailsOfOrg(invitee);
    if (!theirEmails.length) continue;
    const open = await db.select().from(partnerInvites).where(and(
      eq(partnerInvites.orgId, inviter), isNull(partnerInvites.acceptedAt), sql`lower(${partnerInvites.email}) IN (${sql.join(theirEmails.map((e) => sql`${e}`), sql`, `)})`,
    ));
    if (!open.length) continue;
    const claimed = await db.update(partnerInvites).set({ acceptedAt: new Date() })
      .where(and(inArray(partnerInvites.id, open.map((i) => i.id)), isNull(partnerInvites.acceptedAt))).returning({ id: partnerInvites.id });
    if (!claimed.length) continue; // another request got there first
    const storeId = await mainStoreOf(inviter);
    if (!storeId) continue;
    await gamificationRepository.awardOnce(storeId, storeId, POINTS_RULES.partner_connected, "partner_connected", "partnership", p.id);
    await gamificationRepository.grantOwnerBadge(storeId, "partner_connector");
  }
}

/** What the Partners page shows about a business's own standing: points, badges and reputation. */
export async function engagementFor(orgId: string) {
  const orgStores = await db.select({ id: stores.id }).from(stores).where(eq(stores.businessId, orgId));
  const ids = orgStores.map((s) => s.id);
  const [badges, points] = ids.length
    ? await Promise.all([
        db.selectDistinct({ key: gamificationBadgeAwards.badgeKey }).from(gamificationBadgeAwards)
          .where(and(inArray(gamificationBadgeAwards.storeId, ids), eq(gamificationBadgeAwards.subjectType, "owner"), sql`${gamificationBadgeAwards.badgeKey} LIKE 'partner\_%'`)),
        db.select({ total: sql<number>`coalesce(sum(${gamificationPointsLedger.points}), 0)::int` }).from(gamificationPointsLedger)
          .where(and(inArray(gamificationPointsLedger.storeId, ids), eq(gamificationPointsLedger.subjectType, "owner"), sql`${gamificationPointsLedger.reason} LIKE 'partner\_%'`)),
      ])
    : [[], [{ total: 0 }]];
  return { badges: badges.map((b) => b.key), points: points[0]?.total ?? 0, reputation: await getReputation(orgId) };
}
