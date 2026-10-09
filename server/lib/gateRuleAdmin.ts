import { and, desc, eq, gt, or } from "drizzle-orm";
import { isUniqueViolation } from "../db-errors";
import { db } from "../db";
import {
  featureCatalog, featureFlags, featureGateRuleEvents, featureGateRules, orgFeatureEntitlements, organisations,
  type FeatureGateRule,
} from "@shared/schema";
import { freeDomainsTouched, validateGateRule, type GateRuleInput, type GateRuleKind } from "@shared/gateRules";
import { isOrgTrialing } from "./trial";
import { invalidateGateRules } from "./gateRules";

/**
 * The write side of admin-defined gate rules. Every function here is a safeguard
 * point, so the HTTP layer stays thin:
 *   - validateGateRule must pass (protected areas, free/child features, real routes/screens)
 *   - a rule is saved as a DRAFT and enforces nothing until enabled
 *   - editing a live rule drops it back to draft, so a change is never silently live
 *   - enabling needs the admin to confirm how many organisations would lose access
 *   - every change is written to feature_gate_rule_events, which can be reverted
 */

export class GateRuleError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export interface RuleImpact {
  totalOrgs: number;
  withAccess: number;
  trialing: number;
  wouldLoseAccess: number;
  sample: string[];
  featureActive: boolean;
  /** The feature's own flag is off: it is blocked for everyone regardless of this rule. */
  flagOff: boolean;
  /** Free-core API areas this rule would newly restrict. */
  freeDomainsTouched: string[];
}

async function loadFeature(featureId: string) {
  const [feature] = await db
    .select({
      id: featureCatalog.id, key: featureCatalog.key, name: featureCatalog.name, tierType: featureCatalog.tierType,
      isActive: featureCatalog.isActive, flagId: featureCatalog.flagId,
    })
    .from(featureCatalog)
    .where(eq(featureCatalog.id, featureId))
    .limit(1);
  return feature ?? null;
}

async function loadRule(id: string): Promise<FeatureGateRule> {
  const [rule] = await db.select().from(featureGateRules).where(eq(featureGateRules.id, id)).limit(1);
  if (!rule) throw new GateRuleError(404, "Gate rule not found.");
  return rule;
}

async function record(ruleId: string, featureKey: string, action: string, before: unknown, after: unknown, adminEmail: string) {
  await db.insert(featureGateRuleEvents).values({
    ruleId, featureKey, action, before: before as any, after: after as any, adminEmail,
  });
}

function asInput(r: Pick<FeatureGateRule, "kind" | "methods" | "pattern">): GateRuleInput {
  return { kind: r.kind as GateRuleKind, methods: r.methods, pattern: r.pattern };
}

/** How many organisations would lose access if this rule went live. Read-only. */
export async function computeRuleImpact(ruleId: string): Promise<RuleImpact> {
  const rule = await loadRule(ruleId);
  const feature = await loadFeature(rule.featureId);
  if (!feature) throw new GateRuleError(404, "The rule's feature no longer exists.");

  const orgs = await db
    .select({ id: organisations.id, name: organisations.name, status: organisations.status, trialEndsAt: organisations.trialEndsAt })
    .from(organisations);
  const live = orgs.filter((o) => o.status !== "suspended");

  const now = new Date();
  const holderRows = await db
    .select({ organisationId: orgFeatureEntitlements.organisationId })
    .from(orgFeatureEntitlements)
    .where(
      and(
        eq(orgFeatureEntitlements.featureId, feature.id),
        or(
          eq(orgFeatureEntitlements.status, "active"),
          and(eq(orgFeatureEntitlements.status, "pending_removal"), gt(orgFeatureEntitlements.removalEffectiveAt, now)),
        ),
      ),
    );
  const holders = new Set(holderRows.map((h) => h.organisationId));

  const [flag] = await db.select({ status: featureFlags.status }).from(featureFlags).where(eq(featureFlags.id, feature.flagId)).limit(1);
  const flagOff = flag?.status === "off";

  const trialing = live.filter((o) => isOrgTrialing(o));
  const trialingIds = new Set(trialing.map((o) => o.id));
  const losing = live.filter((o) => !holders.has(o.id) && !trialingIds.has(o.id));

  return {
    totalOrgs: live.length,
    withAccess: live.filter((o) => holders.has(o.id)).length,
    trialing: trialing.length,
    wouldLoseAccess: losing.length,
    sample: losing.slice(0, 10).map((o) => o.name ?? o.id),
    featureActive: feature.isActive,
    flagOff,
    freeDomainsTouched: rule.kind === "route" ? freeDomainsTouched(rule.pattern) : [],
  };
}

