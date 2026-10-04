import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { db } from "../db";
import { eq, inArray } from "drizzle-orm";
import { featureCatalog, featureGateRuleEvents, featureGateRules, orgFeatureEntitlements } from "@shared/schema";
import {
  GateRuleError, computeRuleImpact, createRule, deleteRule, disableRule, enableRule, listRuleEvents, revertEvent, updateRule,
} from "./gateRuleAdmin";
import { loadActiveGateRules, invalidateGateRules, matchDynamicRouteRules } from "./gateRules";
import { syncFeatureRegistry } from "./featureSync";
import {
  assertTestDatabase, ensureSchema, createFixture, sweepResidue, closePool, type Fixture,
} from "../test-support/integration-db";

/**
 * The safeguards around admin-defined gate rules, against a real database:
 * drafts enforce nothing, enabling needs the confirmed affected-org count,
 * editing a live rule drops it back to draft, and history can undo a change.
 * Needs migration 0087 on the test database (apply by hand).
 */

const ADMIN = "admin@example.test";
const KNOWN = [{ method: "POST", path: "/api/vendors" }, { method: "GET", path: "/api/vendors" }, { method: "POST", path: "/api/vendors/:id/notes" }];
const FEATURE_KEY = "product_variants"; // an existing paid feature

let featureId: string;
let fixtures: Fixture[] = [];

beforeAll(async () => {
  assertTestDatabase();
  await ensureSchema();
  await sweepResidue();
  await syncFeatureRegistry();
  const [f] = await db.select({ id: featureCatalog.id }).from(featureCatalog).where(eq(featureCatalog.key, FEATURE_KEY));
  featureId = f.id;
});

afterEach(async () => {
  const rules = await db.select({ id: featureGateRules.id }).from(featureGateRules).where(eq(featureGateRules.featureId, featureId));
  const ids = rules.map((r) => r.id);
  if (ids.length) {
    await db.delete(featureGateRuleEvents).where(inArray(featureGateRuleEvents.ruleId, ids));
    await db.delete(featureGateRules).where(inArray(featureGateRules.id, ids));
  }
  await db.delete(featureGateRuleEvents).where(eq(featureGateRuleEvents.featureKey, FEATURE_KEY));
  for (const f of fixtures) {
    await db.delete(orgFeatureEntitlements).where(eq(orgFeatureEntitlements.organisationId, f.businessId));
    await f.cleanup();
  }
  fixtures = [];
  invalidateGateRules();
});

afterAll(async () => {
  await sweepResidue();
  await closePool();
});

const draft = (pattern = "/api/vendors", methods = "writes") =>
  createRule({ featureId, kind: "route", methods, pattern }, ADMIN, KNOWN);

