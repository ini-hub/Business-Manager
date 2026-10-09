import { describe, it, expect } from "vitest";
import {
  featureForScreen, gatedFeatureForScreen, disableImpact, disableRisk, checkDisableAllowed, resolveCountLimit, duplicateLimitTiers, REGISTRY_LIMIT_TIERS, tiersNotAbove, validateTierSelection, otherTiers, keepBiggestTiers,
  FEATURES, FEATURE_SECTIONS, FEATURE_ROUTE_RULES, getFeatureDef, API_DOMAIN_OWNERS, FREE_FEATURE_KEYS, PENDING_GATE_KEYS, validateRegistry,
  type FeatureDef,
} from "./features";

describe("feature registry", () => {
  it("resolves seat limits from the tiers an org owns", () => {
    expect(resolveCountLimit("staff_seats", 2, [])).toEqual({ limit: 2, unlimited: false });
    expect(resolveCountLimit("staff_seats", 2, ["staff_seats_5"])).toEqual({ limit: 5, unlimited: false });
    expect(resolveCountLimit("staff_seats", 2, ["staff_seats_5", "staff_seats_15"])).toEqual({ limit: 15, unlimited: false });
    expect(resolveCountLimit("staff_seats", 2, ["staff_seats_15", "staff_seats_addon"]).unlimited).toBe(true);
    // a customer-capacity add-on is not a seat tier
    expect(resolveCountLimit("staff_seats", 2, ["customer_capacity_addon"])).toEqual({ limit: 2, unlimited: false });
    expect(resolveCountLimit("customer_count", 30, ["customer_capacity_addon"]).unlimited).toBe(true);
  });

  it("keeps tiers of one limit mutually exclusive", () => {
    expect(tiersNotAbove("staff_seats_15")).toEqual(expect.arrayContaining(["staff_seats_5"]));
    expect(tiersNotAbove("staff_seats_15")).not.toContain("staff_seats_addon");
    expect(tiersNotAbove("staff_seats_addon")).toEqual(expect.arrayContaining(["staff_seats_5", "staff_seats_15"]));
    expect(validateTierSelection(["staff_seats_5", "staff_seats_15"], [])).toMatch(/Choose one/);
    expect(validateTierSelection(["staff_seats_5"], ["staff_seats_15"])).toMatch(/already have/);
    expect(validateTierSelection(["staff_seats_15"], ["staff_seats_5"])).toBeNull();
    expect(validateTierSelection(["staff_seats_5", "customer_capacity_addon"], [])).toBeNull();
    expect(otherTiers("staff_seats_15").sort()).toEqual(["staff_seats_5", "staff_seats_addon"]);
    expect(otherTiers("quotes_management")).toEqual([]);
    expect(Array.from(keepBiggestTiers(["staff_seats_5", "staff_seats_15", "quotes_management"])).sort()).toEqual(["quotes_management", "staff_seats_15"]);
  });

  it("guards switching core features off", () => {
    expect(disableRisk("core_platform")).toBe("blocked");
    expect(disableRisk("customer_management")).toBe("confirm"); // free, and others depend on it
    expect(disableRisk("vendor_details")).toBe("confirm"); // purchase orders depend on it
    expect(disableRisk("quotes_management")).toBe("none");
    expect(disableRisk("not_a_feature")).toBe("none");
    expect(checkDisableAllowed("core_platform", "core_platform")).toMatch(/can't be switched off/);
    expect(checkDisableAllowed("customer_management", undefined)).toMatch(/Sales Module/);
    expect(checkDisableAllowed("customer_management", "customer_management")).toBeNull();
    expect(checkDisableAllowed("quotes_management", undefined)).toBeNull();
  });

  it("reports what switching a feature off takes with it", () => {
    const impact = disableImpact("customer_management");
    expect(impact.screens).toContain("/customers");
    expect(impact.domains).toContain("customers");
    // inventory features declare dependsOn customer_management, so they go too
    expect(impact.alsoOff.length).toBeGreaterThan(0);
    expect(disableImpact("purchase_management").alsoOff.map((f) => f.key)).toEqual(expect.arrayContaining(["vendor_details", "purchase_order_tracking"]));
    expect(disableImpact("quotes_management").alsoOff).toEqual([]);
    // Hard dependencies follow the schema's NOT NULL foreign keys: a sale needs a customer, a PO needs a vendor.
    expect(disableImpact("customer_management").alsoOff.map((f) => f.key)).toEqual(expect.arrayContaining(["sales_module", "booking_management", "whatsapp_broadcasts"]));
    expect(disableImpact("vendor_details").alsoOff.map((f) => f.key)).toContain("purchase_order_tracking");
    expect(disableImpact("staff_management").alsoOff.map((f) => f.key)).toEqual(expect.arrayContaining(["sales_module", "attendance_management", "payroll_fixed"]));
  });

  it("lets the Inactive switch hide every gated page", () => {
    // A bundle parent must not own a page a child feature covers, or switching the child off hides nothing.
    const gated = FEATURES.flatMap((f) => ((f as FeatureDef).gatedScreens ?? []).map((p) => ({ parent: f as FeatureDef, path: p })));
    for (const { parent, path } of gated) {
      const owner = featureForScreen(path.replace(/:[A-Za-z0-9_]+/g, "x"));
      const kids = FEATURES.filter((c) => (c as FeatureDef).parent === parent.key).map((c) => c.key as string);
      const hasScreenKids = kids.some((k) => featureForScreen(path) === k);
      if (parent.tier === "bundle_parent") expect({ path, owner: hasScreenKids ? "child" : owner }).toEqual({ path, owner: "child" });
      expect(gatedFeatureForScreen(path)).toBe(parent.key);
    }
  });

  it("is internally consistent", () => {
    expect(validateRegistry()).toEqual([]);
  });

  it("rejects the mistakes it is meant to catch", () => {
    const base: FeatureDef = { key: "a", module: "Settings", section: "settings_business", name: "A", description: "", category: "business_settings", tier: "free", active: true, sortOrder: 1 };
    const problems = validateRegistry([
      base,
      { ...base, key: "a" },
      { ...base, key: "child", sortOrder: 2, tier: "bundle_child" },
      { ...base, key: "x", sortOrder: 3, tier: "paid_flat", active: true, dependsOn: ["y"] },
      { ...base, key: "y", sortOrder: 4, tier: "paid_flat", active: true, price: { monthly: 1, annual: 1 }, dependsOn: ["x"] },
      { ...base, key: "d1", sortOrder: 5, domains: ["same"] },
      { ...base, key: "d2", sortOrder: 6, domains: ["same"] },
      { ...base, key: "g1", sortOrder: 7, groupParent: "g2" },
      { ...base, key: "g2", sortOrder: 8, groupParent: "g1" },
      { ...base, key: "g3", sortOrder: 9, groupParent: "missing" },
      { ...base, key: "bun", sortOrder: 10, tier: "bundle_parent", price: { monthly: 1, annual: 1 }, absorbs: ["a"] },
    ]);
    const text = problems.join("\n");
    expect(text).toMatch(/duplicate key/);
    expect(text).toMatch(/bundle_child needs a parent/);
    expect(text).toMatch(/active paid feature needs a default price/);
    expect(text).toMatch(/dependency cycle/);
    expect(text).toMatch(/domain "same" is owned by both/);
    expect(text).toMatch(/groupParent cycle/);
    expect(text).toMatch(/bun: absorbs a, which is not one of its bundle children/);
    expect(text).toMatch(/groupParent missing is not in the registry/);
  });

  it("keeps the originally seeded catalog keys that are built", () => {
    const keys = new Set(FEATURES.map((f) => f.key));
    for (const k of [
      "vendor_details", "purchase_order_tracking", "attendance_management", "contract_management", "sales_module",
      "customer_management", "customer_filters", "promotions", "staff_seats_addon", "self_check_in",
      "staff_performance_tracking", "customer_capacity_addon", "financial_management", "pnl_statement", "expenses_tracking", "payroll_hybrid_commission", "product_variants", "receipts", "low_stock_threshold", "credit_sale", "credit_recall_reminders",
      "sell_in_parts", "staff_sales_visibility", "store_addon", "receipt_customization", "loyalty_program", "custom_roles_permissions",
    ]) expect(keys.has(k), k).toBe(true);
  });

  it("owns exactly the API domains that were previously declared free", () => {
    expect(Array.from(API_DOMAIN_OWNERS.keys()).sort()).toEqual([
      "accounting", "analytics", "attendance", "audit-logs", "auth", "billing", "bookings", "business", "cash-register",
      "contract", "custom-roles", "customers", "expense-categories", "expenses", "funnel-events", "gamification", "guarantor", "hr", "inventory", "inventory-drafts", "legal",
      "my-booking", "notifications", "orders", "partner-ledger", "partner-transfers", "partners", "payments", "payroll", "products", "profile-completion", "profit-loss",
      "promotions", "purchase-orders", "quotes", "sales", "settings", "staff", "stock-audits", "stock-transfer-drafts",
      "stock-transfers", "stores", "support", "tax-rates", "transactions", "vendors", "webhooks", "whatsapp",
    ]);
  });

  it("gates the original paid routes plus the FRS modules carved out of formerly-free domains", () => {
    const gated = new Set(FEATURE_ROUTE_RULES.map((r) => r.feature));
    for (const k of [
      "credit_recall_reminders", "credit_sale", "custom_roles_permissions", "pnl_statement", "expenses_tracking", "product_variants",
      "self_check_in", "staff_performance_tracking",
      // FRS modules
      "vendor_details", "purchase_order_tracking", "promotions", "booking_management", "whatsapp_broadcasts", "quotes_management",
      "tax_management", "stock_transfer", "inventory_audit", "inventory_drafts", "inventory_archive_delete", "sale_drafts",
      "customer_archive", "leaderboards", "staff_hr_archive", "staff_transfer",
    ]) expect(gated.has(k), k).toBe(true);
  });

  it("sells vendors and purchase orders as one bundle", () => {
    const bundle = getFeatureDef("purchase_management");
    expect(bundle?.tier).toBe("bundle_parent");
    expect(bundle?.absorbs).toEqual(["vendor_details", "purchase_order_tracking"]);
    expect(getFeatureDef("vendor_details")).toMatchObject({ tier: "bundle_child", parent: "purchase_management" });
    expect(getFeatureDef("purchase_order_tracking")).toMatchObject({ tier: "bundle_child", parent: "purchase_management" });
    // The API rules sit on the children so the Inactive switch on either one blocks its own routes; the
    // children are granted with the parent, so buying the bundle still unlocks both.
    const rulesFor = (key: string) => FEATURE_ROUTE_RULES.filter((r) => r.feature === key).map((r) => r.path.source);
    expect(rulesFor("vendor_details").some((p) => p.includes("vendors"))).toBe(true);
    expect(rulesFor("purchase_order_tracking").some((p) => p.includes("purchase-orders"))).toBe(true);
  });

  it("bundles the transfers into Additional Store, a capped add-on, and keeps reminders tied to Credit Sale", () => {
    expect(getFeatureDef("store_addon")?.tier).toBe("paid_metered_limit");
    for (const key of ["staff_transfer", "stock_transfer"]) {
      expect(getFeatureDef(key)).toMatchObject({ tier: "bundle_child", parent: "store_addon" });
      expect(getFeatureDef(key)?.price).toBeUndefined();
    }
    // Their routes stay gated on their own keys, so the Inactive switch can still hide each one alone.
    expect(FEATURE_ROUTE_RULES.some((r) => r.feature === "stock_transfer")).toBe(true);
    expect(FEATURE_ROUTE_RULES.some((r) => r.feature === "staff_transfer")).toBe(true);
    expect(getFeatureDef("credit_recall_reminders")?.dependsOn).toContain("credit_sale");
    expect(disableImpact("store_addon").alsoOff.map((f) => f.key)).toEqual(expect.arrayContaining(["stock_transfer", "staff_transfer"]));
  });

  it("uses the FRS free caps: 2 staff, 30 customers, 1 store, 50 items", () => {
    expect([getFeatureDef("staff_seats_addon")?.freeLimit, getFeatureDef("customer_capacity_addon")?.freeLimit, getFeatureDef("store_addon")?.freeLimit, getFeatureDef("item_capacity_addon")?.freeLimit]).toEqual([2, 30, 1, 50]);
  });

  it("treats free features as always granted", () => {
    expect(FREE_FEATURE_KEYS).toContain("sales_module");
    expect(FREE_FEATURE_KEYS).toContain("core_platform");
    expect(FREE_FEATURE_KEYS).not.toContain("credit_sale");
  });

  it("lists every feature under one of the four product sections, with a groupParent that exists", () => {
    const keys = new Set(FEATURES.map((f) => f.key));
    for (const f of FEATURES as readonly FeatureDef[]) {
      expect(FEATURE_SECTIONS, f.key).toContain(f.section);
      if (f.groupParent) expect(keys.has(f.groupParent), `${f.key} -> ${f.groupParent}`).toBe(true);
    }
    expect(new Set((FEATURES as readonly FeatureDef[]).map((f) => f.section)).size).toBe(4);
  });

  /**
   * Features with a catalog row but nothing gated by them yet. This list may
   * only shrink: attach routes/screens, delete `pendingGate`, and remove the
   * key here. Adding a key means shipping a feature nothing enforces.
   */
  it("pins the pending-gate baseline so it can only shrink", () => {
    expect([...PENDING_GATE_KEYS].sort()).toEqual([]);
  });

  it("only leaves unbuilt, inactive placeholders without a gate", () => {
    const active = FEATURES.filter((f: FeatureDef) => f.pendingGate && f.active).map((f) => f.key);
    expect(active).toEqual([]);
  });

  it("gives every active free or gated-by-route feature coverage", () => {
    const uncovered = FEATURES.filter((f: FeatureDef) =>
      f.active && !f.pendingGate && !f.inlineGate && !f.coveredBy && !f.routes?.length && !f.domains?.length && !f.screens?.length,
    ).map((f) => f.key);
    expect(uncovered).toEqual([]);
  });
});

describe("limit tiers read from catalog rows", () => {
  const tiers = [
    { key: "seats_10", tierType: "paid_metered_limit", limitType: "staff_seats", tierCapacity: 10 },
    { key: "seats_40", tierType: "paid_metered_limit", limitType: "staff_seats", tierCapacity: 40 },
    { key: "seats_any", tierType: "paid_metered_limit", limitType: "staff_seats", tierCapacity: null },
    { key: "plain", tierType: "paid_flat", limitType: null, tierCapacity: null },
  ];
  it("raises the cap to the biggest owned tier and treats a null capacity as unlimited", () => {
    expect(resolveCountLimit("staff_seats", 2, ["seats_10"], tiers)).toEqual({ limit: 10, unlimited: false });
    expect(resolveCountLimit("staff_seats", 2, ["seats_10", "seats_40"], tiers)).toEqual({ limit: 40, unlimited: false });
    expect(resolveCountLimit("staff_seats", 2, ["seats_40", "seats_any"], tiers).unlimited).toBe(true);
    expect(resolveCountLimit("customer_count", 30, ["seats_10"], tiers)).toEqual({ limit: 30, unlimited: false });
  });
  it("replaces smaller tiers and rejects ones the org has outgrown", () => {
    expect(tiersNotAbove("seats_40", tiers).sort()).toEqual(["seats_10"]);
    expect(tiersNotAbove("plain", tiers)).toEqual([]);
    expect(validateTierSelection(["seats_10"], ["seats_40"], tiers)).toMatch(/already have/);
    expect(validateTierSelection(["seats_10", "seats_40"], [], tiers)).toMatch(/Choose one/);
    expect(validateTierSelection(["seats_40"], ["seats_10"], tiers)).toBeNull();
  });
});

describe("duplicate limit tiers", () => {
  it("finds none in the registry", () => {
    expect(duplicateLimitTiers(REGISTRY_LIMIT_TIERS)).toEqual([]);
  });
  it("flags equal capacities within a limit type, but not across types or non-capped tiers", () => {
    const t = (key: string, limitType: string, tierCapacity: number | null, tierType = "paid_metered_limit") => ({ key, tierType, limitType, tierCapacity });
    expect(duplicateLimitTiers([t("a", "staff_seats", 10), t("b", "staff_seats", 10)])).toHaveLength(1);
    expect(duplicateLimitTiers([t("a", "staff_seats", null), t("b", "staff_seats", null)])).toHaveLength(1);
    expect(duplicateLimitTiers([t("a", "staff_seats", 10), t("b", "item_count", 10), t("c", "staff_seats", 10, "paid_flat")])).toEqual([]);
  });
});
