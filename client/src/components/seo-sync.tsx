import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { DASHBOARD_TITLE, normalizePath, resolveRoute, type ResolvedSeo } from "@shared/seo/pages";
import { headTagsFor, type HeadTag, type SiteConfig } from "@shared/seo/head";

/**
 * The server already puts the right head tags in the HTML for the first load. This swaps them as the
 * user navigates in the SPA, so the tab title and robots directive stay correct (and the signed-in
 * dashboard at "/" is not described as the public home page). It renders nothing.
 */
function siteFromDocument(): SiteConfig {
  // The server-rendered canonical carries the configured origin; fall back to the current one in dev.
  const canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
  const origin = canonical ? new URL(canonical).origin : window.location.origin;
  return { siteUrl: origin };
}

function applyTags(tags: readonly HeadTag[]) {
  document.head.querySelectorAll("[data-seo]").forEach((el) => el.remove());
  for (const t of tags) {
    const el = document.createElement(t.tag);
    el.setAttribute("data-seo", "");
    for (const [k, v] of Object.entries(t.attrs)) el.setAttribute(k, v);
    if (t.text) el.textContent = t.text;
    document.head.appendChild(el);
  }
}

export function SeoSync() {
  const [location] = useLocation();
  const { isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    // Wait for the session so a signed-in user's "/" never flashes the public home metadata.
    if (isLoading) return;
    const path = normalizePath(location);
    const resolved: ResolvedSeo =
      path === "/" && isAuthenticated ? { kind: "private", title: DASHBOARD_TITLE } : resolveRoute(path);
    applyTags(headTagsFor(resolved, siteFromDocument()));
  }, [location, isAuthenticated, isLoading]);

  return null;
}
