import { parseDbTimestamp } from "./dbTime";
import { sql } from "drizzle-orm";
import { db } from "../db";

const idList = (ids: string[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);

export interface BusinessSalesStats { txCount: number; gmv: number; latest: Date | null }
export interface BusinessOwner { name: string | null; email: string | null; phone: string | null }

/**
 * What the admin business list shows for a page of businesses, in three set-based queries for the whole page
 * (it used to run about six per business, and fetched every sale of each business to sum and sort in Node):
 * sales count, gross sales and latest sale; active staff; and the owner.
 */
export async function getBusinessRosterStats(orgIds: string[]) {
  const sales = new Map<string, BusinessSalesStats>();
  const staff = new Map<string, number>();
  const owners = new Map<string, BusinessOwner>();
  if (orgIds.length === 0) return { sales, staff, owners };
  const ids = idList(orgIds);

  const [salesRows, staffRows, ownerRows] = await Promise.all([
    db.execute(sql`
      SELECT s.business_id, count(c.id)::int AS tx_count, COALESCE(sum(c.total_price), 0)::float8 AS gmv, max(c.created_at) AS latest
      FROM stores s JOIN checkouts c ON c.store_id = s.id
      WHERE s.business_id IN (${ids}) AND c.is_voided = false
      GROUP BY s.business_id`),
    db.execute(sql`
      SELECT s.business_id, count(st.id)::int AS n
      FROM stores s JOIN staff st ON st.store_id = s.id
      WHERE s.business_id IN (${ids}) AND st.is_archived = false
      GROUP BY s.business_id`),
    db.execute(sql`
      SELECT DISTINCT ON (m.organisation_id) m.organisation_id, u.name, u.email, u.phone
      FROM organisation_members m JOIN users u ON u.id = m.user_id
      WHERE m.organisation_id IN (${ids}) AND m.role = 'owner'
      ORDER BY m.organisation_id, m.id`),
  ]);

  for (const r of salesRows.rows as any[]) sales.set(r.business_id, { txCount: Number(r.tx_count), gmv: Number(r.gmv), latest: r.latest ? parseDbTimestamp(r.latest) : null });
  for (const r of staffRows.rows as any[]) staff.set(r.business_id, Number(r.n));
  for (const r of ownerRows.rows as any[]) owners.set(r.organisation_id, { name: r.name, email: r.email, phone: r.phone });
  return { sales, staff, owners };
}

/** Gross sales of a business as a SQL expression over `organisations` (for filtering and sorting before paging). */
export const businessGmvSql = sql`COALESCE((
  SELECT SUM(c.total_price) FROM checkouts c JOIN stores s ON s.id = c.store_id
  WHERE s.business_id = organisations.id AND c.is_voided = false
), 0)`;

/** The first owner of each business (name, email, phone), for the businesses on screen. */
export async function getBusinessOwners(orgIds: string[]): Promise<Map<string, BusinessOwner>> {
  const owners = new Map<string, BusinessOwner>();
  if (orgIds.length === 0) return owners;
  const rows = await db.execute(sql`
    SELECT DISTINCT ON (m.organisation_id) m.organisation_id, u.name, u.email, u.phone
    FROM organisation_members m JOIN users u ON u.id = m.user_id
    WHERE m.organisation_id IN (${idList(orgIds)}) AND m.role = 'owner'
    ORDER BY m.organisation_id, m.id`);
  for (const r of rows.rows as any[]) owners.set(r.organisation_id, { name: r.name, email: r.email, phone: r.phone });
  return owners;
}
