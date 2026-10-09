import { sql } from "drizzle-orm";
import { db } from "../db";
import { getStoreTimezone, toUtcStart, toUtcEnd } from "./dateUtils";

/**
 * Whole-history figures that screens used to build by downloading every receipt (page by page) and looping in the
 * browser. Each is one grouped statement. Raw `db.execute` returns numeric columns as strings, hence the casts.
 */

export interface VatMonth {
  /** Store-local month, "YYYY-MM". */
  month: string;
  taxableSales: number;
  vatCollected: number;
  count: number;
}

/**
 * VAT collected per store-local month. A receipt is its lines together: tax, subtotal and refunded tax are summed
 * across the receipt's non-voided lines and the receipt is dated by its earliest line. Tax counts net of refunds,
 * never below zero; taxable sales are the receipt's subtotal when it carried any tax.
 */
export async function getVatByMonth(storeId: string): Promise<VatMonth[]> {
  const tz = await getStoreTimezone(storeId);
  const { rows } = await db.execute(sql`
    WITH receipts AS (
      SELECT c.receipt_number,
             min(c.created_at) AS at,
             sum(c.tax_total) AS tax,
             sum(o.tax_refunded) AS refunded,
             sum(CASE WHEN c.subtotal <> 0 THEN c.subtotal ELSE c.total_price - c.tax_total END) AS sub
      FROM checkouts c
      JOIN orders o ON o.id = c.order_id
      WHERE c.store_id = ${storeId} AND c.is_voided = false
      GROUP BY c.receipt_number
    ), net AS (
      SELECT to_char((at AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM') AS month,
             GREATEST(0, tax - refunded) AS vat, sub
      FROM receipts
    )
    SELECT month,
           COALESCE(SUM(sub) FILTER (WHERE vat > 0), 0)::float8 AS "taxableSales",
           COALESCE(SUM(vat), 0)::float8 AS "vatCollected",
           COUNT(*)::int AS count
    FROM net GROUP BY month ORDER BY month DESC`);
  return rows as unknown as VatMonth[];
}

/**
 * Which staff members did service work on which store-local days: "staffId:YYYY-MM-DD". A receipt with any
 * service line counts for every lead and assistant named on any of its lines.
 */
export async function getServiceStaffDays(storeId: string, startDate?: string, endDate?: string): Promise<string[]> {
  const tz = await getStoreTimezone(storeId);
  const from = startDate ? toUtcStart(startDate, tz).toISOString() : null;
  const to = endDate ? toUtcEnd(endDate, tz).toISOString() : null;
  const { rows } = await db.execute(sql`
    WITH lines AS (
      SELECT c.receipt_number, c.created_at, i.type,
             c.lead_staff_id, c.assisting_staff1_id, c.assisting_staff2_id
      FROM checkouts c
      JOIN orders o ON o.id = c.order_id
      JOIN inventory i ON i.id = o.inventory_id
      WHERE c.store_id = ${storeId}
        ${from ? sql`AND c.created_at >= ${from}::timestamp` : sql``}
        ${to ? sql`AND c.created_at <= ${to}::timestamp` : sql``}
    ), service_receipts AS (
      SELECT receipt_number FROM lines GROUP BY receipt_number HAVING bool_or(type = 'service')
    )
    SELECT DISTINCT s.staff_id || ':' || to_char((l.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS key
    FROM lines l
    JOIN service_receipts r ON r.receipt_number = l.receipt_number
    CROSS JOIN LATERAL (VALUES (l.lead_staff_id), (l.assisting_staff1_id), (l.assisting_staff2_id)) AS s(staff_id)
    WHERE s.staff_id IS NOT NULL`);
  return rows.map((r: any) => r.key as string);
}
