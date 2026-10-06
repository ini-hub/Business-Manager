import { describe, it, expect } from "vitest";
import { validateGateRule, routeRuleMatches, findGatedScreen, parseMethods, freeDomainsTouched } from "./gateRules";
import { APP_SCREEN_PATHS } from "./screens";
import { PERMISSION_MODULES, roleHasModule } from "./permissionModules";
import { FEATURES } from "./features";

const paid = { key: "new_thing", tierType: "paid_flat", isActive: true };
const known = [
  { method: "POST", path: "/api/vendors" },
  { method: "GET", path: "/api/vendors/:id" },
  { method: "POST", path: "/api/auth/login" },
];

describe("validateGateRule: safeguards", () => {
  it("accepts a real route on a paid feature", () => {
    expect(validateGateRule({ kind: "route", methods: "writes", pattern: "/api/vendors" }, { feature: paid, knownRoutes: known })).toBeNull();
  });

  it.each(["/api/auth/login", "/api/billing/pay", "/api/entitlements", "/api/admin/users", "/api/webhooks/paystack", "/api/health"])(
    "refuses protected route %s",
    (pattern) => {
      expect(validateGateRule({ kind: "route", methods: "*", pattern }, { feature: paid })).toMatch(/protected/);
    },
  );

  it.each(["/", "/auth/login", "/settings/billing", "/settings/billing/payment-history", "/profile", "/onboarding", "/super-admin/flags"])(
    "refuses protected screen %s",
    (pattern) => {
      expect(validateGateRule({ kind: "screen", methods: "*", pattern }, { feature: paid })).toMatch(/protected/);
    },
  );

  it("refuses to gate all of /api or a bare area wildcard", () => {
    expect(validateGateRule({ kind: "route", methods: "*", pattern: "/api" }, { feature: paid })).not.toBeNull();
    expect(validateGateRule({ kind: "route", methods: "*", pattern: "/api/" }, { feature: paid })).not.toBeNull();
    expect(validateGateRule({ kind: "route", methods: "*", pattern: "/api/:x" }, { feature: paid })).not.toBeNull();
  });

  it("refuses rules on free features and bundle children, which a gate could never meaningfully protect", () => {
    expect(validateGateRule({ kind: "route", methods: "*", pattern: "/api/vendors" }, { feature: { ...paid, tierType: "free" } })).toMatch(/free feature/);
    expect(validateGateRule({ kind: "route", methods: "*", pattern: "/api/vendors" }, { feature: { ...paid, tierType: "bundle_child" } })).toMatch(/parent/);
  });

  it("refuses a missing feature, odd characters, bad methods and routes that do not exist", () => {
    expect(validateGateRule({ kind: "route", methods: "*", pattern: "/api/vendors" }, { feature: null })).toMatch(/does not exist/);
    expect(validateGateRule({ kind: "route", methods: "*", pattern: "/api/ven dors" }, { feature: paid })).toMatch(/may only contain/);
    expect(validateGateRule({ kind: "route", methods: "*", pattern: "/api/../etc" }, { feature: paid })).toMatch(/may only contain/);
    expect(validateGateRule({ kind: "route", methods: "FETCH", pattern: "/api/vendors" }, { feature: paid })).toMatch(/Methods/);
    expect(validateGateRule({ kind: "route", methods: "*", pattern: "/api/nothing-here" }, { feature: paid, knownRoutes: known })).toMatch(/No route/);
    expect(validateGateRule({ kind: "route", methods: "GET", pattern: "/api/vendors" }, { feature: paid, knownRoutes: known.slice(0, 1) })).toMatch(/No route/);
  });

  it("only allows screens that exist in the app", () => {
    expect(validateGateRule({ kind: "screen", methods: "*", pattern: "/vendors" }, { feature: paid })).toBeNull();
    expect(validateGateRule({ kind: "screen", methods: "*", pattern: "/nowhere" }, { feature: paid })).toMatch(/does not exist/);
  });

  it("flags when a rule would restrict a free area", () => {
    expect(freeDomainsTouched("/api/customers")).toEqual(["customers"]);
    expect(freeDomainsTouched("/api/credit/entries")).toEqual([]);
  });
});

describe("matching", () => {
  it("parses method specs", () => {
    expect(parseMethods("*")).toBe("*");
    expect(parseMethods("writes")).toEqual(["POST", "PUT", "PATCH", "DELETE"]);
    expect(parseMethods("post, patch")).toEqual(["POST", "PATCH"]);
    expect(parseMethods("nope")).toBeNull();
  });

  it("matches a route and everything beneath it, by method", () => {
    const rule = { featureKey: "f", methods: "writes", pattern: "/api/vendors" };
    expect(routeRuleMatches(rule, "POST", "/api/vendors")).toBe(true);
    expect(routeRuleMatches(rule, "PATCH", "/api/vendors/abc/notes")).toBe(true);
    expect(routeRuleMatches(rule, "GET", "/api/vendors")).toBe(false);
    expect(routeRuleMatches(rule, "POST", "/api/vendors-extra")).toBe(false);
  });

  it("picks the most specific gated screen", () => {
    const entries = [
      { pattern: "/vendors", featureKey: "a" },
      { pattern: "/vendors/new", featureKey: "b" },
    ];
    expect(findGatedScreen("/vendors/new", entries)).toBe("b");
    expect(findGatedScreen("/vendors/9/edit", entries)).toBe("a");
    expect(findGatedScreen("/customers", entries)).toBeNull();
  });
});

describe("settings > roles sync", () => {
  it("gives every registry feature a module a role can actually hold", () => {
    for (const f of FEATURES) expect(PERMISSION_MODULES as readonly string[], f.key).toContain(f.module);
  });

  it("lets owner/manager through, staff only the base modules, custom roles only what they were given", () => {
    const roles = [{ name: "Cashier Lead", permissions: ["Sales & Checkout", "Expenses & Reports"] }];
    expect(roleHasModule("owner", [], "Expenses & Reports")).toBe(true);
    expect(roleHasModule("manager", [], "Settings")).toBe(true);
    expect(roleHasModule("staff", [], "Customers")).toBe(true);
    expect(roleHasModule("staff", [], "Expenses & Reports")).toBe(false);
    expect(roleHasModule("cashier lead", roles, "Expenses & Reports")).toBe(true);
    expect(roleHasModule("cashier lead", roles, "Staff & Payroll")).toBe(false);
    expect(roleHasModule(undefined, roles, "Customers")).toBe(false);
  });

  it("keeps the picker's screen list free of duplicates", () => {
    expect(new Set(APP_SCREEN_PATHS).size).toBe(APP_SCREEN_PATHS.length);
  });
});
