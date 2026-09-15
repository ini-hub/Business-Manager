/**
 * Row-selection state machine for the shared data table's multiselect + bulk
 * actions. Deliberately framework-free (no React) so the rules below —
 * several of them easy to get subtly wrong — are unit-testable without
 * mounting a component: see table-selection.test.ts.
 *
 * Selection has two modes:
 * - "page": `ids` is the literal set of selected row ids (only ever rows
 *   from pages the user has actually seen).
 * - "all": every row matching the current filter/search query is selected,
 *   including rows on pages never rendered. `ids` is unused in this mode.
 *
 * "all" mode is entered explicitly (selectAllMatching, from the banner) and
 * is deliberately fragile: per spec, deselecting *any* single row while in
 * "all" mode drops back to "page" mode with the current page selected minus
 * that row, rather than tracking a growing exclusion list. This keeps the
 * mental model simple ("all" always means literally all) at the cost of
 * losing the rest of the bulk selection if the user unchecks one row deep
 * into an "all" selection — an intentional trade-off per the spec's 2.2.
 */

export type SelectionMode = "page" | "all";

export interface SelectionState<Id extends string | number> {
  mode: SelectionMode;
  ids: Set<Id>;
  /** Last explicitly toggled row, for shift+click range selection. Not persisted selection state. */
  anchorId: Id | null;
}

export type HeaderCheckboxState = "checked" | "unchecked" | "indeterminate";

export function createEmptySelection<Id extends string | number>(): SelectionState<Id> {
  return { mode: "page", ids: new Set(), anchorId: null };
}

export function clearSelection<Id extends string | number>(): SelectionState<Id> {
  return createEmptySelection<Id>();
}

/** True if `id` is currently selected, in either mode. */
export function isRowSelected<Id extends string | number>(state: SelectionState<Id>, id: Id): boolean {
  return state.mode === "all" ? true : state.ids.has(id);
}

/**
 * Toggle a single row. See module doc: toggling while in "all" mode exits it,
 * falling back to the current page selected minus this row — not an
 * exclusion list layered on top of "all".
 */
export function toggleRow<Id extends string | number>(
  state: SelectionState<Id>,
  id: Id,
  currentPageIds: readonly Id[],
): SelectionState<Id> {
  if (state.mode === "all") {
    const next = new Set(currentPageIds);
    next.delete(id);
    return { mode: "page", ids: next, anchorId: id };
  }
  const next = new Set(state.ids);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return { mode: "page", ids: next, anchorId: id };
}

/**
 * Shift+click: select the contiguous range between the last-toggled row
 * (anchor) and `targetId`, within the current page's row order. Falls back
 * to a plain toggle when there's no anchor yet, or either id isn't on the
 * current page (e.g. the anchor was set before a page change).
 */
export function toggleRange<Id extends string | number>(
  state: SelectionState<Id>,
  targetId: Id,
  currentPageIds: readonly Id[],
): SelectionState<Id> {
  if (state.anchorId === null) return toggleRow(state, targetId, currentPageIds);

  const anchorIdx = currentPageIds.indexOf(state.anchorId);
  const targetIdx = currentPageIds.indexOf(targetId);
  if (anchorIdx === -1 || targetIdx === -1) return toggleRow(state, targetId, currentPageIds);

  const [start, end] = anchorIdx < targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx];
  const rangeIds = currentPageIds.slice(start, end + 1);

  const base = state.mode === "all" ? new Set<Id>() : new Set(state.ids);
  rangeIds.forEach((id) => base.add(id));
  return { mode: "page", ids: base, anchorId: targetId };
}

/**
 * Header checkbox click: selects/clears the *current page only* — never the
 * full filtered set (that's what the "Select all N" banner is for). This is
 * the fix for the defect where the header checkbox silently selected every
 * matching row across all pages with no indication it had done so.
 */
export function toggleSelectAllOnPage<Id extends string | number>(
  state: SelectionState<Id>,
  currentPageIds: readonly Id[],
): SelectionState<Id> {
  if (state.mode === "all") {
    return createEmptySelection<Id>();
  }
  const allSelected = currentPageIds.length > 0 && currentPageIds.every((id) => state.ids.has(id));
  const next = new Set(state.ids);
  if (allSelected) {
    currentPageIds.forEach((id) => next.delete(id));
  } else {
    currentPageIds.forEach((id) => next.add(id));
  }
  return { mode: "page", ids: next, anchorId: null };
}

/** Entered from the "Select all {total}" banner action. */
export function selectAllMatching<Id extends string | number>(): SelectionState<Id> {
  return { mode: "all", ids: new Set(), anchorId: null };
}

export function getSelectionCount<Id extends string | number>(
  state: SelectionState<Id>,
  totalFilteredCount: number,
): number {
  return state.mode === "all" ? totalFilteredCount : state.ids.size;
}

export function headerCheckboxState<Id extends string | number>(
  state: SelectionState<Id>,
  currentPageIds: readonly Id[],
): HeaderCheckboxState {
  if (state.mode === "all") return "checked";
  if (currentPageIds.length === 0) return "unchecked";
  const selectedOnPage = currentPageIds.filter((id) => state.ids.has(id)).length;
  if (selectedOnPage === 0) return "unchecked";
  return selectedOnPage === currentPageIds.length ? "checked" : "indeterminate";
}

/**
 * Whether to show the "{pageCount} selected. Select all {total}" /
 * "All {total} selected. Clear selection" banner.
 */
export function shouldShowSelectAllBanner<Id extends string | number>(
  state: SelectionState<Id>,
  currentPageIds: readonly Id[],
  totalFilteredCount: number,
): boolean {
  if (state.mode === "all") return true;
  return (
    currentPageIds.length > 0 &&
    currentPageIds.every((id) => state.ids.has(id)) &&
    totalFilteredCount > currentPageIds.length
  );
}
