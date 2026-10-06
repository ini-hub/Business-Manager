import crypto from "crypto";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** Flutterwave sends the shared secret you configured, verbatim, in `verif-hash`. */
export function isValidFlutterwaveSignature(header: string | undefined, secret: string): boolean {
  return !!header && !!secret && safeEqual(header, secret);
}

/**
 * Stripe's `Stripe-Signature: t=<unix>,v1=<hmac>` header: HMAC-SHA256 of `<t>.<raw body>`
 * keyed by the endpoint's signing secret. Events older than `toleranceSeconds` are rejected
 * so a captured request cannot be replayed later.
 */
export function isValidStripeSignature(
  rawBody: Buffer | undefined,
  header: string | undefined,
  secret: string,
  toleranceSeconds = 300,
  nowMs = Date.now(),
): boolean {
  if (!rawBody || !header || !secret) return false;
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = parts.find(([k]) => k === "t")?.[1];
  const signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  const ts = Number(t);
  if (!t || !Number.isFinite(ts) || signatures.length === 0) return false;
  if (Math.abs(nowMs / 1000 - ts) > toleranceSeconds) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.`).update(rawBody).digest("hex");
  return signatures.some((s) => safeEqual(s, expected));
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * Reads the store and (optional) checkout ids back out of a reference minted by
 * /api/payments/create-link: `tx-<storeId>[-checkout-<checkoutId>]-<ts>-<rand>`.
 * Both ids are UUIDs, so they contain hyphens and cannot be split on "-".
 */
export function parsePaymentReference(ref: string): { storeId?: string; checkoutId?: string } {
  const m = new RegExp(`^tx-(${UUID})(?:-checkout-(${UUID}))?-\\d+-[0-9a-f]+$`, "i").exec(ref);
  return { storeId: m?.[1], checkoutId: m?.[2] };
}
