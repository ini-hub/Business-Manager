import { createHash } from "crypto";
import { objectStorage } from "./objectStorage";

// Org logos used to live inline in businesses.logo_url as base64 data URLs
// (~800KB for a typical upload), which then rode along on every read of the
// org row - notably GET /api/business, hit on every page load. Uploads now go
// to object storage and the column holds an `s3:<key>` reference; legacy
// data: URLs still work until scripts/migrate-logos-to-s3.ts converts them.
// API responses never carry either form - they carry LOGO_PATH plus a version.

export const LOGO_PATH = "/api/business/logo";
const S3_PREFIX = "s3:";
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const EXT_BY_TYPE: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

export const isDataUrl = (v: string | null | undefined): v is string => !!v && v.startsWith("data:");
export const isS3Ref = (v: string | null | undefined): v is string => !!v && v.startsWith(S3_PREFIX);
export const s3KeyOf = (ref: string): string => ref.slice(S3_PREFIX.length);

export function objectStorageConfigured(): boolean {
  return !!(process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY);
}

export function parseDataUrl(dataUrl: string): { contentType: string; buffer: Buffer } | null {
  const m = /^data:([\w/+.-]+);base64,([\s\S]*)$/.exec(dataUrl);
  if (!m) return null;
  return { contentType: m[1], buffer: Buffer.from(m[2], "base64") };
}

/** Replaces the stored logo (inline or S3 ref) with a short, cache-busting URL. */
export function withPublicLogo<T extends { logoUrl?: string | null }>(business: T): T {
  const stored = business.logoUrl;
  if (!isDataUrl(stored) && !isS3Ref(stored)) return business;
  const version = createHash("sha1").update(stored).digest("hex").slice(0, 10);
  return { ...business, logoUrl: `${LOGO_PATH}?v=${version}` };
}

/**
 * Turns an incoming logoUrl from a PATCH/POST into the value to persist.
 * - our own LOGO_PATH echoed back by the edit form -> undefined (leave unchanged)
 * - a data: URL -> uploaded to object storage, returned as `s3:<key>` (falls
 *   back to storing inline if storage isn't configured, e.g. a bare dev box)
 * - anything else (empty string clears it, external https URL) -> as given
 */
export async function persistableLogo(businessId: string, incoming: string | undefined): Promise<string | undefined> {
  if (incoming === undefined) return undefined;
  if (incoming.startsWith(LOGO_PATH)) return undefined;
  if (!isDataUrl(incoming)) return incoming;
  const parsed = parseDataUrl(incoming);
  if (!parsed || !EXT_BY_TYPE[parsed.contentType]) throw new LogoError("Logo must be a JPG, PNG, WebP or GIF image.");
  if (parsed.buffer.length > MAX_LOGO_BYTES) throw new LogoError("Business logo must be smaller than 2MB.");
  if (!objectStorageConfigured()) return incoming;
  return uploadLogo(businessId, parsed.buffer, parsed.contentType);
}

export async function uploadLogo(businessId: string, buffer: Buffer, contentType: string): Promise<string> {
  const hash = createHash("sha1").update(buffer).digest("hex").slice(0, 12);
  const key = `logos/${businessId}/${hash}.${EXT_BY_TYPE[contentType] ?? "bin"}`;
  await objectStorage.putObject(key, buffer, contentType);
  return S3_PREFIX + key;
}

export class LogoError extends Error {}
