/**
 * Single source of truth for every public route's metadata.
 *
 * Read by the server (server/seo.ts injects the tags into the HTML it returns, so crawlers that
 * do not run JavaScript still see them), by the client (client/src/components/seo-sync.tsx keeps
 * the head in step during in-app navigation), and by the build (sitemap.xml). No page hard-codes
 * its own tags. shared/seo/pages.test.ts enforces the length limits and the other rules.
 *
 * The logged-in app is served from the site root (/customers, /inventory ...), not under /app, so
 * "private" routes are classified by `resolveRoute` below rather than by a path prefix.
 */

export const DEFAULT_SITE_URL = "https://kowope.com";

export const TITLE_MAX = 60;
export const DESCRIPTION_MAX = 160;

export type SeoPage = {
  path: string;
  /** `planned` pages have no UI yet: their copy is kept here, but they are not routed, sitemapped or served. */
  status: "live" | "planned";
  title: string;
  description: string;
  robots: string;
  h1: string;
  /** Filename under /og/. Omit on noindex pages: no share image. */
  ogImage?: string;
  ogTitle?: string;
  ogDescription?: string;
  /** Industry landing pages: adds BreadcrumbList (Home > name). */
  industry?: string;
};

const INDEX = "index, follow";
const HOME_ROBOTS = "index, follow, max-image-preview:large";

export const DEFAULT_SHARE = {
  title: "Run your whole business from your phone",
  description:
    "Sales, stock, customers, staff and bookings in one app built for Nigerian SMEs. Start free, pay only for what you use.",
  image: "og-home.jpg",
  imageAlt:
    "Kowope app on a phone showing today's sales, bookings and credit due, next to the headline Run your whole business from your phone.",
} as const;

export const PAGES: readonly SeoPage[] = [
  {
    path: "/",
    status: "live",
    title: "Kowope: Business Management App for Nigerian SMEs",
    description:
      "Run sales, stock, customers, staff and bookings from your phone. Works offline, priced in Naira. Start free with no card and set up in 10 minutes.",
    robots: HOME_ROBOTS,
    h1: "Run your whole business from your phone.",
    ogImage: "og-home.jpg",
  },
  {
    path: "/pricing",
    status: "planned",
    title: "Kowope Pricing: Free Plan, Paid Plans from ₦7,500/month",
    description:
      "Free forever plan. Starter ₦7,500, Growth ₦18,000 and Business ₦35,000 a month, or add single modules from ₦1,000. Pay yearly and get 2 months free.",
    robots: INDEX,
    h1: "Free to start. Pay for what earns you money.",
    ogImage: "og-home.jpg",
  },
  {
    path: "/salons",
    status: "planned",
    title: "Salon Booking and Commission App in Nigeria | Kowope",
    description:
      "Bookings without double-booking, fair stylist commission and WhatsApp reminders for salons, barbers and spas. Works offline. Start free today.",
    robots: INDEX,
    h1: "Bookings and commission, sorted.",
    ogImage: "og-salon.jpg",
    industry: "Salons",
  },
  {
    path: "/shops",
    status: "planned",
    title: "Shop POS, Inventory and Credit Sales App | Kowope",
    description:
      "Record sales, track customers who buy on credit and know what is on every shelf. Built for Nigerian shops and provisions stores. Start free.",
    robots: INDEX,
    h1: "Know who owes you and what is on your shelf.",
    ogImage: "og-shop.jpg",
    industry: "Shops",
  },
  {
    path: "/boutiques",
    status: "planned",
    title: "Boutique Inventory App with Sizes and Colours | Kowope",
    description:
      "Track every size and colour as its own stock line, run promotions that move slow items and message customers on WhatsApp. Start free.",
    robots: INDEX,
    h1: "Every size, every colour, every sale.",
    ogImage: "og-home.jpg",
    industry: "Boutiques",
  },
  {
    path: "/restaurants",
    status: "planned",
    title: "Restaurant POS, Shift Cash and Staff Attendance | Kowope",
    description:
      "Balance every shift, track staff attendance and lateness, and run payroll at month end. Built for Nigerian restaurants and bakeries.",
    robots: INDEX,
    h1: "Balance every shift, track every staff.",
    ogImage: "og-restaurant.jpg",
    industry: "Restaurants",
  },
  {
    path: "/pharmacies",
    status: "planned",
    title: "Pharmacy Stock Audit and Purchase Order App | Kowope",
    description:
      "Audit stock in minutes, raise supplier purchase orders, record vendor bills and show tax on receipts. Built for Nigerian pharmacies. Start free.",
    robots: INDEX,
    h1: "Audit-ready stock in minutes.",
    ogImage: "og-pharmacy.jpg",
    industry: "Pharmacies",
  },
  {
    path: "/wholesale",
    status: "planned",
    title: "Wholesale and Distribution Software in Nigeria | Kowope",
    description:
      "Send quotes fast, set credit limits per retailer and move stock between outlets. Every bag, every outlet, every naira owed, in one app.",
    robots: INDEX,
    h1: "Every bag, every outlet, every naira owed.",
    ogImage: "og-wholesale.jpg",
    industry: "Wholesale",
  },
  {
    path: "/auth/signup",
    status: "live",
    title: "Create Your Free Kowope Account",
    description: "Set up your business in 10 minutes. Free forever plan and a 14-day Growth trial, no card needed.",
    robots: INDEX,
    h1: "Create your account",
    ogImage: "og-home.jpg",
  },
  {
    path: "/auth/login",
    status: "live",
    title: "Log In | Kowope",
    description: "Log in to manage your sales, stock, customers and staff.",
    robots: "noindex, follow",
    h1: "Log in to Kowope",
  },
  {
    path: "/privacy",
    status: "live",
    title: "Privacy Policy | Kowope",
    description:
      "How Kowope collects, uses and protects your business data, in line with the Nigeria Data Protection Act 2023.",
    robots: INDEX,
    h1: "Privacy Policy",
    ogImage: "og-home.jpg",
  },
  {
    path: "/terms",
    status: "live",
    title: "Terms and Conditions | Kowope",
    description: "The terms that apply when you use Kowope, including plans, billing, free trials and your data.",
    robots: INDEX,
    h1: "Terms and Conditions",
    ogImage: "og-home.jpg",
  },
];

