
// ── Email ────────────────────────────────────────────────────────────────────

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const EMAIL_MAX_LENGTH = 254;

export function validateEmail(email: string): { valid: boolean; error?: string } {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) return { valid: false, error: "Email address is required." };
  if (trimmed.length > EMAIL_MAX_LENGTH) return { valid: false, error: "Email address is too long." };
  if (!EMAIL_REGEX.test(trimmed)) return { valid: false, error: "Enter a valid email address (e.g. name@example.com)." };
  return { valid: true };
}

// ── Email-or-Phone (auth fields) ──────────────────────────────────────────────
// Lenient: accepts valid email OR a phone-like string (7–20 digits/symbols).
// Server does the real lookup; we only block obvious typos.

const EMAIL_OR_PHONE_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$|^\+?[\d\s\-(). ]{7,20}$/;

export function validateEmailOrPhone(val: string): boolean {
  return EMAIL_OR_PHONE_REGEX.test(val.trim());
}

// ── Country code → phone default ──────────────────────────────────────────────

const CURRENCY_TO_COUNTRY: Record<string, string> = {
  NGN: "NG",
  USD: "US",
  GBP: "GB",
  EUR: "DE",
  GHS: "GH",
  KES: "KE",
  ZAR: "ZA",
  CAD: "CA",
  AUD: "AU",
};

export function getDefaultCountryCode(currency?: string): string {
  return CURRENCY_TO_COUNTRY[currency ?? "NGN"] ?? "NG";
}

