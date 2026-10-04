import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

const granted = new Set<string>();
vi.mock("./entitlements", () => ({
  getRequestEntitlements: vi.fn(async () => granted),
  featureNotPurchasedBody: vi.fn(async (key: string) => ({ error: "feature_not_purchased", featureKey: key, featureName: key, message: "nope" })),
}));

let adminRules: { featureKey: string; module: string | null }[] = [];
vi.mock("./gateRules", () => ({ matchDynamicRouteRules: vi.fn(async () => adminRules) }));
let moduleAllowed = true;
vi.mock("./permissions", () => ({ hasModulePermission: vi.fn(async () => moduleAllowed) }));

import { FEATURE_RULES, enforceFeaturePolicy, isClassified, matchFeatureRules } from "./featurePolicy";

function run(method: string, url: string, user: unknown = { businessId: "org-1" }) {
  const req: any = { method, originalUrl: url, user };
  const res: any = { locals: {}, statusCode: 200, body: undefined };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (body: unknown) => { res.body = body; return res; };
  const next = vi.fn();
  return enforceFeaturePolicy(req, res, next).then(() => ({ res, next }));
}

beforeEach(() => { granted.clear(); adminRules = []; moduleAllowed = true; });

describe("matchFeatureRules", () => {
  it("gates writes to expenses (incl. bulk) but not reads", () => {
    expect(matchFeatureRules("POST", "/api/expenses/bulk").map((r) => r.feature)).toEqual(["financial_management"]);
    expect(matchFeatureRules("DELETE", "/api/expenses/abc").map((r) => r.feature)).toEqual(["financial_management"]);
    expect(matchFeatureRules("GET", "/api/expenses")).toEqual([]);
  });

  it("gates the P&L for reads as well as writes", () => {
    expect(matchFeatureRules("GET", "/api/profit-loss/summary").map((r) => r.feature)).toEqual(["financial_management"]);
  });

  it("gates self check-in but leaves manager-recorded proxy punches free", () => {
    expect(matchFeatureRules("POST", "/api/attendance/punch").map((r) => r.feature)).toEqual(["self_check_in"]);
    expect(matchFeatureRules("POST", "/api/attendance/punch/proxy")).toEqual([]);
  });

  it("requires both credit_sale and credit_recall_reminders for reminders", () => {
    expect(matchFeatureRules("POST", "/api/credit/entries/e1/reminders").map((r) => r.feature).sort()).toEqual(["credit_recall_reminders", "credit_sale"]);
    expect(matchFeatureRules("GET", "/api/credit/entries")).toEqual([]);
  });

  it("gates variant creation and custom roles writes", () => {
    expect(matchFeatureRules("POST", "/api/products/p1/variants").map((r) => r.feature)).toEqual(["product_variants"]);
    expect(matchFeatureRules("POST", "/api/custom-roles").map((r) => r.feature)).toEqual(["custom_roles_permissions"]);
    expect(matchFeatureRules("GET", "/api/custom-roles")).toEqual([]);
  });
});

describe("enforceFeaturePolicy", () => {
  it("returns 402 with the feature key when the add-on isn't granted", async () => {
    const { res, next } = await run("POST", "/api/custom-roles");
    expect(res.statusCode).toBe(402);
    expect(res.body).toMatchObject({ error: "feature_not_purchased", featureKey: "custom_roles_permissions" });
    expect(next).not.toHaveBeenCalled();
  });

  it("passes through when granted", async () => {
    granted.add("custom_roles_permissions");
    const { next } = await run("POST", "/api/custom-roles");
    expect(next).toHaveBeenCalledOnce();
  });

  it("blocks when only one of several required features is granted", async () => {
    granted.add("credit_sale");
    const { res } = await run("POST", "/api/credit/entries/e1/reminders");
    expect(res.statusCode).toBe(402);
    expect(res.body.featureKey).toBe("credit_recall_reminders");
  });

  it("ignores unmatched routes and unauthenticated requests", async () => {
    expect((await run("POST", "/api/customers")).next).toHaveBeenCalledOnce();
    expect((await run("POST", "/api/custom-roles", null)).next).toHaveBeenCalledOnce();
  });

  it("ignores the query string when matching", async () => {
    const { res } = await run("GET", "/api/profit-loss?from=2026-01-01");
    expect(res.statusCode).toBe(402);
  });
});

