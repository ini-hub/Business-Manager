import { z } from "zod";

// Helper for trimmed non-empty strings
export const trimmedString = (minLength = 1, message = "This field is required") =>
  z.string().transform(s => s.trim()).pipe(z.string().min(minLength, message));

// Helper for optional trimmed strings (empty becomes undefined)
export const optionalTrimmedString = () =>
  z.string().optional().transform(s => s?.trim() || undefined);
