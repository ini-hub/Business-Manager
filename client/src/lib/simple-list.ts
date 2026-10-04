/**
 * Declarative search + filter + sort for the smaller lists (audits, archived items, vendor
 * bills, register shifts) that don't need a bespoke filter module. Pure, so it is unit tested
 * without mounting anything. Each group is a single-select; picking an option narrows the list.
 */

export interface SimpleGroup<T> {
  key: string;
  label: string;
  options: { value: string; label: string }[];
  /** Does this row belong to the chosen option? */
  match: (row: T, value: string) => boolean;
}

interface SimpleSort<T> {
  key: string;
  label: string;
  compare: (a: T, b: T) => number;
}

export interface SimpleListConfig<T> {
  noun: string;
  placeholder: string;
  /** Text a search term is matched against. */
  searchText: (row: T) => string;
  groups: SimpleGroup<T>[];
  sorts: SimpleSort<T>[];
}

export interface SimpleListState {
  search: string;
  /** group key -> chosen option value */
  picked: Record<string, string | null>;
  sortKey: string | null;
}

export const EMPTY_SIMPLE_LIST: SimpleListState = { search: "", picked: {}, sortKey: null };

export function matchesPicked<T>(row: T, groups: SimpleGroup<T>[], picked: Record<string, string | null>): boolean {
  return groups.every((g) => {
    const v = picked[g.key];
    return !v || g.match(row, v);
  });
}

export function matchesSearch<T>(row: T, cfg: SimpleListConfig<T>, term: string): boolean {
  const q = term.trim().toLowerCase();
  return !q || cfg.searchText(row).toLowerCase().includes(q);
}

export function applySimpleList<T>(rows: T[], cfg: SimpleListConfig<T>, state: SimpleListState): T[] {
  const filtered = rows.filter((r) => matchesSearch(r, cfg, state.search) && matchesPicked(r, cfg.groups, state.picked));
  const sort = cfg.sorts.find((s) => s.key === state.sortKey);
  return sort ? [...filtered].sort(sort.compare) : filtered;
}

export function countPicked(state: SimpleListState): number {
  return Object.values(state.picked).filter(Boolean).length;
}

export function simpleChips<T>(cfg: SimpleListConfig<T>, state: SimpleListState): { key: string; label: string }[] {
  const chips: { key: string; label: string }[] = [];
  for (const g of cfg.groups) {
    const v = state.picked[g.key];
    if (!v) continue;
    chips.push({ key: g.key, label: g.options.find((o) => o.value === v)?.label ?? v });
  }
  return chips;
}
