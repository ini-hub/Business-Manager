import crypto from "crypto";

// Resend signs webhook deliveries the way Svix does (Resend uses Svix as its
// webhook provider) rather than the simple HMAC-of-body scheme
// server/lib/paystack.ts's verifyWebhookSignature uses, so it needs its own
// verifier instead of reusing that one.
//
// Signed content is "{svix-id}.{svix-timestamp}.{raw body}", HMAC-SHA256'd
// with the secret (base64, after stripping the "whsec_" prefix), base64
// encoded, and compared against the space-separated "v1,<sig>" entries in
// the svix-signature header - there can be more than one if the endpoint
// secret was ever rolled.
const TOLERANCE_SECONDS = 5 * 60;

export function verifyResendWebhookSignature(
  rawBody: Buffer,
  headers: { svixId?: string; svixTimestamp?: string; svixSignature?: string },
  secret: string,
): boolean {
  const { svixId, svixTimestamp, svixSignature } = headers;
  if (!svixId || !svixTimestamp || !svixSignature || !secret) return false;

  const timestamp = Number(svixTimestamp);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > TOLERANCE_SECONDS) {
    return false;
  }

  const secretBytes = Buffer.from(secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret, "base64");
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody.toString("utf8")}`;
  const expected = crypto.createHmac("sha256", secretBytes).update(signedContent).digest("base64");
  const expectedBuf = Buffer.from(expected);

  return svixSignature.split(" ").some((entry) => {
    const [version, signature] = entry.split(",");
    if (version !== "v1" || !signature) return false;
    const candidate = Buffer.from(signature);
    return candidate.length === expectedBuf.length && crypto.timingSafeEqual(candidate, expectedBuf);
  });
}
