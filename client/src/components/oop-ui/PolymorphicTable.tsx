import * as React from "react";
import { useState, useEffect } from "react";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  Filter,
  PackageOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";

const getNestedValue = (obj: any, path: string): any => {
  let val = obj;
  const parts = path.split(".");
  for (const part of parts) {
    val = val?.[part];
    if (val === undefined || val === null) break;
  }
  return val;
};

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
}

interface DropdownFilterProps {
  config: TableFilterConfig;
  data: any[];
  value: any;
  onChange: (val: any) => void;
}

export function DropdownFilter({ config, data, value, onChange }: DropdownFilterProps) {
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  
  // Local state for range inputs to apply on blur
  const [minInput, setMinInput] = useState("");
  const [maxInput, setMaxInput] = useState("");
  const [rangeError, setRangeError] = useState("");

  // Sync range values when external change or clear occurs
  useEffect(() => {
    if (config.type === "range" || config.type === "date-range") {
      const minVal = value?.min !== undefined ? String(value.min) : "";
      const maxVal = value?.max !== undefined ? String(value.max) : "";
      setMinInput(minVal);
      setMaxInput(maxVal);
      setRangeError("");
    }
  }, [value, config.type]);

  if (config.type === "select") {
    // Dynamic option extraction from actual data in the table
    const options = React.useMemo(() => {
      const uniqueVals = new Set<string>();
      data.forEach((item) => {
        const val = getNestedValue(item, config.key);
        if (val !== undefined && val !== null && val !== "") {
          const mapped = config.valueMapper ? config.valueMapper(val) : String(val);
          uniqueVals.add(mapped);
        }
      });
      return Array.from(uniqueVals).sort((a, b) => a.localeCompare(b));
    }, [data, config.key, config.valueMapper]);

    const selectedOptions = (value as string[]) || [];
    const hasSearch = options.length > 10;
    
    const filteredOptions = options.filter((opt) =>
      opt.toLowerCase().includes(searchValue.toLowerCase())
    );

    const handleSelectOption = (opt: string) => {
      const next = selectedOptions.includes(opt)
        ? selectedOptions.filter((o) => o !== opt)
        : [...selectedOptions, opt];
      onChange(next.length > 0 ? next : null);
    };

    const count = selectedOptions.length;
    const isActive = count > 0;

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant={isActive ? "secondary" : "outline"}
            size="sm"
            className={cn(
              "h-9 px-3 text-xs font-semibold gap-1.5 border transition-all",
              isActive && "bg-primary/5 border-primary/30 text-primary shadow-xs"
            )}
          >
            <span>{config.label}</span>
            {isActive && <span className="bg-primary/10 text-primary px-1.5 py-0.5 rounded-full text-[10px] font-bold">{count}</span>}
            <span className="text-[10px] opacity-60">▾</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-2" align="start">
          <div className="space-y-2">
            {hasSearch && (
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder={`Search ${config.label.toLowerCase()}...`}
                  value={searchValue}
                  onChange={(e) => setSearchValue(e.target.value)}
                  className="pl-8 h-8 text-xs"
                />
              </div>
            )}
            <div className="max-h-56 overflow-y-auto space-y-1 py-1">
              {filteredOptions.length === 0 ? (
                <div className="text-[11px] text-muted-foreground p-2 text-center">No options found</div>
              ) : (
                filteredOptions.map((opt) => {
                  const isChecked = selectedOptions.includes(opt);
                  return (
                    <label
                      key={opt}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/60 cursor-pointer text-xs font-medium transition-colors"
                    >
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={() => handleSelectOption(opt)}
                      />
                      <span className="truncate">{opt}</span>
                    </label>
                  );
                })
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  if (config.type === "range") {
    const isActive = (value?.min !== undefined && value?.min !== "") || (value?.max !== undefined && value?.max !== "");
    
    const handleBlur = () => {
      const minNum = minInput !== "" ? Number(minInput) : "";
      const maxNum = maxInput !== "" ? Number(maxInput) : "";

      if (minNum !== "" && maxNum !== "" && minNum > maxNum) {
        setRangeError("Min cannot be greater than Max");
        return;
      }
      
      setRangeError("");
      onChange(minNum !== "" || maxNum !== "" ? { min: minNum, max: maxNum } : null);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleBlur();
      }
    };

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant={isActive ? "secondary" : "outline"}
            size="sm"
            className={cn(
              "h-9 px-3 text-xs font-semibold gap-1.5 border transition-all",
              isActive && "bg-primary/5 border-primary/30 text-primary shadow-xs"
            )}
          >
            <span>{config.label}</span>
            {isActive && (
              <span className="text-[10px] font-bold bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">
                {minInput || "0"}-{maxInput || "∞"}
              </span>
            )}
            <span className="text-[10px] opacity-60">▾</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-4 space-y-3" align="start">
          <div className="space-y-1">
            <h4 className="text-xs font-bold text-foreground">{config.label} Range</h4>
            <p className="text-[10px] text-muted-foreground">Press Enter or click outside to apply</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[10px]">Min {config.currencySymbol || ""}</Label>
              <Input
                type="number"
                min="0"
                step="1"
                placeholder="Min"
                value={minInput}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "" || Number(val) >= 0) {
                    setMinInput(val);
                  }
                }}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                className="h-8 text-xs font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px]">Max {config.currencySymbol || ""}</Label>
              <Input
                type="number"
                min="0"
                step="1"
                placeholder="Max"
                value={maxInput}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "" || Number(val) >= 0) {
                    setMaxInput(val);
                  }
                }}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                className="h-8 text-xs font-mono"
              />
            </div>
          </div>
          {rangeError && (
            <p className="text-[10px] font-semibold text-destructive animate-pulse">{rangeError}</p>
          )}
        </PopoverContent>
      </Popover>
    );
  }

  if (config.type === "date-range") {
    const isActive = (value?.min !== undefined && value?.min !== "") || (value?.max !== undefined && value?.max !== "");

    const handleBlur = () => {
      const minDate = minInput || "";
      const maxDate = maxInput || "";

      if (minDate && maxDate && new Date(minDate) > new Date(maxDate)) {
        setRangeError("Min cannot be greater than Max");
        return;
      }

      setRangeError("");
      onChange(minDate || maxDate ? { min: minDate, max: maxDate } : null);
    };

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant={isActive ? "secondary" : "outline"}
            size="sm"
            className={cn(
              "h-9 px-3 text-xs font-semibold gap-1.5 border transition-all",
              isActive && "bg-primary/5 border-primary/30 text-primary shadow-xs"
            )}
          >
            <span>{config.label}</span>
            {isActive && (
              <span className="text-[10px] font-bold bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">
                Date Range
              </span>
            )}
            <span className="text-[10px] opacity-60">▾</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-4 space-y-3" align="start">
          <div className="space-y-1">
            <h4 className="text-xs font-bold text-foreground">{config.label} Range</h4>
            <p className="text-[10px] text-muted-foreground">Select date bounds to filter</p>
          </div>
          <div className="grid grid-cols-1 gap-2">
            <div className="space-y-1">
              <Label className="text-[10px]">From Date</Label>
              <Input
                type="date"
                value={minInput}
                onChange={(e) => setMinInput(e.target.value)}
                onBlur={handleBlur}
                className="h-8 text-xs font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px]">To Date</Label>
              <Input
                type="date"
                value={maxInput}
                onChange={(e) => setMaxInput(e.target.value)}
                onBlur={handleBlur}
                className="h-8 text-xs font-mono"
              />
            </div>
          </div>
          {rangeError && (
            <p className="text-[10px] font-semibold text-destructive animate-pulse">{rangeError}</p>
          )}
        </PopoverContent>
      </Popover>
    );
  }

  return null;
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
}: PolymorphicTableProps<T>) {
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSizeState, setPageSizeState] = useState(pageSize);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc" | null>(null);

  // Advanced filters state
  const [activeFilters, setActiveFilters] = useState<Record<string, any>>({});
  const [isMobileFiltersOpen, setIsMobileFiltersOpen] = useState(false);
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

  // Filter & Search Logic
  const filteredData = data.filter((item) => {
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
  });

  const sortedData = [...filteredData].sort((a, b) => {
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
  });

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
          
          {/* Mobile Filter Trigger Button */}
          {filterConfigs.length > 0 && (
            <div className="md:hidden flex items-center gap-2 w-full sm:w-auto">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsMobileFiltersOpen(true)}
                className={cn(
                  "h-9 px-3 gap-2 text-xs font-semibold w-full sm:w-auto justify-center",
                  hasActiveFilters && "bg-primary/5 border-primary/30 text-primary"
                )}
              >
                <Filter className="h-3.5 w-3.5" />
                Filters {hasActiveFilters && `(${Object.keys(activeFilters).length})`} ▾
              </Button>
              
              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearAllFilters}
                  className="text-xs text-muted-foreground px-2 h-9"
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

      <div className="hidden lg:block rounded-md border bg-card text-card-foreground overflow-x-auto max-w-full">
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

      {/* Mobile / Tablet View: Beautiful Card List */}
      <div className="lg:hidden space-y-4">
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
          <div className="grid gap-4 sm:grid-cols-2 w-full min-w-0">
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

      {/* Mobile Filters Sheet/Dialog */}
      <Dialog open={isMobileFiltersOpen} onOpenChange={setIsMobileFiltersOpen}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Filter className="h-5 w-5 text-primary" />
              Table Filters
            </DialogTitle>
            <DialogDescription>
              Narrow down results using criteria filters below.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 py-4">
            {filterConfigs.map((config) => {
              const value = activeFilters[config.key];
              return (
                <div key={`mobile-${config.key}`} className="space-y-2 border-b pb-4 last:border-0 last:pb-0">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{config.label}</h4>
                  
                  {config.type === "select" ? (
                    <div className="space-y-2">
                      {(() => {
                        const uniqueVals = new Set<string>();
                        data.forEach((item) => {
                          const val = getNestedValue(item, config.key);
                          if (val !== undefined && val !== null && val !== "") {
                            const mapped = config.valueMapper ? config.valueMapper(val) : String(val);
                            uniqueVals.add(mapped);
                          }
                        });
                        const options = Array.from(uniqueVals).sort((a, b) => a.localeCompare(b));
                        const selectedOptions = (value as string[]) || [];

                        return (
                          <div className="grid grid-cols-2 gap-2">
                            {options.map((opt) => {
                              const isChecked = selectedOptions.includes(opt);
                              return (
                                <label
                                  key={opt}
                                  className={cn(
                                    "flex items-center gap-2 px-2.5 py-2 rounded-lg border transition-all text-xs font-semibold cursor-pointer",
                                    isChecked
                                      ? "bg-primary/5 border-primary/30 text-primary shadow-xs"
                                      : "bg-background border-muted/50 text-muted-foreground hover:bg-muted/10"
                                  )}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => {
                                      const next = isChecked
                                        ? selectedOptions.filter((o) => o !== opt)
                                        : [...selectedOptions, opt];
                                      handleFilterChange(config.key, next.length > 0 ? next : null);
                                    }}
                                    className="rounded border-muted text-primary focus:ring-primary h-4 w-4"
                                  />
                                  <span className="truncate">{opt}</span>
                                </label>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                  ) : config.type === "range" ? (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-[10px]">Min {config.currencySymbol || ""}</Label>
                        <Input
                          type="number"
                          placeholder="Min"
                          value={value?.min !== undefined ? value.min : ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === "" || Number(val) >= 0) {
                              const nextMax = value?.max !== undefined ? value.max : "";
                              handleFilterChange(config.key, val !== "" || nextMax !== "" ? { min: val === "" ? "" : Number(val), max: nextMax } : null);
                            }
                          }}
                          className="h-9 text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px]">Max {config.currencySymbol || ""}</Label>
                        <Input
                          type="number"
                          placeholder="Max"
                          value={value?.max !== undefined ? value.max : ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === "" || Number(val) >= 0) {
                              const nextMin = value?.min !== undefined ? value.min : "";
                              handleFilterChange(config.key, nextMin !== "" || val !== "" ? { min: nextMin, max: val === "" ? "" : Number(val) } : null);
                            }
                          }}
                          className="h-9 text-xs"
                        />
                      </div>
                    </div>
                  ) : config.type === "date-range" ? (
                    <div className="grid grid-cols-1 gap-2">
                      <div className="space-y-1">
                        <Label className="text-[10px]">From Date</Label>
                        <Input
                          type="date"
                          value={value?.min !== undefined ? value.min : ""}
                          onChange={(e) => {
                            const nextMax = value?.max !== undefined ? value.max : "";
                            handleFilterChange(config.key, e.target.value || nextMax ? { min: e.target.value, max: nextMax } : null);
                          }}
                          className="h-9 text-xs font-mono"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px]">To Date</Label>
                        <Input
                          type="date"
                          value={value?.max !== undefined ? value.max : ""}
                          onChange={(e) => {
                            const nextMin = value?.min !== undefined ? value.min : "";
                            handleFilterChange(config.key, nextMin || e.target.value ? { min: nextMin, max: e.target.value } : null);
                          }}
                          className="h-9 text-xs font-mono"
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            {hasActiveFilters && (
              <Button variant="outline" onClick={clearAllFilters} className="text-xs">
                Clear Filters
              </Button>
            )}
            <Button onClick={() => setIsMobileFiltersOpen(false)} className="text-xs min-w-[100px]">
              Apply Filters
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
