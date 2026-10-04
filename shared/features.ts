/**
 * Feature registry: the single source of truth for what features exist and
 * what each one covers (API routes, API domains, client screens).
 *
 * Browser-safe: no drizzle, no node imports. Consumed by
 *   - server/lib/featurePolicy.ts   (route gating is derived from `routes`/`domains`)
 *   - server/lib/entitlements.ts    (free features are always granted)
 *   - server/lib/featureSync.ts     (upserts feature_catalog + feature_flags from here)
 *
 * What lives where:
 *   - Structure (key, name, tier, parent, dependencies, limits, coverage) is
 *     defined HERE and pushed to the database by the sync.
 *   - Operational state (prices, is_active, flag status) is owned by the
 *     database / admin UI. The sync only uses the values below as defaults when
 *     it creates a row; it never overwrites an admin's edit.
 *
 * Every feature owns exactly one feature flag (feature_catalog.flag_id), named
 * after the feature key. Flag status 'off' is the platform-wide kill-switch.
 */

import { isPermissionModule, type PermissionModule } from "./permissionModules";

export type FeatureTier = "free" | "paid_flat" | "paid_metered_limit" | "bundle_parent" | "bundle_child";

export type FeatureCategory =
  | "vendor_mgmt"
  | "staff_mgmt"
  | "customer_mgmt"
  | "financial_mgmt"
  | "tax_compliance"
  | "inventory_mgmt"
  | "analytics"
  | "business_settings";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export const WRITE_METHODS: readonly HttpMethod[] = ["POST", "PUT", "PATCH", "DELETE"];

/** A request this feature must be entitled to before the route runs. */
export interface RouteRule {
  methods: readonly HttpMethod[] | "*";
  path: RegExp;
}

export interface FeatureDef {
  /** snake_case, stable forever: it is the catalog key AND the flag name. */
  key: string;
  name: string;
  description: string;
  category: FeatureCategory;
  tier: FeatureTier;
  /**
   * The Settings > Roles module this feature belongs to. A custom role can only
   * use a feature's admin-defined gated routes/screens if it holds this module
   * (shared/permissionModules.ts); the role form lists the feature under it.
   */
  module: PermissionModule;
  /** bundle_child only: key of the bundle_parent that grants this. */
  parent?: string;
  /** Purchase-time prerequisites (feature keys). */
  dependsOn?: readonly string[];
  /** paid_metered_limit only. */
  freeLimit?: number;
  limitType?: "staff_seats" | "customer_count" | "store_count";
  /** Default price when the catalog row is first created; the DB owns it afterwards. */
  price?: { monthly: number; annual: number };
  /** Default is_active when the row is first created; the DB owns it afterwards. */
  active: boolean;
  sortOrder: number;
  /**
   * Requests that REQUIRE this feature (enforced by enforceFeaturePolicy).
   * Used for paid features. Free features need no rules.
   */
  routes?: readonly RouteRule[];
  /**
   * First `/api/<segment>` path segments this feature owns. Mutating routes
   * under a domain are classified (and therefore allowed through the policy
   * coverage test) by the feature that owns the domain.
   */
  domains?: readonly string[];
  /**
   * Where this feature is enforced by a check inside a handler rather than a
   * route rule (the decision depends on the request body or stored data).
   * Counts as coverage; keep the named check in step with the key.
   */
  inlineGate?: string;
  /**
   * Why a feature legitimately has no route rule, domain or screen of its own
   * (it is enforced client-side, or only through its bundle parent). Counts as
   * coverage.
   */
  coveredBy?: string;
  /**
   * Client route paths (wouter patterns, client/src/App.tsx) this feature owns.
   * A path owns itself and everything beneath it; the most specific owner wins,
   * so "/expenses/new" can belong to a different feature than "/expenses".
   */
  screens?: readonly string[];
  /**
   * The subset of screens that render a locked card (and show a lock in the
   * sidebar) when the org lacks this feature. Lists of data an org already owns
   * stay readable after an add-on lapses, so they are owned but not gated.
   */
  gatedScreens?: readonly string[];
  /**
   * Set while a feature has a catalog row but nothing in the app is gated by
   * it yet. Listed by a test as a baseline that may only shrink; remove the
   * field when real routes/screens are attached.
   */
  pendingGate?: string;
}

