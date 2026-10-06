/**
 * The one cookie-header parser. No cookie-parser middleware is installed, so
 * cookies are read straight off the raw header. Malformed percent-encoding must
 * never throw: this runs inside async middleware, where a throw is an unhandled
 * rejection that takes the process down.
 */
export function parseCookies(cookieHeader?: string): Record<string, string> {
  const list: Record<string, string> = {};
  if (!cookieHeader) return list;
  for (const cookie of cookieHeader.split(";")) {
    const parts = cookie.split("=");
    const key = parts.shift()!.trim();
    if (!key) continue;
    const raw = parts.join("=");
    try {
      list[key] = decodeURI(raw);
    } catch {
      list[key] = raw;
    }
  }
  return list;
}
