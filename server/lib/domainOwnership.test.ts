import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { API_DOMAIN_OWNERS, FEATURES, type FeatureDef } from "../../shared/features";

/**
 * Every /api/<domain> the server registers must have an owning feature, so the
 * catalog's Active switch and gate rules can reach the whole feature (page and
 * API together) instead of just its screen. Gaps are listed, not hidden.
 */
const serverDir = path.resolve(__dirname, "..");
const files = [
  path.join(serverDir, "routes.ts"),
  ...fs.readdirSync(path.join(serverDir, "routes")).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).map((f) => path.join(serverDir, "routes", f)),
];

const domains = new Set<string>();
for (const f of files) {
  for (const m of fs.readFileSync(f, "utf8").matchAll(/\b(?:app|router)\.(?:get|post|put|patch|delete|use|all)\(\s*["'`]\/api\/([A-Za-z0-9_-]+)/g)) domains.add(m[1]);
}

/**
 * Platform plumbing with no feature to switch off (auth, session, billing, webhooks, public pages, admin console),
 * plus domains shared by several features whose sub-paths are owned by path-level route rules instead
 * (reports, charts, dashboard, search). Keep short: a new entry here is a decision not to make it switchable.
 */
const PLATFORM_DOMAINS: ReadonlySet<string> = new Set([
  "auth", "user", "entitlements", "billing", "subscription", "webhooks", "health", "csrf-token", "public", "support", "legal", "profile", "upload", "uploads",
  "admin", "debug", "verify", "geocode", "export-branding", "announcements", "permission-modules", "reports", "charts", "dashboard", "search",
]);

describe("API domain ownership", () => {
  it("finds the routes (guards against the scan matching nothing)", () => {
    expect(domains.size).toBeGreaterThan(40);
  });

  it("gives every API domain an owning feature or marks it platform", () => {
    const unowned = Array.from(domains).filter((d) => !API_DOMAIN_OWNERS.has(d) && !PLATFORM_DOMAINS.has(d)).sort();
    expect(unowned).toEqual([]);
  });

  it("owns each domain exactly once and names real features", () => {
    const keys = new Set(FEATURES.map((f) => f.key as string));
    for (const [d, k] of API_DOMAIN_OWNERS) expect(keys.has(k), `${d} -> ${k}`).toBe(true);
    const claimed = (FEATURES as readonly FeatureDef[]).flatMap((f) => f.domains ?? []);
    expect(claimed.length).toBe(new Set(claimed).size);
  });
});
