/**
 * One-off backfill: encrypts plaintext store_integrations.secret_key /
 * webhook_secret in place. Idempotent (already "enc:v1:" values are skipped).
 * Requires PLATFORM_CREDENTIALS_ENCRYPTION_KEY and DATABASE_URL.
 * Usage: npx tsx scripts/encrypt-store-integrations.ts
 */
import { eq } from "drizzle-orm";
import { db } from "../server/db";
import { storeIntegrations } from "../shared/schema";
import { encryptIfNeeded, isEncryptedValue } from "../server/lib/credentialEncryption";

async function main() {
  const rows = await db.select().from(storeIntegrations);
  let changed = 0;
  for (const r of rows) {
    if (isEncryptedValue(r.secretKey) || !r.secretKey) {
      if (isEncryptedValue(r.webhookSecret) || !r.webhookSecret) continue;
    }
    await db.update(storeIntegrations).set({
      secretKey: encryptIfNeeded(r.secretKey) as string | null,
      webhookSecret: encryptIfNeeded(r.webhookSecret) as string | null,
    }).where(eq(storeIntegrations.id, r.id));
    changed++;
  }
  console.log(`Encrypted ${changed} of ${rows.length} store integration rows.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