export const NOT_FOUND_TITLE = "Page Not Found | Kowope";
export const PRIVATE_ROBOTS = "noindex, nofollow";

/** Auth-flow screens with a specific title; every other private screen derives "[Screen] | Kowope". */
const PRIVATE_TITLES: Record<string, string> = {
  "/auth/verify-otp": "Verify Your Email | Kowope",
  "/auth/forgot-password": "Forgot Password | Kowope",
  "/auth/reset-password": "Reset Password | Kowope",
  "/activate": "Activate Your Account | Kowope",
};

/** "/" is the public home page when signed out and the dashboard when signed in. */
export const DASHBOARD_TITLE = "Dashboard | Kowope";

/**
 * First path segments that belong to the app or to token/session flows. Anything here is served
 * 200 with noindex, nofollow. client/src/App.routes.test.ts-style coverage lives in
 * shared/seo/pages.test.ts: every top-level segment App.tsx routes must be here or a page above.
 */
export const PRIVATE_SEGMENTS: readonly string[] = [
  "activate", "analytics", "auth", "bookings", "broadcasts", "complete-profile", "credit-sales",
  "customers", "data-usage", "expenses", "guarantor", "help-support", "inventory", "leaderboard",
  "legal", "my-booking", "onboarding", "payroll", "profile", "profit-loss", "purchase-orders",
  "quotes", "reports", "sales", "settings", "staff", "staffs", "stock-transfers", "super-admin",
  "transactions", "vendors", "verify",
];

export type ResolvedSeo =
  | { kind: "public"; page: SeoPage }
  | { kind: "private"; title: string }
  | { kind: "notfound"; title: string };

export function normalizePath(pathname: string): string {
  const path = pathname.split("?")[0].split("#")[0] || "/";
  return path.length > 1 ? path.replace(/\/+$/, "") || "/" : path;
}

function humanize(segment: string): string {
  return segment
    .split("-")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export function resolveRoute(pathname: string): ResolvedSeo {
  const path = normalizePath(pathname);
  const page = PAGES.find((p) => p.status === "live" && p.path === path);
  if (page) return { kind: "public", page };

  const segment = path.split("/")[1] ?? "";
  if (PRIVATE_SEGMENTS.includes(segment)) {
    const title = PRIVATE_TITLES[path] ?? `${humanize(segment === "super-admin" ? "admin" : segment)} | Kowope`;
    return { kind: "private", title };
  }
  return { kind: "notfound", title: NOT_FOUND_TITLE };
}

export function indexablePages(): SeoPage[] {
  return PAGES.filter((p) => p.status === "live" && /\bindex\b/.test(p.robots) && !/\bnoindex\b/.test(p.robots));
}
