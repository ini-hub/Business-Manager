import { db } from "../db";
import { eq } from "drizzle-orm";
import { platformConfig } from "@shared/schema";
import { TRIAL_DAYS, GRACE_DAYS } from "./trial";
import { encryptSecret, decryptSecret } from "./credentialEncryption";

/**
 * Platform-operator-level settings (shared/schema/platform.ts's platformConfig
 * key/value table) - not scoped to any business. Small and generic on
 * purpose: today's only consumer is trial length, but new admin-configurable
 * platform settings can reuse get/setPlatformConfigValue without a schema
 * change.
 */

export async function getPlatformConfigValue<T>(key: string): Promise<T | undefined> {
  const [row] = await db.select().from(platformConfig).where(eq(platformConfig.key, key)).limit(1);
  return row ? (row.value as T) : undefined;
}

export async function setPlatformConfigValue(key: string, value: unknown, updatedBy?: string): Promise<void> {
  await db
    .insert(platformConfig)
    .values({ key, value: value as any, updatedBy })
    .onConflictDoUpdate({
      target: platformConfig.key,
      set: { value: value as any, updatedBy, updatedAt: new Date() },
    });
}

/**
 * The trial length new signups get, admin-configurable from Platform
 * Settings (requirements plan §2). Falls back to the TRIAL_DAYS constant if
 * no admin has ever set one - so nothing changes for existing deployments
 * until an admin actively opts in. Per the confirmed decision, changing this
 * only affects orgs signing up afterward - trialEndsAt is fixed once at
 * signup and never recalculated for an org already mid-trial.
 */
export async function getConfiguredTrialDays(): Promise<number> {
  const value = await getPlatformConfigValue<number>("trial_days");
  const days = typeof value === "number" && value > 0 ? value : TRIAL_DAYS;
  return days;
}

/** Days of full access after a trial/failed renewal before the soft lock (default 7). */
export async function getConfiguredGraceDays(): Promise<number> {
  const value = await getPlatformConfigValue<number>("grace_days");
  return typeof value === "number" && value >= 0 ? value : GRACE_DAYS;
}

export async function getSmsConfig(): Promise<{ smsEnabled: boolean; whatsappEnabled: boolean }> {
  const smsEnabled = await getPlatformConfigValue<boolean>("sms_enabled");
  const whatsappEnabled = await getPlatformConfigValue<boolean>("whatsapp_enabled");
  return {
    smsEnabled: smsEnabled === true,
    whatsappEnabled: whatsappEnabled === true,
  };
}

/**
 * The one Meta Tech Provider app this whole platform uses to talk to the
 * WhatsApp Cloud API on behalf of every connected business (see
 * server/lib/metaWebhook.ts, server/routes/whatsapp-webhooks.routes.ts).
 * Distinct from a per-store whatsappNumbers row (shared/schema/whatsapp.ts):
 * this is the platform operator's own app secret / webhook verify token,
 * not any one business's WhatsApp number credentials. Rotatable from Super
 * Admin > Platform Settings with no redeploy, same DB-first/env-fallback
 * posture as getConfiguredSecretKey in server/lib/paystack.ts. appSecret is
 * encrypted at rest (it's an HMAC key); verifyToken is a low-sensitivity
 * handshake value, kept as plaintext like a public key.
 */
/**
 * Masked view for the admin GET endpoint - never returns the decrypted
 * secret, only whether each value is configured, mirroring
 * platformPaymentCredentials' secretKeySet/webhookSecretSet fields.
 */
export async function getWhatsAppPlatformConfigStatus(): Promise<{ isActive: boolean; appSecretSet: boolean; verifyTokenSet: boolean }> {
  const isActive = (await getPlatformConfigValue<boolean>("whatsapp_platform_active")) === true;
  const appSecretEncrypted = await getPlatformConfigValue<string>("whatsapp_app_secret_encrypted");
  const verifyToken = await getPlatformConfigValue<string>("whatsapp_verify_token");
  return { isActive, appSecretSet: !!appSecretEncrypted, verifyTokenSet: !!verifyToken };
}

/**
 * Resolves the app secret / verify token actually in effect: DB-configured
 * (Super Admin, only when active) takes priority, env vars stay a fallback
 * so nothing breaks for deployments that haven't configured a row yet.
 */
export async function getEffectiveWhatsAppPlatformCredentials(): Promise<{ appSecret: string; verifyToken: string } | null> {
  const isActive = (await getPlatformConfigValue<boolean>("whatsapp_platform_active")) === true;

  let appSecret: string | undefined;
  let verifyToken: string | undefined;
  if (isActive) {
    const appSecretEncrypted = await getPlatformConfigValue<string>("whatsapp_app_secret_encrypted");
    verifyToken = await getPlatformConfigValue<string>("whatsapp_verify_token");
    if (appSecretEncrypted) {
      try {
        appSecret = decryptSecret(appSecretEncrypted);
      } catch (error) {
        console.error("Failed to decrypt configured WhatsApp app secret, falling back to env:", error);
      }
    }
  }

  appSecret = appSecret ?? process.env.WHATSAPP_APP_SECRET;
  verifyToken = verifyToken ?? process.env.WHATSAPP_VERIFY_TOKEN;
  if (!appSecret || !verifyToken) return null;
  return { appSecret, verifyToken };
}

export async function setWhatsAppPlatformConfig(
  values: { isActive: boolean; appSecret?: string; verifyToken?: string },
  updatedBy?: string,
): Promise<void> {
  await setPlatformConfigValue("whatsapp_platform_active", values.isActive, updatedBy);
  if (typeof values.appSecret === "string") {
    await setPlatformConfigValue("whatsapp_app_secret_encrypted", values.appSecret ? encryptSecret(values.appSecret) : null, updatedBy);
  }
  if (typeof values.verifyToken === "string") {
    await setPlatformConfigValue("whatsapp_verify_token", values.verifyToken || null, updatedBy);
  }
}