describe("gate rule safeguards", () => {
  it("saves a new rule as a draft that enforces nothing", async () => {
    const rule = await draft();
    expect(rule.status).toBe("draft");
    invalidateGateRules();
    expect((await loadActiveGateRules()).some((r) => r.id === rule.id)).toBe(false);
    expect(await matchDynamicRouteRules("POST", "/api/vendors")).toEqual([]);
  });

  it("refuses protected areas, unknown routes and free features before anything is written", async () => {
    await expect(createRule({ featureId, kind: "route", methods: "*", pattern: "/api/billing/pay" }, ADMIN, KNOWN)).rejects.toThrow(/protected/);
    await expect(createRule({ featureId, kind: "route", methods: "*", pattern: "/api/ghost" }, ADMIN, KNOWN)).rejects.toThrow(/No route/);
    const [free] = await db.select({ id: featureCatalog.id }).from(featureCatalog).where(eq(featureCatalog.key, "sales_module"));
    await expect(createRule({ featureId: free.id, kind: "route", methods: "*", pattern: "/api/vendors" }, ADMIN, KNOWN)).rejects.toThrow(/free feature/);
    expect(await db.select().from(featureGateRules).where(eq(featureGateRules.featureId, featureId))).toHaveLength(0);
  });

  it("rejects a duplicate rule", async () => {
    await draft();
    await expect(draft()).rejects.toThrow(/already exists/);
  });

  it("only goes live once the admin confirms the number of organisations that lose access", async () => {
    const f = await createFixture();
    fixtures.push(f);
    const rule = await draft();

    const impact = await computeRuleImpact(rule.id);
    expect(impact.wouldLoseAccess).toBeGreaterThanOrEqual(1);

    await expect(enableRule(rule.id, impact.wouldLoseAccess + 1, ADMIN)).rejects.toBeInstanceOf(GateRuleError);
    await expect(enableRule(rule.id, undefined, ADMIN)).rejects.toThrow(/changed since you previewed/);
    invalidateGateRules();
    expect(await matchDynamicRouteRules("POST", "/api/vendors")).toEqual([]);

    const { rule: live } = await enableRule(rule.id, impact.wouldLoseAccess, ADMIN);
    expect(live.status).toBe("active");
    const matched = await matchDynamicRouteRules("POST", "/api/vendors");
    expect(matched).toHaveLength(1);
    expect(matched[0].featureKey).toBe(FEATURE_KEY);
    expect(matched[0].module).toBe("Inventory & Catalog");
    expect(await matchDynamicRouteRules("GET", "/api/vendors")).toEqual([]); // writes only
  });

  it("counts an organisation that already holds the feature as keeping access", async () => {
    const f = await createFixture();
    fixtures.push(f);
    const rule = await draft();
    const before = await computeRuleImpact(rule.id);
    await db.insert(orgFeatureEntitlements).values({ organisationId: f.businessId, featureId, status: "active", source: "admin_grant" });
    const after = await computeRuleImpact(rule.id);
    expect(after.withAccess).toBe(before.withAccess + 1);
    expect(after.wouldLoseAccess).toBe(before.wouldLoseAccess - 1);
  });

  it("drops a live rule back to draft when it is edited, and stops enforcing it", async () => {
    const rule = await draft();
    const impact = await computeRuleImpact(rule.id);
    await enableRule(rule.id, impact.wouldLoseAccess, ADMIN);
    expect(await matchDynamicRouteRules("POST", "/api/vendors")).toHaveLength(1);

    const edited = await updateRule(rule.id, { methods: "POST" }, ADMIN, KNOWN);
    expect(edited.status).toBe("draft");
    expect(await matchDynamicRouteRules("POST", "/api/vendors")).toEqual([]);
  });

  it("will not delete a live rule, only a draft", async () => {
    const rule = await draft();
    const impact = await computeRuleImpact(rule.id);
    await enableRule(rule.id, impact.wouldLoseAccess, ADMIN);
    await expect(deleteRule(rule.id, ADMIN)).rejects.toThrow(/Disable/);
    await disableRule(rule.id, ADMIN);
    await deleteRule(rule.id, ADMIN);
    expect(await db.select().from(featureGateRules).where(eq(featureGateRules.id, rule.id))).toHaveLength(0);
  });

  it("refuses to enable a rule on an inactive feature, which would block everyone", async () => {
    const rule = await draft();
    await db.update(featureCatalog).set({ isActive: false }).where(eq(featureCatalog.id, featureId));
    try {
      await expect(enableRule(rule.id, 0, ADMIN)).rejects.toThrow(/inactive/);
    } finally {
      await db.update(featureCatalog).set({ isActive: true }).where(eq(featureCatalog.id, featureId));
    }
  });
});

describe("history and revert", () => {
  it("records every change", async () => {
    const rule = await draft();
    await updateRule(rule.id, { note: "why" }, ADMIN, KNOWN);
    await disableRule(rule.id, ADMIN);
    const actions = (await listRuleEvents(rule.id)).map((e) => e.action).sort();
    expect(actions).toEqual(["create", "disable", "update"]);
  });

  it("undoes an edit, restoring the earlier definition as a draft", async () => {
    const rule = await draft("/api/vendors", "writes");
    await updateRule(rule.id, { methods: "POST" }, ADMIN, KNOWN);
    const update = (await listRuleEvents(rule.id)).find((e) => e.action === "update")!;
    await revertEvent(update.id, KNOWN, ADMIN);
    const [now] = await db.select().from(featureGateRules).where(eq(featureGateRules.id, rule.id));
    expect(now.methods).toBe("writes");
    expect(now.status).toBe("draft");
  });

  it("undoes a delete, bringing the rule back as a draft, never live", async () => {
    const rule = await draft();
    await deleteRule(rule.id, ADMIN);
    const del = (await listRuleEvents(rule.id)).find((e) => e.action === "delete")!;
    const { restored } = await revertEvent(del.id, KNOWN, ADMIN);
    expect(restored).toBe(true);
    const [back] = await db.select().from(featureGateRules).where(eq(featureGateRules.id, rule.id));
    expect(back.status).toBe("draft");
    expect(await matchDynamicRouteRules("POST", "/api/vendors")).toEqual([]);
  });

  it("undoing a create removes the rule", async () => {
    const rule = await draft();
    const create = (await listRuleEvents(rule.id)).find((e) => e.action === "create")!;
    await revertEvent(create.id, KNOWN, ADMIN);
    expect(await db.select().from(featureGateRules).where(eq(featureGateRules.id, rule.id))).toHaveLength(0);
  });
});
