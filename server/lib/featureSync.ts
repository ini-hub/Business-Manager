import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { featureCatalog, featureDependencies, featureFlags, organisations, orgFeatureEntitlements, type FeatureCatalog } from "@shared/schema";
import { FEATURES, getFeatureDef, launchesForReview, type FeatureDef } from "@shared/features";

/**
 * Pushes the code registry (shared/features.ts) into feature_catalog,
 * feature_dependencies and feature_flags.
 *
 * Ownership rule: the registry owns STRUCTURE (name, description, category,
 * tier, parent, limits, sort order, dependencies); the database owns
 * OPERATIONAL STATE (prices, is_active, flag status). A row the sync creates
 * gets the registry's price/active as defaults, but an existing row's price,
 * currency, is_active and flag status are never touched, so an admin's edit
 * survives every deploy. Idempotent: a second run reports no changes.
 *
 * Launch rule: a priced feature the sync creates (see launchesForReview) starts INACTIVE and
 * 'pending_review', so it is hidden and unpurchasable, and is not grandfathered to anyone, until a super
 * admin prices and publishes it (publishFeature, below). That is what makes it safe to sync on every boot:
 * a deploy can add features but never switches a paid one on. The exception is an empty catalog (a fresh
 * database), where there is no admin to review anything, so the first seed publishes everything.
 *
 * This is also the supported way to repair an empty catalog. Do not re-run the
 * old seed INSERTs from migrations 0048/0057 by hand: since 0086 a catalog row
 * cannot exist without its flag.
 */

type DbOrTx = Pick<typeof db, "select" | "insert" | "update" | "delete" | "execute">;

export interface SyncReport {
  createdFeatures: string[];
  createdFlags: string[];
  /** Created this run and left inactive until a super admin publishes them. */
  pendingReview: string[];
  updatedFeatures: { key: string; fields: string[] }[];
  createdDependencies: string[];
  /** Edges from a bundled child to its own parent: redundant (the parent grants it) and they would block cancelling the parent. */
  removedDependencies: string[];
  /** Newly created paid features granted for free to the organisations that already existed. */
  grandfathered: { key: string; organisations: number }[];
  /** A new bundle granted to the organisations that held one of the features it now contains. */
  absorbed: { key: string; organisations: number }[];
  /** In the database but not in the registry (left alone; e.g. a stray test row). */
  dbOnlyFeatures: string[];
}

type StructuralFields = Pick<
  FeatureCatalog,
  "name" | "description" | "category" | "tierType" | "freeLimit" | "limitType" | "tierCapacity" | "sortOrder" | "permissionModule" | "section"
>;

function structuralFields(def: FeatureDef): StructuralFields {
  return {
    name: def.name,
    description: def.description,
    category: def.category,
    tierType: def.tier,
    freeLimit: def.freeLimit ?? null,
    limitType: def.limitType ?? null,
    tierCapacity: def.tierCapacity ?? null,
    sortOrder: def.sortOrder,
    permissionModule: def.module,
    section: def.section,
  };
}

/** Names of the structural columns where an existing row differs from the registry. */
export function diffStructure(def: FeatureDef, row: StructuralFields): string[] {
  const want = structuralFields(def);
  return (Object.keys(want) as (keyof StructuralFields)[]).filter((k) => want[k] !== row[k]);
}

/** Grants a feature (source 'grandfathered') to every organisation that exists now; returns how many. Idempotent. */
async function grandfatherToExistingOrgs(tx: DbOrTx, featureId: string): Promise<number> {
  const orgs = await tx.select({ id: organisations.id }).from(organisations);
  if (orgs.length > 0) {
    await tx
      .insert(orgFeatureEntitlements)
      .values(orgs.map((o) => ({ organisationId: o.id, featureId, status: "active", source: "grandfathered" })))
      .onConflictDoNothing();
  }
  return orgs.length;
}

export interface PublishResult {
  feature: FeatureCatalog;
  /** Organisations that were granted it for free because it used to be free (registry `grandfather`). */
  grandfathered: number;
}

/**
 * Takes a feature the sync created pending review live: applies the admin's price, activates it and runs the
 * grandfathering the sync held back. Returns null when the feature does not exist or is already published
 * (a second click is harmless and grants nothing twice).
 */
