/**
 * Resolves the public base URL of this app, used for links embedded in
 * outgoing emails (activation, login, contract, billing, etc.).
 *
 * Order of precedence:
 *   1. APP_URL          - explicit override (set this in the Render dashboard
 *                          when a custom domain is mapped; RENDER_EXTERNAL_URL
 *                          below only ever points at the *.onrender.com host)
 *   2. RENDER_EXTERNAL_URL - auto-injected by Render for every service, so if
 *                          APP_URL is ever left unset in production, links
 *                          still resolve to a real live URL instead of localhost
 *   3. REPLIT_DEV_DOMAIN   - same idea for a Replit deployment
 *   4. http://localhost:<PORT> - dev-only fallback, no env vars set at all
 *
 * Never hardcode a localhost fallback anywhere else - call getAppUrl() instead,
 * so every link updates automatically if the live domain ever changes.
 */
export function getAppUrl(): string {
  const explicit = process.env.APP_URL?.trim();
  if (explicit) return stripTrailingSlash(explicit);

  const renderUrl = process.env.RENDER_EXTERNAL_URL?.trim();
  if (renderUrl) return stripTrailingSlash(renderUrl);

  const replitDomain = process.env.REPLIT_DEV_DOMAIN?.trim();
  if (replitDomain) return `https://${replitDomain}`;

  const port = process.env.PORT || "5000";
  return `http://localhost:${port}`;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}
