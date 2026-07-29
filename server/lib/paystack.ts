import crypto from "crypto";

const PAYSTACK_BASE_URL = "https://api.paystack.co";

function getSecretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) {
    throw new Error("PAYSTACK_SECRET_KEY is not set.");
  }
  return key;
}

export function isPaystackConfigured(): boolean {
  return !!process.env.PAYSTACK_SECRET_KEY;
}

async function paystackRequest<T = any>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getSecretKey()}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const body = await response.json();
  if (!response.ok || body.status === false) {
    throw new Error(body.message || `Paystack request to ${path} failed.`);
  }
  return body;
}

export async function initializeTransaction(args: {
  email: string;
  amountKobo: number;
  reference: string;
  callbackUrl: string;
  currency: string;
  metadata?: Record<string, unknown>;
}): Promise<{ authorizationUrl: string; accessCode: string; raw: any }> {
  const result = await paystackRequest("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify({
      email: args.email,
      amount: args.amountKobo,
      reference: args.reference,
      callback_url: args.callbackUrl,
      currency: args.currency,
      metadata: args.metadata,
    }),
  });
  return {
    authorizationUrl: result.data.authorization_url,
    accessCode: result.data.access_code,
    raw: result.data,
  };
}

export async function verifyTransaction(reference: string): Promise<{
  success: boolean;
  raw: any;
}> {
  const result = await paystackRequest(`/transaction/verify/${encodeURIComponent(reference)}`, {
    method: "GET",
  });
  return { success: result.data?.status === "success", raw: result.data };
}

export async function chargeAuthorization(args: {
  email: string;
  amountKobo: number;
  reference: string;
  authorizationCode: string;
  currency: string;
}): Promise<{ success: boolean; raw: any }> {
  const result = await paystackRequest("/transaction/charge_authorization", {
    method: "POST",
    body: JSON.stringify({
      email: args.email,
      amount: args.amountKobo,
      reference: args.reference,
      authorization_code: args.authorizationCode,
      currency: args.currency,
    }),
  });
  return { success: result.data?.status === "success", raw: result.data };
}

/**
 * Verifies Paystack's `x-paystack-signature` header, which is an HMAC-SHA512
 * of the exact raw request bytes keyed by the secret key. Must be computed
 * over the raw body (req.rawBody, captured by the global express.json
 * `verify` hook in server/index.ts) - hashing JSON.stringify(req.body)
 * instead can silently mismatch on key ordering/whitespace.
 */
export function verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
  if (!signature) return false;
  const hash = crypto.createHmac("sha512", getSecretKey()).update(rawBody).digest("hex");
  return hash === signature;
}
