import type { RequestHandler } from "express";
import { featureNotPurchasedBody, getRequestEntitlements } from "./entitlements";
import { matchDynamicRouteRules } from "./gateRules";
import { hasModulePermission } from "./permissions";
import { FEATURE_ROUTE_RULES, API_DOMAIN_OWNERS, type HttpMethod } from "@shared/features";

/**
 * Central, deny-by-default map from API routes to the paid feature they need.
 *
 * Why this exists: gating used to be an opt-in `requireFeature(...)` sprinkled
 * on individual routes, so every route added (or forgotten) was silently free.
 * This table is the single source of truth, enforced by one middleware mounted
 * beside enforceOrgAccess (server/routes.ts), and a source-scan test
 * (featurePolicy.test.ts) fails when a mutating route is neither gated here
 * nor explicitly declared free - so a new endpoint cannot ship unclassified.
 *
 * Count caps (staff / customers / stores) are NOT here: they are enforced in
 * the storage layer (assertWithinCountLimit) so every create/restore/bulk path
 * is covered by construction.
 *
 * Reads of data an org already owns stay open unless the feature IS the read
 * (P&L, staff-performance reports): a lapsed add-on soft-locks writes but
 * never hides or deletes history.
 */

type Method = HttpMethod;

export interface FeatureRule {
  methods: readonly Method[] | "*";
  path: RegExp;
  feature: string;
}

/**
 * Every matching rule must pass (so a route can require more than one feature).
 * Derived from the feature registry (shared/features.ts): add or change a rule
 * there, not here.
 */
export const FEATURE_RULES: readonly FeatureRule[] = FEATURE_ROUTE_RULES;

/**
 * Domains whose mutating routes are free on every plan, i.e. every API domain
 * the registry assigns to a feature. Listed at first-path-segment granularity
 * so a route added under an existing domain inherits its classification, while
 * a brand-new domain (or a gated one above) has to be decided on purpose - the
 * coverage test enforces that. Domains guarded by the storage-layer count caps
 * (staff, customers, stores) are free here.
 */
const FREE_ROUTE_DOMAINS: readonly string[] = Array.from(API_DOMAIN_OWNERS.keys());

export function matchFeatureRules(method: string, path: string): FeatureRule[] {
  const m = method.toUpperCase() as Method;
  return FEATURE_RULES.filter((rule) => (rule.methods === "*" || rule.methods.includes(m)) && rule.path.test(path));
}

/** True when a mutating route path is gated above or belongs to a declared-free domain. */
export function isClassified(path: string): boolean {
  if (FEATURE_RULES.some((rule) => rule.path.test(path))) return true;
  const domain = /^\/api\/([^/]+)/.exec(path)?.[1];
  return !!domain && FREE_ROUTE_DOMAINS.includes(domain);
}

/**
 * One middleware for the whole /api surface. Only requests matching a rule pay
 * for an entitlement lookup (memoised on res.locals, so the legacy per-route
 * requireFeature that runs later reuses it), and unauthenticated requests fall
 * through to the route's own auth.
 */
export const enforceFeaturePolicy: RequestHandler = async (req, res, next) => {
  const businessId = (req as any).user?.businessId;
  if (!businessId) return next();

  const fullPath = req.originalUrl.split("?")[0];
  const rules = matchFeatureRules(req.method, fullPath);

  try {
    // Admin-defined rules (Feature Catalog > Gate rules) on top of the code baseline.
    const adminRules = await matchDynamicRouteRules(req.method, fullPath);
    if (rules.length === 0 && adminRules.length === 0) return next();

    const granted = await getRequestEntitlements(res, businessId);
    for (const rule of rules) {
      if (!granted.has(rule.feature)) {
        return res.status(402).json(await featureNotPurchasedBody(rule.feature));
      }
    }
    for (const rule of adminRules) {
      if (!granted.has(rule.featureKey)) {
        return res.status(402).json(await featureNotPurchasedBody(rule.featureKey));
      }
      // Having the feature is not enough: a custom role also needs the Settings > Roles
      // module the feature sits under. owner/manager always pass.
      if (rule.module && !(await hasModulePermission((req as any).user, rule.module))) {
        return res.status(403).json({
          error: "module_permission_required",
          module: rule.module,
          featureKey: rule.featureKey,
          message: `Your role doesn't include ${rule.module} access. Ask an owner to update your role in Settings > Roles.`,
        });
      }
    }
    return next();
  } catch (error) {
    console.error("enforceFeaturePolicy error:", error);
    return res.status(500).json({ error: "We couldn't verify feature access. Please try again." });
  }
};