describe("admin-defined gate rules", () => {
  it("402s when the org lacks the feature an admin rule names", async () => {
    adminRules = [{ featureKey: "new_thing", module: null }];
    const { res, next } = await run("POST", "/api/anything");
    expect(res.statusCode).toBe(402);
    expect(res.body).toMatchObject({ featureKey: "new_thing" });
    expect(next).not.toHaveBeenCalled();
  });

  it("passes when the feature is held and the rule names no module", async () => {
    adminRules = [{ featureKey: "new_thing", module: null }];
    granted.add("new_thing");
    expect((await run("POST", "/api/anything")).next).toHaveBeenCalledOnce();
  });

  it("403s a role that lacks the feature's Settings > Roles module, even with the feature", async () => {
    adminRules = [{ featureKey: "new_thing", module: "Expenses & Reports" }];
    granted.add("new_thing");
    moduleAllowed = false;
    const { res, next } = await run("GET", "/api/anything");
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ error: "module_permission_required", module: "Expenses & Reports" });
    expect(next).not.toHaveBeenCalled();
  });

  it("lets a role that holds the module through", async () => {
    adminRules = [{ featureKey: "new_thing", module: "Expenses & Reports" }];
    granted.add("new_thing");
    expect((await run("GET", "/api/anything")).next).toHaveBeenCalledOnce();
  });

  it("still enforces the code baseline alongside admin rules", async () => {
    adminRules = [{ featureKey: "new_thing", module: null }];
    granted.add("new_thing");
    expect((await run("POST", "/api/custom-roles")).res.statusCode).toBe(402);
  });
});

/**
 * Deny-by-default guard: every mutating route declared in the server sources
 * must be gated in FEATURE_RULES or belong to a domain in FREE_ROUTE_DOMAINS.
 * Adding a route under a brand-new /api/<domain> fails here until someone
 * decides which side it's on - it can no longer ship silently free.
 */
describe("route coverage", () => {
  const serverDir = path.resolve(__dirname, "..");

  function sourceFiles(): { file: string; prefix: string; pattern: RegExp }[] {
    const out: { file: string; prefix: string; pattern: RegExp }[] = [];
    const appPattern = /\bapp\.(?:post|put|patch|delete)\(\s*(["'`])(\/api\/[^"'`]+)\1/g;
    const routerPattern = /\brouter\.(?:post|put|patch|delete)\(\s*(["'`])(\/[^"'`]*)\1/g;
    out.push({ file: path.join(serverDir, "routes.ts"), prefix: "", pattern: appPattern });
    for (const f of fs.readdirSync(path.join(serverDir, "routes"))) {
      if (f.endsWith(".routes.ts")) out.push({ file: path.join(serverDir, "routes", f), prefix: "", pattern: appPattern });
    }
    for (const f of fs.readdirSync(path.join(serverDir, "controllers"))) {
      if (f.endsWith("Controller.ts")) out.push({ file: path.join(serverDir, "controllers", f), prefix: "/api", pattern: routerPattern });
    }
    return out;
  }

  it("finds routes to check (guards against the scan silently matching nothing)", () => {
    let total = 0;
    for (const { file, pattern } of sourceFiles()) {
      total += Array.from(fs.readFileSync(file, "utf8").matchAll(new RegExp(pattern.source, "g"))).length;
    }
    expect(total).toBeGreaterThan(150);
  });

  it("classifies every mutating route as gated or explicitly free", () => {
    const unclassified: string[] = [];
    for (const { file, prefix, pattern } of sourceFiles()) {
      const src = fs.readFileSync(file, "utf8");
      for (const m of src.matchAll(new RegExp(pattern.source, "g"))) {
        const routePath = m[2].startsWith("/api") ? m[2] : prefix + m[2];
        if (m[1] === "`" && routePath.includes("${")) continue;
        if (!isClassified(routePath)) unclassified.push(`${path.basename(file)}: ${routePath}`);
      }
    }
    expect(unclassified).toEqual([]);
  });

  it("has no gated rule pointing at an empty feature key", () => {
    for (const rule of FEATURE_RULES) expect(rule.feature).toMatch(/^[a-z_]+$/);
  });
});

/**
 * Route rules in shared/features.ts are the only place a route is gated. A
 * second, per-route requireFeature(...) would be a gate the registry (and the
 * admin kill-switch view of it) doesn't know about.
 */
describe("single source of gating", () => {
  it("has no per-route requireFeature outside the entitlements module", () => {
    const serverDir = path.resolve(__dirname, "..");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== "node_modules") walk(full); continue; }
        if (!e.name.endsWith(".ts") || /\.(i?test)\.ts$/.test(e.name)) continue;
        if (full === path.join(serverDir, "lib", "entitlements.ts")) continue;
        if (/\brequireFeature\(/.test(fs.readFileSync(full, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""))) offenders.push(path.relative(serverDir, full));
      }
    };
    walk(serverDir);
    expect(offenders).toEqual([]);
  });
});