export async function publishFeature(
  id: string,
  price?: { priceMonthly?: number | null; priceAnnual?: number | null },
  lookup: (key: string) => FeatureDef | undefined = getFeatureDef,
): Promise<PublishResult | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(featureCatalog).where(eq(featureCatalog.id, id)).for("update");
    if (!row || row.reviewStatus !== "pending_review") return null;
    const [feature] = await tx
      .update(featureCatalog)
      .set({
        isActive: true,
        reviewStatus: "published",
        updatedAt: new Date(),
        ...(price?.priceMonthly !== undefined ? { priceMonthly: price.priceMonthly } : {}),
        ...(price?.priceAnnual !== undefined ? { priceAnnual: price.priceAnnual } : {}),
      })
      .where(eq(featureCatalog.id, id))
      .returning();
    const def = lookup(row.key);
    const grandfathered = def?.grandfather && row.tierType !== "free" && row.tierType !== "bundle_child"
      ? await grandfatherToExistingOrgs(tx, row.id)
      : 0;
    return { feature, grandfathered };
  });
}

export async function syncFeatureRegistry(
  options: { dryRun?: boolean; features?: readonly FeatureDef[]; publishNew?: boolean } = {},
): Promise<SyncReport> {
  const features = options.features ?? (FEATURES as readonly FeatureDef[]);
  const report: SyncReport = {
    createdFeatures: [], createdFlags: [], pendingReview: [], updatedFeatures: [], createdDependencies: [], removedDependencies: [], grandfathered: [], absorbed: [], dbOnlyFeatures: [],
  };

  // A dry run still goes through a transaction, and rolls it back at the end.
  class DryRunRollback extends Error {}

  const run = async (tx: DbOrTx) => {
    // Two instances booting together (rolling deploy) must not both insert the same rows.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('feature_sync'))`);
    const existing = new Map((await tx.select().from(featureCatalog)).map((r) => [r.key, r]));
    const publishNew = options.publishNew === true || existing.size === 0;
    const initialKeys = new Set(existing.keys());
    const flagsByName = new Map((await tx.select().from(featureFlags)).map((f) => [f.name, f]));

    const idByKey = new Map<string, string>();

    for (const def of features) {
      let flag = flagsByName.get(def.key);
      if (!flag) {
        [flag] = await tx
          .insert(featureFlags)
          .values({ name: def.key, status: "on", description: def.name, updatedBy: "feature sync" })
          .returning();
        flagsByName.set(def.key, flag);
        report.createdFlags.push(def.key);
      }

      const row = existing.get(def.key);
      if (!row) {
        // A new parent that already has children in the database cannot start dark: those children are hidden
        // while their parent is, and a bundle that absorbs old features would retire them while it is hidden.
        const adoptsExisting = features.some((f) => f.parent === def.key && initialKeys.has(f.key));
        const dark = !publishNew && !adoptsExisting && launchesForReview(def);
        const [created] = await tx
          .insert(featureCatalog)
          .values({
            key: def.key,
            ...structuralFields(def),
            priceMonthly: def.price?.monthly ?? null,
            priceAnnual: def.price?.annual ?? null,
            isActive: def.active && !dark,
            reviewStatus: dark ? "pending_review" : "published",
            flagId: flag.id,
          })
          .returning();
        idByKey.set(def.key, created.id);
        existing.set(def.key, created);
        report.createdFeatures.push(def.key);
        if (dark) report.pendingReview.push(def.key);
        // A module that used to be free is now paid: organisations that already exist keep
        // it (source 'grandfathered'); the super admin can later schedule a sunset.
        // A feature left pending review is granted at publish time instead (publishFeature).
        if (!dark && def.grandfather && def.active && def.tier !== "free" && def.tier !== "bundle_child") {
          report.grandfathered.push({ key: def.key, organisations: await grandfatherToExistingOrgs(tx, created.id) });
        }
        continue;
      }

      idByKey.set(def.key, row.id);
      const fields = diffStructure(def, row);
      // A feature that was free and is now paid: organisations that exist right now keep it.
      if (def.grandfather && def.active && row.tierType === "free" && def.tier !== "free" && def.tier !== "bundle_child") {
        report.grandfathered.push({ key: def.key, organisations: await grandfatherToExistingOrgs(tx, row.id) });
      }
      // The registry only fills a MISSING price (a free feature that just became paid); it never overwrites an admin's.
      if (def.price && row.priceMonthly == null && row.priceAnnual == null && def.tier !== "free") {
        await tx.update(featureCatalog).set({ priceMonthly: def.price.monthly, priceAnnual: def.price.annual, updatedAt: new Date() }).where(eq(featureCatalog.id, row.id));
        fields.push("price (filled)");
      }
      if (fields.length > 0) {
        await tx
          .update(featureCatalog)
          .set({ ...structuralFields(def), updatedAt: new Date() })
          .where(eq(featureCatalog.id, row.id));
        report.updatedFeatures.push({ key: def.key, fields });
      }
    }

    // Bundle parents (needs every id to exist first).
    const reparented: FeatureDef[] = [];
    for (const def of features) {
      const row = existing.get(def.key)!;
      const wantParent = def.parent ? idByKey.get(def.parent) ?? null : null;
      if ((row.parentFeatureId ?? null) !== wantParent) {
        if (wantParent) reparented.push(def);
        await tx.update(featureCatalog).set({ parentFeatureId: wantParent, updatedAt: new Date() }).where(eq(featureCatalog.id, row.id));
        const prior = report.updatedFeatures.find((u) => u.key === def.key);
        if (prior) prior.fields.push("parentFeatureId");
        else if (!report.createdFeatures.includes(def.key)) report.updatedFeatures.push({ key: def.key, fields: ["parentFeatureId"] });
      }
    }

    // A feature that just became a child of a parent (Stock Transfers under Additional Store) is granted by that
    // parent now, so a separate row an organisation still holds for it would bill twice. For organisations that
    // hold the parent, retire the child's own rows; anyone holding only the child keeps it as it was.
    for (const def of reparented) {
      const parentId = idByKey.get(def.parent!)!;
      const childId = idByKey.get(def.key)!;
      const holders = (await tx.select({ org: orgFeatureEntitlements.organisationId }).from(orgFeatureEntitlements)
        .where(and(eq(orgFeatureEntitlements.featureId, parentId), inArray(orgFeatureEntitlements.status, ["active", "pending_removal"])))).map((r) => r.org);
      if (holders.length === 0) continue;
      const own = await tx.select({ id: orgFeatureEntitlements.id }).from(orgFeatureEntitlements)
        .where(and(eq(orgFeatureEntitlements.featureId, childId), inArray(orgFeatureEntitlements.organisationId, holders), inArray(orgFeatureEntitlements.status, ["active", "pending_removal"])));
      if (own.length > 0) {
        await tx.update(orgFeatureEntitlements).set({ status: "removed", updatedAt: new Date() }).where(inArray(orgFeatureEntitlements.id, own.map((r) => r.id)));
        report.absorbed.push({ key: `${def.key} -> ${def.parent}`, organisations: own.length });
      }
    }

    // A bundle created this run that swallows features once sold alone: whoever held any of
    // them gets the bundle, and the old rows are retired (the bundle grants the children).
    for (const def of features) {
      if (!def.absorbs?.length || !report.createdFeatures.includes(def.key)) continue;
      const bundleId = idByKey.get(def.key)!;
      const childIds = def.absorbs.map((k) => idByKey.get(k)).filter((id): id is string => !!id);
      const held = childIds.length
        ? await tx.select().from(orgFeatureEntitlements).where(and(inArray(orgFeatureEntitlements.featureId, childIds), inArray(orgFeatureEntitlements.status, ["active", "pending_removal"])))
        : [];
      const best = new Map<string, (typeof held)[number]>();
      // Keep the most generous row per organisation: active over pending removal, then paid over comped.
      const rank = (r: (typeof held)[number]) => (r.status === "active" ? 2 : 0) + (r.source === "purchased" ? 1 : 0);
      for (const row of held) {
        const cur = best.get(row.organisationId);
        if (!cur || rank(row) > rank(cur) || (rank(row) === rank(cur) && (row.removalEffectiveAt?.getTime() ?? Infinity) > (cur.removalEffectiveAt?.getTime() ?? Infinity))) best.set(row.organisationId, row);
      }
      if (best.size > 0) {
        await tx.insert(orgFeatureEntitlements).values(Array.from(best.values()).map((r) => ({
          organisationId: r.organisationId, featureId: bundleId, status: r.status, source: r.source,
          effectiveFrom: r.effectiveFrom, removalEffectiveAt: r.removalEffectiveAt,
          subscriptionPaymentId: r.subscriptionPaymentId, grantedByAdminId: r.grantedByAdminId,
        }))).onConflictDoNothing();
        await tx.update(orgFeatureEntitlements).set({ status: "removed", updatedAt: new Date() }).where(inArray(orgFeatureEntitlements.id, held.map((r) => r.id)));
      }
      report.absorbed.push({ key: def.key, organisations: best.size });
    }

    // Product-tree nesting (display only), same two-pass shape as bundle parents.
    for (const def of features) {
      const row = existing.get(def.key)!;
      const want = def.groupParent ? idByKey.get(def.groupParent) ?? null : null;
      if ((row.groupParentFeatureId ?? null) !== want) {
        await tx.update(featureCatalog).set({ groupParentFeatureId: want, updatedAt: new Date() }).where(eq(featureCatalog.id, row.id));
        const prior = report.updatedFeatures.find((u) => u.key === def.key);
        if (prior) prior.fields.push("groupParentFeatureId");
        else if (!report.createdFeatures.includes(def.key)) report.updatedFeatures.push({ key: def.key, fields: ["groupParentFeatureId"] });
      }
    }

    // Dependencies: add what is missing. Edges an admin added in the UI are kept.
    const ids = Array.from(idByKey.values());
    const edges = ids.length ? await tx.select().from(featureDependencies).where(inArray(featureDependencies.featureId, ids)) : [];
    const haveEdge = new Set(edges.map((e) => `${e.featureId}>${e.dependsOnFeatureId}`));
    for (const def of features) {
      for (const dep of def.dependsOn ?? []) {
        const from = idByKey.get(def.key)!;
        const to = idByKey.get(dep)!;
        if (haveEdge.has(`${from}>${to}`)) continue;
        await tx.insert(featureDependencies).values({ featureId: from, dependsOnFeatureId: to }).onConflictDoNothing();
        report.createdDependencies.push(`${def.key} -> ${dep}`);
      }
    }

    // A child that "depends on" the parent granting it (old Stock Transfers -> Additional Store) is redundant now and
    // would stop an owner cancelling the parent while the child is granted. Drop just those edges; others stay.
    for (const def of features) {
      if (!def.parent) continue;
      const childId = idByKey.get(def.key);
      const parentId = idByKey.get(def.parent);
      if (!childId || !parentId || !haveEdge.has(`${childId}>${parentId}`)) continue;
      await tx.delete(featureDependencies).where(and(eq(featureDependencies.featureId, childId), eq(featureDependencies.dependsOnFeatureId, parentId)));
      report.removedDependencies.push(`${def.key} -> ${def.parent}`);
    }

    const registryKeys = new Set(features.map((f) => f.key));
    report.dbOnlyFeatures = Array.from(existing.keys()).filter((k) => !registryKeys.has(k));
  };

  try {
    await db.transaction(async (tx) => {
      await run(tx);
      if (options.dryRun) throw new DryRunRollback();
    });
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
  }

  return report;
}

