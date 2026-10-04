/**
 * Pushes shared/features.ts into feature_catalog / feature_flags /
 * feature_dependencies. See server/lib/featureSync.ts for what it will and will
 * not overwrite.
 *
 *   npm run features:sync              # apply
 *   npm run features:sync -- --dry-run # print what would change, write nothing
 *
 * Point DATABASE_URL at the database you want to sync.
 */
import { formatSyncReport, syncFeatureRegistry } from "../server/lib/featureSync";
import { pool } from "../server/db";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const report = await syncFeatureRegistry({ dryRun });
  console.log(dryRun ? "DRY RUN - nothing was written\n" : "Applied\n");
  console.log(formatSyncReport(report));
}

main()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error("features:sync failed:", error);
    await pool.end().catch(() => {});
    process.exit(1);
  });
