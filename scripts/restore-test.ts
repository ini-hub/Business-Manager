/**
 * Restore drill: downloads a backup (default: key given as argv[2]) and runs
 * pg_restore --list on it to prove the dump is readable, then (optionally)
 * restores it into a scratch database.
 *
 *   npx tsx scripts/restore-test.ts db-backups/<stamp>.dump
 *   RESTORE_TARGET_URL=postgres://.../scratch npx tsx scripts/restore-test.ts <key>
 *
 * NEVER point RESTORE_TARGET_URL at production: pg_restore --clean drops objects.
 */
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { objectStorage } from "../server/lib/objectStorage";

async function main() {
  const key = process.argv[2];
  if (!key) throw new Error("Usage: restore-test.ts <db-backups/....dump>");
  const res = await fetch(await objectStorage.getSignedGetUrl(key, 120));
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const file = path.join(os.tmpdir(), `restore-${Date.now()}.dump`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  try {
    const toc = execFileSync("pg_restore", ["--list", file]).toString();
    console.log(`Dump readable: ${toc.split("\n").length} TOC lines.`);
    const target = process.env.RESTORE_TARGET_URL;
    if (target) {
      if (target === process.env.DATABASE_URL) throw new Error("Refusing to restore over DATABASE_URL.");
      execFileSync("pg_restore", ["--clean", "--if-exists", "--no-owner", "--dbname", target, file], { stdio: "inherit" });
      console.log("Restored into scratch database. Spot-check row counts before trusting it.");
    }
  } finally {
    fs.rmSync(file, { force: true });
  }
  process.exit(0);
}
main().catch((e) => { console.error("RESTORE TEST FAILED:", e); process.exit(1); });
