import { z } from "zod";

// Strips control characters (newlines, carriage returns, other C0/DEL bytes)
// that .trim() leaves untouched when they're embedded mid-string - left in,
// they can flow into contexts like email Subject headers and corrupt or
// suppress delivery. See server/sanitize.ts's sanitizeHeaderValue for the
// email-side counterpart.
const stripControlChars = (s: string) => s.replace(/[\r\n\x00-\x1f\x7f]/g, "");

// Helper for trimmed non-empty strings
export const trimmedString = (minLength = 1, message = "This field is required") =>
  z.string().transform(s => stripControlChars(s.trim()).trim()).pipe(z.string().min(minLength, message));

// Helper for optional trimmed strings (empty becomes undefined)
export const optionalTrimmedString = () =>
  z.string().optional().transform(s => stripControlChars(s?.trim() || "").trim() || undefined);

// How a business is organised. Asked at signup / workspace creation and used to
// recommend a pricing bundle when the trial ends (migration 0133).
export const BUSINESS_STRUCTURES = ["solo", "with_staff", "multi_store"] as const;
export type BusinessStructure = (typeof BUSINESS_STRUCTURES)[number];
export const BUSINESS_STRUCTURE_LABELS: Record<BusinessStructure, { name: string; description: string }> = {
  solo: { name: "Solo owner", description: "Just me, one location" },
  with_staff: { name: "With staff", description: "Me and employees, one location" },
  multi_store: { name: "Multi-store", description: "More than one location" },
};
