import type { NextFunction, Request, Response } from "express";
import { DEFAULT_SITE_URL, resolveRoute } from "../shared/seo/pages";
import { headTagsFor, renderHeadTags, type SiteConfig } from "../shared/seo/head";

export const SEO_MARKER = "<!--seo-head-->";

const clean = (v: string | undefined) => v?.trim() || undefined;

/**
 * SITE_URL is the canonical origin (www or bare, whichever is primary). The social handle and
 * profile URLs are optional: while unset, the tags that need them are left out rather than
 * emitted as placeholders.
 */
export function siteConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SiteConfig {
  const handle = clean(env.SEO_TWITTER_HANDLE);
  return {
    siteUrl: (clean(env.SITE_URL) ?? DEFAULT_SITE_URL).replace(/\/+$/, ""),
    twitterHandle: handle ? (handle.startsWith("@") ? handle : `@${handle}`) : undefined,
    sameAs: (env.SEO_SAME_AS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  };
}

export type RenderedDocument = { status: number; html: string; noindexHeader: boolean };

/** Injects the route's head tags into the built index.html. Unknown routes get a real 404. */
export function renderDocument(template: string, pathname: string, site: SiteConfig): RenderedDocument {
  const resolved = resolveRoute(pathname);
  const html = template.replace(SEO_MARKER, renderHeadTags(headTagsFor(resolved, site)));
  return {
    status: resolved.kind === "notfound" ? 404 : 200,
    html,
    noindexHeader: resolved.kind !== "public",
  };
}

/**
 * 301s for http -> https, www -> the SITE_URL host, and trailing-slash duplicates. Mounted only
 * after the API routes so health checks (plain http, no forwarded proto) are never redirected.
 */
export function canonicalRedirects(site: SiteConfig) {
  const siteHost = new URL(site.siteUrl).host;
  const bareHost = siteHost.replace(/^www\./, "");
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();

    const host = (req.headers.host ?? "").toLowerCase();
    const hostIsSite = host.replace(/^www\./, "") === bareHost;
    const targetHost = hostIsSite ? siteHost : host;
    const insecure = req.headers["x-forwarded-proto"] === "http";
    const hasTrailingSlash = req.path.length > 1 && req.path.endsWith("/");

    if (!insecure && targetHost === host && !hasTrailingSlash) return next();

    const protocol = insecure ? "https" : req.protocol;
    const pathname = hasTrailingSlash ? req.path.replace(/\/+$/, "") || "/" : req.path;
    const query = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
    res.redirect(301, `${protocol}://${targetHost}${pathname}${query}`);
  };
}
