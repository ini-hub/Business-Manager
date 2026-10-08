// One-time backfill: give a free trial to organisations created through
// POST /api/auth/organisation/create before that route started setting
// status = 'trialing' / trial_ends_at (they were left 'active' with no trial).
//
// Candidates are orgs that are status 'active', have no trial_ends_at, have no
// subscription row, were created after the trial system shipped (on or after the
// earliest org that has a trial_ends_at), and carry the workspace route's
// "-NNNN" random slug suffix. The suffix is a heuristic (a signup business name
// ending in four digits would match too), so the default is a dry run that lists
// the candidates; review them, then re-run with --apply.
//
// The trial runs a full configured length from the moment the script is applied.
//
//   npx tsx scripts/backfill-workspace-trials.ts           # dry run
//   npx tsx scripts/backfill-workspace-trials.ts --apply

import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { getConfiguredTrialDays } from "../server/lib/platformConfig";
import { computeTrialEndsAt } from "../server/lib/trial";

const CANDIDATES = sql`
  FROM organisations o
  WHERE o.status = 'active'
    AND o.trial_ends_at IS NULL
    AND o.slug ~ '-[0-9]{4}$'
    AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.organisation_id = o.id)
    AND o.created_at >= (SELECT MIN(created_at) FROM organisations WHERE trial_ends_at IS NOT NULL)
`;

async function main() {
  const apply = process.argv.includes("--apply");

  const rows = await db.execute(sql`SELECT o.id, o.name, o.slug, o.created_at ${CANDIDATES} ORDER BY o.created_at`);
  const list = (rows as any).rows ?? rows;
  console.log(`${list.length} candidate organisation(s):`);
  for (const r of list as any[]) console.log(`  ${r.id}  ${r.name}  (${r.slug})  created ${new Date(r.created_at).toISOString()}`);

  if (!apply) {
    console.log("\nDry run. Re-run with --apply to start their trials.");
    process.exit(0);
  }

  const trialEndsAt = computeTrialEndsAt(new Date(), await getConfiguredTrialDays());
  const updated = await db.execute(sql`
    UPDATE organisations SET status = 'trialing', trial_ends_at = ${trialEndsAt}
    WHERE id IN (SELECT o.id ${CANDIDATES})
    RETURNING id
  `);
  console.log(`\nStarted a trial for ${((updated as any).rows ?? updated).length} organisation(s), ending ${trialEndsAt.toISOString()}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
