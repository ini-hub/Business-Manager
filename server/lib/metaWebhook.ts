import crypto from "crypto";

// Meta signs WhatsApp Cloud API webhook deliveries with a single HMAC-SHA256
// of the raw body (app secret as key), sent as "sha256=<hex>" in
// X-Hub-Signature-256 - simpler than Resend/Svix's multi-signature scheme in
// server/lib/resendWebhook.ts, just one comparison.
export function verifyMetaWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader || !appSecret) return false;
  const [scheme, signature] = signatureHeader.split("=");
  if (scheme !== "sha256" || !signature) return false;

  const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expected);
  const candidateBuf = Buffer.from(signature);

  return candidateBuf.length === expectedBuf.length && crypto.timingSafeEqual(candidateBuf, expectedBuf);
}
