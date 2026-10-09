import { parseDbTimestamp } from "./dbTime";
import { sql } from "drizzle-orm";
import { db } from "../db";

/**
 * Platform anomaly lists for the super-admin console. Both used to read every row of a large table (every
 * checkout ever made; every user) into Node and apply the rules in a loop, with extra queries per user, and each
 * response ended with a hard-coded example row that did not exist in the data. The rules are now applied by the
 * database, newest first, one page at a time, and only real findings are returned.
 *
 * Each record is flagged by the FIRST rule it meets, in this order, exactly as the loops did.
 */
export const LARGE_TRANSACTION_THRESHOLD = 500_000;
export const HIGH_DISCOUNT_PERCENT = 40;
export const RAPID_VOID_MINUTES = 5;
export const ROUND_NUMBER_MINIMUM = 100_000;
export const ROUND_NUMBER_STEP = 10_000;
export const EXCESSIVE_FAILED_LOGINS = 10;
export const MULTI_OWNERSHIP_COUNT = 5;
export const DORMANT_OWNER_DAYS = 60;

export interface FlaggedTransaction {
  id: string;
  reference: string;
  business: string;
  date: Date;
  total: number;
  flag: string;
  trigger: string;
}

const money = (n: number) => n.toLocaleString();

export async function getFlaggedTransactions(page: { limit: number; offset: number }): Promise<{ rows: FlaggedTransaction[]; total: number }> {
  const result = await db.execute(sql`
    WITH flagged AS (
      SELECT c.id, c.receipt_number, s.name AS business, c.created_at, c.total_charged, c.discount_percent,
             c.voided_at,
        CASE
          WHEN c.total_price > ${LARGE_TRANSACTION_THRESHOLD} THEN 'large'
          WHEN c.discount_percent > ${HIGH_DISCOUNT_PERCENT} THEN 'discount'
          WHEN c.is_voided AND c.voided_at IS NOT NULL
               AND EXTRACT(EPOCH FROM (c.voided_at - c.created_at)) / 60 < ${RAPID_VOID_MINUTES} THEN 'void'
          WHEN c.total_price >= ${ROUND_NUMBER_MINIMUM} AND c.total_price % ${ROUND_NUMBER_STEP} = 0 THEN 'round'
        END AS rule
      FROM checkouts c JOIN stores s ON s.id = c.store_id
    )
    SELECT id, receipt_number, business, created_at, total_charged::float8 AS total_charged, discount_percent::float8 AS discount_percent,
           EXTRACT(EPOCH FROM (voided_at - created_at)) / 60 AS void_minutes, rule, count(*) OVER ()::int AS total
    FROM flagged WHERE rule IS NOT NULL
    ORDER BY created_at DESC, id
    LIMIT ${page.limit} OFFSET ${page.offset}`);

  const rows = (result.rows as any[]).map((r): FlaggedTransaction => {
    const base = { id: r.id, reference: r.receipt_number, business: r.business, date: parseDbTimestamp(r.created_at), total: Number(r.total_charged) };
    switch (r.rule) {
      case "large":
        return { ...base, flag: "Unusually large", trigger: `Transaction total ₦${money(base.total)} exceeds platform threshold.` };
      case "discount":
        return { ...base, flag: "High discount", trigger: `Discretionary markdown of ${Number(r.discount_percent)}% exceeds warning index.` };
      case "void":
        return { ...base, flag: "Rapid void", trigger: `Transaction voided in ${Math.round(Number(r.void_minutes))} minutes. Suspicious reversal patterns.` };
      default:
        return { ...base, flag: "Round number", trigger: `Suspiciously round amount ₦${money(base.total)} suggests manual input bypass.` };
    }
  });
  const total = result.rows.length > 0 ? Number((result.rows[0] as any).total) : 0;
  return { rows, total };
}

export interface FlaggedUser { id: string; name: string; email: string; flag: string; trigger: string }

export async function getFlaggedUsers(page: { limit: number; offset: number }, now: Date = new Date()): Promise<{ rows: FlaggedUser[]; total: number }> {
  const dormantSince = new Date(now.getTime() - DORMANT_OWNER_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const result = await db.execute(sql`
    WITH owned AS (
      SELECT user_id, count(*)::int AS orgs_owned, array_agg(organisation_id) AS org_ids
      FROM organisation_members WHERE role = 'owner' GROUP BY user_id
    ),
    flagged AS (
      SELECT u.id, u.name, u.email, u.phone, u.login_attempts, COALESCE(o.orgs_owned, 0) AS orgs_owned,
        CASE
          WHEN u.login_attempts >= ${EXCESSIVE_FAILED_LOGINS} THEN 'logins'
          WHEN COALESCE(o.orgs_owned, 0) >= ${MULTI_OWNERSHIP_COUNT} THEN 'multi'
          WHEN COALESCE(o.orgs_owned, 0) > 0
               AND (u.last_login_at IS NULL OR u.last_login_at < ${dormantSince}::timestamp)
               AND EXISTS (
                 SELECT 1 FROM checkouts c JOIN stores s ON s.id = c.store_id
                 WHERE s.business_id = ANY(o.org_ids) AND c.created_at >= ${dormantSince}::timestamp
               ) THEN 'dormant'
        END AS rule
      FROM users u LEFT JOIN owned o ON o.user_id = u.id
    )
    SELECT id, name, email, phone, login_attempts, orgs_owned, rule, count(*) OVER ()::int AS total
    FROM flagged WHERE rule IS NOT NULL
    ORDER BY id
    LIMIT ${page.limit} OFFSET ${page.offset}`);

  const rows = (result.rows as any[]).map((r): FlaggedUser => {
    const base = { id: r.id, name: r.name || "Business User", email: r.email || r.phone || "No Contact" };
    switch (r.rule) {
      case "logins":
        return { ...base, flag: "Excessive failed logins", trigger: `Account registered ${r.login_attempts} failed attempts. Currently locked or flagged.` };
      case "multi":
        return { ...base, flag: "Multiple org ownership", trigger: `Owner of ${r.orgs_owned} organisations. Highly unusual scaling pattern.` };
      default:
        return { ...base, flag: "Dormant owner", trigger: `Owner inactive for 60+ days but staff recorded sales recently.` };
    }
  });
  const total = result.rows.length > 0 ? Number((result.rows[0] as any).total) : 0;
  return { rows, total };
}