const w = WRITE_METHODS;

export const FEATURES = [
  // ─── Free core: vendors & purchasing ────────────────────────────────────
  {
    key: "vendor_details", module: "Inventory & Catalog", name: "Vendor Details", description: "Vendor records and profiles.",
    category: "vendor_mgmt", tier: "free", active: true, sortOrder: 10,
    domains: ["vendors", "quotes", "tax-rates"], screens: ["/vendors", "/quotes"],
  },
  {
    key: "purchase_order_tracking", module: "Inventory & Catalog", name: "Purchase Order Tracking", description: "Create and track purchase orders to vendors.",
    category: "vendor_mgmt", tier: "free", active: true, sortOrder: 20,
    domains: ["purchase-orders"], screens: ["/purchase-orders"],
  },

  // ─── Free core: staff ──────────────────────────────────────────────────
  {
    key: "attendance_management", module: "Staff & Payroll", name: "Attendance Management (manager-recorded)", description: "Clock staff in and out on their behalf.",
    category: "staff_mgmt", tier: "free", active: true, sortOrder: 30,
    domains: ["attendance"], screens: ["/staff/attendance", "/staffs/attendance"],
  },
  {
    key: "contract_management", module: "Staff & Payroll", name: "Contract Management", description: "Versioned staff contracts with e-signature.",
    category: "staff_mgmt", tier: "free", active: true, sortOrder: 40,
    domains: ["contract"],
  },

  // ─── Free core: sales & customers ──────────────────────────────────────
  {
    key: "sales_module", module: "Sales & Checkout", name: "Sales Module", description: "Core point-of-sale checkout.",
    category: "inventory_mgmt", tier: "free", active: true, sortOrder: 50,
    domains: ["sales", "transactions"], screens: ["/sales", "/transactions", "/credit-sales"],
  },
  {
    key: "customer_details", module: "Customers", name: "Customer Details", description: "Customer records, up to the free tier limit.",
    category: "customer_mgmt", tier: "free", active: true, sortOrder: 60,
    domains: ["customers"], screens: ["/customers"],
  },
  {
    key: "customer_filters", module: "Customers", name: "Customer Filters", description: "Filter and segment the customer list.",
    category: "customer_mgmt", tier: "free", active: true, sortOrder: 70,
    coveredBy: "client-side filtering on the /customers page (client/src/pages/customers.tsx); free, no server enforcement needed",
  },
  {
    key: "promotions", module: "Sales & Checkout", name: "Promotions", description: "BOGO, spend-threshold, and percentage-discount campaigns.",
    category: "inventory_mgmt", tier: "free", active: true, sortOrder: 80,
    domains: ["promotions"], screens: ["/settings/promotions"],
  },
  {
    key: "hide_transaction_amount", module: "Settings", name: "Hide Transaction Amount From Staff", description: "Mask amounts from staff in transactions, dashboard, and exports.",
    category: "business_settings", tier: "free", active: false, sortOrder: 90,
    pendingGate: "placeholder, inactive: nothing implements transaction-amount masking yet",
  },

  // ─── Staff seats / self check-in / performance ─────────────────────────
  {
    key: "staff_seats_addon", module: "Staff & Payroll", name: "Additional Staff Seats", description: "Unlimited staff beyond the first free seat.",
    category: "staff_mgmt", tier: "paid_metered_limit", freeLimit: 1, limitType: "staff_seats",
    price: { monthly: 2000, annual: 20000 }, active: true, sortOrder: 100,
    screens: ["/staffs/new"],
  },
  {
    key: "self_check_in", module: "Staff & Payroll", name: "Self Check-In", description: "Staff clock themselves in and out.",
    category: "staff_mgmt", tier: "paid_flat", dependsOn: ["attendance_management"],
    price: { monthly: 1500, annual: 15000 }, active: true, sortOrder: 110,
    // Manager-recorded /punch/proxy stays free.
    routes: [{ methods: ["POST"], path: /^\/api\/attendance\/punch$/ }],
  },
  {
    key: "staff_performance_tracking", module: "Staff & Payroll", name: "Staff Performance Tracking", description: "Per-staff performance reports.",
    category: "staff_mgmt", tier: "paid_flat",
    price: { monthly: 2500, annual: 25000 }, active: true, sortOrder: 120,
    routes: [{ methods: "*", path: /^\/api\/reports\/staff-performance(\/|$)/ }],
    screens: ["/staffs/performance"],
    gatedScreens: ["/staffs/performance"],
  },

  // ─── Customers ─────────────────────────────────────────────────────────
  {
    key: "customer_capacity_addon", module: "Customers", name: "Additional Customer Capacity", description: "Unlimited customers beyond the first 50 free.",
    category: "customer_mgmt", tier: "paid_metered_limit", freeLimit: 50, limitType: "customer_count",
    price: { monthly: 2000, annual: 20000 }, active: true, sortOrder: 130,
    screens: ["/customers/new"],
  },
  {
    key: "customer_analytics_retention", module: "Customers", name: "Customer Analytics & Retention", description: "Retention and repeat-customer analytics.",
    category: "customer_mgmt", tier: "paid_flat",
    price: { monthly: 3000, annual: 30000 }, active: false, sortOrder: 140,
    pendingGate: "placeholder, inactive: no retention analytics exists yet. Attach its routes/screens when built, then activate",
  },
  {
    key: "quote_booking_management", module: "Customers", name: "Quote & Booking Management", description: "Pricing not yet decided - placeholder entry.",
    category: "customer_mgmt", tier: "paid_flat", active: false, sortOrder: 150,
    pendingGate: "placeholder, inactive",
  },

  // ─── Financial Management bundle ───────────────────────────────────────
  {
    key: "financial_management", module: "Expenses & Reports", name: "Financial Management", description: "P&L Statement, Expenses, and Hybrid/Commission Payroll, sold as one bundle.",
    category: "financial_mgmt", tier: "bundle_parent",
    price: { monthly: 7500, annual: 75000 }, active: true, sortOrder: 160,
    routes: [
      { methods: "*", path: /^\/api\/profit-loss(\/|$)/ },
      { methods: w, path: /^\/api\/expenses(\/|$)/ },
      { methods: w, path: /^\/api\/expense-categories(\/|$)/ },
    ],
    screens: ["/profit-loss", "/expenses"],
    gatedScreens: ["/profit-loss", "/expenses/new", "/expenses/categories", "/expenses/:id/edit"],
  },
  {
    key: "pnl_statement", module: "Expenses & Reports", name: "Profit & Loss Statement", description: "Included in the Financial Management bundle.",
    category: "financial_mgmt", tier: "bundle_child", parent: "financial_management", active: true, sortOrder: 161,
    coveredBy: "granted and gated through the financial_management bundle parent; give it its own rule if it is ever sold alone",
  },
  {
    key: "expenses_tracking", module: "Expenses & Reports", name: "Expenses", description: "Included in the Financial Management bundle.",
    category: "financial_mgmt", tier: "bundle_child", parent: "financial_management", active: true, sortOrder: 162,
    coveredBy: "granted and gated through the financial_management bundle parent; give it its own rule if it is ever sold alone",
  },
  {
    key: "payroll_hybrid_commission", module: "Staff & Payroll", name: "Payroll - Hybrid & Commission", description: "Included in the Financial Management bundle. Fixed-pay payroll stays free.",
    category: "financial_mgmt", tier: "bundle_child", parent: "financial_management", active: true, sortOrder: 163,
    inlineGate: "POST /api/payroll/periods/:id/calculate when the store has hybrid/commission staff: payroll.routes.ts, hasFeature(\"payroll_hybrid_commission\")",
  },
  {
    key: "vat_tracking", module: "Expenses & Reports", name: "VAT Tracking & Remittance Log", description: "Backend not yet built - placeholder entry (see plan §6).",
    category: "tax_compliance", tier: "paid_flat", active: false, sortOrder: 170,
    pendingGate: "placeholder, inactive",
  },

  // ─── Inventory & sales add-ons ─────────────────────────────────────────
  {
    key: "product_variants", module: "Inventory & Catalog", name: "Product Variants", description: "Size/color/style variants per product.",
    category: "inventory_mgmt", tier: "paid_flat",
    price: { monthly: 1500, annual: 15000 }, active: true, sortOrder: 180,
    routes: [{ methods: ["POST"], path: /^\/api\/products\/[^/]+\/variants(\/|$)/ }],
  },
  {
    key: "sell_in_parts", module: "Inventory & Catalog", name: "Sell In Parts", description: "Backend not yet built - placeholder entry (see plan §6).",
    category: "inventory_mgmt", tier: "paid_flat", active: false, sortOrder: 190,
    pendingGate: "placeholder, inactive",
  },
  {
    key: "receipts", module: "Sales & Checkout", name: "Receipts", description: "Custom receipt output beyond the default.",
    category: "inventory_mgmt", tier: "free", active: false, sortOrder: 200,
    coveredBy: "decided free: receipts have no endpoint or screen of their own; inactive so it is not offered in the catalog",
  },
  {
    key: "low_stock_threshold", module: "Inventory & Catalog", name: "Low Stock Threshold & Reminders", description: "Configurable reorder points and alerts.",
    category: "inventory_mgmt", tier: "paid_flat",
    price: { monthly: 1000, annual: 10000 }, active: true, sortOrder: 210,
    inlineGate: "PUT /api/settings when the body sets lowStockThreshold: settings.routes.ts GATED_SETTINGS_FIELDS",
  },
  {
    key: "credit_sale", module: "Sales & Checkout", name: "Credit Sale", description: "Checkout a sale as credit against a customer.",
    category: "inventory_mgmt", tier: "paid_flat", dependsOn: ["sales_module", "customer_details"],
    price: { monthly: 2000, annual: 20000 }, active: true, sortOrder: 220,
    inlineGate: "POST /api/sales with a credit tender: sales.routes.ts, getRequestEntitlements(...).has(\"credit_sale\")",
    routes: [{ methods: w, path: /^\/api\/credit\/entries(\/|$)/ }],
  },
  {
    key: "credit_recall_reminders", module: "Sales & Checkout", name: "Credit Recall Reminders", description: "Automated reminders for outstanding credit.",
    category: "inventory_mgmt", tier: "paid_flat", dependsOn: ["credit_sale"],
    price: { monthly: 1000, annual: 10000 }, active: true, sortOrder: 230,
    routes: [{ methods: w, path: /^\/api\/credit\/entries\/[^/]+\/reminders(\/|$)/ }],
  },
  {
    key: "consignment_management", module: "Inventory & Catalog", name: "Consignment Management", description: "Backend not yet built - placeholder entry (see plan §6).",
    category: "inventory_mgmt", tier: "paid_flat", active: false, sortOrder: 240,
    pendingGate: "placeholder, inactive",
  },

  // ─── Business settings ─────────────────────────────────────────────────
  {
    key: "store_addon", module: "Settings", name: "Additional Store / Branch", description: "Each store beyond the first free one.",
    category: "business_settings", tier: "paid_metered_limit", freeLimit: 1, limitType: "store_count",
    price: { monthly: 5000, annual: 50000 }, active: true, sortOrder: 250,
    screens: ["/settings/stores/new"],
  },
  {
    key: "receipt_customization", module: "Settings", name: "Custom Receipt Prefix + Thank-You Note", description: "Currently free and in active use - see the sunset-notice mechanism before paywalling.",
    category: "business_settings", tier: "paid_flat",
    price: { monthly: 1500, annual: 15000 }, active: true, sortOrder: 260,
    inlineGate: "PUT /api/settings when the body sets receiptPrefix or receiptThankYouMessage: settings.routes.ts GATED_SETTINGS_FIELDS. Grandfathered orgs keep it; schedule a sunset from the catalog page before removing that",
  },
  {
    key: "loyalty_program", module: "Customers", name: "Loyalty Point Configuration", description: "Currently free and in active use - see the sunset-notice mechanism before paywalling.",
    category: "business_settings", tier: "paid_flat",
    price: { monthly: 1500, annual: 15000 }, active: true, sortOrder: 270,
    inlineGate: "PUT /api/settings when the body sets loyaltyPointsPerCurrency or loyaltyPointValue: settings.routes.ts GATED_SETTINGS_FIELDS. Grandfathered orgs keep it; schedule a sunset from the catalog page before removing that",
  },
  {
    key: "custom_roles_permissions", module: "Settings", name: "Custom Roles & Permissions", description: "Currently free and in active use - see the sunset-notice mechanism before paywalling.",
    category: "business_settings", tier: "paid_flat",
    price: { monthly: 1500, annual: 15000 }, active: true, sortOrder: 280,
    routes: [{ methods: w, path: /^\/api\/custom-roles(\/|$)/ }],
    screens: ["/settings/roles/new", "/settings/roles/:id/edit"],
    gatedScreens: ["/settings/roles/new", "/settings/roles/:id/edit"],
  },
  {
    key: "plugins_integrations", module: "Settings", name: "Plugins & Integrations", description: "Framework not yet built - placeholder entry (see plan §6).",
    category: "business_settings", tier: "paid_flat", active: false, sortOrder: 290,
    pendingGate: "placeholder, inactive",
  },

  // ─── Free core domains that previously had no feature of their own ─────
  {
    key: "core_platform", module: "Dashboard", name: "Core Platform", description: "Sign-in, billing, support, notifications, stores and business settings. Always available.",
    category: "business_settings", tier: "free", active: true, sortOrder: 300,
    domains: [
      "auth", "audit-logs", "billing", "business", "funnel-events", "legal", "notifications",
      "payments", "profile-completion", "settings", "stores", "support", "webhooks",
    ],
    screens: [
      "/", "/profile", "/help-support", "/settings", "/onboarding", "/complete-profile", "/reports/audit-logs",
      "/auth", "/activate", "/terms", "/privacy", "/data-usage", "/legal", "/verify", "/guarantor",
    ],
  },
  {
    key: "inventory_management", module: "Inventory & Catalog", name: "Inventory Management", description: "Products, stock, stock transfers, audits and consumables.",
    category: "inventory_mgmt", tier: "free", active: true, sortOrder: 310,
    domains: ["inventory", "products", "orders", "stock-audits", "stock-transfers"],
    screens: ["/inventory", "/stock-transfers"],
  },
  {
    key: "booking_management", module: "Customers", name: "Bookings", description: "Appointments and bookings, including the customer-facing booking link.",
    category: "customer_mgmt", tier: "free", active: true, sortOrder: 320,
    domains: ["bookings", "my-booking"], screens: ["/bookings", "/my-booking"],
  },
  {
    key: "staff_management", module: "Staff & Payroll", name: "Staff Management", description: "Staff records, HR profiles, guarantors and staff gamification.",
    category: "staff_mgmt", tier: "free", active: true, sortOrder: 330,
    domains: ["staff", "hr", "guarantor", "gamification"],
    screens: ["/staff", "/staffs", "/leaderboard"],
  },
  {
    key: "payroll_fixed", module: "Staff & Payroll", name: "Payroll (fixed pay)", description: "Fixed-pay payroll periods, advances and payslips.",
    category: "financial_mgmt", tier: "free", active: true, sortOrder: 340,
    domains: ["payroll"], screens: ["/payroll"],
  },
  {
    key: "accounting_ledger", module: "Expenses & Reports", name: "Accounting & Cash Register", description: "Ledger, balance sheet and the cash register.",
    category: "financial_mgmt", tier: "free", active: true, sortOrder: 350,
    domains: ["accounting", "cash-register"], screens: ["/reports/balance-sheet"],
  },
  {
    key: "analytics_explorer", module: "Expenses & Reports", name: "Analytics Explorer", description: "Self-serve analytics, saved views and dashboards.",
    category: "analytics", tier: "free", active: true, sortOrder: 360,
    domains: ["analytics"], screens: ["/analytics"],
  },
  {
    key: "reports_basic", module: "Expenses & Reports", name: "Reports", description: "Standard business reports.",
    category: "analytics", tier: "free", active: true, sortOrder: 370,
    screens: ["/reports"],
  },
  {
    key: "whatsapp_broadcasts", module: "Customers", name: "WhatsApp & Broadcasts", description: "WhatsApp number, templates and customer broadcasts.",
    category: "customer_mgmt", tier: "free", active: true, sortOrder: 380,
    domains: ["whatsapp"], screens: ["/broadcasts", "/settings/whatsapp-number"],
  },
] as const satisfies readonly FeatureDef[];

