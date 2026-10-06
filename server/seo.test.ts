import { describe, it, expect } from "vitest";
import { SEO_MARKER, renderDocument, siteConfigFromEnv, canonicalRedirects } from "./seo";

const template = `<html><head>${SEO_MARKER}</head><body></body></html>`;
const site = { siteUrl: "https://kowope.com" };

describe("renderDocument", () => {
  it("puts the route's tags in the returned HTML (no JavaScript needed)", () => {
    const doc = renderDocument(template, "/auth/signup", site);
    expect(doc.status).toBe(200);
    expect(doc.html).toContain("<title data-seo>Create Your Free Kowope Account</title>");
    expect(doc.html).toContain('property="og:image" content="https://kowope.com/og/og-home.jpg"');
    expect(doc.html).not.toContain(SEO_MARKER);
    expect(doc.noindexHeader).toBe(false);
  });

  it("answers 404 with noindex for an unknown route", () => {
    const doc = renderDocument(template, "/does-not-exist", site);
    expect(doc.status).toBe(404);
    expect(doc.noindexHeader).toBe(true);
    expect(doc.html).toContain('content="noindex"');
  });

  it("answers 200 with noindex for app screens", () => {
    const doc = renderDocument(template, "/inventory/new", site);
    expect(doc.status).toBe(200);
    expect(doc.noindexHeader).toBe(true);
  });
});

describe("siteConfigFromEnv", () => {
  it("defaults the origin and drops unset social fields", () => {
    expect(siteConfigFromEnv({})).toEqual({ siteUrl: "https://kowope.com", twitterHandle: undefined, sameAs: [] });
  });
  it("normalises handle and trims the trailing slash", () => {
    const c = siteConfigFromEnv({ SITE_URL: "https://www.kowope.com/", SEO_TWITTER_HANDLE: "kowope", SEO_SAME_AS: "https://a.com, https://b.com" });
    expect(c).toEqual({ siteUrl: "https://www.kowope.com", twitterHandle: "@kowope", sameAs: ["https://a.com", "https://b.com"] });
  });
});

describe("canonicalRedirects", () => {
  const run = (req: Record<string, unknown>) => {
    let redirect: [number, string] | null = null;
    let nexted = false;
    canonicalRedirects(site)(
      { method: "GET", protocol: "https", ...req } as never,
      { redirect: (s: number, u: string) => (redirect = [s, u]) } as never,
      () => (nexted = true),
    );
    return { redirect, nexted };
  };

  it("301s www to the bare domain, http to https and trailing-slash duplicates, keeping the query", () => {
    expect(run({ headers: { host: "www.kowope.com" }, path: "/pricing", originalUrl: "/pricing?a=1" }).redirect).toEqual([301, "https://kowope.com/pricing?a=1"]);
    expect(run({ headers: { host: "kowope.com", "x-forwarded-proto": "http" }, path: "/", originalUrl: "/" }).redirect).toEqual([301, "https://kowope.com/"]);
    expect(run({ headers: { host: "kowope.com" }, path: "/terms/", originalUrl: "/terms/" }).redirect).toEqual([301, "https://kowope.com/terms"]);
  });

  it("leaves a canonical request, other hosts and non-GET alone", () => {
    expect(run({ headers: { host: "kowope.com" }, path: "/terms", originalUrl: "/terms" }).nexted).toBe(true);
    expect(run({ headers: { host: "localhost:5000" }, path: "/terms", originalUrl: "/terms" }).nexted).toBe(true);
    expect(run({ method: "POST", headers: { host: "www.kowope.com" }, path: "/x", originalUrl: "/x" }).nexted).toBe(true);
  });
});
