import { z } from "zod";

/**
 * Client-side auth rules shared by login, sign-up, forgot and reset password,
 * so the form, the checklist and the server (passwordSchema in
 * shared/schema/auth.ts) never disagree about what is acceptable.
 */

/** Emails are matched case-insensitively and without stray spaces. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export const newPasswordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .refine((v) => /[A-Z]/.test(v), "Must include at least one uppercase letter")
  .refine((v) => /[a-z]/.test(v), "Must include at least one lowercase letter")
  .refine((v) => /[0-9]/.test(v), "Must include at least one number")
  .refine((v) => /[^A-Za-z0-9]/.test(v), "Must include at least one special character")
  .refine((v) => !/\s/.test(v), "Password cannot contain spaces");