export function formatSyncReport(r: SyncReport): string {
  const lines = [
    `created features:     ${r.createdFeatures.length ? r.createdFeatures.join(", ") : "none"}`,
    `created flags:        ${r.createdFlags.length ? r.createdFlags.join(", ") : "none"}`,
    `pending review:       ${r.pendingReview.length ? r.pendingReview.join(", ") : "none"}`,
    `updated features:     ${r.updatedFeatures.length ? r.updatedFeatures.map((u) => `${u.key} (${u.fields.join(", ")})`).join("; ") : "none"}`,
    `created dependencies: ${r.createdDependencies.length ? r.createdDependencies.join(", ") : "none"}`,
    `removed dependencies: ${r.removedDependencies.length ? r.removedDependencies.join(", ") : "none"}`,
    `grandfathered:        ${r.grandfathered.length ? r.grandfathered.map((g) => `${g.key} (${g.organisations} orgs)`).join(", ") : "none"}`,
    `absorbed into bundles: ${r.absorbed.length ? r.absorbed.map((g) => `${g.key} (${g.organisations} orgs)`).join(", ") : "none"}`,
    `in DB, not in registry (left alone): ${r.dbOnlyFeatures.length ? r.dbOnlyFeatures.join(", ") : "none"}`,
  ];
  return lines.join("\n");
}

export function syncReportIsClean(r: SyncReport): boolean {
  return !r.createdFeatures.length && !r.createdFlags.length && !r.updatedFeatures.length && !r.createdDependencies.length && !r.removedDependencies.length;
}
