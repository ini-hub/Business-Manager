import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";

// ── Platform-wide operator config ───────────────────────────────────────────
// Simple key/value table for platform-operator-level settings that aren't
// scoped to any business (unlike shared/schema/stores.ts's per-store
// `settings`). First and only consumer today: 'trial_days' (falls back to
// server/lib/trial.ts's TRIAL_DAYS constant when no row exists yet).
export const platformConfig = pgTable("platform_config", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  updatedBy: text("updated_by"), // email of the admin who last changed it
});

export type PlatformConfig = typeof platformConfig.$inferSelect;
export type InsertPlatformConfig = typeof platformConfig.$inferInsert;

// ── Platform payment gateway credentials ────────────────────────────────────
// The credentials THIS platform uses to charge businesses for their
// subscription (distinct from shared/schema/pos-extras.ts's storeIntegrations,
// which are a tenant's own credentials for collecting money from ITS
// customers - see the separation note in server/routes/billing.routes.ts).
// Secrets are encrypted at rest via server/lib/credentialEncryption.ts
// (AES-256-GCM), never stored in plaintext - these are platform-wide,
// money-moving credentials, held to a higher bar than the tenant-integration
// precedent. process.env.PAYSTACK_SECRET_KEY stays a fallback for
// deployments that haven't configured a row here yet (server/lib/paystack.ts).
export const platformPaymentCredentials = pgTable("platform_payment_credentials", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  provider: text("provider").notNull().unique(), // 'paystack' | 'stripe' | 'flutterwave'
  isActive: boolean("is_active").notNull().default(false),
  publicKey: text("public_key"), // not secret, kept in plaintext
  secretKeyEncrypted: text("secret_key_encrypted"), // AES-256-GCM ciphertext, base64 (iv+tag+data packed)
  webhookSecretEncrypted: text("webhook_secret_encrypted"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  updatedBy: text("updated_by"),
});

export type PlatformPaymentCredential = typeof platformPaymentCredentials.$inferSelect;
export type InsertPlatformPaymentCredential = typeof platformPaymentCredentials.$inferInsert;
