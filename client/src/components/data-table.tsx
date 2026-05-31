import { PolymorphicTable, ColumnConfig, TableFilterConfig } from "./oop-ui/PolymorphicTable";

export interface Column<T> {
  key: keyof T | string;
  header: string;
  render?: (item: T) => React.ReactNode;
  className?: string;
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
}: DataTableProps<T>) {
  // Map standard Column format to PolymorphicTable ColumnConfig
  const mappedColumns: ColumnConfig<T>[] = columns.map((col) => ({
    key: String(col.key),
    header: col.header,
    className: col.className,
    render: col.render,
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
    />
  );
}
