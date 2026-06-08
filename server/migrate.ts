import { pool } from "./db";
import path from "path";
import fs from "fs";

// Migrations that were applied manually before this runner was introduced.
// These are seeded into the tracking table on first run so they are never re-executed.
const LEGACY_APPLIED = [
  "0000_icy_captain_midlands.sql",
  "0001_dashing_gravity.sql",
  "0002_booking_module.sql",
  "0003_add_transactions_amount.sql",
  "0004_soft_delete_and_booking_reminders.sql",
  "0005_return_logs_fractional_quantity.sql",
  "custom_rename_profit.sql",
];

export async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Seed legacy entries so they are never re-executed
    for (const name of LEGACY_APPLIED) {
      await client.query(
        `INSERT INTO _migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING`,
        [name]
      );
    }

    const migrationsDir = path.join(process.cwd(), "migrations");
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const { rows } = await client.query("SELECT filename FROM _migrations");
    const applied = new Set(rows.map((r: { filename: string }) => r.filename));

    for (const file of files) {
      if (applied.has(file)) continue;

      console.log(`[Migration] Applying ${file}...`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO _migrations (filename) VALUES ($1)`,
          [file]
        );
        await client.query("COMMIT");
        console.log(`[Migration] Applied ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
  } finally {
    client.release();
  }
}