export type FeatureKey = (typeof FEATURES)[number]["key"];

export const FEATURE_KEYS: readonly FeatureKey[] = FEATURES.map((f) => f.key);

const BY_KEY: ReadonlyMap<string, FeatureDef> = new Map(FEATURES.map((f) => [f.key, f]));

export function getFeatureDef(key: string): FeatureDef | undefined {
  return BY_KEY.get(key);
}

export function isFeatureKey(key: string): key is FeatureKey {
  return BY_KEY.has(key);
}

/** Free features are granted on every plan, including with an empty or missing catalog row. */
export const FREE_FEATURE_KEYS: readonly string[] = FEATURES.filter((f) => f.tier === "free").map((f) => f.key);

const patternCache = new Map<string, RegExp>();

/** "/a/:id" matches "/a/1" and everything below it; "/" matches only "/". Used for screens and admin-defined route rules. */
export function compilePathPattern(pattern: string): RegExp {
  return screenPattern(pattern);
}

function screenPattern(pattern: string): RegExp {
  let re = patternCache.get(pattern);
  if (!re) {
    const body = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:[A-Za-z0-9_]+/g, "[^/]+");
    re = pattern === "/" ? /^\/$/ : new RegExp(`^${body}(/.*)?$`);
    patternCache.set(pattern, re);
  }
  return re;
}

