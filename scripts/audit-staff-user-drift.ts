/**
 * One-off audit: finds every non-archived staff row whose name/email has
 * drifted from the users row it's linked to (staff.userId). Read-only.
 *
 * Run against whichever database you want to audit by pointing DATABASE_URL
 * at it, e.g.:
 *   DATABASE_URL=<production url> npx tsx scripts/audit-staff-user-drift.ts
 *
 * See /Users/mac/.claude/plans/twinkly-moseying-origami.md, Phase 3.
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  const drift = await db.execute(sql`
    select s.id as staff_id, s.store_id, s.name as staff_name, s.email as staff_email,
           u.id as user_id, u.name as user_name, u.email as user_email
    from staff s
    join users u on u.id = s.user_id
    where s.is_archived = false
      and (lower(s.email) is distinct from lower(u.email) or s.name is distinct from u.name)
    order by s.created_at
  `);
  console.log(`Found ${drift.rows.length} drifted row(s):`);
  for (const row of drift.rows) {
    console.log(row);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
