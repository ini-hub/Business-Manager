import { z } from "zod";

// ── Email ────────────────────────────────────────────────────────────────────

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const EMAIL_MAX_LENGTH = 254;

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

export const EMAIL_OR_PHONE_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$|^\+?[\d\s\-(). ]{7,20}$/;

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

// ── Reusable Zod chains ───────────────────────────────────────────────────────

/** Required email field */
export const zodRequiredEmail = z
  .string()
  .trim()
  .min(1, "Email address is required.")
  .email("Enter a valid email address (e.g. name@example.com).")
  .max(EMAIL_MAX_LENGTH, "Email address is too long.")
  .transform((v) => v.toLowerCase());

/** Optional email — empty string or valid email */
export const zodOptionalEmail = z
  .string()
  .trim()
  .transform((v) => v.toLowerCase())
  .refine(
    (v) => v === "" || EMAIL_REGEX.test(v),
    "Enter a valid email address (e.g. name@example.com)."
  )
  .optional()
  .or(z.literal(""));

/** Required phone — min 7 chars after trimming */
export const zodRequiredPhone = z
  .string()
  .trim()
  .min(7, "Enter a valid phone number.");

/** Optional phone — empty or at least 7 chars */
export const zodOptionalPhone = z
  .string()
  .trim()
  .refine((v) => v === "" || v.replace(/\D/g, "").length >= 7, "Enter a valid phone number.")
  .optional()
  .or(z.literal(""));

/** emailOrPhone field used in auth forms */
export const zodEmailOrPhone = z
  .string()
  .min(1, "Enter your email or phone number.")
  .refine(validateEmailOrPhone, "Enter a valid email address or phone number.");
