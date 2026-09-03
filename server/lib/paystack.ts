import crypto from "crypto";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { platformPaymentCredentials } from "@shared/schema";
import { decryptSecret } from "./credentialEncryption";

const PAYSTACK_BASE_URL = "https://api.paystack.co";

/**
 * DB-configured credentials (requirements plan §5) take priority so an admin
 * can rotate the platform's Paystack key from the new admin UI with no
 * redeploy; process.env.PAYSTACK_SECRET_KEY stays a fallback for deployments
 * that haven't configured a row yet, so nothing breaks until an admin opts
 * in. Not cached - key rotations must take effect immediately, and this is a
 * single indexed-PK lookup on the same request path that already hits the
 * DB for the checkout/webhook it's part of.
 */
async function getConfiguredSecretKey(): Promise<string | null> {
  const [row] = await db
    .select()
    .from(platformPaymentCredentials)
    .where(eq(platformPaymentCredentials.provider, "paystack"))
    .limit(1);
  if (row?.isActive && row.secretKeyEncrypted) {
    try {
      return decryptSecret(row.secretKeyEncrypted);
    } catch (error) {
      console.error("Failed to decrypt configured Paystack secret key, falling back to env:", error);
    }
  }
  return null;
}

async function getSecretKey(): Promise<string> {
  const configured = await getConfiguredSecretKey();
  const key = configured ?? process.env.PAYSTACK_SECRET_KEY;
  if (!key) {
    throw new Error("Paystack isn't configured - set it up in Super Admin > Platform Settings, or set PAYSTACK_SECRET_KEY.");
  }
  return key;
}

export async function isPaystackConfigured(): Promise<boolean> {
  const configured = await getConfiguredSecretKey();
  return !!(configured ?? process.env.PAYSTACK_SECRET_KEY);
}

async function paystackRequest<T = any>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${await getSecretKey()}`,
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
export async function verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): Promise<boolean> {
  if (!signature) return false;
  const hash = crypto.createHmac("sha512", await getSecretKey()).update(rawBody).digest("hex");
  return hash === signature;
}
