import * as React from "react";
import { useState, useEffect, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { useDebounce } from "@/hooks/use-debounce";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  PackageOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DropdownFilter, MobileFilterChip } from "./PolymorphicTableFilters";

const getNestedValue = (obj: any, path: string): any => {
  let val = obj;
  const parts = path.split(".");
  for (const part of parts) {
    val = val?.[part];
    if (val === undefined || val === null) break;
  }
  return val;
};

interface EncodedTableState {
  q?: string;
  p?: number;
  ps?: number;
  sc?: string;
  sd?: "asc" | "desc";
  f?: Record<string, any>;
}

// Reads once at mount, so a table whose `urlKey` prop is set can restore the search/page/
// sort/filters it had before the user navigated away (e.g. to a detail page) and back —
// otherwise this state lives only in local useState and resets to defaults on remount.
function readTableStateFromUrl(urlKey: string | undefined): EncodedTableState | null {
  if (!urlKey) return null;
  try {
    const raw = new URLSearchParams(window.location.search).get(urlKey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export interface TableFilterConfig {
  key: string;
  label: string;
  type: "select" | "range" | "date-range";
  currencySymbol?: string;
  valueMapper?: (val: any) => string;
}

export interface ColumnConfig<T> {
  key: string;
  header: string;
  className?: string;
  align?: "left" | "right" | "center";
  type?: "text" | "currency" | "date" | "badge" | "custom";
  currencyCode?: string;
  badgeVariants?: (val: any) => "default" | "secondary" | "destructive" | "outline";
  render?: (item: T) => React.ReactNode;
  filterable?: boolean;
}

export interface PolymorphicTableProps<T> {
  data: T[];
  columns: ColumnConfig<T>[];
  searchable?: boolean;
  searchPlaceholder?: string;
  searchKeys?: string[];
  isLoading?: boolean;
  emptyMessage?: string;
  pageSize?: number;
  onRowClick?: (item: T) => void;
  className?: string;
  
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

  // Fires whenever the live search/filter/sort result set changes (the full matched set,
  // not just the current page) — lets a parent page offer "export what I'm currently
  // looking at" alongside its normal full-dataset export.
  onVisibleDataChange?: (rows: T[]) => void;

  // When set, persists search/page/sort/filters to a URL query param under this key, so the
  // list survives navigating to a detail page and back. Must be unique among tables rendered
  // on the same page.
  urlKey?: string;

  // Always render the card list, never the spreadsheet-style table — even on desktop.
  // For a table with enough columns that the desktop view would need horizontal
  // scroll to see the rest, a scroll bar most people never notice they can use is
  // worse than a layout that fits: the card list shows every column's value with
  // nothing to discover, at any width.
  forceCardView?: boolean;
}

export function PolymorphicTable<T extends { id: string | number }>({
  data,
  columns,
  searchable = true,
  searchPlaceholder = "Search records...",
  searchKeys = [],
  isLoading = false,
  emptyMessage = "No records found.",
  pageSize = 10,
  onRowClick,
  className,
  filterConfigs = [],
  
  // Multiselect
  multiselect = false,
  selectedIds,
  onSelectedIdsChange,

  // Premium empty state enhancements
  emptyIcon,
  emptyAction,
  emptyTitle = "No Records Available",

  onVisibleDataChange,
  urlKey,
  forceCardView = false,
}: PolymorphicTableProps<T>) {
  const [initialUrlState] = useState(() => readTableStateFromUrl(urlKey));
  const [location, setLocation] = useLocation();

  const [searchTerm, setSearchTerm] = useState(initialUrlState?.q ?? "");
  const [currentPage, setCurrentPage] = useState(initialUrlState?.p ?? 1);
  const [pageSizeState, setPageSizeState] = useState(initialUrlState?.ps ?? pageSize);
  const [sortColumn, setSortColumn] = useState<string | null>(initialUrlState?.sc ?? null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc" | null>(initialUrlState?.sd ?? null);

  // Advanced filters state
  const [activeFilters, setActiveFilters] = useState<Record<string, any>>(initialUrlState?.f ?? {});
  const [mobileDetailItem, setMobileDetailItem] = useState<T | null>(null);

  // Uncontrolled fallback for multiselect
  const [localSelectedIds, setLocalSelectedIds] = useState<(string | number)[]>([]);
  const isControlled = selectedIds !== undefined;
  const currentSelectedIds = isControlled ? selectedIds : localSelectedIds;

  const handleHeaderClick = (columnKey: string) => {
    if (sortColumn === columnKey) {
      if (sortDirection === "asc") {
        setSortDirection("desc");
      } else if (sortDirection === "desc") {
        setSortColumn(null);
        setSortDirection(null);
      } else {
        setSortDirection("asc");
      }
    } else {
      setSortColumn(columnKey);
      setSortDirection("asc");
    }
    setCurrentPage(1);
  };

  const handleFilterChange = (key: string, value: any) => {
    setActiveFilters((prev) => {
      const next = { ...prev };
      if (value === null || value === undefined) {
        delete next[key];
      } else {
        next[key] = value;
      }
      return next;
    });
    setCurrentPage(1);
  };

  const clearAllFilters = () => {
    setActiveFilters({});
    setCurrentPage(1);
  };

  const hasActiveFilters = Object.keys(activeFilters).length > 0;

  const debouncedSearchTerm = useDebounce(searchTerm, 400);
  useEffect(() => {
    if (!urlKey) return;
    const state: EncodedTableState = {};
    if (debouncedSearchTerm) state.q = debouncedSearchTerm;
    if (currentPage > 1) state.p = currentPage;
    if (pageSizeState !== pageSize) state.ps = pageSizeState;
    if (sortColumn) state.sc = sortColumn;
    if (sortDirection) state.sd = sortDirection;
    if (Object.keys(activeFilters).length > 0) state.f = activeFilters;

    const params = new URLSearchParams(window.location.search);
    if (Object.keys(state).length > 0) {
      params.set(urlKey, JSON.stringify(state));
    } else {
      params.delete(urlKey);
    }
    const nextSearch = params.toString();
    const currentSearch = window.location.search.replace(/^\?/, "");
    if (nextSearch !== currentSearch) {
      setLocation(nextSearch ? `${location}?${nextSearch}` : location, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlKey, debouncedSearchTerm, currentPage, pageSizeState, sortColumn, sortDirection, activeFilters]);

  // Filter & Search Logic
  const filteredData = useMemo(() => data.filter((item) => {
    // 1. Global Search
    if (searchable && searchTerm && searchKeys.length > 0) {
      const matchesGlobal = searchKeys.some((keyPath) => {
        let value = getNestedValue(item, keyPath);
        if (value !== undefined && value !== null) {
          if (typeof value === "string") {
            return value.toLowerCase().includes(searchTerm.toLowerCase());
          }
          if (typeof value === "number") {
            return value.toString().includes(searchTerm);
          }
        }
        return false;
      });
      if (!matchesGlobal) return false;
    }

    // 2. Toolbar Filters
    for (const config of filterConfigs) {
      const { key, type } = config;
      const filterValue = activeFilters[key];
      if (filterValue === undefined || filterValue === null) continue;

      let itemValue = getNestedValue(item, key);

      if (type === "select") {
        const selectedOptions = filterValue as string[];
        if (selectedOptions.length > 0) {
          const mappedItemVal = config.valueMapper
            ? config.valueMapper(itemValue)
            : (itemValue !== undefined && itemValue !== null ? String(itemValue) : "");

          const matches = selectedOptions.some(
            (opt) => opt.toLowerCase() === mappedItemVal.toLowerCase()
          );
          if (!matches) return false;
        }
      } else if (type === "range") {
        const range = filterValue as { min: number | ""; max: number | "" };
        const numVal = itemValue !== undefined && itemValue !== null ? Number(itemValue) : 0;

        const minVal = range.min !== "" ? Number(range.min) : null;
        const maxVal = range.max !== "" ? Number(range.max) : null;

        if (minVal !== null && numVal < minVal) return false;
        if (maxVal !== null && numVal > maxVal) return false;
      } else if (type === "date-range") {
        const range = filterValue as { min: string | ""; max: string | "" };
        if (!itemValue) return false;
        const dateVal = new Date(itemValue).getTime();

        const minDate = range.min ? new Date(range.min).getTime() : null;
        const maxDate = range.max ? new Date(range.max).getTime() : null;

        if (minDate !== null && dateVal < minDate) return false;
        if (maxDate !== null && dateVal > maxDate) return false;
      }
    }

    return true;
  }), [data, searchable, searchTerm, searchKeys, filterConfigs, activeFilters]);

  const sortedData = useMemo(() => [...filteredData].sort((a, b) => {
    if (!sortColumn || !sortDirection) return 0;

    let valA = getNestedValue(a, sortColumn);
    let valB = getNestedValue(b, sortColumn);

    if (valA === undefined || valA === null) return sortDirection === "asc" ? 1 : -1;
    if (valB === undefined || valB === null) return sortDirection === "asc" ? -1 : 1;

    if (typeof valA === "string" && typeof valB === "string") {
      return sortDirection === "asc"
        ? valA.localeCompare(valB)
        : valB.localeCompare(valA);
    }

    if (typeof valA === "number" && typeof valB === "number") {
      return sortDirection === "asc" ? valA - valB : valB - valA;
    }

    const strA = String(valA);
    const strB = String(valB);
    return sortDirection === "asc" ? strA.localeCompare(strB) : strB.localeCompare(strA);
  }), [filteredData, sortColumn, sortDirection]);

  // `sortedData` gets a new array/row identity on every render whenever a caller passes
  // inline `filterConfigs`/`searchKeys` literals or rebuilds `data` via `.map(...)` in the
  // render body (most do) — reference equality alone can't detect "nothing really changed"
  // in that case. Compare by value instead, so `onVisibleDataChange` (and any setState it
  // drives in the parent) only fires when the actual visible rows change, not on every
  // render — otherwise that setState would re-trigger this same render path forever.
  const lastEmittedSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    if (!onVisibleDataChange) return;
    const signature = JSON.stringify(sortedData);
    if (signature !== lastEmittedSignatureRef.current) {
      lastEmittedSignatureRef.current = signature;
      onVisibleDataChange(sortedData);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedData]);

  const totalPages = Math.ceil(sortedData.length / pageSizeState);
  const startIndex = (currentPage - 1) * pageSizeState;
  const paginatedData = sortedData.slice(startIndex, startIndex + pageSizeState);

  const goToPage = (page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  };

  const handleSelectRow = (id: string | number) => {
    const nextSelected = currentSelectedIds.includes(id)
      ? currentSelectedIds.filter((selectedId) => selectedId !== id)
      : [...currentSelectedIds, id];

    if (!isControlled) {
      setLocalSelectedIds(nextSelected);
    }
    onSelectedIdsChange?.(nextSelected);
  };

  const handleSelectAll = () => {
    const allFilteredIds = sortedData.map((item) => item.id);
    const allSelected = allFilteredIds.every((id) => currentSelectedIds.includes(id));

    let nextSelected: (string | number)[];
    if (allSelected) {
      nextSelected = currentSelectedIds.filter((id) => !allFilteredIds.includes(id));
    } else {
      const newIds = allFilteredIds.filter((id) => !currentSelectedIds.includes(id));
      nextSelected = [...currentSelectedIds, ...newIds];
    }

    if (!isControlled) {
      setLocalSelectedIds(nextSelected);
    }
    onSelectedIdsChange?.(nextSelected);
  };

  const renderSortIcon = (columnKey: string) => {
    if (sortColumn !== columnKey) {
      return <ArrowUpDown className="ml-1.5 h-3.5 w-3.5 text-muted-foreground opacity-50 group-hover:opacity-100 transition-opacity" />;
    }
    return sortDirection === "asc" ? (
      <ArrowUp className="ml-1.5 h-3.5 w-3.5 text-primary" />
    ) : (
      <ArrowDown className="ml-1.5 h-3.5 w-3.5 text-primary" />
    );
  };

  const formatCellValue = (item: T, col: ColumnConfig<T>) => {
    if (col.render) {
      return col.render(item);
    }

    let val = getNestedValue(item, col.key);

    if (val === undefined || val === null) return "";

    if (col.type === "currency") {
      const code = col.currencyCode || "NGN";
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: code,
      }).format(Number(val));
    }

    if (col.type === "date") {
      return new Intl.DateTimeFormat("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      }).format(new Date(val));
    }

    return String(val);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        {searchable && (
          <div className="relative max-w-sm">
            <Skeleton className="h-9 w-full" />
          </div>
        )}
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                {multiselect && (
                  <TableHead className="w-12 px-4 py-3 text-center">
                    <Skeleton className="h-4 w-4 mx-auto" />
                  </TableHead>
                )}
                {columns.map((column) => (
                  <TableHead key={column.key} className={cn(column.className, column.align === "right" && "text-right")}>
                    {column.header}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {multiselect && (
                    <TableCell className="w-12 px-4 py-3 text-center">
                      <Skeleton className="h-4 w-4 mx-auto" />
                    </TableCell>
                  )}
                  {columns.map((column) => (
                    <TableCell key={column.key}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-4 w-full min-w-0 overflow-hidden", className)}>
      {/* Search & Dynamic Horizontal Filter Toolbar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 pb-2 border-b border-muted/30">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-1">
          {searchable && (
            <div className="relative w-full sm:max-w-xs md:max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={searchPlaceholder}
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
                className="pl-9 h-9"
              />
            </div>
          )}
          
          {/* Desktop Filters: Horizontal Toolbar beside Search */}
          {filterConfigs.length > 0 && (
            <div className="hidden md:flex items-center gap-2 flex-wrap">
              {filterConfigs.map((config) => (
                <DropdownFilter
                  key={config.key}
                  config={config}
                  data={data}
                  value={activeFilters[config.key]}
                  onChange={(val) => handleFilterChange(config.key, val)}
                />
              ))}
              
              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearAllFilters}
                  className="text-xs text-primary hover:underline hover:bg-transparent font-semibold px-2"
                >
                  Clear All
                </Button>
              )}
            </div>
          )}
          
          {/* Mobile Filters: one chip per filter, mirroring the desktop toolbar above —
              tapping a chip opens a bottom sheet scoped to just that filter, instead of
              one combined form covering every filter at once. */}
          {filterConfigs.length > 0 && (
            <div className="md:hidden flex items-center gap-2 w-full">
              <div className="flex items-center gap-2 overflow-x-auto flex-1 min-w-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden py-0.5">
                {filterConfigs.map((config) => (
                  <MobileFilterChip
                    key={config.key}
                    config={config}
                    data={data}
                    value={activeFilters[config.key]}
                    onChange={(val) => handleFilterChange(config.key, val)}
                  />
                ))}
              </div>

              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearAllFilters}
                  className="text-xs text-muted-foreground px-2 h-9 flex-shrink-0"
                >
                  Clear All
                </Button>
              )}
            </div>
          )}
        </div>
        
        {/* Record count indicator */}
        <div className="text-xs font-semibold text-muted-foreground whitespace-nowrap self-end md:self-center">
          Showing <span className="text-foreground font-bold">{filteredData.length}</span> of <span className="text-foreground font-bold">{data.length}</span> records
        </div>
      </div>

      <div className={cn(forceCardView ? "hidden" : "hidden lg:block", "rounded-md border bg-card text-card-foreground overflow-x-auto max-w-full")}>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              {multiselect && (
                <TableHead className="w-12 px-4 py-3 text-center select-none">
                  <Checkbox
                    checked={
                      sortedData.length > 0 &&
                      sortedData.every((item) => currentSelectedIds.includes(item.id))
                    }
                    onCheckedChange={handleSelectAll}
                    aria-label="Select all"
                  />
                </TableHead>
              )}
              {columns.map((column) => (
                <TableHead
                  key={column.key}
                  className={cn(
                    column.className,
                    "cursor-pointer select-none group hover:bg-muted/50 transition-colors py-3 font-semibold",
                    column.align === "right" && "text-right"
                  )}
                  onClick={() => handleHeaderClick(column.key)}
                >
                  <div className={cn("flex items-center", column.align === "right" && "justify-end")}>
                    <span>{column.header}</span>
                    {renderSortIcon(column.key)}
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedData.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length + (multiselect ? 1 : 0)} className="py-16 text-center">
                  {hasActiveFilters || searchTerm ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-4">
                      <span className="text-sm text-muted-foreground">No records match your filters.</span>
                      <Button variant="ghost" size="sm" onClick={clearAllFilters} className="text-primary hover:underline hover:bg-transparent font-semibold">
                        Clear Filters
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center max-w-sm mx-auto text-center space-y-4 py-4">
                      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/5 text-primary border border-primary/10 shadow-xs">
                        {emptyIcon || <PackageOpen className="h-6 w-6 opacity-70" />}
                      </div>
                      <div className="space-y-1">
                        <h3 className="text-sm font-bold text-foreground">{emptyTitle}</h3>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          {emptyMessage || "No data records logged for this branch."}
                        </p>
                      </div>
                      {emptyAction}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ) : (
              paginatedData.map((item) => {
                const isSelected = currentSelectedIds.includes(item.id);
                return (
                  <TableRow
                    key={item.id}
                    onClick={() => onRowClick?.(item)}
                    className={cn(
                      "hover:bg-muted/20 transition-colors duration-150",
                      onRowClick && "cursor-pointer",
                      isSelected && "bg-primary/5 hover:bg-primary/10"
                    )}
                  >
                    {multiselect && (
                      <TableCell
                        className="w-12 px-4 py-3 text-center"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectRow(item.id);
                        }}
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => handleSelectRow(item.id)}
                          aria-label={`Select row ${item.id}`}
                        />
                      </TableCell>
                    )}
                    {columns.map((column) => (
                      <TableCell
                        key={column.key}
                        className={cn(
                          column.className,
                          column.align === "right" && "text-right font-mono text-xs"
                        )}
                      >
                        {formatCellValue(item, column)}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Mobile / Tablet View: Beautiful Card List. Also used at every width when forceCardView is set. */}
      <div className={cn(forceCardView ? "block" : "lg:hidden", "space-y-4")}>
        {paginatedData.length === 0 ? (
          <div className="rounded-xl border bg-card p-12 text-center shadow-xs border-muted/80">
            {hasActiveFilters || searchTerm ? (
              <div className="flex flex-col items-center justify-center gap-2">
                <span className="text-sm text-muted-foreground">No records match your filters.</span>
                <Button variant="ghost" size="sm" onClick={clearAllFilters} className="text-primary hover:underline hover:bg-transparent font-semibold">
                  Clear Filters
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center max-w-sm mx-auto text-center space-y-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/5 text-primary border border-primary/10 shadow-xs">
                  {emptyIcon || <PackageOpen className="h-6 w-6 opacity-70" />}
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-foreground">{emptyTitle}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {emptyMessage || "No data records logged for this branch."}
                  </p>
                </div>
                {emptyAction}
              </div>
            )}
          </div>
        ) : (
          <div className={cn("grid gap-4 sm:grid-cols-2 w-full min-w-0", forceCardView && "xl:grid-cols-3")}>
            {paginatedData.map((item) => {
              const isSelected = currentSelectedIds.includes(item.id);
              const actionsCol = columns.find(col => col.key === "actions");
              const dataCols = columns.filter(col => col.key !== "actions");
              const primaryCol = dataCols[0];
              const otherCols = dataCols.slice(1);

              return (
                <div
                  key={item.id}
                  onClick={() => {
                    if (onRowClick) {
                      onRowClick(item);
                    } else {
                      setMobileDetailItem(item);
                    }
                  }}
                  className={cn(
                    "relative bg-card text-card-foreground border rounded-xl p-4 shadow-xs hover:border-primary/45 hover:shadow-md transition-all cursor-pointer flex flex-col gap-3 group border-muted/80 min-w-0 overflow-hidden",
                    isSelected && "border-primary/50 bg-primary/5"
                  )}
                >
                  {/* Card Header */}
                  <div className="flex items-start justify-between gap-2 pr-8">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {multiselect && (
                        <div
                          className="shrink-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelectRow(item.id);
                          }}
                        >
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => handleSelectRow(item.id)}
                            aria-label={`Select row ${item.id}`}
                          />
                        </div>
                      )}
                      <div className="font-bold text-sm text-foreground truncate min-w-0 leading-tight">
                        {primaryCol ? formatCellValue(item, primaryCol) : `Record #${item.id}`}
                      </div>
                    </div>
                    
                    {/* Floating Actions button in card top-right */}
                    {actionsCol && (
                      <div 
                        className="absolute top-3 right-3 z-10 shrink-0" 
                        onClick={(e) => e.stopPropagation()}
                      >
                        {formatCellValue(item, actionsCol)}
                      </div>
                    )}
                  </div>
                  
                  {/* Card Body Key-Values */}
                  {otherCols.length > 0 && (
                    <div className="flex flex-col gap-2 pt-3 border-t border-muted/40">
                      {otherCols.map((col) => (
                        <div key={col.key} className="flex justify-between items-center min-w-0 gap-4">
                          <span className="text-xs font-medium text-muted-foreground shrink-0">
                            {col.header}
                          </span>
                          <div className="text-sm text-foreground font-semibold truncate text-right">
                            {formatCellValue(item, col)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Mobile Row Details Dialog */}
      <Dialog open={!!mobileDetailItem} onOpenChange={(open) => !open && setMobileDetailItem(null)}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader className="pb-3 border-b border-muted/20">
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              Detail Information
            </DialogTitle>
            <DialogDescription>
              Core fields and status values for this entry.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4 divide-y divide-muted/30">
            {mobileDetailItem && columns.map((col) => {
              if (col.key === "actions") return null;
              return (
                <div key={col.key} className="flex justify-between gap-4 py-2.5 first:pt-0">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{col.header}</span>
                  <span className="text-xs font-bold text-foreground text-right">{formatCellValue(mobileDetailItem, col)}</span>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>


      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-2">
        <div className="flex items-center gap-4">
          <p className="text-xs text-muted-foreground">
            Showing {sortedData.length === 0 ? 0 : startIndex + 1} to {Math.min(startIndex + pageSizeState, sortedData.length)} of {sortedData.length} entries
          </p>
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Rows:</span>
            <Select
              value={String(pageSizeState)}
              onValueChange={(val) => {
                setPageSizeState(Number(val));
                setCurrentPage(1);
              }}
            >
              <SelectTrigger className="h-7 w-[65px] text-xs font-semibold">
                <SelectValue placeholder={String(pageSizeState)} />
              </SelectTrigger>
              <SelectContent>
                {[5, 10, 30, 50, 100].map((size) => (
                  <SelectItem key={size} value={String(size)} className="text-xs">
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => goToPage(1)}
              disabled={currentPage === 1}
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="px-3 text-xs font-bold text-muted-foreground">
              Page {currentPage} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage === totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => goToPage(totalPages)}
              disabled={currentPage === totalPages}
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
