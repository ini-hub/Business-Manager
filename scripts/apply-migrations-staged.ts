/**
 * Applies an explicit list of migrations, in the order given, each in its own transaction.
 *
 * Why not server/migrate.ts: that applies every pending file at once. This release needs 0116
 * (stock ledger opening balances) applied separately, immediately before the deploy, so stock
 * sold by the old code between the migration and the deploy does not show up as ledger drift.
 *
 * Usage (the target is read ONLY from the TARGET_DATABASE_URL variable, never from .env):
 *   TARGET_DATABASE_URL=... npx tsx scripts/apply-migrations-staged.ts <file> [<file> ...]           # dry run
 *   TARGET_DATABASE_URL=... npx tsx scripts/apply-migrations-staged.ts --confirm <file> [<file> ...] # apply
 *
 * Files are names inside migrations/, e.g. 0109_payment_accounts.sql. Already-applied files are skipped.
 */
import fs from "fs";
import path from "path";
import { Pool } from "pg";

async function main() {
  const args = process.argv.slice(2);
  const confirm = args.includes("--confirm");
  const files = args.filter((a) => !a.startsWith("--"));
  const url = process.env.TARGET_DATABASE_URL;
  if (!url) throw new Error("Set TARGET_DATABASE_URL.");
  if (files.length === 0) throw new Error("List the migration files to apply.");

  const dir = path.join(process.cwd(), "migrations");
  for (const f of files) {
    if (path.basename(f) !== f || !f.endsWith(".sql") || !fs.existsSync(path.join(dir, f))) {
      throw new Error(`Not a migration file in migrations/: ${f}`);
    }
  }

  const host = new URL(url).host;
  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 30000 });
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('migrations'))");
    const { rows } = await client.query("SELECT filename FROM _migrations");
    const applied = new Set(rows.map((r) => r.filename as string));
    const pending = files.filter((f) => !applied.has(f));

    console.log(`Target host: ${host}`);
    console.log(`Already applied (skipped): ${files.filter((f) => applied.has(f)).join(", ") || "none"}`);
    console.log(`To apply, in order: ${pending.join(", ") || "none"}`);
    if (!confirm) {
      console.log("\nDry run. Re-run with --confirm to apply.");
      return;
    }

    for (const f of pending) {
      const sqlText = fs.readFileSync(path.join(dir, f), "utf8");
      try {
        await client.query("BEGIN");
        await client.query(sqlText);
        await client.query("INSERT INTO _migrations (filename) VALUES ($1)", [f]);
        await client.query("COMMIT");
        console.log(`applied ${f}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`${f} failed and was rolled back: ${(err as Error).message}`);
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('migrations'))").catch(() => undefined);
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
