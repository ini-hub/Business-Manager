import {
  DEFAULT_SHARE,
  PRIVATE_ROBOTS,
  indexablePages,
  normalizePath,
  resolveRoute,
  type ResolvedSeo,
  type SeoPage,
} from "./pages";

/**
 * Builds the per-route head tags as plain data so the same output can be rendered to an HTML string
 * on the server (what crawlers read) and applied to the DOM on the client (in-app navigation).
 * Every tag built here carries data-seo so the client can swap them without touching the static
 * tags in client/index.html (charset, viewport, icons, manifest, fonts, theme colour).
 */

export type HeadTag = {
  tag: "title" | "meta" | "link" | "script";
  attrs: Record<string, string>;
  text?: string;
};

export type SiteConfig = {
  /** Absolute origin, no trailing slash. */
  siteUrl: string;
  /** Optional: tags that need them are omitted when unset, never emitted as placeholders. */
  twitterHandle?: string;
  sameAs?: readonly string[];
};

export const PLANS = [
  { name: "Free", price: 0 },
  { name: "Starter", price: 7500 },
  { name: "Growth", price: 18000 },
  { name: "Business", price: 35000 },
] as const;

const meta = (key: "name" | "property", name: string, content: string): HeadTag => ({
  tag: "meta",
  attrs: { [key]: name, content },
});

export function absoluteUrl(site: SiteConfig, path: string): string {
  const p = normalizePath(path);
  return p === "/" ? `${site.siteUrl}/` : `${site.siteUrl}${p}`;
}

function jsonLdFor(page: SeoPage, site: SiteConfig): object | null {
  if (page.path === "/") {
    const org = `${site.siteUrl}/#org`;
    return {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Organization",
          "@id": org,
          name: "Kowope",
          url: `${site.siteUrl}/`,
          logo: `${site.siteUrl}/icon-512.png`,
          ...(site.sameAs?.length ? { sameAs: site.sameAs } : {}),
        },
        {
          "@type": "WebSite",
          "@id": `${site.siteUrl}/#website`,
          name: "Kowope",
          url: `${site.siteUrl}/`,
          inLanguage: "en-NG",
          publisher: { "@id": org },
        },
        {
          "@type": "SoftwareApplication",
          name: "Kowope",
          applicationCategory: "BusinessApplication",
          operatingSystem: "Android, iOS, Web",
          description: page.description,
          offers: PLANS.map((plan) => ({
            "@type": "Offer",
            name: plan.name,
            price: plan.price,
            priceCurrency: "NGN",
            ...(plan.price > 0
              ? { priceSpecification: { "@type": "UnitPriceSpecification", price: plan.price, priceCurrency: "NGN", unitText: "MONTH" } }
              : {}),
          })),
        },
      ],
    };
  }
  if (page.industry) {
    return {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${site.siteUrl}/` },
        { "@type": "ListItem", position: 2, name: page.industry, item: absoluteUrl(site, page.path) },
      ],
    };
  }
  return null;
}

function publicTags(page: SeoPage, site: SiteConfig): HeadTag[] {
  const canonical = absoluteUrl(site, page.path);
  const tags: HeadTag[] = [
    { tag: "title", attrs: {}, text: page.title },
    meta("name", "description", page.description),
    { tag: "link", attrs: { rel: "canonical", href: canonical } },
    meta("name", "robots", page.robots),
  ];

  // Noindex pages get no share image, so there is nothing to build a card from.
  if (!page.ogImage) return tags;

  const isIndustry = Boolean(page.industry);
  const ogTitle = page.ogTitle ?? (isIndustry ? page.h1 : DEFAULT_SHARE.title);
  const ogDescription = page.ogDescription ?? (isIndustry ? page.description : DEFAULT_SHARE.description);
  const image = `${site.siteUrl}/og/${page.ogImage}`;
  const alt = isIndustry
    ? `Kowope app on a phone next to the headline ${page.h1}`
    : DEFAULT_SHARE.imageAlt;

  tags.push(
    meta("property", "og:type", "website"),
    meta("property", "og:site_name", "Kowope"),
    meta("property", "og:locale", "en_NG"),
    meta("property", "og:url", canonical),
    meta("property", "og:title", ogTitle),
    meta("property", "og:description", ogDescription),
    meta("property", "og:image", image),
    meta("property", "og:image:width", "1200"),
    meta("property", "og:image:height", "630"),
    meta("property", "og:image:alt", alt),
    meta("name", "twitter:card", "summary_large_image"),
    ...(site.twitterHandle ? [meta("name", "twitter:site", site.twitterHandle)] : []),
    meta("name", "twitter:title", ogTitle),
    meta("name", "twitter:description", ogDescription),
    meta("name", "twitter:image", image),
    meta("name", "twitter:image:alt", alt),
  );

  const ld = jsonLdFor(page, site);
  if (ld) {
    // "<" is escaped so a stray "</script>" in copy can never close the tag early.
    tags.push({ tag: "script", attrs: { type: "application/ld+json" }, text: JSON.stringify(ld).replace(/</g, "\\u003c") });
  }
  return tags;
}

export function headTagsFor(resolved: ResolvedSeo, site: SiteConfig): HeadTag[] {
  if (resolved.kind === "public") return publicTags(resolved.page, site);
  return [
    { tag: "title", attrs: {}, text: resolved.title },
    meta("name", "robots", resolved.kind === "notfound" ? "noindex" : PRIVATE_ROBOTS),
  ];
}

export function headTagsForPath(pathname: string, site: SiteConfig): HeadTag[] {
  return headTagsFor(resolveRoute(pathname), site);
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderHeadTags(tags: readonly HeadTag[]): string {
  return tags
    .map((t) => {
      const attrs = Object.entries(t.attrs)
        .map(([k, v]) => ` ${k}="${escapeHtml(v)}"`)
        .join("");
      if (t.tag === "title") return `<title data-seo>${escapeHtml(t.text ?? "")}</title>`;
      if (t.tag === "script") return `<script data-seo${attrs}>${t.text ?? ""}</script>`;
      return `<${t.tag} data-seo${attrs}>`;
    })
    .join("\n    ");
}

export function renderSitemap(site: SiteConfig, lastmod: string): string {
  const urls = indexablePages()
    .map((p) => `  <url>\n    <loc>${absoluteUrl(site, p.path)}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function renderRobotsTxt(site: SiteConfig): string {
  // The app is served from the site root, so its screens are kept out of the index with noindex
  // (a robots.txt Disallow would stop crawlers from ever reading that noindex).
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /app/",
    "Disallow: /api/",
    "Disallow: /auth/verify",
    "",
    `Sitemap: ${site.siteUrl}/sitemap.xml`,
    "",
  ].join("\n");
}
