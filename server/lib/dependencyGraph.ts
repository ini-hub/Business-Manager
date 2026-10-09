export interface DependencyEdge {
  featureId: string;
  dependsOnFeatureId: string;
}

/**
 * Why adding "feature needs dependency" would be wrong, or null. A feature cannot need itself, and two features
 * cannot need each other directly or through others (neither could ever be bought first). The message names
 * the loop so the admin can see which edge to remove.
 */
export function dependencyProblem(
  edges: readonly DependencyEdge[],
  featureId: string,
  dependsOnFeatureId: string,
  nameOf: (id: string) => string,
): string | null {
  if (featureId === dependsOnFeatureId) return `${nameOf(featureId)} cannot depend on itself.`;

  // A path from the dependency back to the feature means the new edge closes a loop.
  const next = new Map<string, string[]>();
  for (const e of edges) next.set(e.featureId, [...(next.get(e.featureId) ?? []), e.dependsOnFeatureId]);
  const seen = new Set<string>();
  const walk = (id: string, path: string[]): string[] | null => {
    if (id === featureId) return [...path, id];
    if (seen.has(id)) return null;
    seen.add(id);
    for (const n of next.get(id) ?? []) {
      const found = walk(n, [...path, id]);
      if (found) return found;
    }
    return null;
  };
  const loop = walk(dependsOnFeatureId, [featureId]);
  if (loop) return `That would make a loop: ${loop.map(nameOf).join(" needs ")}.`;
  return null;
}
