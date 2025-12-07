export function sanitizeString(input: string | undefined | null): string {
  if (!input) return "";
  return input
    .trim()
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ");
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

export function sanitizePhoneNumber(input: string | undefined | null): string {
  if (!input) return "";
  return input.replace(/[^\d+\-\s()]/g, "").trim();
}

export function sanitizeEmail(input: string | undefined | null): string {
  if (!input) return "";
  return input.trim().toLowerCase();
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
