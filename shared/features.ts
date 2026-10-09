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

type FeatureTier = "free" | "paid_flat" | "paid_metered_limit" | "bundle_parent" | "bundle_child";

type FeatureCategory =
  | "vendor_mgmt"
  | "staff_mgmt"
  | "customer_mgmt"
  | "financial_mgmt"
  | "tax_compliance"
  | "inventory_mgmt"
  | "analytics"
  | "business_settings";

/**
 * The four top-level groups of the product, as the business sees them. Every
 * feature sits in exactly one; `category` stays as the finer admin filter.
 */
export type FeatureSection = "management" | "sales" | "settings_business" | "settings_store";

export const FEATURE_SECTIONS: readonly FeatureSection[] = ["management", "sales", "settings_business", "settings_store"];

export const FEATURE_SECTION_LABELS: Record<FeatureSection, string> = {
  management: "Management",
  sales: "Sales",
  settings_business: "Settings - Business",
  settings_store: "Settings - Store",
};

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export const WRITE_METHODS: readonly HttpMethod[] = ["POST", "PUT", "PATCH", "DELETE"];

/** A request this feature must be entitled to before the route runs. */
interface RouteRule {
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
  /** Top-level product group this feature is listed under. */
  section: FeatureSection;
  /**
   * Where this feature nests in the product tree (e.g. Customer > Archive). Display
   * and grouping only: unlike `parent` it never grants anything. A free feature
   * nested under a paid one reads "free once the parent is paid": it is always
   * granted, and the parent's own gate decides whether the screen is reachable.
   */
  groupParent?: string;
  /** bundle_child only: key of the bundle_parent that grants this. */
  parent?: string;
  /**
   * bundle_parent only: features that used to be sold on their own and are now
   * children of this bundle. When the sync first creates the bundle it grants it to
   * every organisation holding one of them (same status, source and dates) and
   * retires the old rows, so nobody loses access or pays twice.
   */
  absorbs?: readonly string[];
  /** Purchase-time prerequisites (feature keys). */
  dependsOn?: readonly string[];
  /** paid_metered_limit only. */
  freeLimit?: number;
  limitType?: "staff_seats" | "customer_count" | "store_count" | "item_count";
  /**
   * paid_metered_limit only: the most this tier allows in total (not on top of freeLimit). Leave it off for the
   * unlimited tier. Tiers of one limitType are mutually exclusive: holding a bigger one replaces a smaller one.
   */
  tierCapacity?: number;
  /** Default price when the catalog row is first created; the DB owns it afterwards. */
  price?: { monthly: number; annual: number };
  /** Default is_active when the row is first created; the DB owns it afterwards. */
  active: boolean;
  /**
   * How the sync launches this feature when it first creates the row. "review" creates it inactive and
   * pending review: hidden and unpurchasable until a super admin prices and publishes it. "live" uses
   * `active` as written. Left off, a priced feature (paid, capped add-on, bundle) goes to review and a
   * free or bundled one goes live. A new parent whose children already exist in the database always goes
   * live (the sync enforces it), since hiding it would hide them. See launchesForReview.
   */
  launch?: "live" | "review";
  /**
   * Set on a paid feature that used to be free. When the sync first creates its
   * row it grants it (source 'grandfathered') to every organisation that exists
   * at that moment, so nobody loses a module they already use.
   */
  grandfather?: boolean;
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

/** Whether the sync creates this feature inactive and pending an admin's review. */
export function launchesForReview(def: Pick<FeatureDef, "launch" | "tier" | "active">): boolean {
  if (!def.active) return false; // already declared dark: nothing to review
  if (def.launch) return def.launch === "review";
  return def.tier === "paid_flat" || def.tier === "paid_metered_limit" || def.tier === "bundle_parent";
}

const w = WRITE_METHODS;

export const FEATURES = [
  // ─── Free core: vendors & purchasing ────────────────────────────────────
  {
    key: "purchase_management", section: "management", module: "Inventory & Catalog", name: "Purchase Order Management",
    description: "Vendors & Bills and Purchase Orders, sold as one bundle: a purchase order is raised against a vendor, so neither is useful without the other.",
    category: "vendor_mgmt", tier: "bundle_parent", active: true, sortOrder: 5,
    price: { monthly: 4500, annual: 45000 }, // REVIEW: placeholder price (the two former prices added together)
    // Organisations that already held either feature on its own get the bundle.
    absorbs: ["vendor_details", "purchase_order_tracking"],
    coveredBy: "Sold as a bundle; its vendor_details and purchase_order_tracking children own the routes and screens, so each can be switched off alone.",
    gatedScreens: ["/vendors", "/purchase-orders"],
  },
  {
    key: "vendor_details", section: "management", groupParent: "purchase_management", module: "Inventory & Catalog", name: "Vendors & Bills", description: "Included in the Purchase Order Management bundle. Vendor records, vendor bills and bill payments.",
    category: "vendor_mgmt", tier: "bundle_child", parent: "purchase_management", active: true, sortOrder: 10,
    coveredBy: "granted and gated through the purchase_management bundle parent; give it its own rule if it is ever sold alone",
    // Owns the page so switching this feature off hides /vendors; the paid gate stays on the parent's gatedScreens.
    screens: ["/vendors"],
    domains: ["vendors"],
    routes: [{ methods: w, path: /^\/api\/vendors(\/|$)/ }],
  },
  {
    key: "purchase_order_tracking", section: "management", groupParent: "purchase_management", module: "Inventory & Catalog", name: "Purchase Orders", description: "Included in the Purchase Order Management bundle. Create and track purchase orders to vendors.",
    category: "vendor_mgmt", tier: "bundle_child", parent: "purchase_management", active: true, sortOrder: 20,
    coveredBy: "granted and gated through the purchase_management bundle parent; give it its own rule if it is ever sold alone",
    // Owns the page so switching this feature off hides it; the paid gate stays on the bundle parent's gatedScreens.
    screens: ["/purchase-orders"],
    domains: ["purchase-orders"],
    routes: [{ methods: w, path: /^\/api\/purchase-orders(\/|$)/ }],
    // Hard dependency: its records reference the other feature's (NOT NULL foreign keys), so it cannot work without it.
    dependsOn: ["vendor_details"],
  },

  // ─── Free core: staff ──────────────────────────────────────────────────
  {
    key: "attendance_management", section: "management", groupParent: "staff_management", module: "Staff & Payroll", name: "Attendance Management (manager-recorded)", description: "Clock staff in and out on their behalf.",
    category: "staff_mgmt", tier: "free", active: true, sortOrder: 30,
    domains: ["attendance"], screens: ["/staff/attendance", "/staffs/attendance"],
    // Hard dependency: its records reference the other feature's (NOT NULL foreign keys), so it cannot work without it.
    dependsOn: ["staff_management"],
  },
  {
    key: "contract_management", section: "management", groupParent: "staff_management", module: "Staff & Payroll", name: "Contract Management", description: "Versioned staff contracts with e-signature.",
    category: "staff_mgmt", tier: "free", active: true, sortOrder: 40,
    domains: ["contract"],
  },

  // ─── Free core: sales & customers ──────────────────────────────────────
  {
    key: "sales_module", section: "sales", module: "Sales & Checkout", name: "Sales Module", description: "Core point-of-sale checkout.",
    category: "inventory_mgmt", tier: "free", active: true, sortOrder: 50,
    domains: ["sales", "transactions"], screens: ["/sales", "/transactions"],
    // Hard dependency: its records reference the other feature's (NOT NULL foreign keys), so it cannot work without it.
    dependsOn: ["customer_management", "staff_management", "inventory_management"],
  },
  {
    key: "customer_management", section: "management", module: "Customers", name: "Customer Management", description: "Customer records, up to the free tier limit.",
    category: "customer_mgmt", tier: "free", active: true, sortOrder: 60,
    domains: ["customers"], screens: ["/customers"],
  },
  {
    key: "customer_filters", section: "management", groupParent: "customer_management", module: "Customers", name: "Customer Filters", description: "Filter and segment the customer list.",
    category: "customer_mgmt", tier: "free", active: true, sortOrder: 70,
    coveredBy: "client-side filtering on the /customers page (client/src/pages/customers.tsx); free, no server enforcement needed",
  },
  {
    key: "promotions", section: "sales", module: "Sales & Checkout", name: "Promotions", description: "BOGO, spend-threshold, and percentage-discount campaigns.",
    category: "inventory_mgmt", tier: "paid_flat", grandfather: true, active: true, sortOrder: 80,
    price: { monthly: 2000, annual: 20000 }, // REVIEW: placeholder price
    domains: ["promotions"], routes: [{ methods: w, path: /^\/api\/promotions(\/|$)/ }],
    screens: ["/settings/promotions"], gatedScreens: ["/settings/promotions"],
  },
  {
    key: "staff_sales_visibility", section: "settings_business", groupParent: "business_profile", module: "Settings", name: "Staff Sales Visibility", description: "Choose whether Staff see only their own sales or every sale. Owners and managers always see all sales.",
    category: "business_settings", tier: "paid_flat",
    price: { monthly: 1000, annual: 10000 }, active: true, sortOrder: 90, // REVIEW: placeholder price
    inlineGate: "PATCH /api/business/:id when the body sets staffOwnTransactionsOnly: business.routes.ts; read side: transactionAccess.ts resolveTransactionScope",
  },

  // ─── Staff seats / self check-in / performance ─────────────────────────
  {
    key: "staff_seats_addon", section: "management", groupParent: "staff_management", module: "Staff & Payroll", name: "Additional Staff Seats", description: "Unlimited staff in every store beyond the 2 free per store. The owner never uses a seat.",
    category: "staff_mgmt", tier: "paid_metered_limit", freeLimit: 2, limitType: "staff_seats",
    price: { monthly: 2000, annual: 20000 }, active: true, sortOrder: 100,
    screens: ["/staffs/new"],
  },
  // Smaller seat packs, priced below the unlimited add-on so a team that has outgrown the free seats has a cheaper
  // first step than "unlimited". Placeholder prices: edit them in the Feature Catalog.
  {
    key: "staff_seats_5", section: "management", groupParent: "staff_management", module: "Staff & Payroll", name: "Staff Seats: up to 5", description: "Up to 5 staff per store. The owner never uses a seat.",
    category: "staff_mgmt", tier: "paid_metered_limit", freeLimit: 2, limitType: "staff_seats", tierCapacity: 5,
    price: { monthly: 1000, annual: 10000 }, active: true, sortOrder: 98, // REVIEW: placeholder price
    coveredBy: "Seat packs: capacity is resolved from the owned tiers in server/lib/entitlements.ts evaluateCountLimit.",
  },
  {
    key: "staff_seats_15", section: "management", groupParent: "staff_management", module: "Staff & Payroll", name: "Staff Seats: up to 15", description: "Up to 15 staff per store. The owner never uses a seat.",
    category: "staff_mgmt", tier: "paid_metered_limit", freeLimit: 2, limitType: "staff_seats", tierCapacity: 15,
    price: { monthly: 1500, annual: 15000 }, active: true, sortOrder: 99, // REVIEW: placeholder price
    coveredBy: "Seat packs: capacity is resolved from the owned tiers in server/lib/entitlements.ts evaluateCountLimit.",
  },
  {
    key: "self_check_in", section: "management", groupParent: "attendance_management", module: "Staff & Payroll", name: "Self Check-In", description: "Staff clock themselves in and out.",
    category: "staff_mgmt", tier: "paid_flat", dependsOn: ["attendance_management"],
    price: { monthly: 1500, annual: 15000 }, active: true, sortOrder: 110,
    // Manager-recorded /punch/proxy stays free.
    routes: [{ methods: ["POST"], path: /^\/api\/attendance\/punch$/ }],
  },
  {
    key: "staff_performance_tracking", section: "management", groupParent: "staff_management", module: "Staff & Payroll", name: "Staff Performance Tracking", description: "Per-staff performance reports.",
    category: "staff_mgmt", tier: "paid_flat",
    price: { monthly: 2500, annual: 25000 }, active: true, sortOrder: 120,
    routes: [{ methods: "*", path: /^\/api\/reports\/staff-performance(\/|$)/ }],
    screens: ["/staffs/performance"],
    gatedScreens: ["/staffs/performance"],
  },

  // ─── Customers ─────────────────────────────────────────────────────────
  {
    key: "customer_capacity_addon", section: "management", groupParent: "customer_management", module: "Customers", name: "Additional Customer Capacity", description: "Unlimited customers beyond the first 30 free.",
    category: "customer_mgmt", tier: "paid_metered_limit", freeLimit: 30, limitType: "customer_count",
    price: { monthly: 2000, annual: 20000 }, active: true, sortOrder: 130,
    screens: ["/customers/new"],
  },
  {
    key: "item_capacity_addon", section: "management", groupParent: "inventory_management", module: "Inventory & Catalog", name: "Additional Item Capacity", description: "Unlimited inventory items beyond the first 50 free.",
    category: "inventory_mgmt", tier: "paid_metered_limit", freeLimit: 50, limitType: "item_count",
    price: { monthly: 2000, annual: 20000 }, grandfather: true, active: true, sortOrder: 135, // REVIEW: placeholder price
    screens: ["/inventory/new"],
  },
  {
    key: "customer_analytics", section: "management", module: "Customers", name: "Customer Analytics",
    description: "Grouping for the paid customer analytics features: Customer Insights and Customer Analytics & Retention. Owns nothing itself.",
    category: "customer_mgmt", tier: "free", active: true, sortOrder: 139,
    coveredBy: "grouping header only: it grants and gates nothing; each child below is sold and gated on its own",
  },

  // ─── Financial Management bundle ───────────────────────────────────────
  {
    key: "financial_management", section: "management", module: "Expenses & Reports", name: "Financial Management", description: "P&L Statement, Expenses, and Hybrid/Commission Payroll, sold as one bundle.",
    category: "financial_mgmt", tier: "bundle_parent",
    price: { monthly: 7500, annual: 75000 }, active: true, sortOrder: 160,
    coveredBy: "Sold as a bundle; its pnl_statement and expenses_tracking children own the routes and screens, so each can be switched off alone.",
    gatedScreens: ["/profit-loss", "/expenses/new", "/expenses/categories", "/expenses/:id/edit"],
  },
  {
    key: "pnl_statement", section: "management", groupParent: "financial_management", module: "Expenses & Reports", name: "Profit & Loss Statement", description: "Included in the Financial Management bundle.",
    category: "financial_mgmt", tier: "bundle_child", parent: "financial_management", active: true, sortOrder: 161,
    coveredBy: "granted and gated through the financial_management bundle parent; give it its own rule if it is ever sold alone",
    // Owns the page so switching this feature off hides it; the paid gate stays on the bundle parent's gatedScreens.
    screens: ["/profit-loss"],
    domains: ["profit-loss"],
    routes: [{ methods: "*", path: /^\/api\/profit-loss(\/|$)/ }],
  },
  {
    key: "expenses_tracking", section: "management", groupParent: "financial_management", module: "Expenses & Reports", name: "Expenses", description: "Included in the Financial Management bundle.",
    category: "financial_mgmt", tier: "bundle_child", parent: "financial_management", active: true, sortOrder: 162,
    coveredBy: "granted and gated through the financial_management bundle parent; give it its own rule if it is ever sold alone",
    // Owns the page so switching this feature off hides it; the paid gate stays on the bundle parent's gatedScreens.
    screens: ["/expenses"],
    domains: ["expenses", "expense-categories"],
    routes: [
      { methods: w, path: /^\/api\/expenses(\/|$)/ },
      { methods: w, path: /^\/api\/expense-categories(\/|$)/ },
    ],
  },
  {
    key: "payroll_hybrid_commission", section: "management", groupParent: "staff_management", module: "Staff & Payroll", name: "Payroll - Hybrid & Commission", description: "Included in the Financial Management bundle. Fixed-pay payroll stays free.",
    category: "financial_mgmt", tier: "bundle_child", parent: "financial_management", active: true, sortOrder: 163,
    inlineGate: "POST /api/payroll/periods/:id/calculate when the store has hybrid/commission staff: payroll.routes.ts, hasFeature(\"payroll_hybrid_commission\")",
  },

  // ─── Inventory & sales add-ons ─────────────────────────────────────────
  {
    key: "product_variants", section: "management", groupParent: "inventory_management", module: "Inventory & Catalog", name: "Product Variants", description: "Size/color/style variants per product.",
    category: "inventory_mgmt", tier: "paid_flat",
    price: { monthly: 1500, annual: 15000 }, active: true, sortOrder: 180,
    routes: [{ methods: ["POST"], path: /^\/api\/products\/[^/]+\/variants(\/|$)/ }],
  },
  {
    key: "sell_in_parts", section: "management", groupParent: "inventory_management", module: "Inventory & Catalog", name: "Sell In Parts", description: "Sell items in fractional quantities (for example by the metre or kilo).",
    category: "inventory_mgmt", tier: "paid_flat",
    price: { monthly: 1000, annual: 10000 }, active: true, sortOrder: 190, // REVIEW: placeholder price
    inlineGate: "POST/PATCH /api/inventory when the body sets allowFractional: inventory.routes.ts, hasFeature(\"sell_in_parts\"); existing fractional items keep selling",
  },
  {
    key: "receipts", section: "settings_store", groupParent: "store_details", module: "Sales & Checkout", name: "Receipts", description: "Custom receipt output beyond the default.",
    category: "inventory_mgmt", tier: "free", active: false, sortOrder: 200,
    coveredBy: "decided free: receipts have no endpoint or screen of their own; inactive so it is not offered in the catalog",
  },
  {
    key: "low_stock_threshold", section: "management", groupParent: "inventory_management", module: "Inventory & Catalog", name: "Low Stock Threshold & Reminders", description: "Configurable reorder points and alerts.",
    category: "inventory_mgmt", tier: "paid_flat",
    price: { monthly: 1000, annual: 10000 }, active: true, sortOrder: 210,
    routes: [{ methods: w, path: /^\/api\/settings\/stock$/ }],
    inlineGate: "PUT /api/settings when the body sets lowStockThreshold: settings.routes.ts GATED_SETTINGS_FIELDS (the legacy whole-settings endpoint; the Stock tab uses PUT /api/settings/stock)",
  },
  {
    key: "credit_sale", section: "sales", module: "Sales & Checkout", name: "Credit Sale", description: "Checkout a sale as credit against a customer.",
    category: "inventory_mgmt", tier: "paid_flat", dependsOn: ["sales_module", "customer_management"],
    price: { monthly: 2000, annual: 20000 }, active: true, sortOrder: 220,
    inlineGate: "POST /api/sales with a credit tender: sales.routes.ts, getRequestEntitlements(...).has(\"credit_sale\")",
    routes: [{ methods: w, path: /^\/api\/credit\/entries(\/|$)/ }],
    screens: ["/credit-sales", "/settings/credit-sales"], gatedScreens: ["/credit-sales", "/settings/credit-sales"],
  },
  {
    key: "credit_recall_reminders", section: "settings_store", groupParent: "credit_sale", module: "Sales & Checkout", name: "Credit Recall Reminders", description: "Automated reminders for outstanding credit.",
    category: "inventory_mgmt", tier: "paid_flat", dependsOn: ["credit_sale"],
    price: { monthly: 1000, annual: 10000 }, active: true, sortOrder: 230,
    routes: [{ methods: w, path: /^\/api\/credit\/entries\/[^/]+\/reminders(\/|$)/ }],
  },

  // ─── Business settings ─────────────────────────────────────────────────
  {
    key: "store_addon", section: "settings_business", groupParent: "stores_management", module: "Settings", name: "Additional Store / Branch", description: "Open more stores beyond the first, with Stock Transfers and Staff Transfers included to move stock and people between them.",
    category: "business_settings", tier: "paid_metered_limit", freeLimit: 1, limitType: "store_count",
    price: { monthly: 5000, annual: 50000 }, active: true, sortOrder: 250,
    screens: ["/settings/stores/new"],
  },
  // Store packs: cheaper steps below "unlimited". Every pack carries Stock Transfers and Staff Transfers (the children
  // above), since moving stock and people only makes sense with more than one store. Placeholder prices.
  {
    key: "store_pack_3", section: "settings_business", groupParent: "stores_management", module: "Settings", name: "Stores: up to 3", description: "Up to 3 stores in total, with Stock Transfers and Staff Transfers included.",
    category: "business_settings", tier: "paid_metered_limit", freeLimit: 1, limitType: "store_count", tierCapacity: 3,
    price: { monthly: 2500, annual: 25000 }, active: true, sortOrder: 248, // REVIEW: placeholder price
    coveredBy: "Store packs: capacity is resolved from the owned tiers in server/lib/entitlements.ts evaluateCountLimit; children come from the store_addon tier's group.",
  },
  {
    key: "store_pack_10", section: "settings_business", groupParent: "stores_management", module: "Settings", name: "Stores: up to 10", description: "Up to 10 stores in total, with Stock Transfers and Staff Transfers included.",
    category: "business_settings", tier: "paid_metered_limit", freeLimit: 1, limitType: "store_count", tierCapacity: 10,
    price: { monthly: 4000, annual: 40000 }, active: true, sortOrder: 249, // REVIEW: placeholder price
    coveredBy: "Store packs: capacity is resolved from the owned tiers in server/lib/entitlements.ts evaluateCountLimit; children come from the store_addon tier's group.",
  },
  {
    key: "receipt_customization", section: "settings_store", groupParent: "receipts", module: "Settings", name: "Custom Receipt Prefix + Thank-You Note", description: "Currently free and in active use - see the sunset-notice mechanism before paywalling.",
    category: "business_settings", tier: "paid_flat",
    price: { monthly: 1500, annual: 15000 }, active: true, sortOrder: 260,
    routes: [{ methods: w, path: /^\/api\/settings\/receipts$/ }],
    inlineGate: "PUT /api/settings when the body sets receiptPrefix or receiptThankYouMessage: settings.routes.ts GATED_SETTINGS_FIELDS. Grandfathered orgs keep it; schedule a sunset from the catalog page before removing that",
  },
  {
    key: "loyalty_program", section: "settings_store", groupParent: "store_details", module: "Customers", name: "Loyalty Point Configuration", description: "Currently free and in active use - see the sunset-notice mechanism before paywalling.",
    category: "business_settings", tier: "paid_flat",
    price: { monthly: 1500, annual: 15000 }, active: true, sortOrder: 270,
    routes: [{ methods: w, path: /^\/api\/settings\/loyalty$/ }],
    inlineGate: "PUT /api/settings when the body sets loyaltyPointsPerCurrency or loyaltyPointValue: settings.routes.ts GATED_SETTINGS_FIELDS. Grandfathered orgs keep it; schedule a sunset from the catalog page before removing that",
  },
  {
    key: "custom_roles_permissions", section: "settings_business", groupParent: "roles_management", module: "Settings", name: "Custom Roles & Permissions", description: "Currently free and in active use - see the sunset-notice mechanism before paywalling.",
    category: "business_settings", tier: "paid_flat",
    price: { monthly: 1500, annual: 15000 }, active: true, sortOrder: 280,
    domains: ["custom-roles"],
    routes: [{ methods: w, path: /^\/api\/custom-roles(\/|$)/ }],
    screens: ["/settings/roles/new", "/settings/roles/:id/edit"],
    gatedScreens: ["/settings/roles/new", "/settings/roles/:id/edit"],
  },

  // ─── FRS modules carved out of formerly-free domains (grandfathered) ───
  {
    key: "quotes_management", section: "sales", module: "Sales & Checkout", name: "Quotes", description: "Quotes with validity dates, convertible to sales or credit sales.",
    category: "customer_mgmt", tier: "paid_flat", grandfather: true, active: true, sortOrder: 400,
    price: { monthly: 2000, annual: 20000 }, // REVIEW: placeholder price
    domains: ["quotes"], routes: [{ methods: w, path: /^\/api\/quotes(\/|$)/ }],
    screens: ["/quotes"], gatedScreens: ["/quotes"],
  },
  {
    key: "tax_management", section: "sales", module: "Sales & Checkout", name: "Taxes", description: "Tax rates applied per store, inclusive or exclusive.",
    category: "tax_compliance", tier: "paid_flat", grandfather: true, active: true, sortOrder: 410,
    price: { monthly: 1500, annual: 15000 }, // REVIEW: placeholder price
    domains: ["tax-rates"], routes: [{ methods: w, path: /^\/api\/tax-rates(\/|$)/ }],
    screens: ["/settings/taxes"], gatedScreens: ["/settings/taxes"],
  },
  {
    key: "stock_transfer", section: "management", module: "Inventory & Catalog", name: "Stock Transfers", description: "Included with Additional Store. Move stock between your stores.",
    category: "inventory_mgmt", tier: "bundle_child", parent: "store_addon", active: true, sortOrder: 420,
    coveredBy: "granted and gated through the store_addon parent; its routes and screen below are gated on this key",
    domains: ["stock-transfers", "stock-transfer-drafts"],
    routes: [{ methods: w, path: /^\/api\/stock-transfers?(-drafts)?(\/|$)/ }],
    screens: ["/stock-transfers"], gatedScreens: ["/stock-transfers"],
  },
  {
    key: "partner_transfers", section: "management", groupParent: "inventory_management", module: "Inventory & Catalog", name: "Partner Transfers", description: "Share stock with partner businesses on the platform and keep track of what is owed, in money or in goods.",
    category: "inventory_mgmt", tier: "free", active: true, sortOrder: 425,
    // Free on purpose: every partner a business brings in is another business on the platform.
    domains: ["partners", "partner-transfers", "partner-ledger"],
    screens: ["/partners", "/partners/transfers/new", "/partners/transfers/:id", "/partners/ledger"],
    dependsOn: ["inventory_management"],
  },
  {
    key: "inventory_audit", section: "management", groupParent: "inventory_management", module: "Inventory & Catalog", name: "Stock Audit", description: "Stock counts with a variance report.",
    category: "inventory_mgmt", tier: "paid_flat", grandfather: true, active: true, sortOrder: 430,
    price: { monthly: 1500, annual: 15000 }, // REVIEW: placeholder price
    domains: ["stock-audits"], routes: [{ methods: w, path: /^\/api\/stock-audits(\/|$)/ }],
    screens: ["/inventory/audits"], gatedScreens: ["/inventory/audits"],
  },
  {
    key: "inventory_drafts", section: "management", groupParent: "inventory_management", module: "Inventory & Catalog", name: "Draft Inventory", description: "Save inventory as a draft before publishing it to checkout.",
    category: "inventory_mgmt", tier: "paid_flat", grandfather: true, active: true, sortOrder: 440,
    price: { monthly: 1000, annual: 10000 }, // REVIEW: placeholder price
    domains: ["inventory-drafts"], routes: [{ methods: w, path: /^\/api\/inventory-drafts(\/|$)/ }],
  },
  {
    key: "inventory_archive_delete", section: "management", groupParent: "inventory_management", module: "Inventory & Catalog", name: "Archive & Delete Items", description: "Archive or delete inventory items.",
    category: "inventory_mgmt", tier: "paid_flat", grandfather: true, active: true, sortOrder: 450,
    price: { monthly: 1000, annual: 10000 }, // REVIEW: placeholder price
    routes: [
      { methods: ["DELETE"], path: /^\/api\/inventory\/[^/]+$/ },
      { methods: ["POST"], path: /^\/api\/inventory\/[^/]+\/archive$/ },
      // Write-off can archive in the same step, so it sits behind the same gate as archiving.
      { methods: ["POST"], path: /^\/api\/inventory\/[^/]+\/write-off$/ },
    ],
  },
  {
    key: "sale_drafts", section: "sales", groupParent: "sales_module", module: "Sales & Checkout", name: "Draft Sales", description: "Save a sale as a draft and resume it later.",
    category: "inventory_mgmt", tier: "paid_flat", grandfather: true, active: true, sortOrder: 460,
    price: { monthly: 1000, annual: 10000 }, // REVIEW: placeholder price
    routes: [{ methods: w, path: /^\/api\/sales\/drafts(\/|$)/ }],
  },
  {
    key: "customer_archive", section: "management", groupParent: "customer_management", module: "Customers", name: "Archive Customers", description: "Archive and restore customers; archived customers don't count toward the cap.",
    category: "customer_mgmt", tier: "paid_flat", grandfather: true, active: true, sortOrder: 470,
    price: { monthly: 1000, annual: 10000 }, // REVIEW: placeholder price
    routes: [
      { methods: ["DELETE"], path: /^\/api\/customers\/[^/]+(\/permanent)?$/ },
      { methods: ["POST"], path: /^\/api\/customers\/[^/]+\/restore$/ },
    ],
  },
  {
    key: "customer_insights", section: "management", groupParent: "customer_analytics", module: "Customers", name: "Customer Insights", description: "Spend, visit frequency, last visit and top items per customer.",
    category: "customer_mgmt", tier: "paid_flat", grandfather: true, active: true, sortOrder: 480,
    price: { monthly: 2000, annual: 20000 }, // REVIEW: placeholder price
    screens: ["/customers/insights"], gatedScreens: ["/customers/insights"],
  },
  {
    key: "leaderboards", section: "management", module: "Dashboard", name: "Leaderboards", description: "Staff, customer and sales leaderboards with loyalty achievements.",
    category: "analytics", tier: "paid_flat", grandfather: true, active: true, sortOrder: 490,
    price: { monthly: 1500, annual: 15000 }, // REVIEW: placeholder price
    domains: ["gamification"], routes: [{ methods: ["GET"], path: /^\/api\/gamification\/leaderboard(\/|$)/ }],
    screens: ["/leaderboard"], gatedScreens: ["/leaderboard"],
  },
  {
    key: "staff_hr_archive", section: "management", groupParent: "staff_management", module: "Staff & Payroll", name: "HR Profiles & Staff Archive", description: "HR profile records and archiving staff (archived staff cannot log in).",
    category: "staff_mgmt", tier: "paid_flat", grandfather: true, active: true, sortOrder: 500,
    price: { monthly: 2000, annual: 20000 }, // REVIEW: placeholder price
    domains: ["hr"],
    routes: [
      // Guarantor links belong to onboarding (free); everything else under /hr is the HR profile.
      { methods: w, path: /^\/api\/hr\/(?!.*guarantor)/ },
      { methods: ["DELETE"], path: /^\/api\/staff\/[^/]+$/ },
      { methods: ["POST"], path: /^\/api\/staff\/[^/]+\/restore$/ },
    ],
    screens: ["/staffs/:id/hr-profile", "/settings/hr-profiles"], gatedScreens: ["/staffs/:id/hr-profile", "/settings/hr-profiles"],
    // Hard dependency: its records reference the other feature's (NOT NULL foreign keys), so it cannot work without it.
    dependsOn: ["staff_management"],
  },
  {
    key: "staff_transfer", section: "management", groupParent: "staff_management", module: "Staff & Payroll", name: "Transfer Staff Between Stores", description: "Included with Additional Store. Move a staff member to another store.",
    category: "staff_mgmt", tier: "bundle_child", parent: "store_addon", active: true, sortOrder: 510,
    routes: [{ methods: ["POST"], path: /^\/api\/staff\/[^/]+\/transfer$/ }],
  },
  {
    key: "payment_collection", section: "settings_store", module: "Settings", name: "Payment Collection", description: "Settlement account and online payment collection.",
    category: "business_settings", tier: "paid_flat", grandfather: true, active: true, sortOrder: 520,
    price: { monthly: 2000, annual: 20000 }, // REVIEW: placeholder price
    screens: ["/settings/payment-integrations"], gatedScreens: ["/settings/payment-integrations"],
  },
  {
    key: "capital_assets", section: "settings_store", module: "Settings", name: "Capital & Assets", description: "Capital and fixed-assets register with depreciation.",
    category: "business_settings", tier: "paid_flat", grandfather: true, active: true, sortOrder: 530,
    price: { monthly: 1500, annual: 15000 }, // REVIEW: placeholder price
    screens: ["/settings/capital-assets"], gatedScreens: ["/settings/capital-assets"],
  },

  // ─── Free core domains that previously had no feature of their own ─────
  {
    key: "core_platform", section: "management", module: "Dashboard", name: "Core Platform", description: "Sign-in, billing, support, notifications, stores and business settings. Always available.",
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
    key: "inventory_management", section: "management", module: "Inventory & Catalog", name: "Inventory Management", description: "Products, stock and consumables.",
    category: "inventory_mgmt", tier: "free", active: true, sortOrder: 310,
    domains: ["inventory", "products", "orders"],
    screens: ["/inventory"],
  },
  {
    key: "booking_management", section: "sales", module: "Customers", name: "Bookings", description: "Appointments and bookings, including the customer-facing booking link.",
    category: "customer_mgmt", tier: "paid_flat", grandfather: true, active: true, sortOrder: 320,
    price: { monthly: 3000, annual: 30000 }, // REVIEW: placeholder price
    // The customer-facing /my-booking link stays open so existing customers can still manage a booking.
    domains: ["bookings", "my-booking"], routes: [{ methods: w, path: /^\/api\/bookings(\/|$)/ }],
    screens: ["/bookings", "/my-booking"], gatedScreens: ["/bookings"],
    // Hard dependency: its records reference the other feature's (NOT NULL foreign keys), so it cannot work without it.
    dependsOn: ["customer_management"],
  },
  {
    key: "staff_management", section: "management", module: "Staff & Payroll", name: "Staff Management", description: "Staff records, guarantors and contracts.",
    category: "staff_mgmt", tier: "free", active: true, sortOrder: 330,
    domains: ["staff", "guarantor"],
    screens: ["/staff", "/staffs"],
  },
  {
    key: "payroll_fixed", section: "management", groupParent: "staff_management", module: "Staff & Payroll", name: "Payroll (fixed pay)", description: "Fixed-pay payroll periods, advances and payslips.",
    category: "financial_mgmt", tier: "free", active: true, sortOrder: 340,
    domains: ["payroll"], screens: ["/payroll"],
    // Hard dependency: its records reference the other feature's (NOT NULL foreign keys), so it cannot work without it.
    dependsOn: ["staff_management"],
  },
  {
    key: "accounting_ledger", section: "management", module: "Expenses & Reports", name: "Accounting & Cash Register", description: "Ledger, balance sheet and the cash register.",
    category: "financial_mgmt", tier: "free", active: true, sortOrder: 350,
    domains: ["accounting", "cash-register"], screens: ["/reports/balance-sheet"],
  },
  {
    key: "analytics_explorer", section: "management", module: "Expenses & Reports", name: "Analytics Explorer", description: "Self-serve analytics, saved views and dashboards.",
    category: "analytics", tier: "free", active: true, sortOrder: 360,
    domains: ["analytics"], screens: ["/analytics"],
  },
  {
    key: "reports_basic", section: "management", module: "Expenses & Reports", name: "Reports", description: "Standard business reports.",
    category: "analytics", tier: "free", active: true, sortOrder: 370,
    screens: ["/reports"],
  },
  {
    key: "whatsapp_broadcasts", section: "sales", module: "Customers", name: "WhatsApp & Broadcasts", description: "WhatsApp number, templates and customer broadcasts.",
    category: "customer_mgmt", tier: "paid_flat", grandfather: true, active: true, sortOrder: 380,
    price: { monthly: 2500, annual: 25000 }, // REVIEW: placeholder price
    domains: ["whatsapp"], routes: [{ methods: w, path: /^\/api\/whatsapp\/(broadcasts|templates)(\/|$)/ }],
    screens: ["/broadcasts", "/settings/whatsapp-number"], gatedScreens: ["/broadcasts"],
    // Hard dependency: its records reference the other feature's (NOT NULL foreign keys), so it cannot work without it.
    dependsOn: ["customer_management"],
  },

  // ─── Product tree: every screen and action (section + groupParent) ──────
  {
    key: "dashboard_views", module: "Dashboard", section: "management", groupParent: "core_platform", name: "Business & Personal Dashboard", description: "Managers and owners see both the Business and Personal dashboard views.",
    category: "business_settings", tier: "free", active: true, sortOrder: 600,
    coveredBy: "Enforced through core_platform; this flag is the admin kill-switch for the business & personal dashboard action.",
  },
  {
    key: "dashboard_new_sale", module: "Dashboard", section: "management", groupParent: "core_platform", name: "Dashboard: New Sale Shortcut", description: "Start a new sale straight from the dashboard.",
    category: "business_settings", tier: "free", active: true, sortOrder: 601,
    coveredBy: "Enforced through core_platform; this flag is the admin kill-switch for the dashboard: new sale shortcut action.",
  },
  {
    key: "customer_list", module: "Customers", section: "management", groupParent: "customer_management", name: "Customer List", description: "Browse and search the customer list.",
    category: "customer_mgmt", tier: "free", active: true, sortOrder: 602,
    coveredBy: "Enforced through customer_management; this flag is the admin kill-switch for the customer list action.",
  },
  {
    key: "customer_add", module: "Customers", section: "management", groupParent: "customer_management", name: "Add Customer", description: "Create a new customer (subject to the free customer cap).",
    category: "customer_mgmt", tier: "free", active: true, sortOrder: 603,
    coveredBy: "Enforced through customer_management; this flag is the admin kill-switch for the add customer action.",
  },
  {
    key: "customer_edit", module: "Customers", section: "management", groupParent: "customer_management", name: "Edit Customer", description: "Edit a customer from the list or the details page.",
    category: "customer_mgmt", tier: "free", active: true, sortOrder: 604,
    coveredBy: "Enforced through customer_management; this flag is the admin kill-switch for the edit customer action.",
  },
  {
    key: "customer_bulk_ops", module: "Customers", section: "management", groupParent: "customer_management", name: "Customer Bulk Operations", description: "Bulk actions on the customer list.",
    category: "customer_mgmt", tier: "free", active: true, sortOrder: 605,
    coveredBy: "Enforced through customer_management; this flag is the admin kill-switch for the customer bulk operations action.",
  },
  {
    key: "customer_activity_credit", module: "Sales & Checkout", section: "management", groupParent: "credit_sale", name: "Customer Credit Activity", description: "A customer's credit history; included once Credit Sale is paid.",
    category: "inventory_mgmt", tier: "free", active: true, sortOrder: 606,
    coveredBy: "Enforced through credit_sale; this flag is the admin kill-switch for the customer credit activity action.",
  },
  {
    key: "customer_activity_bookings", module: "Customers", section: "management", groupParent: "booking_management", name: "Customer Booking Activity", description: "A customer's bookings and alerts; included once Bookings is paid.",
    category: "customer_mgmt", tier: "free", active: true, sortOrder: 607,
    coveredBy: "Enforced through booking_management; this flag is the admin kill-switch for the customer booking activity action.",
  },
  {
    key: "customer_activity_transactions", module: "Customers", section: "management", groupParent: "customer_management", name: "Customer Transaction Activity", description: "A customer's transaction history on the customer details page.",
    category: "customer_mgmt", tier: "free", active: true, sortOrder: 608,
    coveredBy: "Enforced through customer_management; this flag is the admin kill-switch for the customer transaction activity action.",
  },
  {
    key: "staff_list", module: "Staff & Payroll", section: "management", groupParent: "staff_management", name: "Staff List", description: "Browse the staff list.",
    category: "staff_mgmt", tier: "free", active: true, sortOrder: 609,
    coveredBy: "Enforced through staff_management; this flag is the admin kill-switch for the staff list action.",
  },
  {
    key: "staff_add", module: "Staff & Payroll", section: "management", groupParent: "staff_management", name: "Add Staff", description: "Invite a new staff member (subject to the free seat cap).",
    category: "staff_mgmt", tier: "free", active: true, sortOrder: 610,
    coveredBy: "Enforced through staff_management; this flag is the admin kill-switch for the add staff action.",
  },
  {
    key: "staff_edit", module: "Staff & Payroll", section: "management", groupParent: "staff_management", name: "Edit Staff", description: "Edit a staff member from the list or the details page.",
    category: "staff_mgmt", tier: "free", active: true, sortOrder: 611,
    coveredBy: "Enforced through staff_management; this flag is the admin kill-switch for the edit staff action.",
  },
  {
    key: "staff_bulk_ops", module: "Staff & Payroll", section: "management", groupParent: "staff_management", name: "Staff Bulk Operations", description: "Bulk actions on the staff list.",
    category: "staff_mgmt", tier: "free", active: true, sortOrder: 612,
    coveredBy: "Enforced through staff_management; this flag is the admin kill-switch for the staff bulk operations action.",
  },
  {
    key: "staff_activity_attendance", module: "Staff & Payroll", section: "management", groupParent: "attendance_management", name: "Staff Attendance Activity", description: "A staff member's attendance log.",
    category: "staff_mgmt", tier: "free", active: true, sortOrder: 613,
    coveredBy: "Enforced through attendance_management; this flag is the admin kill-switch for the staff attendance activity action.",
  },
  {
    key: "staff_activity_performance", module: "Staff & Payroll", section: "management", groupParent: "staff_performance_tracking", name: "Staff Performance Activity", description: "A staff member's performance log; included once Staff Performance Tracking is paid.",
    category: "staff_mgmt", tier: "free", active: true, sortOrder: 614,
    coveredBy: "Enforced through staff_performance_tracking; this flag is the admin kill-switch for the staff performance activity action.",
  },
  {
    key: "staff_activity_payroll", module: "Staff & Payroll", section: "management", groupParent: "payroll_hybrid_commission", name: "Staff Payroll Activity", description: "A staff member's payroll log (commission and hybrid pay come with Financial Management).",
    category: "staff_mgmt", tier: "free", active: true, sortOrder: 615,
    coveredBy: "Enforced through payroll_hybrid_commission; this flag is the admin kill-switch for the staff payroll activity action.",
  },
  {
    key: "staff_leaderboard", module: "Dashboard", section: "management", groupParent: "leaderboards", name: "Staff Leaderboard", description: "Staff leaderboard and achievements; included once Leaderboards is paid.",
    category: "analytics", tier: "free", active: true, sortOrder: 616,
    coveredBy: "Enforced through leaderboards; this flag is the admin kill-switch for the staff leaderboard action.",
  },
  {
    key: "inventory_item_list", module: "Inventory & Catalog", section: "management", groupParent: "inventory_management", name: "Inventory Item List", description: "Browse the item list.",
    category: "inventory_mgmt", tier: "free", active: true, sortOrder: 617,
    coveredBy: "Enforced through inventory_management; this flag is the admin kill-switch for the inventory item list action.",
  },
  {
    key: "inventory_add_item", module: "Inventory & Catalog", section: "management", groupParent: "inventory_management", name: "Add Item (no variants)", description: "Create a simple item without variants.",
    category: "inventory_mgmt", tier: "free", active: true, sortOrder: 618,
    coveredBy: "Enforced through inventory_management; this flag is the admin kill-switch for the add item (no variants) action.",
  },
  {
    key: "inventory_edit_item", module: "Inventory & Catalog", section: "management", groupParent: "inventory_management", name: "Edit Item", description: "Edit an item from the list.",
    category: "inventory_mgmt", tier: "free", active: true, sortOrder: 619,
    coveredBy: "Enforced through inventory_management; this flag is the admin kill-switch for the edit item action.",
  },
  {
    key: "inventory_activity_history", module: "Inventory & Catalog", section: "management", groupParent: "inventory_management", name: "Inventory Activity History", description: "Stock movement history.",
    category: "inventory_mgmt", tier: "free", active: true, sortOrder: 620,
    coveredBy: "Enforced through inventory_management; this flag is the admin kill-switch for the inventory activity history action.",
  },
  {
    key: "inventory_bulk_ops", module: "Inventory & Catalog", section: "management", groupParent: "inventory_management", name: "Inventory Bulk Operations", description: "Bulk actions on the item list.",
    category: "inventory_mgmt", tier: "free", active: true, sortOrder: 621,
    coveredBy: "Enforced through inventory_management; this flag is the admin kill-switch for the inventory bulk operations action.",
  },
  {
    key: "inventory_low_stock_count", module: "Inventory & Catalog", section: "management", groupParent: "inventory_management", name: "Low Stock Item Count", description: "Count of items below their reorder point.",
    category: "inventory_mgmt", tier: "free", active: true, sortOrder: 622,
    coveredBy: "Enforced through inventory_management; this flag is the admin kill-switch for the low stock item count action.",
  },
  {
    key: "stock_transfer_list", module: "Inventory & Catalog", section: "management", groupParent: "stock_transfer", name: "Stock Transfer List", description: "Browse transfers; included once Stock Transfers is paid.",
    category: "inventory_mgmt", tier: "free", active: true, sortOrder: 623,
    coveredBy: "Enforced through stock_transfer; this flag is the admin kill-switch for the stock transfer list action.",
  },
  {
    key: "stock_transfer_create", module: "Inventory & Catalog", section: "management", groupParent: "stock_transfer", name: "Create Stock Transfer Request", description: "Request a transfer; included once Stock Transfers is paid.",
    category: "inventory_mgmt", tier: "free", active: true, sortOrder: 624,
    coveredBy: "Enforced through stock_transfer; this flag is the admin kill-switch for the create stock transfer request action.",
  },
  {
    key: "stock_transfer_bulk_ops", module: "Inventory & Catalog", section: "management", groupParent: "stock_transfer", name: "Stock Transfer Bulk Operations", description: "Bulk actions on transfers.",
    category: "inventory_mgmt", tier: "free", active: true, sortOrder: 625,
    coveredBy: "Enforced through stock_transfer; this flag is the admin kill-switch for the stock transfer bulk operations action.",
  },
  {
    key: "purchase_order_list", module: "Inventory & Catalog", section: "management", groupParent: "purchase_order_tracking", name: "Purchase Order List", description: "Browse purchase orders; included once Purchase Orders is paid.",
    category: "vendor_mgmt", tier: "free", active: true, sortOrder: 626,
    coveredBy: "Enforced through purchase_order_tracking; this flag is the admin kill-switch for the purchase order list action.",
  },
  {
    key: "purchase_order_create", module: "Inventory & Catalog", section: "management", groupParent: "purchase_order_tracking", name: "Create Purchase Order", description: "Raise a purchase order; included once Purchase Orders is paid.",
    category: "vendor_mgmt", tier: "free", active: true, sortOrder: 627,
    coveredBy: "Enforced through purchase_order_tracking; this flag is the admin kill-switch for the create purchase order action.",
  },
  {
    key: "purchase_order_bulk_ops", module: "Inventory & Catalog", section: "management", groupParent: "purchase_order_tracking", name: "Purchase Order Bulk Operations", description: "Bulk actions on purchase orders.",
    category: "vendor_mgmt", tier: "free", active: true, sortOrder: 628,
    coveredBy: "Enforced through purchase_order_tracking; this flag is the admin kill-switch for the purchase order bulk operations action.",
  },
  {
    key: "vendor_list", module: "Inventory & Catalog", section: "management", groupParent: "vendor_details", name: "Vendor List", description: "Browse vendors; included once Vendors & Bills is paid.",
    category: "vendor_mgmt", tier: "free", active: true, sortOrder: 629,
    coveredBy: "Enforced through vendor_details; this flag is the admin kill-switch for the vendor list action.",
  },
  {
    key: "vendor_edit_archive", module: "Inventory & Catalog", section: "management", groupParent: "vendor_details", name: "Edit & Archive Vendor", description: "Edit or archive a vendor; included once Vendors & Bills is paid.",
    category: "vendor_mgmt", tier: "free", active: true, sortOrder: 630,
    coveredBy: "Enforced through vendor_details; this flag is the admin kill-switch for the edit & archive vendor action.",
  },
  {
    key: "vendor_bill_add", module: "Inventory & Catalog", section: "management", groupParent: "vendor_details", name: "Add Vendor Bill", description: "Record a vendor bill; included once Vendors & Bills is paid.",
    category: "vendor_mgmt", tier: "free", active: true, sortOrder: 631,
    coveredBy: "Enforced through vendor_details; this flag is the admin kill-switch for the add vendor bill action.",
  },
  {
    key: "vendor_bill_payment", module: "Inventory & Catalog", section: "management", groupParent: "vendor_details", name: "Record Vendor Bill Payment", description: "Pay a vendor bill; included once Vendors & Bills is paid.",
    category: "vendor_mgmt", tier: "free", active: true, sortOrder: 632,
    coveredBy: "Enforced through vendor_details; this flag is the admin kill-switch for the record vendor bill payment action.",
  },
  {
    key: "vendor_bulk_ops", module: "Inventory & Catalog", section: "management", groupParent: "vendor_details", name: "Vendor Bulk Operations", description: "Bulk actions on vendors.",
    category: "vendor_mgmt", tier: "free", active: true, sortOrder: 633,
    coveredBy: "Enforced through vendor_details; this flag is the admin kill-switch for the vendor bulk operations action.",
  },
  {
    key: "sale_complete", module: "Sales & Checkout", section: "sales", groupParent: "sales_module", name: "Complete Sale", description: "Finish a sale at checkout.",
    category: "inventory_mgmt", tier: "free", active: true, sortOrder: 634,
    coveredBy: "Enforced through sales_module; this flag is the admin kill-switch for the complete sale action.",
  },
  {
    key: "transactions", module: "Sales & Checkout", section: "sales", name: "Transactions", description: "The transactions area.",
    category: "inventory_mgmt", tier: "free", active: true, sortOrder: 635,
    coveredBy: "Enforced through its own screens and the core routes; this flag is the admin kill-switch for transactions.",
  },
  {
    key: "transactions_list", module: "Sales & Checkout", section: "sales", groupParent: "transactions", name: "Transaction List", description: "Browse transactions.",
    category: "inventory_mgmt", tier: "free", active: true, sortOrder: 636,
    coveredBy: "Enforced through transactions; this flag is the admin kill-switch for the transaction list action.",
  },
  {
    key: "register_shift", module: "Sales & Checkout", section: "sales", groupParent: "transactions", name: "Register Shift", description: "Open and close a register shift.",
    category: "inventory_mgmt", tier: "free", active: true, sortOrder: 637,
    coveredBy: "Enforced through transactions; this flag is the admin kill-switch for the register shift action.",
  },
  {
    key: "transactions_new_sale", module: "Sales & Checkout", section: "sales", groupParent: "transactions", name: "Transactions: New Sale", description: "Start a sale from the transactions page.",
    category: "inventory_mgmt", tier: "free", active: true, sortOrder: 638,
    coveredBy: "Enforced through transactions; this flag is the admin kill-switch for the transactions: new sale action.",
  },
  {
    key: "transactions_export", module: "Sales & Checkout", section: "sales", groupParent: "transactions", name: "Transactions Export", description: "Export transactions.",
    category: "inventory_mgmt", tier: "free", active: true, sortOrder: 639,
    coveredBy: "Enforced through transactions; this flag is the admin kill-switch for the transactions export action.",
  },
  {
    key: "credit_sale_list", module: "Sales & Checkout", section: "sales", groupParent: "credit_sale", name: "Credit Sale List", description: "Browse credit sales; included once Credit Sale is paid.",
    category: "inventory_mgmt", tier: "free", active: true, sortOrder: 640,
    coveredBy: "Enforced through credit_sale; this flag is the admin kill-switch for the credit sale list action.",
  },
  {
    key: "credit_sale_bulk_ops", module: "Sales & Checkout", section: "sales", groupParent: "credit_sale", name: "Credit Sale Bulk Operations", description: "Bulk actions on credit sales.",
    category: "inventory_mgmt", tier: "free", active: true, sortOrder: 641,
    coveredBy: "Enforced through credit_sale; this flag is the admin kill-switch for the credit sale bulk operations action.",
  },
  {
    key: "booking_new", module: "Customers", section: "sales", groupParent: "booking_management", name: "New Booking", description: "Create a booking; included once Bookings is paid.",
    category: "customer_mgmt", tier: "free", active: true, sortOrder: 642,
    coveredBy: "Enforced through booking_management; this flag is the admin kill-switch for the new booking action.",
  },
  {
    key: "booking_calendar", module: "Customers", section: "sales", groupParent: "booking_management", name: "Booking Calendar", description: "Calendar view of bookings; included once Bookings is paid.",
    category: "customer_mgmt", tier: "free", active: true, sortOrder: 643,
    coveredBy: "Enforced through booking_management; this flag is the admin kill-switch for the booking calendar action.",
  },
  {
    key: "booking_bulk_ops", module: "Customers", section: "sales", groupParent: "booking_management", name: "Booking Bulk Operations", description: "Bulk actions on bookings.",
    category: "customer_mgmt", tier: "free", active: true, sortOrder: 644,
    coveredBy: "Enforced through booking_management; this flag is the admin kill-switch for the booking bulk operations action.",
  },
  {
    key: "quote_new", module: "Sales & Checkout", section: "sales", groupParent: "quotes_management", name: "New Quote", description: "Create a quote; included once Quotes is paid.",
    category: "customer_mgmt", tier: "free", active: true, sortOrder: 645,
    coveredBy: "Enforced through quotes_management; this flag is the admin kill-switch for the new quote action.",
  },
  {
    key: "quote_list", module: "Sales & Checkout", section: "sales", groupParent: "quotes_management", name: "Quote List", description: "Browse quotes; included once Quotes is paid.",
    category: "customer_mgmt", tier: "free", active: true, sortOrder: 646,
    coveredBy: "Enforced through quotes_management; this flag is the admin kill-switch for the quote list action.",
  },
  {
    key: "quote_bulk_ops", module: "Sales & Checkout", section: "sales", groupParent: "quotes_management", name: "Quote Bulk Operations", description: "Bulk actions on quotes; included once Quotes is paid.",
    category: "customer_mgmt", tier: "free", active: true, sortOrder: 647,
    coveredBy: "Enforced through quotes_management; this flag is the admin kill-switch for the quote bulk operations action.",
  },
  {
    key: "quote_save_draft", module: "Sales & Checkout", section: "sales", groupParent: "quotes_management", name: "Save Quote as Draft", description: "Save a quote as a draft; included once Quotes is paid.",
    category: "customer_mgmt", tier: "free", active: true, sortOrder: 648,
    coveredBy: "Enforced through quotes_management; this flag is the admin kill-switch for the save quote as draft action.",
  },
  {
    key: "promotion_new", module: "Sales & Checkout", section: "sales", groupParent: "promotions", name: "New Promotion", description: "Create a promotion; included once Promotions is paid.",
    category: "inventory_mgmt", tier: "free", active: true, sortOrder: 649,
    coveredBy: "Enforced through promotions; this flag is the admin kill-switch for the new promotion action.",
  },
  {
    key: "tax_rate_add", module: "Sales & Checkout", section: "sales", groupParent: "tax_management", name: "Add Tax Rate", description: "Add a tax rate; included once Taxes is paid.",
    category: "tax_compliance", tier: "free", active: true, sortOrder: 650,
    coveredBy: "Enforced through tax_management; this flag is the admin kill-switch for the add tax rate action.",
  },
  {
    key: "tax_bulk_ops", module: "Sales & Checkout", section: "sales", groupParent: "tax_management", name: "Tax Bulk Operations", description: "Bulk actions on tax rates.",
    category: "tax_compliance", tier: "free", active: true, sortOrder: 651,
    coveredBy: "Enforced through tax_management; this flag is the admin kill-switch for the tax bulk operations action.",
  },
  {
    key: "business_profile", module: "Settings", section: "settings_business", name: "Business Profile", description: "Business name, logo and details.",
    category: "business_settings", tier: "free", active: true, sortOrder: 652,
    coveredBy: "Enforced through its own screens and the core routes; this flag is the admin kill-switch for business profile.",
  },
  {
    key: "commission_split_override", module: "Settings", section: "settings_business", groupParent: "business_profile", name: "Override Default Commission Split", description: "Override the default commission split per service or per store.",
    category: "business_settings", tier: "free", active: true, sortOrder: 653,
    coveredBy: "Enforced through business_profile; this flag is the admin kill-switch for the commission split override action.",
  },
  {
    key: "stores_management", module: "Settings", section: "settings_business", name: "Stores", description: "Store list, add, edit and archive (the free store count is capped by Additional Store).",
    category: "business_settings", tier: "free", active: true, sortOrder: 654,
    coveredBy: "Enforced through its own screens and the core routes; this flag is the admin kill-switch for stores.",
  },
  {
    key: "store_add", module: "Settings", section: "settings_business", groupParent: "stores_management", name: "Add Store", description: "Create a store beyond the first free one; limit enforced by Additional Store.",
    category: "business_settings", tier: "free", active: true, sortOrder: 655,
    coveredBy: "Enforced through stores_management; this flag is the admin kill-switch for the add store action.",
  },
  {
    key: "store_edit", module: "Settings", section: "settings_business", groupParent: "stores_management", name: "Edit Store", description: "Edit a store.",
    category: "business_settings", tier: "free", active: true, sortOrder: 656,
    coveredBy: "Enforced through stores_management; this flag is the admin kill-switch for the edit store action.",
  },
  {
    key: "store_archive", module: "Settings", section: "settings_business", groupParent: "stores_management", name: "Archive Store", description: "Archive a store.",
    category: "business_settings", tier: "free", active: true, sortOrder: 657,
    coveredBy: "Enforced through stores_management; this flag is the admin kill-switch for the archive store action.",
  },
  {
    key: "roles_management", module: "Settings", section: "settings_business", name: "Roles & Permissions", description: "Module-based roles and permissions.",
    category: "business_settings", tier: "free", active: true, sortOrder: 658,
    coveredBy: "Enforced through its own screens and the core routes; this flag is the admin kill-switch for roles & permissions.",
  },
  {
    key: "roles_system_builtin", module: "Settings", section: "settings_business", groupParent: "roles_management", name: "Built-in Roles", description: "The system roles.",
    category: "business_settings", tier: "free", active: true, sortOrder: 659,
    coveredBy: "Enforced through roles_management; this flag is the admin kill-switch for the built-in roles action.",
  },
  {
    key: "custom_role_edit", module: "Settings", section: "settings_business", groupParent: "custom_roles_permissions", name: "Edit Custom Role", description: "Edit a custom role; included once Custom Roles is paid.",
    category: "business_settings", tier: "free", active: true, sortOrder: 660,
    coveredBy: "Enforced through custom_roles_permissions; this flag is the admin kill-switch for the edit custom role action.",
  },
  {
    key: "custom_role_delete", module: "Settings", section: "settings_business", groupParent: "custom_roles_permissions", name: "Delete Custom Role", description: "Delete a custom role; included once Custom Roles is paid.",
    category: "business_settings", tier: "free", active: true, sortOrder: 661,
    coveredBy: "Enforced through custom_roles_permissions; this flag is the admin kill-switch for the delete custom role action.",
  },
  {
    key: "billing_management", module: "Settings", section: "settings_business", name: "Billing", description: "Plan, invoices and payment methods.",
    category: "business_settings", tier: "free", active: true, sortOrder: 662,
    coveredBy: "Enforced through its own screens and the core routes; this flag is the admin kill-switch for billing.",
  },
  {
    key: "store_details", module: "Settings", section: "settings_store", name: "Store Details", description: "Per-store details, pay rules and loyalty.",
    category: "business_settings", tier: "free", active: true, sortOrder: 663,
    coveredBy: "Enforced through its own screens and the core routes; this flag is the admin kill-switch for store details.",
  },
  {
    key: "pay_rule_fixed", module: "Settings", section: "settings_store", groupParent: "store_details", name: "Pay Rule: Fixed", description: "Fixed pay rule for a store.",
    category: "business_settings", tier: "free", active: true, sortOrder: 664,
    coveredBy: "Enforced through store_details; this flag is the admin kill-switch for the pay rule: fixed action.",
  },
  {
    key: "pay_rule_commission", module: "Settings", section: "settings_store", groupParent: "store_details", name: "Pay Rule: Commission", description: "Commission pay rule; part of the Financial Management bundle.",
    category: "business_settings", tier: "bundle_child", parent: "financial_management", active: true, sortOrder: 665,
    coveredBy: "Enforced through store_details; this flag is the admin kill-switch for the pay rule: commission action.",
  },
  {
    key: "pay_rule_hybrid", module: "Settings", section: "settings_store", groupParent: "store_details", name: "Pay Rule: Hybrid", description: "Hybrid pay rule; part of the Financial Management bundle.",
    category: "business_settings", tier: "bundle_child", parent: "financial_management", active: true, sortOrder: 666,
    coveredBy: "Enforced through store_details; this flag is the admin kill-switch for the pay rule: hybrid action.",
  },
  {
    key: "attendance_settings", module: "Staff & Payroll", section: "settings_store", groupParent: "attendance_management", name: "Attendance Settings", description: "Per-store attendance rules.",
    category: "staff_mgmt", tier: "free", active: true, sortOrder: 667,
    coveredBy: "Enforced through attendance_management; this flag is the admin kill-switch for the attendance settings action.",
  },
  {
    key: "settings_bulk_ops", module: "Settings", section: "settings_store", name: "Settings Bulk Operations", description: "Bulk actions inside settings lists.",
    category: "business_settings", tier: "free", active: true, sortOrder: 668,
    coveredBy: "Enforced through its own screens and the core routes; this flag is the admin kill-switch for settings bulk operations.",
  },
] as const satisfies readonly FeatureDef[];

export type FeatureKey = (typeof FEATURES)[number]["key"];

const BY_KEY: ReadonlyMap<string, FeatureDef> = new Map(FEATURES.map((f) => [f.key, f]));

export function getFeatureDef(key: string): FeatureDef | undefined {
  return BY_KEY.get(key);
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
    if (f.tierCapacity !== undefined && (f.tier !== "paid_metered_limit" || f.tierCapacity <= (f.freeLimit ?? 0))) {
      problems.push(`${f.key}: tierCapacity needs a paid_metered_limit above its freeLimit`);
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
      // A capped add-on (paid_metered_limit) can carry children too: buying it grants them along with its limit.
      else if (parent.tier !== "bundle_parent" && parent.tier !== "paid_metered_limit") problems.push(`${f.key}: parent ${f.parent} is not a bundle_parent or a capped add-on`);
    }
    if (f.groupParent) {
      if (f.groupParent === f.key) problems.push(`${f.key}: groupParent cannot be itself`);
      else if (!keys.has(f.groupParent)) problems.push(`${f.key}: groupParent ${f.groupParent} is not in the registry`);
    }
    if (!FEATURE_SECTIONS.includes(f.section)) problems.push(`${f.key}: unknown section "${f.section}"`);
    for (const a of f.absorbs ?? []) {
      const child = features.find((c) => c.key === a);
      if (f.tier !== "bundle_parent") problems.push(`${f.key}: only a bundle_parent may absorb features`);
      else if (child?.parent !== f.key) problems.push(`${f.key}: absorbs ${a}, which is not one of its bundle children`);
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

  // groupParent cycles: walking up from any feature must end at a root.
  const groupUp = new Map(features.map((f) => [f.key, f.groupParent] as const));
  for (const f of features) {
    const trail = [f.key];
    for (let k = groupUp.get(f.key); k; k = groupUp.get(k)) {
      if (trail.includes(k)) {
        problems.push(`groupParent cycle: ${[...trail, k].join(" -> ")}`);
        break;
      }
      trail.push(k);
    }
  }

  return problems;
}

export interface DisableImpact {
  /** Client pages that stop existing for every business. */
  screens: string[];
  /** API domains that start returning feature_disabled. */
  domains: string[];
  /** Features switched off with it: bundle children and anything that dependsOn it, transitively. */
  alsoOff: { key: string; name: string }[];
}

/** What switching a feature off takes with it, for the admin console's confirmation. */
export function disableImpact(key: string): DisableImpact {
  const all = FEATURES as readonly FeatureDef[];
  const off = new Set<string>([key]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of all) {
      if (off.has(f.key)) continue;
      if ((f.parent && off.has(f.parent)) || (f.dependsOn ?? []).some((d) => off.has(d))) {
        off.add(f.key);
        changed = true;
      }
    }
  }
  const hit = all.filter((f) => off.has(f.key));
  return {
    screens: hit.flatMap((f) => f.screens ?? []),
    domains: hit.flatMap((f) => f.domains ?? []),
    alsoOff: hit.filter((f) => f.key !== key).map((f) => ({ key: f.key, name: f.name })),
  };
}

/** Features nothing may switch off: the app can't sign in, bill or show settings without them. */
const NEVER_SWITCHED_OFF: ReadonlySet<string> = new Set(["core_platform"]);

export type DisableRisk = "blocked" | "confirm" | "none";

/**
 * How careful switching a feature off needs to be: "blocked" (never allowed), "confirm" (a free core feature,
 * or one other features depend on - the admin must type its key) or "none".
 */
export function disableRisk(key: string): DisableRisk {
  const def = getFeatureDef(key);
  if (!def) return "none";
  if (NEVER_SWITCHED_OFF.has(key)) return "blocked";
  return def.tier === "free" || disableImpact(key).alsoOff.length > 0 ? "confirm" : "none";
}

/** Server-side gate for turning a feature off: null when allowed, otherwise the message to return. */
export function checkDisableAllowed(key: string, confirmKey: unknown): string | null {
  const risk = disableRisk(key);
  if (risk === "blocked") return `${getFeatureDef(key)?.name ?? key} is core to the app and can't be switched off.`;
  if (risk === "confirm" && confirmKey !== key) {
    const { alsoOff, screens } = disableImpact(key);
    const parts = [`Switching off ${getFeatureDef(key)?.name ?? key} affects every business immediately.`];
    if (screens.length) parts.push(`It hides ${screens.join(", ")}.`);
    if (alsoOff.length) parts.push(`It also switches off ${alsoOff.map((f) => f.name).join(", ")}.`);
    parts.push("Confirm by sending the feature key.");
    return parts.join(" ");
  }
  return null;
}

type LimitKind = NonNullable<FeatureDef["limitType"]>;

/**
 * The part of a catalog entry that makes it a limit tier. The limit logic below works on these rather
 * than on the code registry, so a capped add-on created in the admin catalog behaves like a built-in one.
 */
export interface LimitTier {
  key: string;
  tierType: string;
  limitType: string | null;
  /** Total the tier allows; null is unlimited. */
  tierCapacity: number | null;
}

/** The built-in tiers. The default when a caller has no catalog rows to hand (unit tests). */
export const REGISTRY_LIMIT_TIERS: readonly LimitTier[] = (FEATURES as readonly FeatureDef[]).map((f) => ({
  key: f.key,
  tierType: f.tier,
  limitType: f.limitType ?? null,
  tierCapacity: f.tierCapacity ?? null,
}));

/**
 * What a count cap is once the org's owned tiers are counted: the free limit, raised to the biggest owned pack,
 * or unlimited when it holds a tier with no capacity (the original "unlimited" add-on).
 */
export function resolveCountLimit(
  limitType: LimitKind,
  freeLimit: number,
  ownedKeys: readonly string[],
  tiers: readonly LimitTier[] = REGISTRY_LIMIT_TIERS,
): { limit: number; unlimited: boolean } {
  let limit = freeLimit;
  for (const t of tiers) {
    if (t.limitType !== limitType || t.tierType !== "paid_metered_limit" || !ownedKeys.includes(t.key)) continue;
    if (t.tierCapacity === null) return { limit: Infinity, unlimited: true };
    limit = Math.max(limit, t.tierCapacity);
  }
  return { limit, unlimited: false };
}

/** Capacity rank of a tier: bigger is better, unlimited is Infinity. Null for a feature that isn't a limit tier. */
export function tierRank(key: string, tiers: readonly LimitTier[] = REGISTRY_LIMIT_TIERS): { limitType: string; rank: number } | null {
  const t = tiers.find((x) => x.key === key);
  if (!t || t.tierType !== "paid_metered_limit" || !t.limitType) return null;
  return { limitType: t.limitType, rank: t.tierCapacity ?? Infinity };
}

/** Keys of every tier sharing this tier's limit type, smaller or equal first (the ones a purchase of it replaces). */
export function tiersNotAbove(key: string, tiers: readonly LimitTier[] = REGISTRY_LIMIT_TIERS): string[] {
  const me = tierRank(key, tiers);
  if (!me) return [];
  return tiers
    .filter((t) => t.key !== key && tierRank(t.key, tiers)?.limitType === me.limitType && (tierRank(t.key, tiers)?.rank ?? Infinity) <= me.rank)
    .map((t) => t.key);
}

/** Purchase-time check on a cart's seat/limit tiers: at most one per limit type, and never one the org has outgrown. */
export function validateTierSelection(selected: readonly string[], ownedKeys: readonly string[], tiers: readonly LimitTier[] = REGISTRY_LIMIT_TIERS): string | null {
  const nameOf = (key: string) => getFeatureDef(key)?.name ?? key;
  const seen = new Map<string, string>();
  for (const key of selected) {
    const t = tierRank(key, tiers);
    if (!t) continue;
    const other = seen.get(t.limitType);
    if (other) return `Choose one: "${nameOf(other)}" and "${nameOf(key)}" can't be bought together.`;
    seen.set(t.limitType, key);
    for (const owned of ownedKeys) {
      const o = tierRank(owned, tiers);
      if (o && o.limitType === t.limitType && o.rank >= t.rank && owned !== key) {
        return `You already have "${nameOf(owned)}", which covers "${nameOf(key)}".`;
      }
    }
  }
  return null;
}

/** Every other tier sharing this tier's limit type: what ticking it in the cart has to untick. */
export function otherTiers(key: string, tiers: readonly LimitTier[] = REGISTRY_LIMIT_TIERS): string[] {
  const me = tierRank(key, tiers);
  if (!me) return [];
  return tiers.filter((t) => t.key !== key && tierRank(t.key, tiers)?.limitType === me.limitType).map((t) => t.key);
}

/** From a selection, drops all but the biggest tier of each limit type (for "select all"). */
export function keepBiggestTiers(keys: Iterable<string>, tiers: readonly LimitTier[] = REGISTRY_LIMIT_TIERS): Set<string> {
  const all = Array.from(keys);
  const best = new Map<string, { key: string; rank: number }>();
  for (const k of all) {
    const t = tierRank(k, tiers);
    if (t && (!best.has(t.limitType) || t.rank > best.get(t.limitType)!.rank)) best.set(t.limitType, { key: k, rank: t.rank });
  }
  const keep = new Set(Array.from(best.values()).map((b) => b.key));
  return new Set(all.filter((k) => !tierRank(k, tiers) || keep.has(k)));
}
