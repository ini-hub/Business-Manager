import { describe, it, expect } from "vitest";
import { buildCspDirectives, bucketOrigins } from "./csp";

describe("buildCspDirectives", () => {
  it("allows map tiles, the bucket and nothing else third-party by default", () => {
    const d = buildCspDirectives({ S3_ENDPOINT: "https://acct.r2.cloudflarestorage.com", S3_BUCKET: "b" } as any);
    expect(d.imgSrc).toContain("https://tile.openstreetmap.org");
    expect(d.imgSrc).toContain("https://acct.r2.cloudflarestorage.com");
    expect(d.connectSrc).toContain("https://*.acct.r2.cloudflarestorage.com");
    expect(d.scriptSrc.join(" ")).not.toContain("googleapis");
    expect(d.frameSrc).toEqual(["'none'"]);
  });
  it("allows the Sentry ingest origin only when a client DSN is set", () => {
    expect(buildCspDirectives({} as any).connectSrc.join(" ")).not.toContain("sentry");
    expect(buildCspDirectives({ VITE_SENTRY_DSN: "https://k@o1.ingest.sentry.io/2" } as any).connectSrc).toContain("https://o1.ingest.sentry.io");
  });
  it("does not allow inline scripts", () => {
    expect(buildCspDirectives({} as any).scriptSrc).not.toContain("'unsafe-inline'");
  });
  it("adds Google Maps hosts only when a key is configured", () => {
    const d = buildCspDirectives({ VITE_GOOGLE_MAPS_API_KEY: "k" } as any);
    expect(d.scriptSrc).toContain("https://maps.googleapis.com");
    expect(d.connectSrc).toContain("https://maps.googleapis.com");
  });
  it("derives AWS S3 origins when no endpoint is set", () => {
    expect(bucketOrigins({ S3_BUCKET: "bk", S3_REGION: "eu-west-1" } as any)).toContain("https://bk.s3.eu-west-1.amazonaws.com");
  });
  it("ignores a malformed endpoint", () => {
    expect(bucketOrigins({ S3_ENDPOINT: "not a url" } as any)).toEqual([]);
  });
});
