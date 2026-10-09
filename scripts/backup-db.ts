/**
 * Daily logical backup: pg_dump (custom format) -> S3 bucket under db-backups/.
 * Needs pg_dump on PATH, DATABASE_URL and the S3_* variables. Schedule it daily
 * (cron / hosting scheduler): `npx tsx scripts/backup-db.ts`.
 * Prune old dumps with a bucket lifecycle rule on the db-backups/ prefix.
 * Neon's own point-in-time restore is the first line of defence; this is the
 * independent copy that survives losing the Neon project.
 */
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { objectStorage } from "../server/lib/objectStorage";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set.");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(os.tmpdir(), `backup-${stamp}.dump`);
  try {
    execFileSync("pg_dump", ["--format=custom", "--no-owner", "--file", file, url], { stdio: "inherit" });
    const buf = fs.readFileSync(file);
    const key = `db-backups/${stamp}.dump`;
    await objectStorage.putObject(key, buf, "application/octet-stream");
    console.log(`Backup uploaded: ${key} (${(buf.length / 1048576).toFixed(1)} MB)`);
  } finally {
    fs.rmSync(file, { force: true });
  }
  process.exit(0);
}
main().catch((e) => { console.error("BACKUP FAILED:", e); process.exit(1); });
