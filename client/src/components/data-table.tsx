import { PolymorphicTable, ColumnConfig, TableFilterConfig, RowAction } from "./oop-ui/PolymorphicTable";
import type { BulkAction } from "./oop-ui/BulkActionsBar";

export type { RowAction };
export type { BulkAction, BulkActionSelection, BulkActionPrecheck, BulkActionResult } from "./oop-ui/BulkActionsBar";

export interface Column<T> {
  key: keyof T | string;
  header: string;
  render?: (item: T) => React.ReactNode;
  className?: string;
  /** See ColumnConfig.priority — responsive display tier for the mobile/tablet card view. */
  priority?: 1 | 2 | 3;
}

export interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  searchable?: boolean;
  searchPlaceholder?: string;
  searchKeys?: string[];
  isLoading?: boolean;
  emptyMessage?: string;
  pageSize?: number;
  onRowClick?: (item: T) => void;
  
  // Advanced table filters prop
  filterConfigs?: TableFilterConfig[];

  // Multiselect properties
  multiselect?: boolean;
  selectedIds?: (string | number)[];
  onSelectedIdsChange?: (ids: (string | number)[]) => void;

  // Premium empty state enhancements
  emptyIcon?: React.ReactNode;
  emptyAction?: React.ReactNode;
  emptyTitle?: string;

  // Fires with the live search/filter/sort result set — lets a page offer "export what
  // I'm currently looking at" alongside its normal full-dataset export.
  onVisibleDataChange?: (rows: T[]) => void;

  // When set, persists search/page/sort/filters to a URL query param under this key, so the
  // list survives navigating to a detail page and back. Must be unique among tables rendered
  // on the same page.
  urlKey?: string;

  // Always render the card list, even on desktop — for a table with enough
  // columns that the desktop view would need horizontal scroll.
  forceCardView?: boolean;

  // Hints tap-to-open on the mobile/tablet card list with a trailing chevron.
  showCardChevron?: boolean;

  // See PolymorphicTable's cardLayout — "compact-grid" lays the first 4
  // priority columns out as a 2x2 grid instead of a vertical label:value list.
  cardLayout?: "list" | "compact-grid";

  // Suppresses the built-in pagination/rows-per-page footer, for callers that
  // paginate server-side and render their own footer instead.
  hideFooter?: boolean;

  // See PolymorphicTable's hideToolbar — suppresses the built-in
  // search/filter/count row for a fully custom toolbar rendered by the caller.
  hideToolbar?: boolean;

  // Auto-generates a single "..." row-actions menu instead of a hand-rolled
  // "actions" column of icon buttons. Ignored if `columns` already has one.
  rowActions?: (item: T) => RowAction[];

  // Replaces the built-in search input with caller-owned markup, for
  // server-side search — keeps it in the same toolbar row as filters/count
  // instead of the caller rendering its own search box in a separate block.
  searchSlot?: React.ReactNode;

  // Replaces the built-in "Showing X of Y records" text, for callers whose
  // `data` is only the current server page (X/Y would otherwise reflect the
  // page size, not the true total).
  resultCountLabel?: React.ReactNode;

  // Opts into the full multiselect + bulk-actions system: sticky bottom
  // action bar, "Select all {total}" banner, safe/reversible/destructive
  // action semantics. Requires `multiselect` and `entityNoun`. Without this,
  // `multiselect` alone still works as plain checkboxes with no action bar.
  bulkActions?: BulkAction<T>[];

  // Singular/plural noun for bulk-action copy. Required when bulkActions is set.
  entityNoun?: { singular: string; plural: string };
}

export function DataTable<T extends { id: string | number }>({
  data,
  columns,
  searchable = true,
  searchPlaceholder = "Search...",
  searchKeys = [],
  isLoading = false,
  emptyMessage = "No data available",
  pageSize = 10,
  onRowClick,
  filterConfigs,
  multiselect,
  selectedIds,
  onSelectedIdsChange,
  emptyIcon,
  emptyAction,
  emptyTitle,
  onVisibleDataChange,
  urlKey,
  forceCardView,
  showCardChevron,
  cardLayout,
  hideFooter,
  hideToolbar,
  rowActions,
  searchSlot,
  resultCountLabel,
  bulkActions,
  entityNoun,
}: DataTableProps<T>) {
  // Map standard Column format to PolymorphicTable ColumnConfig
  const mappedColumns: ColumnConfig<T>[] = columns.map((col) => ({
    key: String(col.key),
    header: col.header,
    className: col.className,
    render: col.render,
    priority: col.priority,
  }));

  return (
    <PolymorphicTable
      data={data}
      columns={mappedColumns}
      searchable={searchable}
      searchPlaceholder={searchPlaceholder}
      searchKeys={searchKeys}
      isLoading={isLoading}
      emptyMessage={emptyMessage}
      pageSize={pageSize}
      onRowClick={onRowClick}
      filterConfigs={filterConfigs}
      multiselect={multiselect}
      selectedIds={selectedIds}
      onSelectedIdsChange={onSelectedIdsChange}
      emptyIcon={emptyIcon}
      emptyAction={emptyAction}
      emptyTitle={emptyTitle}
      onVisibleDataChange={onVisibleDataChange}
      urlKey={urlKey}
      forceCardView={forceCardView}
      showCardChevron={showCardChevron}
      cardLayout={cardLayout}
      hideFooter={hideFooter}
      hideToolbar={hideToolbar}
      rowActions={rowActions}
      searchSlot={searchSlot}
      resultCountLabel={resultCountLabel}
      bulkActions={bulkActions}
      entityNoun={entityNoun}
    />
  );
}
