/**
 * Admin-defined gate rules: a super admin attaches an existing API route or
 * client screen to a feature from the UI, without a deploy. The rules in
 * shared/features.ts are the locked baseline; these can only ADD gates, never
 * loosen one, and every rule passes validateGateRule before it is saved.
 *
 * Pure and browser-safe so the server, the admin UI and the tests share one
 * definition of "what is allowed".
 */
import { API_DOMAIN_OWNERS, WRITE_METHODS, compilePathPattern, getFeatureDef, type HttpMethod } from "./features";
import { APP_SCREEN_PATHS } from "./screens";

export type GateRuleKind = "route" | "screen";
export type GateRuleStatus = "draft" | "active";

/** "*" (any method), "writes" (POST/PUT/PATCH/DELETE) or a comma list such as "POST,PATCH". */
export type MethodSpec = string;

export interface GateRuleInput {
  kind: GateRuleKind;
  methods: MethodSpec;
  pattern: string;
}

const ALL_METHODS: readonly HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/** API areas an admin rule may never touch: sign-in, billing, plan lookup, health, admin and webhooks. */
const PROTECTED_API_SEGMENTS: readonly string[] = [
  "auth", "billing", "entitlements", "health", "admin", "webhooks", "legal", "payments", "profile-completion",
  "notifications", "support", "debug",
];

/** Client paths an admin rule may never touch: the way in, the way to pay, and the account itself. */
const PROTECTED_SCREEN_PREFIXES: readonly string[] = [
  "/auth", "/activate", "/terms", "/privacy", "/data-usage", "/legal", "/verify", "/guarantor", "/onboarding",
  "/complete-profile", "/settings/billing", "/profile", "/help-support", "/super-admin", "/my-booking",
];

const SAFE_PATTERN = /^\/[A-Za-z0-9_\-./:]*$/;

export function parseMethods(spec: MethodSpec): readonly HttpMethod[] | "*" | null {
  const s = spec.trim();
  if (s === "*") return "*";
  if (s.toLowerCase() === "writes") return WRITE_METHODS;
  const parts = s.split(",").map((p) => p.trim().toUpperCase()).filter(Boolean);
  if (!parts.length || !parts.every((p) => (ALL_METHODS as readonly string[]).includes(p))) return null;
  return Array.from(new Set(parts)) as HttpMethod[];
}

export function describeMethods(spec: MethodSpec): string {
  const m = parseMethods(spec);
  if (m === "*") return "any method";
  if (m === WRITE_METHODS) return "writes";
  return m ? m.join(", ") : spec;
}

export interface ValidateOptions {
  /** The feature the rule would attach to (undefined = it does not exist). */
  feature?: { key: string; tierType: string; isActive: boolean } | null;
  /** Real routes in the running app, to confirm the pattern matches something. */
  knownRoutes?: readonly { method: string; path: string }[];
}

/** Returns a reason the rule must not be saved, or null when it is safe. */
export function validateGateRule(rule: GateRuleInput, options: ValidateOptions = {}): string | null {
  const { feature, knownRoutes } = options;
  if (feature === null) return "That feature does not exist.";
  if (feature) {
    if (feature.tierType === "free") {
      return "A free feature is granted to every organisation, so a gate on it would do nothing. Attach the rule to a paid feature.";
    }
    if (feature.tierType === "bundle_child") {
      return "A bundle child is only granted through its parent. Attach the rule to the parent bundle.";
    }
  }

  const pattern = rule.pattern.trim();
  if (!SAFE_PATTERN.test(pattern) || pattern.includes("//") || pattern.includes("..")) {
    return "The path may only contain letters, numbers, / - _ . and :param segments.";
  }
  if (pattern.length > 200) return "The path is too long.";
  if (!parseMethods(rule.methods)) return "Methods must be *, writes, or a list such as POST,PATCH.";

  if (rule.kind === "route") {
    if (!pattern.startsWith("/api/")) return "A route rule must start with /api/.";
    const segments = pattern.split("/").filter(Boolean);
    if (segments.length < 2) return "A route rule must name a specific area, not all of /api.";
    if (segments.some((s) => s.startsWith(":")) && segments[1].startsWith(":")) return "The first segment after /api must be a fixed name.";
    if (PROTECTED_API_SEGMENTS.includes(segments[1])) {
      return `/api/${segments[1]} is protected: gating it could lock people out of sign-in, billing or their account.`;
    }
    const methods = parseMethods(rule.methods);
    if (knownRoutes) {
      const re = compilePathPattern(pattern);
      const hit = knownRoutes.some(
        (r) => re.test(r.path) && (methods === "*" || (methods as readonly string[]).includes(r.method.toUpperCase())),
      );
      if (!hit) return "No route in the app matches that path and method. Pick one from the list.";
    }
    return null;
  }

  // screen
  if (pattern === "/" || PROTECTED_SCREEN_PREFIXES.some((p) => pattern === p || pattern.startsWith(`${p}/`))) {
    return "That screen is protected: gating it could lock people out of sign-in, billing or their account.";
  }
  if (!APP_SCREEN_PATHS.includes(pattern)) return "That screen does not exist in the app. Pick one from the list.";
  if (rule.methods.trim() !== "*") return "Screen rules do not use methods.";
  return null;
}

/** Free-core API domains a rule would newly restrict, for the "this affects free functionality" warning. */
export function freeDomainsTouched(pattern: string): string[] {
  const seg = pattern.split("/").filter(Boolean)[1];
  if (!seg) return [];
  const owner = API_DOMAIN_OWNERS.get(seg);
  if (!owner) return [];
  return getFeatureDef(owner)?.tier === "free" ? [seg] : [];
}

export interface ActiveRouteRule { featureKey: string; methods: string; pattern: string }

export function routeRuleMatches(rule: ActiveRouteRule, method: string, path: string): boolean {
  const methods = parseMethods(rule.methods);
  if (!methods) return false;
  if (methods !== "*" && !(methods as readonly string[]).includes(method.toUpperCase())) return false;
  return compilePathPattern(rule.pattern).test(path);
}

export interface ScreenGateEntry { pattern: string; featureKey: string }

/** Most specific gated screen wins; the caller supplies the baseline entries plus any admin rules. */
export function findGatedScreen(path: string, entries: readonly ScreenGateEntry[]): string | null {
  const clean = path.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
  let best: ScreenGateEntry | null = null;
  for (const e of entries) {
    if (compilePathPattern(e.pattern).test(clean) && (!best || e.pattern.length > best.pattern.length)) best = e;
  }
  return best?.featureKey ?? null;
}
