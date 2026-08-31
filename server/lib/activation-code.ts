import crypto from "crypto";

// Ambiguity is tolerated here (0/O, 1/I) because the code is normalised
// case-insensitively on the way back in and people mostly copy-paste it.
// Changing the alphabet would invalidate codes already sitting in inboxes.
const CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const CODE_HALF_LENGTH = 4;

export const ACTIVATION_CODE_TTL_MS = 48 * 60 * 60 * 1000;

/** "AB3D-9XK2". crypto.randomInt only - never Math.random for a credential. */
export function generateActivationCode(): string {
  const half = () => {
    let out = "";
    for (let i = 0; i < CODE_HALF_LENGTH; i++) {
      out += CODE_ALPHABET.charAt(crypto.randomInt(0, CODE_ALPHABET.length));
    }
    return out;
  };
  return `${half()}-${half()}`;
}

export function activationCodeExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + ACTIVATION_CODE_TTL_MS);
}

/**
 * Canonical form for comparison: strip the hyphen and anything else a person
 * may have typed or a mail client may have inserted, then upper-case. Both the
 * stored code and the submitted one go through this before comparison, so
 * "ab3d 9xk2" and "AB3D-9XK2" match.
 */
export function normalizeActivationCode(raw: string): string {
  return raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}
