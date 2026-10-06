import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  DESCRIPTION_MAX, PAGES, PRIVATE_SEGMENTS, TITLE_MAX, indexablePages, resolveRoute,
} from "./pages";
import { headTagsFor, headTagsForPath, renderHeadTags, renderRobotsTxt, renderSitemap } from "./head";

const site = { siteUrl: "https://kowope.com" };
const root = path.resolve(__dirname, "../..");

describe("seo pages", () => {
  it("keeps every title within 60 characters and description within 160", () => {
    for (const p of PAGES) {
      expect(p.title.length, `${p.path} title`).toBeLessThanOrEqual(TITLE_MAX);
      expect(p.description.length, `${p.path} description`).toBeLessThanOrEqual(DESCRIPTION_MAX);
      for (const s of [p.ogTitle, p.ogDescription]) if (s) expect(s.length).toBeGreaterThan(0);
    }
  });

  it("gives every page a unique path, title and description", () => {
    for (const key of ["path", "title", "description"] as const) {
      const values = PAGES.map((p) => p[key]);
      expect(new Set(values).size, key).toBe(values.length);
    }
  });

  it("has no bracketed placeholder text in any page copy", () => {
    expect(JSON.stringify(PAGES)).not.toMatch(/\[[A-Z@_ ]{3,}\]/);
  });

  it("only lists the indexable live routes in the sitemap", () => {
    const xml = renderSitemap(site, "2026-01-01");
    expect(xml).toContain("<loc>https://kowope.com/</loc>");
    expect(xml).toContain("<loc>https://kowope.com/auth/signup</loc>");
    expect(xml).not.toContain("/auth/login"); // noindex
    expect(xml).not.toContain("/salons"); // planned, no page yet
    expect(indexablePages().every((p) => p.status === "live")).toBe(true);
  });

  it("points live share images at files that exist and are under 300 KB", () => {
    for (const p of PAGES.filter((x) => x.status === "live" && x.ogImage)) {
      const file = path.join(root, "client/public/og", p.ogImage!);
      expect(fs.existsSync(file), p.ogImage).toBe(true);
      expect(fs.statSync(file).size).toBeLessThan(300 * 1024);
    }
  });

  it("classifies every top-level segment App.tsx routes, so none falls through to a 404", () => {
    const app = fs.readFileSync(path.join(root, "client/src/App.tsx"), "utf8");
    const segments = new Set(Array.from(app.matchAll(/<Route path="\/([^/":]*)/g), (m) => m[1]).filter(Boolean));
    expect(segments.size).toBeGreaterThan(20);
    const live = new Set(PAGES.filter((p) => p.status === "live").map((p) => p.path.split("/")[1]));
    for (const s of segments) {
      expect(PRIVATE_SEGMENTS.includes(s) || live.has(s), `/${s}`).toBe(true);
    }
  });
});

describe("seo head rendering", () => {
  const html = (p: string) => renderHeadTags(headTagsForPath(p, site));

  it("renders the home tags with absolute URLs", () => {
    const h = html("/");
    expect(h).toContain("<title data-seo>Kowope: Business Management App for Nigerian SMEs</title>");
    expect(h).toContain('<link data-seo rel="canonical" href="https://kowope.com/">');
    expect(h).toContain('content="https://kowope.com/og/og-home.jpg?v=3"');
    expect(h).toContain('property="og:title" content="Run your whole business from your phone"');
    expect(h).toContain('name="twitter:card" content="summary_large_image"');
    expect(h).toContain("index, follow, max-image-preview:large");
  });

  it("emits valid homepage JSON-LD with the three schema types and NGN offers", () => {
    const tag = headTagsForPath("/", site).find((t) => t.tag === "script")!;
    const graph = JSON.parse(tag.text!)["@graph"];
    expect(graph.map((n: { "@type": string }) => n["@type"])).toEqual(["Organization", "WebSite", "SoftwareApplication"]);
    expect(graph[2].offers.map((o: { price: number }) => o.price)).toEqual([0, 7500, 18000, 35000]);
    expect(JSON.stringify(graph)).not.toMatch(/aggregateRating|Review/);
  });

  it("omits handle and sameAs rather than emitting placeholders when unset", () => {
    const h = html("/");
    expect(h).not.toContain("twitter:site");
    expect(h).not.toContain("sameAs");
    expect(h).not.toMatch(/\[[A-Z@_ ]{3,}\]/);
    const withHandle = renderHeadTags(headTagsForPath("/", { ...site, twitterHandle: "@kowope", sameAs: ["https://x.com/kowope"] }));
    expect(withHandle).toContain('name="twitter:site" content="@kowope"');
    expect(withHandle).toContain("https://x.com/kowope");
  });

  it("strips the query string from the canonical", () => {
    expect(html("/auth/signup?ref=x")).toContain('href="https://kowope.com/auth/signup"');
  });

  it("noindexes login, app screens and unknown routes, with no share image", () => {
    expect(html("/auth/login")).toContain('content="noindex, follow"');
    expect(html("/auth/login")).not.toContain("og:image");
    expect(html("/customers/12")).toContain('content="noindex, nofollow"');
    expect(html("/customers/12")).toContain("Customers | Kowope");
    expect(html("/auth/verify-otp")).toContain("Verify Your Email | Kowope");
    expect(html("/nope")).toContain("Page Not Found | Kowope");
    expect(headTagsFor(resolveRoute("/nope"), site).find((t) => t.attrs.name === "robots")!.attrs.content).toBe("noindex");
    expect(resolveRoute("/nope").kind).toBe("notfound");
  });

  it("treats a trailing slash as the same route", () => {
    expect(resolveRoute("/privacy/").kind).toBe("public");
  });

  it("writes robots.txt that blocks the api and verify step and names the sitemap", () => {
    const r = renderRobotsTxt(site);
    expect(r).toContain("Disallow: /api/");
    expect(r).toContain("Disallow: /auth/verify");
    expect(r).toContain("Sitemap: https://kowope.com/sitemap.xml");
  });
});
