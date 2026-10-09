/**
 * Content-Security-Policy for production. Everything is same-origin except what the
 * app really loads: Google Fonts, OpenStreetMap tiles (branch geofence map), Google
 * Maps when VITE_GOOGLE_MAPS_API_KEY is set, and the S3-compatible bucket that
 * browsers PUT contract files to and read presigned URLs from.
 */
export function bucketOrigins(env: NodeJS.ProcessEnv): string[] {
  const out = new Set<string>();
  const endpoint = env.S3_ENDPOINT;
  if (endpoint) {
    try {
      const u = new URL(endpoint);
      out.add(u.origin);
      out.add(`https://*.${u.host}`); // virtual-hosted style: <bucket>.<endpoint host>
    } catch {
      /* malformed endpoint: the upload would fail anyway; leave the policy tight */
    }
  } else if (env.S3_BUCKET) {
    const region = env.S3_REGION && env.S3_REGION !== "auto" ? env.S3_REGION : "us-east-1";
    out.add(`https://${env.S3_BUCKET}.s3.${region}.amazonaws.com`);
    out.add(`https://s3.${region}.amazonaws.com`);
  }
  return Array.from(out);
}

/** Origin of the Sentry ingest endpoint (browser errors are POSTed there), derived from the client DSN. */
export function sentryOrigins(env: NodeJS.ProcessEnv): string[] {
  const dsn = env.VITE_SENTRY_DSN;
  if (!dsn) return [];
  try {
    return [new URL(dsn).origin];
  } catch {
    return [];
  }
}

export function buildCspDirectives(env: NodeJS.ProcessEnv = process.env): Record<string, string[]> {
  const bucket = bucketOrigins(env);
  const maps = env.VITE_GOOGLE_MAPS_API_KEY ? ["https://maps.googleapis.com", "https://*.gstatic.com", "https://*.googleapis.com"] : [];
  return {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", ...(maps.length ? ["https://maps.googleapis.com", "https://maps.gstatic.com"] : [])], // no 'unsafe-inline': the built page has no inline script (JSON-LD is a data block, not executed)
    styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    fontSrc: ["'self'", "https://fonts.gstatic.com"],
    imgSrc: ["'self'", "data:", "blob:", "https://tile.openstreetmap.org", "https://*.tile.openstreetmap.org", ...maps, ...bucket],
    connectSrc: ["'self'", ...maps.slice(0, 1), ...bucket, ...sentryOrigins(env)],
    workerSrc: ["'self'", "blob:"],
    frameSrc: ["'none'"],
    objectSrc: ["'none'"],
    upgradeInsecureRequests: [],
  };
}