export async function createRule(
  input: GateRuleInput & { featureId: string; note?: string | null },
  adminEmail: string,
  knownRoutes: { method: string; path: string }[],
): Promise<FeatureGateRule> {
  const feature = await loadFeature(input.featureId);
  const problem = validateGateRule(input, { feature: feature ?? null, knownRoutes });
  if (problem) throw new GateRuleError(400, problem);

  try {
    const [created] = await db
      .insert(featureGateRules)
      .values({
        featureId: input.featureId, kind: input.kind, methods: input.methods.trim(), pattern: input.pattern.trim(),
        note: input.note ?? null, status: "draft", createdBy: adminEmail, updatedBy: adminEmail,
      })
      .returning();
    await record(created.id, feature!.key, "create", null, created, adminEmail);
    return created;
  } catch (error: any) {
    if (isUniqueViolation(error)) throw new GateRuleError(409, "That exact rule already exists for this feature.");
    throw error;
  }
}

export async function updateRule(
  id: string,
  patch: Partial<Pick<GateRuleInput, "methods" | "pattern">> & { note?: string | null },
  adminEmail: string,
  knownRoutes: { method: string; path: string }[],
): Promise<FeatureGateRule> {
  const before = await loadRule(id);
  const feature = await loadFeature(before.featureId);
  const next = { ...asInput(before), ...(patch.methods !== undefined ? { methods: patch.methods } : {}), ...(patch.pattern !== undefined ? { pattern: patch.pattern } : {}) };
  const problem = validateGateRule(next, { feature: feature ?? null, knownRoutes });
  if (problem) throw new GateRuleError(400, problem);

  try {
    const [updated] = await db
      .update(featureGateRules)
      .set({
        methods: next.methods.trim(), pattern: next.pattern.trim(),
        note: patch.note !== undefined ? patch.note : before.note,
        // A live rule that is edited is no longer the rule that was approved: back to draft.
        status: "draft", updatedBy: adminEmail, updatedAt: new Date(),
      })
      .where(eq(featureGateRules.id, id))
      .returning();
    await record(id, feature!.key, "update", before, updated, adminEmail);
    invalidateGateRules();
    return updated;
  } catch (error: any) {
    if (isUniqueViolation(error)) throw new GateRuleError(409, "That exact rule already exists for this feature.");
    throw error;
  }
}

export async function enableRule(id: string, confirmAffectedOrgs: unknown, adminEmail: string): Promise<{ rule: FeatureGateRule; impact: RuleImpact }> {
  const before = await loadRule(id);
  const feature = await loadFeature(before.featureId);
  if (!feature) throw new GateRuleError(404, "The rule's feature no longer exists.");
  const problem = validateGateRule(asInput(before), { feature });
  if (problem) throw new GateRuleError(400, problem);
  if (!feature.isActive) {
    throw new GateRuleError(409, "This feature is inactive, so no organisation holds it and the rule would block everyone. Activate the feature first.");
  }

  const impact = await computeRuleImpact(id);
  if (impact.flagOff) {
    throw new GateRuleError(409, "This feature's flag is off, which blocks it for everyone. Switch the flag on before enabling a rule.");
  }
  // The admin must have seen the preview: they send the number they were shown, and it has to still be true.
  if (confirmAffectedOrgs !== impact.wouldLoseAccess) {
    throw new GateRuleError(409, "The number of affected organisations changed since you previewed it. Review the preview again.", impact);
  }

  const [rule] = await db
    .update(featureGateRules)
    .set({ status: "active", updatedBy: adminEmail, updatedAt: new Date() })
    .where(eq(featureGateRules.id, id))
    .returning();
  await record(id, feature.key, "enable", before, { ...rule, affectedOrgs: impact.wouldLoseAccess }, adminEmail);
  invalidateGateRules();
  return { rule, impact };
}

