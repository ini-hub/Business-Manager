/**
 * Backfills payroll_postings for payroll periods that were paid before the
 * ledger existed.
 *
 * Rebuilds each period's lines from the figures still on record
 * (payroll_entries + payroll_deductions) using the same buildPostings() the
 * live settlement path calls, so history and new runs cannot drift apart.
 *
 * Idempotent: postPeriod replaces a period's postings wholesale, so re-running
 * converges rather than duplicating. Pass --dry to preview.
 */
import { pool, db } from "../server/db";
import { sql } from "drizzle-orm";
import { payrollPostingService } from "../server/services/PayrollPostingService";

const dryRun = process.argv.includes("--dry");

(async () => {
  const periods = await db.execute(sql`
    SELECT pp.id, pp.start_date, pp.end_date, s.name AS store
      FROM payroll_periods pp
      JOIN stores s ON s.id = pp.store_id
     WHERE pp.status = 'paid'
     ORDER BY s.name, pp.start_date`);

  console.log(`${periods.rows.length} paid period(s) to backfill${dryRun ? " (dry run)" : ""}.`);

  let posted = 0;
  let skipped = 0;
  for (const p of periods.rows as any[]) {
    const label = `${p.store}  ${p.start_date}..${p.end_date}`;
    if (dryRun) {
      const existing = await db.execute(sql`
        SELECT COUNT(*)::int AS n FROM payroll_postings WHERE period_id = ${p.id}`);
      console.log(`  ${(existing.rows[0] as any).n > 0 ? "has postings" : "would post  "}  ${label}`);
      continue;
    }
    try {
      const lines = await payrollPostingService.postPeriodStandalone(p.id);
      if (lines.length === 0) { skipped++; console.log(`  no figures   ${label}`); }
      else { posted++; console.log(`  ${String(lines.length).padStart(2)} lines     ${label}`); }
    } catch (e) {
      console.error(`  FAILED       ${label}: ${(e as Error).message}`);
      await pool.end();
      process.exit(1);
    }
  }

  if (!dryRun) console.log(`\nPosted ${posted} period(s); ${skipped} had no figures to post.`);
  await pool.end();
  process.exit(0);
})().catch(async (e) => {
  console.error("Backfill crashed:", e);
  await pool.end().catch(() => {});
  process.exit(1);
});
