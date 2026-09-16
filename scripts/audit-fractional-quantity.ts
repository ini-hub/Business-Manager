/**
 * One-off audit: finds every inventory row where allowFractional is false
 * (a "countable" item — pieces, units, etc.) but the stored quantity is
 * currently a non-integer. Read-only — per the redesign spec's instruction
 * to report existing fractional data on countable units rather than
 * silently rounding it, this script only lists affected rows; it does not
 * write anything.
 *
 * Run against whichever database you want to audit by pointing DATABASE_URL
 * at it, e.g.:
 *   DATABASE_URL=<production url> npx tsx scripts/audit-fractional-quantity.ts
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  const drift = await db.execute(sql`
    select i.id, i.store_id, i.name, i.type, i.unit, i.quantity, i.allow_fractional,
           s.name as store_name
    from inventory i
    join stores s on s.id = i.store_id
    where i.allow_fractional = false
      and i.quantity <> trunc(i.quantity)
      and i.is_deleted = false
    order by i.store_id, i.name
  `);
  console.log(`Found ${drift.rows.length} non-divisible item(s) with a fractional stored quantity:`);
  for (const row of drift.rows) {
    console.log(row);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
