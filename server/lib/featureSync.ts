import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { featureCatalog, featureDependencies, featureFlags, type FeatureCatalog } from "@shared/schema";
import { FEATURES, type FeatureDef } from "@shared/features";

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
 * This is also the supported way to repair an empty catalog. Do not re-run the
 * old seed INSERTs from migrations 0048/0057 by hand: since 0086 a catalog row
 * cannot exist without its flag.
 */

type DbOrTx = Pick<typeof db, "select" | "insert" | "update">;

export interface SyncReport {
  createdFeatures: string[];
  createdFlags: string[];
  updatedFeatures: { key: string; fields: string[] }[];
  createdDependencies: string[];
  /** In the database but not in the registry (left alone; e.g. a stray test row). */
  dbOnlyFeatures: string[];
}

type StructuralFields = Pick<
  FeatureCatalog,
  "name" | "description" | "category" | "tierType" | "freeLimit" | "limitType" | "sortOrder" | "permissionModule"
>;

function structuralFields(def: FeatureDef): StructuralFields {
  return {
    name: def.name,
    description: def.description,
    category: def.category,
    tierType: def.tier,
    freeLimit: def.freeLimit ?? null,
    limitType: def.limitType ?? null,
    sortOrder: def.sortOrder,
    permissionModule: def.module,
  };
}

/** Names of the structural columns where an existing row differs from the registry. */
export function diffStructure(def: FeatureDef, row: StructuralFields): string[] {
  const want = structuralFields(def);
  return (Object.keys(want) as (keyof StructuralFields)[]).filter((k) => want[k] !== row[k]);
}

export async function syncFeatureRegistry(
  options: { dryRun?: boolean; features?: readonly FeatureDef[] } = {},
): Promise<SyncReport> {
  const features = options.features ?? (FEATURES as readonly FeatureDef[]);
  const report: SyncReport = {
    createdFeatures: [], createdFlags: [], updatedFeatures: [], createdDependencies: [], dbOnlyFeatures: [],
  };

  // A dry run still goes through a transaction, and rolls it back at the end.
  class DryRunRollback extends Error {}

  const run = async (tx: DbOrTx) => {
    const existing = new Map((await tx.select().from(featureCatalog)).map((r) => [r.key, r]));
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
        const [created] = await tx
          .insert(featureCatalog)
          .values({
            key: def.key,
            ...structuralFields(def),
            priceMonthly: def.price?.monthly ?? null,
            priceAnnual: def.price?.annual ?? null,
            isActive: def.active,
            flagId: flag.id,
          })
          .returning();
        idByKey.set(def.key, created.id);
        existing.set(def.key, created);
        report.createdFeatures.push(def.key);
        continue;
      }

      idByKey.set(def.key, row.id);
      const fields = diffStructure(def, row);
      if (fields.length > 0) {
        await tx
          .update(featureCatalog)
          .set({ ...structuralFields(def), updatedAt: new Date() })
          .where(eq(featureCatalog.id, row.id));
        report.updatedFeatures.push({ key: def.key, fields });
      }
    }

    // Bundle parents (needs every id to exist first).
    for (const def of features) {
      const row = existing.get(def.key)!;
      const wantParent = def.parent ? idByKey.get(def.parent) ?? null : null;
      if ((row.parentFeatureId ?? null) !== wantParent) {
        await tx.update(featureCatalog).set({ parentFeatureId: wantParent, updatedAt: new Date() }).where(eq(featureCatalog.id, row.id));
        const prior = report.updatedFeatures.find((u) => u.key === def.key);
        if (prior) prior.fields.push("parentFeatureId");
        else if (!report.createdFeatures.includes(def.key)) report.updatedFeatures.push({ key: def.key, fields: ["parentFeatureId"] });
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
    `updated features:     ${r.updatedFeatures.length ? r.updatedFeatures.map((u) => `${u.key} (${u.fields.join(", ")})`).join("; ") : "none"}`,
    `created dependencies: ${r.createdDependencies.length ? r.createdDependencies.join(", ") : "none"}`,
    `in DB, not in registry (left alone): ${r.dbOnlyFeatures.length ? r.dbOnlyFeatures.join(", ") : "none"}`,
  ];
  return lines.join("\n");
}

export function syncReportIsClean(r: SyncReport): boolean {
  return !r.createdFeatures.length && !r.createdFlags.length && !r.updatedFeatures.length && !r.createdDependencies.length;
}