function bestScreenOwner(path: string, pick: (f: FeatureDef) => readonly string[] | undefined): string | null {
  const clean = path.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
  let best: { key: string; len: number } | null = null;
  for (const f of FEATURES as readonly FeatureDef[]) {
    for (const p of pick(f) ?? []) {
      if (screenPattern(p).test(clean) && (!best || p.length > best.len)) best = { key: f.key, len: p.length };
    }
  }
  return best?.key ?? null;
}

/** The feature that owns a client path, or null if nothing does. */
export function featureForScreen(path: string): string | null {
  return bestScreenOwner(path, (f) => f.screens);
}

/** The feature an org must hold to open this client path, or null if the page is not gated. */
export function gatedFeatureForScreen(path: string): string | null {
  return bestScreenOwner(path, (f) => f.gatedScreens);
}

export interface DerivedFeatureRule extends RouteRule {
  feature: string;
}

/** Route rules for every paid feature, flattened for the policy middleware. */
export const FEATURE_ROUTE_RULES: readonly DerivedFeatureRule[] = FEATURES.flatMap((f) =>
  ((f as FeatureDef).routes ?? []).map((r) => ({ ...r, feature: f.key })),
);

/** API domains (first path segment under /api) and the feature that owns each. */
export const API_DOMAIN_OWNERS: ReadonlyMap<string, string> = new Map(
  FEATURES.flatMap((f) => ((f as FeatureDef).domains ?? []).map((d) => [d, f.key] as const)),
);

