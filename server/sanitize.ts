export function sanitizeString(input: string | undefined | null): string {
  if (!input) return "";
  return input
    .trim()
    .replace(/[<>"'`&]/g, "")
    .replace(/\s+/g, " ");
}

export function toTitleCase(input: string | undefined | null): string {
  if (!input) return "";
  return input
    .trim()
    .split(" ")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function escapeHtml(input: string | undefined | null): string {
  if (!input) return "";
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

export function sanitizeHtml(input: string | undefined | null): string {
  if (!input) return "";
  return input
    .trim()
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\//g, "&#x2F;");
}

export function sanitizeNumber(input: unknown): number {
  if (typeof input === "number" && !isNaN(input)) {
    return input;
  }
  if (typeof input === "string") {
    const parsed = parseFloat(input);
    if (!isNaN(parsed)) {
      return parsed;
    }
  }
  return 0;
}

export function sanitizeBoolean(input: unknown): boolean {
  if (typeof input === "boolean") return input;
  if (typeof input === "string") {
    return input.toLowerCase() === "true" || input === "1";
  }
  return false;
}

export function sanitizeUUID(input: string | undefined | null): string | null {
  if (!input) return null;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(input)) {
    return input.toLowerCase();
  }
  return null;
}

export function normalizePhoneNumber(input: string | undefined | null): string {
  if (!input) return "";
  // Remove all non-digits
  let digits = input.replace(/\D/g, "");
  // Strip leading country code 234 if present
  if (digits.startsWith("234") && digits.length > 10) {
    digits = digits.slice(3);
  }
  // Strip leading zero
  if (digits.startsWith("0")) {
    digits = digits.slice(1);
  }
  return digits;
}

export function sanitizePhoneNumber(input: string | undefined | null): string {
  if (!input) return "";
  const normalised = normalizePhoneNumber(input);
  // Reject strings that are too short (< 7) or too long (> 15) after normalisation
  if (normalised.length > 0 && (normalised.length < 7 || normalised.length > 15)) return "";
  return normalised;
}

const EMAIL_FORMAT_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function sanitizeEmail(input: string | undefined | null): string {
  if (!input) return "";
  return input.trim().toLowerCase();
}

/** Returns true if the email string passes basic format validation. */
export function validateEmailFormat(email: string | undefined | null): boolean {
  if (!email) return false;
  const trimmed = email.trim().toLowerCase();
  return trimmed.length > 0 && trimmed.length <= 254 && EMAIL_FORMAT_REGEX.test(trimmed);
}

export function sanitizeStoreCode(input: string | undefined | null): string {
  if (!input) return "";
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
}

export function validatePositiveNumber(value: number): boolean {
  return typeof value === "number" && !isNaN(value) && value >= 0;
}

export function validateNonEmptyString(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateMaxLength(value: string, maxLength: number): boolean {
  return typeof value === "string" && value.length <= maxLength;
}

export function sanitizeRequestBody<T extends object>(body: T, schema: Record<keyof T, "string" | "number" | "boolean" | "uuid">): Partial<T> {
  const sanitized: Partial<T> = {};
  
  for (const key of Object.keys(schema) as Array<keyof T>) {
    const type = schema[key];
    const value = body[key];
    
    switch (type) {
      case "string":
        sanitized[key] = sanitizeString(value as string) as T[keyof T];
        break;
      case "number":
        sanitized[key] = sanitizeNumber(value) as T[keyof T];
        break;
      case "boolean":
        sanitized[key] = sanitizeBoolean(value) as T[keyof T];
        break;
      case "uuid":
        const uuid = sanitizeUUID(value as string);
        if (uuid) sanitized[key] = uuid as T[keyof T];
        break;
    }
  }
  
  return sanitized;
}
