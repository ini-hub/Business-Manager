/**
 * Builds a human-readable URL slug from a name and UUID.
 * Format: "{name-slug}-{first-8-chars-of-uuid}"
 * Example: buildSlug("Classic T-Shirt", "550e8400-e29b-...") → "classic-t-shirt-550e8400"
 */
export function buildSlug(name: string, id: string): string {
  const namePart = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, "")   // strip special chars
    .replace(/\s+/g, "-")            // spaces → dashes
    .replace(/-+/g, "-")             // collapse consecutive dashes
    .replace(/^-|-$/g, "")           // trim edge dashes
    .substring(0, 40);               // cap name segment length

  const idPart = id.substring(0, 8); // e.g. "550e8400" (first UUID segment)
  return namePart ? `${namePart}-${idPart}` : idPart;
}

/**
 * Returns true when a string looks like a raw UUID.
 */
export function isUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}
