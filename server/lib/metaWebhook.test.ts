import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { verifyMetaWebhookSignature } from "./metaWebhook";

const APP_SECRET = "test-app-secret";

function sign(body: Buffer, secret: string): string {
  return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
}

describe("verifyMetaWebhookSignature", () => {
  it("accepts a correctly signed payload", () => {
    const body = Buffer.from(JSON.stringify({ hello: "world" }));
    expect(verifyMetaWebhookSignature(body, sign(body, APP_SECRET), APP_SECRET)).toBe(true);
  });

  it("rejects a payload signed with a different secret", () => {
    const body = Buffer.from(JSON.stringify({ hello: "world" }));
    expect(verifyMetaWebhookSignature(body, sign(body, "wrong-secret"), APP_SECRET)).toBe(false);
  });

  it("rejects a tampered body even with a validly-formed signature", () => {
    const original = Buffer.from(JSON.stringify({ amount: 100 }));
    const signature = sign(original, APP_SECRET);
    const tampered = Buffer.from(JSON.stringify({ amount: 100000 }));
    expect(verifyMetaWebhookSignature(tampered, signature, APP_SECRET)).toBe(false);
  });

  it("rejects a missing signature header", () => {
    const body = Buffer.from("{}");
    expect(verifyMetaWebhookSignature(body, undefined, APP_SECRET)).toBe(false);
  });

  it("rejects a missing app secret", () => {
    const body = Buffer.from("{}");
    expect(verifyMetaWebhookSignature(body, sign(body, APP_SECRET), "")).toBe(false);
  });

  it("rejects a signature using the wrong scheme prefix", () => {
    const body = Buffer.from("{}");
    const wrongScheme = `sha1=${crypto.createHmac("sha1", APP_SECRET).update(body).digest("hex")}`;
    expect(verifyMetaWebhookSignature(body, wrongScheme, APP_SECRET)).toBe(false);
  });

  it("rejects a signature of the wrong length rather than throwing", () => {
    const body = Buffer.from("{}");
    expect(verifyMetaWebhookSignature(body, "sha256=abc123", APP_SECRET)).toBe(false);
  });
});