export async function disableRule(id: string, adminEmail: string): Promise<FeatureGateRule> {
  const before = await loadRule(id);
  const feature = await loadFeature(before.featureId);
  const [rule] = await db
    .update(featureGateRules)
    .set({ status: "draft", updatedBy: adminEmail, updatedAt: new Date() })
    .where(eq(featureGateRules.id, id))
    .returning();
  await record(id, feature?.key ?? "unknown", "disable", before, rule, adminEmail);
  invalidateGateRules();
  return rule;
}

/** Only a draft can be deleted: turn a live rule off first, so removal is never also a surprise change in access. */
export async function deleteRule(id: string, adminEmail: string): Promise<void> {
  const before = await loadRule(id);
  if (before.status === "active") throw new GateRuleError(409, "Disable this rule before deleting it.");
  const feature = await loadFeature(before.featureId);
  await db.delete(featureGateRules).where(eq(featureGateRules.id, id));
  await record(id, feature?.key ?? "unknown", "delete", before, null, adminEmail);
  invalidateGateRules();
}

export async function listRuleEvents(ruleId?: string, limit = 100) {
  const q = db.select().from(featureGateRuleEvents);
  return (ruleId ? q.where(eq(featureGateRuleEvents.ruleId, ruleId)) : q).orderBy(desc(featureGateRuleEvents.createdAt)).limit(limit);
}

/**
 * Puts a rule back to how it was before an event. The restored rule is always a
 * DRAFT: reverting never switches enforcement on, it only restores the definition
 * (enabling is its own confirmed step). Reverting a "create" deletes the rule.
 */
export async function revertEvent(eventId: string, knownRoutes: { method: string; path: string }[], adminEmail: string): Promise<{ restored: boolean }> {
  const [event] = await db.select().from(featureGateRuleEvents).where(eq(featureGateRuleEvents.id, eventId)).limit(1);
  if (!event) throw new GateRuleError(404, "History entry not found.");

  const [existing] = await db.select().from(featureGateRules).where(eq(featureGateRules.id, event.ruleId)).limit(1);
  const before = event.before as FeatureGateRule | null;

  if (!before) {
    if (existing) {
      if (existing.status === "active") await disableRule(existing.id, adminEmail);
      await deleteRule(existing.id, adminEmail);
    }
    await record(event.ruleId, event.featureKey, "revert", existing ?? null, null, adminEmail);
    return { restored: false };
  }

  const feature = await loadFeature(before.featureId);
  const problem = validateGateRule(asInput(before), { feature: feature ?? null, knownRoutes });
  if (problem) throw new GateRuleError(409, `That earlier version is no longer allowed: ${problem}`);

  if (existing) {
    await db
      .update(featureGateRules)
      .set({ methods: before.methods, pattern: before.pattern, note: before.note, status: "draft", updatedBy: adminEmail, updatedAt: new Date() })
      .where(eq(featureGateRules.id, existing.id));
  } else {
    await db.insert(featureGateRules).values({
      id: before.id, featureId: before.featureId, kind: before.kind, methods: before.methods, pattern: before.pattern,
      note: before.note, status: "draft", createdBy: before.createdBy, updatedBy: adminEmail,
    });
  }
  await record(event.ruleId, event.featureKey, "revert", existing ?? null, { ...before, status: "draft" }, adminEmail);
  invalidateGateRules();
  return { restored: true };
}

export async function listRulesWithFeature() {
  return db
    .select({
      id: featureGateRules.id, kind: featureGateRules.kind, methods: featureGateRules.methods, pattern: featureGateRules.pattern,
      status: featureGateRules.status, note: featureGateRules.note, updatedBy: featureGateRules.updatedBy, updatedAt: featureGateRules.updatedAt,
      featureId: featureCatalog.id, featureKey: featureCatalog.key, featureName: featureCatalog.name, module: featureCatalog.permissionModule,
    })
    .from(featureGateRules)
    .innerJoin(featureCatalog, eq(featureCatalog.id, featureGateRules.featureId))
    .orderBy(featureGateRules.pattern);
}
