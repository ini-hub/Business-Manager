// One-off: moves inline base64 org logos (businesses.logo_url = "data:...") to
// object storage and rewrites the column to an `s3:<key>` reference.
// Idempotent - rows already converted are skipped. Dry run unless --apply.
//   npx tsx scripts/migrate-logos-to-s3.ts [--apply]
import { like, eq } from "drizzle-orm";
import { db, pool } from "../server/db";
import { businesses } from "@shared/schema";
import { objectStorageConfigured, parseDataUrl, uploadLogo } from "../server/lib/businessLogo";

async function main() {
  const apply = process.argv.includes("--apply");
  if (apply && !objectStorageConfigured()) throw new Error("S3_* env vars must be set to --apply.");

  const rows = await db.select({ id: businesses.id, name: businesses.name, logoUrl: businesses.logoUrl })
    .from(businesses)
    .where(like(businesses.logoUrl, "data:%"));
  console.log(`${rows.length} inline logo(s) found${apply ? "" : " (dry run)"}`);

  for (const row of rows) {
    const parsed = parseDataUrl(row.logoUrl!);
    if (!parsed) { console.warn(`skip ${row.name}: not a base64 data URL`); continue; }
    console.log(`${row.name}: ${(parsed.buffer.length / 1024).toFixed(0)}KB ${parsed.contentType}`);
    if (!apply) continue;
    const ref = await uploadLogo(row.id, parsed.buffer, parsed.contentType);
    await db.update(businesses).set({ logoUrl: ref }).where(eq(businesses.id, row.id));
    console.log(`  -> ${ref}`);
  }
}

main().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
