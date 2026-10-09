import { getFeatureDef } from "@shared/features";

/** The slice of a catalog row that decides whether a feature is visible. */
export interface VisibilityRow {
  id: string;
  key: string;
  isActive: boolean;
  parentFeatureId: string | null;
}

/** Hidden features: flag off, deactivated, or whose bundle parent / dependency is hidden. */
export function computeDisabledKeys(catalog: VisibilityRow[], flagOff: Set<string>): Set<string> {
  const byId = new Map(catalog.map((f) => [f.id, f]));
  const disabled = new Set<string>(flagOff);
  for (const f of catalog) if (!f.isActive) disabled.add(f.key);
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of catalog) {
      if (disabled.has(f.key)) continue;
      const parent = f.parentFeatureId ? byId.get(f.parentFeatureId) : undefined;
      const deps = getFeatureDef(f.key)?.dependsOn ?? [];
      if ((parent && disabled.has(parent.key)) || deps.some((d) => disabled.has(d))) {
        disabled.add(f.key);
        changed = true;
      }
    }
  }
  return disabled;
}

export type CheckResult = "pass" | "blocks" | "note";
export interface VisibilityCheck {
  id: "active" | "flag" | "parent" | "dependencies";
  label: string;
  detail: string;
  result: CheckResult;
}
export interface VisibilityReport {
  status: "visible" | "scoped" | "hidden";
  checks: VisibilityCheck[];
}

/**
 * Why a feature is or is not visible to customers, using the same rule the runtime applies
 * (computeDisabledKeys). `flagStatus` is the feature's own flag: only "off" hides it for everyone,
 * "scoped" shows it to the listed businesses, anything else (on, legacy by_plan) is On.
 */
export function explainVisibility(args: {
  feature: VisibilityRow;
  catalog: VisibilityRow[];
  flagStatusByKey: Map<string, string>;
  scopedCount: number;
}): VisibilityReport {
  const { feature, catalog, flagStatusByKey, scopedCount } = args;
  const flagOff = new Set<string>();
  flagStatusByKey.forEach((status, key) => { if (status === "off") flagOff.add(key); });
  const hidden = computeDisabledKeys(catalog, flagOff);
  const byId = new Map(catalog.map((f) => [f.id, f]));

  const flagStatus = flagStatusByKey.get(feature.key) ?? "on";
  const parent = feature.parentFeatureId ? byId.get(feature.parentFeatureId) : undefined;
  const dependsOn = getFeatureDef(feature.key)?.dependsOn ?? [];
  const hiddenDeps = dependsOn.filter((d) => hidden.has(d));

  const checks: VisibilityCheck[] = [
    feature.isActive
      ? { id: "active", label: "Active", detail: "Yes, sold to businesses", result: "pass" }
      : { id: "active", label: "Active", detail: "No, waiting for price and publish", result: "blocks" },
    flagStatus === "off"
      ? { id: "flag", label: "Flag", detail: "Off for every business", result: "blocks" }
      : flagStatus === "scoped"
        ? { id: "flag", label: "Flag", detail: `Scoped to ${scopedCount} business${scopedCount === 1 ? "" : "es"}`, result: "note" }
        : { id: "flag", label: "Flag", detail: "On", result: "pass" },
    !parent
      ? { id: "parent", label: "Parent", detail: "None", result: "pass" }
      : hidden.has(parent.key)
        ? { id: "parent", label: "Parent", detail: `${parent.key} is hidden`, result: "blocks" }
        : { id: "parent", label: "Parent", detail: `${parent.key} is visible`, result: "pass" },
    dependsOn.length === 0
      ? { id: "dependencies", label: "Dependencies", detail: "None", result: "pass" }
      : hiddenDeps.length
        ? { id: "dependencies", label: "Dependencies", detail: `${hiddenDeps.join(", ")} hidden`, result: "blocks" }
        : { id: "dependencies", label: "Dependencies", detail: `${dependsOn.join(", ")} visible`, result: "pass" },
  ];

  const blocked = checks.some((c) => c.result === "blocks");
  return { status: blocked ? "hidden" : flagStatus === "scoped" ? "scoped" : "visible", checks };
}
