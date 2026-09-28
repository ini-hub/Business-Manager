/**
 * Interim CLI for registering a store's WhatsApp number (shared/schema/
 * whatsapp.ts's whatsappNumbers table) until a Super Admin / store-settings
 * UI form exists for it. Upserts by storeId (one active number per store).
 *
 * Usage:
 *   npx tsx scripts/register-whatsapp-number.ts <storeId> <phoneNumberId> <wabaId> [accessToken] [displayPhoneNumber]
 *
 * accessToken is optional so this can be used purely to unblock local
 * webhook-simulation testing (inbound routing works without it - only
 * actual outbound sends via WhatsAppService need a real token).
 */
import { db } from "../server/db";
import { whatsappNumbers, stores } from "../shared/schema";
import { eq } from "drizzle-orm";
import { encryptSecret } from "../server/lib/credentialEncryption";

async function main() {
  const [storeId, phoneNumberId, wabaId, accessToken, displayPhoneNumber] = process.argv.slice(2);
  if (!storeId || !phoneNumberId || !wabaId) {
    console.error("Usage: register-whatsapp-number.ts <storeId> <phoneNumberId> <wabaId> [accessToken] [displayPhoneNumber]");
    process.exit(1);
  }

  const [store] = await db.select().from(stores).where(eq(stores.id, storeId));
  if (!store) {
    console.error(`No store found with id ${storeId}.`);
    process.exit(1);
  }

  const [existingByStore] = await db.select().from(whatsappNumbers).where(eq(whatsappNumbers.storeId, storeId));
  const [existingByPhoneNumberId] = await db.select().from(whatsappNumbers).where(eq(whatsappNumbers.phoneNumberId, phoneNumberId));
  if (existingByPhoneNumberId && existingByPhoneNumberId.storeId !== storeId) {
    console.error(`phone_number_id ${phoneNumberId} is already registered to a different store (${existingByPhoneNumberId.storeId}).`);
    process.exit(1);
  }

  const values = {
    storeId,
    phoneNumberId,
    wabaId,
    displayPhoneNumber: displayPhoneNumber ?? null,
    accessTokenEncrypted: accessToken ? encryptSecret(accessToken) : null,
    status: "active" as const,
    updatedAt: new Date(),
  };

  if (existingByStore) {
    await db.update(whatsappNumbers).set(values).where(eq(whatsappNumbers.id, existingByStore.id));
    console.log(`Updated WhatsApp number for store "${store.name}" (${storeId}).`);
  } else {
    await db.insert(whatsappNumbers).values(values);
    console.log(`Registered WhatsApp number for store "${store.name}" (${storeId}).`);
  }

  if (!accessToken) {
    console.warn("No access token provided - inbound webhook routing will work, but outbound sends will fail until one is set.");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
