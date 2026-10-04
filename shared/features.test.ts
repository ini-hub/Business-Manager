import { describe, it, expect } from "vitest";
import {
  FEATURES, FEATURE_ROUTE_RULES, API_DOMAIN_OWNERS, FREE_FEATURE_KEYS, PENDING_GATE_KEYS, validateRegistry,
  type FeatureDef,
} from "./features";

describe("feature registry", () => {
  it("is internally consistent", () => {
    expect(validateRegistry()).toEqual([]);
  });

  it("rejects the mistakes it is meant to catch", () => {
    const base: FeatureDef = { key: "a", module: "Settings", name: "A", description: "", category: "business_settings", tier: "free", active: true, sortOrder: 1 };
    const problems = validateRegistry([
      base,
      { ...base, key: "a" },
      { ...base, key: "child", sortOrder: 2, tier: "bundle_child" },
      { ...base, key: "x", sortOrder: 3, tier: "paid_flat", active: true, dependsOn: ["y"] },
      { ...base, key: "y", sortOrder: 4, tier: "paid_flat", active: true, price: { monthly: 1, annual: 1 }, dependsOn: ["x"] },
      { ...base, key: "d1", sortOrder: 5, domains: ["same"] },
      { ...base, key: "d2", sortOrder: 6, domains: ["same"] },
    ]);
    const text = problems.join("\n");
    expect(text).toMatch(/duplicate key/);
    expect(text).toMatch(/bundle_child needs a parent/);
    expect(text).toMatch(/active paid feature needs a default price/);
    expect(text).toMatch(/dependency cycle/);
    expect(text).toMatch(/domain "same" is owned by both/);
  });

  it("keeps the 32 originally seeded catalog keys", () => {
    const keys = new Set(FEATURES.map((f) => f.key));
    for (const k of [
      "vendor_details", "purchase_order_tracking", "attendance_management", "contract_management", "sales_module",
      "customer_details", "customer_filters", "promotions", "hide_transaction_amount", "staff_seats_addon", "self_check_in",
      "staff_performance_tracking", "customer_capacity_addon", "customer_analytics_retention", "quote_booking_management",
      "financial_management", "pnl_statement", "expenses_tracking", "payroll_hybrid_commission", "vat_tracking",
      "product_variants", "sell_in_parts", "receipts", "low_stock_threshold", "credit_sale", "credit_recall_reminders",
      "consignment_management", "store_addon", "receipt_customization", "loyalty_program", "custom_roles_permissions",
      "plugins_integrations",
    ]) expect(keys.has(k), k).toBe(true);
  });

  it("owns exactly the API domains that were previously declared free", () => {
    expect(Array.from(API_DOMAIN_OWNERS.keys()).sort()).toEqual([
      "accounting", "analytics", "attendance", "audit-logs", "auth", "billing", "bookings", "business", "cash-register",
      "contract", "customers", "funnel-events", "gamification", "guarantor", "hr", "inventory", "legal",
      "my-booking", "notifications", "orders", "payments", "payroll", "products", "profile-completion",
      "promotions", "purchase-orders", "quotes", "sales", "settings", "staff", "stock-audits",
      "stock-transfers", "stores", "support", "tax-rates", "transactions", "vendors", "webhooks", "whatsapp",
    ]);
  });

  it("gates the same paid routes as before the registry existed", () => {
    const gated = FEATURE_ROUTE_RULES.map((r) => r.feature).sort();
    expect(gated).toEqual([
      "credit_recall_reminders", "credit_sale", "custom_roles_permissions", "financial_management", "financial_management",
      "financial_management", "product_variants", "self_check_in", "staff_performance_tracking",
    ]);
  });

  it("treats free features as always granted", () => {
    expect(FREE_FEATURE_KEYS).toContain("sales_module");
    expect(FREE_FEATURE_KEYS).toContain("core_platform");
    expect(FREE_FEATURE_KEYS).not.toContain("credit_sale");
  });

  /**
   * Features with a catalog row but nothing gated by them yet. This list may
   * only shrink: attach routes/screens, delete `pendingGate`, and remove the
   * key here. Adding a key means shipping a feature nothing enforces.
   */
  it("pins the pending-gate baseline so it can only shrink", () => {
    expect([...PENDING_GATE_KEYS].sort()).toEqual([
      "consignment_management", "customer_analytics_retention", "hide_transaction_amount",
      "plugins_integrations", "quote_booking_management", "sell_in_parts", "vat_tracking",
    ]);
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
