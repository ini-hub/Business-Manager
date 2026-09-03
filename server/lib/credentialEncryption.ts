import crypto from "crypto";

/**
 * AES-256-GCM at-rest encryption for the platform's own payment gateway
 * credentials (shared/schema/platform.ts's platformPaymentCredentials) - held
 * to a higher bar than the plaintext-plus-masking convention
 * storeIntegrations uses for tenant credentials, since these are platform-
 * wide, money-moving secrets (requirements plan §5).
 *
 * Fails fast at first use if the key-encrypting-key isn't set, same posture
 * as JWT_SECRET in server/auth.ts - this is the one secret still allowed to
 * live in env, since it never rotates and nothing can decrypt without it.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM standard nonce size

function getEncryptionKey(): Buffer {
  const key = process.env.PLATFORM_CREDENTIALS_ENCRYPTION_KEY;
  if (!key) {
    throw new Error(
      "PLATFORM_CREDENTIALS_ENCRYPTION_KEY environment variable must be set to store platform payment credentials."
    );
  }
  // Accept either a 64-char hex string or a 44-char base64 string - either
  // way it must decode to exactly 32 bytes for AES-256.
  const buf = /^[0-9a-fA-F]{64}$/.test(key) ? Buffer.from(key, "hex") : Buffer.from(key, "base64");
  if (buf.length !== 32) {
    throw new Error(
      "PLATFORM_CREDENTIALS_ENCRYPTION_KEY must decode to exactly 32 bytes (a 64-char hex string or 32-byte base64 string)."
    );
  }
  return buf;
}

/** Returns iv + authTag + ciphertext, base64-packed into one string for one DB column. */
export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

export function decryptSecret(packed: string): string {
  const key = getEncryptionKey();
  const buf = Buffer.from(packed, "base64");
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + 16);
  const encrypted = buf.subarray(IV_LENGTH + 16);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

/** True only if the key-encrypting-key is actually set - lets callers degrade to the env-var fallback instead of throwing. */
export function isCredentialEncryptionConfigured(): boolean {
  try {
    getEncryptionKey();
    return true;
  } catch {
    return false;
  }
}
