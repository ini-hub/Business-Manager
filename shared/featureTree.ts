/**
 * Arranges features into the product tree (section > feature > sub-feature) for
 * display. Browser-safe, no drizzle. Pure: it never reads the registry itself, the
 * caller supplies rows (catalog rows from the API, with registry values filled in
 * for anything the sync has not populated yet).
 */

import { FEATURE_SECTIONS, type FeatureSection } from "./features";

export interface TreeInput {
  key: string;
  section: string | null;
  /** Key of the feature this one nests under, or null for a root. */
  groupParent: string | null;
  sortOrder: number;
}

export interface TreeNode<T extends TreeInput> {
  item: T;
  children: TreeNode<T>[];
}

export interface SectionNode<T extends TreeInput> {
  /** A product section, or "other" for features that belong to none. */
  section: FeatureSection | "other";
  roots: TreeNode<T>[];
  /** Every feature under this section, roots included. */
  count: number;
}

const bySort = <T extends TreeInput>(a: TreeNode<T>, b: TreeNode<T>) =>
  a.item.sortOrder - b.item.sortOrder || a.item.key.localeCompare(b.item.key);

/**
 * A feature nests under its groupParent wherever that parent is listed, even in a
 * different section, so a root's section decides where a whole subtree appears.
 * A missing parent, or a cycle, makes the feature a root rather than dropping it.
 */
export function buildFeatureTree<T extends TreeInput>(items: readonly T[]): SectionNode<T>[] {
  const nodes = new Map(items.map((item) => [item.key, { item, children: [] as TreeNode<T>[] }]));

  const reachesRoot = (key: string): boolean => {
    const seen = new Set<string>([key]);
    for (let p = nodes.get(key)?.item.groupParent; p; p = nodes.get(p)?.item.groupParent) {
      if (!nodes.has(p) || seen.has(p)) return false;
      seen.add(p);
    }
    return true;
  };

  const roots: TreeNode<T>[] = [];
  for (const node of Array.from(nodes.values())) {
    const parent = node.item.groupParent ? nodes.get(node.item.groupParent) : undefined;
    if (parent && reachesRoot(node.item.key)) parent.children.push(node);
    else roots.push(node);
  }

  const sortDeep = (list: TreeNode<T>[]) => {
    list.sort(bySort);
    for (const n of list) sortDeep(n.children);
  };
  sortDeep(roots);

  const size = (n: TreeNode<T>): number => 1 + n.children.reduce((sum, c) => sum + size(c), 0);
  const known = new Set<string>(FEATURE_SECTIONS);
  const order: (FeatureSection | "other")[] = [...FEATURE_SECTIONS, "other"];

  return order
    .map((section) => {
      const mine = roots.filter((r) => (known.has(r.item.section ?? "") ? r.item.section : "other") === section);
      return { section, roots: mine, count: mine.reduce((sum, r) => sum + size(r), 0) };
    })
    .filter((s) => s.roots.length > 0);
}

/** Keys of every node in the subtree, the node itself first. */
export function subtreeKeys<T extends TreeInput>(node: TreeNode<T>): string[] {
  return [node.item.key, ...node.children.flatMap(subtreeKeys)];
}

/**
 * The tree reduced to nodes that match, plus the ancestors needed to reach them.
 * A node whose own text matches keeps its whole subtree.
 */
export function filterFeatureTree<T extends TreeInput>(
  sections: readonly SectionNode<T>[],
  matches: (item: T) => boolean,
): SectionNode<T>[] {
  const keep = (node: TreeNode<T>): TreeNode<T> | null => {
    if (matches(node.item)) return node;
    const children = node.children.map(keep).filter((c): c is TreeNode<T> => c !== null);
    return children.length ? { item: node.item, children } : null;
  };
  const size = (n: TreeNode<T>): number => 1 + n.children.reduce((sum, c) => sum + size(c), 0);
  return sections
    .map((s) => {
      const roots = s.roots.map(keep).filter((r): r is TreeNode<T> => r !== null);
      return { ...s, roots, count: roots.reduce((sum, r) => sum + size(r), 0) };
    })
    .filter((s) => s.roots.length > 0);
}
