import { FEATURES, type FeatureDef } from "@shared/features";
import { routeRuleMatches, type ScreenGateEntry } from "@shared/gateRules";
import type { PermissionModule } from "@shared/permissionModules";

/**
 * Admin-defined gate rules, loaded from feature_gate_rules (status 'active') and
 * merged with the code baseline in shared/features.ts. Cached briefly because
 * the policy middleware asks on every /api request; an admin change calls
 * invalidateGateRules() so it takes effect on this instance immediately (other
 * instances pick it up within CACHE_MS).
 *
 * Failing safe: if the table cannot be read, keep serving the last good rules
 * (or none). The baseline rules in code are enforced regardless, so a database
 * hiccup never loosens the built-in gates and never locks anyone out of a route
 * that was only ever gated by an admin rule.
 */

const CACHE_MS = 60_000;

export interface DynamicGateRule {
  id: string;
  kind: "route" | "screen";
  methods: string;
  pattern: string;
  featureKey: string;
  featureName: string;
  /** The role module a custom role needs for this feature (null = no module check). */
  module: PermissionModule | null;
}

let cache: { rules: DynamicGateRule[]; at: number } | null = null;

export function invalidateGateRules(): void {
  cache = null;
}

export async function loadActiveGateRules(): Promise<DynamicGateRule[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rules;
  try {
    // Imported here so merely importing this module (e.g. in unit tests of the
    // policy middleware) does not open a database pool.
    const [{ db }, { featureGateRules, featureCatalog }, { eq, and }] = await Promise.all([
      import("../db"),
      import("@shared/schema"),
      import("drizzle-orm"),
    ]);
    const rows = await db
      .select({
        id: featureGateRules.id,
        kind: featureGateRules.kind,
        methods: featureGateRules.methods,
        pattern: featureGateRules.pattern,
        featureKey: featureCatalog.key,
        featureName: featureCatalog.name,
        module: featureCatalog.permissionModule,
      })
      .from(featureGateRules)
      .innerJoin(featureCatalog, eq(featureCatalog.id, featureGateRules.featureId))
      .where(and(eq(featureGateRules.status, "active"), eq(featureCatalog.isActive, true)));
    const rules = rows.map((r) => ({ ...r, kind: r.kind as "route" | "screen", module: (r.module as PermissionModule | null) ?? null }));
    cache = { rules, at: Date.now() };
    return rules;
  } catch (error) {
    console.error("[gateRules] could not load admin gate rules; using the last good set:", error);
    return cache?.rules ?? [];
  }
}

export async function matchDynamicRouteRules(method: string, path: string): Promise<DynamicGateRule[]> {
  const rules = await loadActiveGateRules();
  return rules.filter((r) => r.kind === "route" && routeRuleMatches(r, method, path));
}

export interface ScreenGate extends ScreenGateEntry {
  /** Where the rule came from: "code" is the locked baseline, "admin" was added in the console. */
  source: "code" | "admin";
  module: PermissionModule | null;
}

/** Baseline gated screens from the registry, plus active admin screen rules. */
export async function listScreenGates(): Promise<ScreenGate[]> {
  const baseline: ScreenGate[] = (FEATURES as readonly FeatureDef[]).flatMap((f) =>
    (f.gatedScreens ?? []).map((pattern) => ({ pattern, featureKey: f.key, source: "code" as const, module: null })),
  );
  const dynamic = (await loadActiveGateRules())
    .filter((r) => r.kind === "screen")
    .map((r) => ({ pattern: r.pattern, featureKey: r.featureKey, source: "admin" as const, module: r.module }));
  return [...baseline, ...dynamic];
}

;
