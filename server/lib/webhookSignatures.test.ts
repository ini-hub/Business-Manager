import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { isValidFlutterwaveSignature, isValidStripeSignature, parsePaymentReference } from "./webhookSignatures";
import { isValidPaystackSignature } from "./paystack";

const body = Buffer.from('{"type":"checkout.session.completed"}');
const stripeHeader = (secret: string, t: number, b = body) =>
  `t=${t},v1=${crypto.createHmac("sha256", secret).update(`${t}.`).update(b).digest("hex")}`;

describe("isValidStripeSignature", () => {
  const now = 1_700_000_000_000;
  it("accepts a correctly signed, fresh event", () => {
    expect(isValidStripeSignature(body, stripeHeader("whsec_x", now / 1000), "whsec_x", 300, now)).toBe(true);
  });
  it("rejects a wrong secret, a tampered body, a stale timestamp and missing inputs", () => {
    expect(isValidStripeSignature(body, stripeHeader("other", now / 1000), "whsec_x", 300, now)).toBe(false);
    expect(isValidStripeSignature(Buffer.from("{}"), stripeHeader("whsec_x", now / 1000), "whsec_x", 300, now)).toBe(false);
    expect(isValidStripeSignature(body, stripeHeader("whsec_x", now / 1000 - 3600), "whsec_x", 300, now)).toBe(false);
    expect(isValidStripeSignature(body, undefined, "whsec_x", 300, now)).toBe(false);
    expect(isValidStripeSignature(body, stripeHeader("whsec_x", now / 1000), "", 300, now)).toBe(false);
  });
});

describe("isValidFlutterwaveSignature", () => {
  it("needs a configured secret and an exact match", () => {
    expect(isValidFlutterwaveSignature("s3cret", "s3cret")).toBe(true);
    expect(isValidFlutterwaveSignature("s3cret", "")).toBe(false);
    expect(isValidFlutterwaveSignature(undefined, "s3cret")).toBe(false);
    expect(isValidFlutterwaveSignature("nope!!", "s3cret")).toBe(false);
  });
});

describe("isValidPaystackSignature", () => {
  it("verifies over the raw body and rejects an empty secret", () => {
    const sig = crypto.createHmac("sha512", "sk").update(body).digest("hex");
    expect(isValidPaystackSignature(body, sig, "sk")).toBe(true);
    expect(isValidPaystackSignature(body, sig, "")).toBe(false);
    expect(isValidPaystackSignature(body, "bad", "sk")).toBe(false);
  });
});

describe("parsePaymentReference", () => {
  const s = "0b1c2d3e-1111-2222-3333-444455556666";
  const c = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  it("reads store and checkout ids back out", () => {
    expect(parsePaymentReference(`tx-${s}-checkout-${c}-1700000000000-deadbeef`)).toEqual({ storeId: s, checkoutId: c });
    expect(parsePaymentReference(`tx-${s}-1700000000000-deadbeef`)).toEqual({ storeId: s, checkoutId: undefined });
  });
  it("returns nothing for anything else", () => {
    expect(parsePaymentReference("tx-abc-1-2")).toEqual({});
    expect(parsePaymentReference("")).toEqual({});
  });
});