/** Features that exist in the catalog but gate nothing yet. A test pins this list so it can only shrink. */
export const PENDING_GATE_KEYS: readonly string[] = FEATURES.filter((f) => !!(f as FeatureDef).pendingGate).map((f) => f.key);

/** Returns a list of human-readable problems; empty when the registry is internally consistent. */
export function validateRegistry(features: readonly FeatureDef[] = FEATURES): string[] {
  const problems: string[] = [];
  const keys = new Set<string>();
  const sortOrders = new Set<number>();
  const domainOwner = new Map<string, string>();

  for (const f of features) {
    if (!/^[a-z][a-z0-9_]*$/.test(f.key)) problems.push(`${f.key}: key must be lowercase snake_case`);
    if (keys.has(f.key)) problems.push(`${f.key}: duplicate key`);
    keys.add(f.key);
    if (sortOrders.has(f.sortOrder)) problems.push(`${f.key}: duplicate sortOrder ${f.sortOrder}`);
    sortOrders.add(f.sortOrder);

    if (!isPermissionModule(f.module)) problems.push(`${f.key}: unknown permission module "${f.module}"`);
    if (f.tier === "bundle_child" && !f.parent) problems.push(`${f.key}: bundle_child needs a parent`);
    if (f.tier !== "bundle_child" && f.parent) problems.push(`${f.key}: only bundle_child may set a parent`);
    if (f.tier === "paid_metered_limit" && (f.freeLimit === undefined || !f.limitType)) {
      problems.push(`${f.key}: paid_metered_limit needs freeLimit and limitType`);
    }
    if (f.tier === "free" && (f.price || f.routes?.length)) problems.push(`${f.key}: a free feature must not carry a price or route rules`);
    if ((f.tier === "paid_flat" || f.tier === "bundle_parent" || f.tier === "paid_metered_limit") && f.active && !f.price) {
      problems.push(`${f.key}: an active paid feature needs a default price`);
    }

    for (const d of f.domains ?? []) {
      const prev = domainOwner.get(d);
      if (prev) problems.push(`domain "${d}" is owned by both ${prev} and ${f.key}`);
      domainOwner.set(d, f.key);
    }
  }

  for (const f of features) {
    if (f.parent) {
      const parent = features.find((p) => p.key === f.parent);
      if (!parent) problems.push(`${f.key}: parent ${f.parent} is not in the registry`);
      else if (parent.tier !== "bundle_parent") problems.push(`${f.key}: parent ${f.parent} is not a bundle_parent`);
    }
    for (const dep of f.dependsOn ?? []) {
      if (!keys.has(dep)) problems.push(`${f.key}: depends on unknown feature ${dep}`);
    }
  }

  // Dependency cycles (DFS).
  const deps = new Map(features.map((f) => [f.key, f.dependsOn ?? []] as const));
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (key: string, trail: string[]): void => {
    if (done.has(key)) return;
    if (visiting.has(key)) {
      problems.push(`dependency cycle: ${[...trail, key].join(" -> ")}`);
      return;
    }
    visiting.add(key);
    for (const d of deps.get(key) ?? []) visit(d, [...trail, key]);
    visiting.delete(key);
    done.add(key);
  };
  for (const f of features) visit(f.key, []);

  return problems;
}
