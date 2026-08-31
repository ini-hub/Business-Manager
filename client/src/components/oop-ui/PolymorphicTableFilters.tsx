import * as React from "react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, Filter } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
  SheetTrigger,
  SheetClose,
} from "@/components/ui/sheet";
import type { TableFilterConfig } from "./PolymorphicTable";

// Local copy of the same nested-path reader PolymorphicTable.tsx keeps for its own
// search/sort/filter logic — kept private here too rather than importing it, so this
// file never has to import a value (only the TableFilterConfig type) back from
// PolymorphicTable.tsx.
const getNestedValue = (obj: any, path: string): any => {
  let val = obj;
  const parts = path.split(".");
  for (const part of parts) {
    val = val?.[part];
    if (val === undefined || val === null) break;
  }
  return val;
};

// Single source of truth for a filter field's widget state and derived data, shared by
// the desktop popover (DropdownFilter) and the mobile bottom sheet (MobileFilterChip) so
// "how a select/range/date-range filter behaves" is implemented exactly once.
export interface FilterFieldController {
  config: TableFilterConfig;
  isActive: boolean;
  badge: string | null;

  // select
  searchValue: string;
  setSearchValue: (v: string) => void;
  hasSearch: boolean;
  filteredOptions: string[];
  selectedOptions: string[];
  handleSelectOption: (opt: string) => void;

  // range / date-range
  minInput: string;
  maxInput: string;
  rangeError: string;
  setMinInput: (v: string) => void;
  setMaxInput: (v: string) => void;
  handleBlur: () => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
}

export function useFilterFieldController(
  config: TableFilterConfig,
  data: any[],
  value: any,
  onChange: (val: any) => void
): FilterFieldController {
  const [searchValue, setSearchValue] = useState("");
  const [minInput, setMinInput] = useState("");
  const [maxInput, setMaxInput] = useState("");
  const [rangeError, setRangeError] = useState("");

  // Sync range/date-range local buffers when the external value changes or is cleared.
  useEffect(() => {
    if (config.type === "range" || config.type === "date-range") {
      setMinInput(value?.min !== undefined ? String(value.min) : "");
      setMaxInput(value?.max !== undefined ? String(value.max) : "");
      setRangeError("");
    }
  }, [value, config.type]);

  const options = React.useMemo(() => {
    if (config.type !== "select") return [];
    const uniqueVals = new Set<string>();
    data.forEach((item) => {
      const val = getNestedValue(item, config.key);
      if (val !== undefined && val !== null && val !== "") {
        const mapped = config.valueMapper ? config.valueMapper(val) : String(val);
        uniqueVals.add(mapped);
      }
    });
    return Array.from(uniqueVals).sort((a, b) => a.localeCompare(b));
  }, [data, config.key, config.valueMapper, config.type]);

  const selectedOptions = (config.type === "select" ? (value as string[]) : undefined) || [];
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

  const handleBlur = () => {
    if (config.type === "range") {
      const minNum = minInput !== "" ? Number(minInput) : "";
      const maxNum = maxInput !== "" ? Number(maxInput) : "";
      if (minNum !== "" && maxNum !== "" && minNum > maxNum) {
        setRangeError("Min cannot be greater than Max");
        return;
      }
      setRangeError("");
      onChange(minNum !== "" || maxNum !== "" ? { min: minNum, max: maxNum } : null);
    } else if (config.type === "date-range") {
      const minDate = minInput || "";
      const maxDate = maxInput || "";
      if (minDate && maxDate && new Date(minDate) > new Date(maxDate)) {
        setRangeError("Min cannot be greater than Max");
        return;
      }
      setRangeError("");
      onChange(minDate || maxDate ? { min: minDate, max: maxDate } : null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleBlur();
    }
  };

  const isActive =
    config.type === "select"
      ? selectedOptions.length > 0
      : (value?.min !== undefined && value?.min !== "") || (value?.max !== undefined && value?.max !== "");

  const badge =
    config.type === "select"
      ? (selectedOptions.length > 0 ? String(selectedOptions.length) : null)
      : config.type === "range"
      ? (isActive ? `${minInput || "0"}-${maxInput || "∞"}` : null)
      : config.type === "date-range"
      ? (isActive ? "Date Range" : null)
      : null;

  return {
    config,
    isActive,
    badge,
    searchValue,
    setSearchValue,
    hasSearch,
    filteredOptions,
    selectedOptions,
    handleSelectOption,
    minInput,
    maxInput,
    rangeError,
    setMinInput,
    setMaxInput,
    handleBlur,
    handleKeyDown,
  };
}

// Presentational-only: the actual options UI for a filter field (searchable checkbox
// list / min-max range / date bounds). Takes nothing but the controller, so it drops
// unchanged into either a desktop Popover or a mobile Sheet.
export function FilterFieldBody({ controller }: { controller: FilterFieldController }) {
  const { config } = controller;

  if (config.type === "select") {
    return (
      <div className="space-y-2">
        {controller.hasSearch && (
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={`Search ${config.label.toLowerCase()}...`}
              value={controller.searchValue}
              onChange={(e) => controller.setSearchValue(e.target.value)}
              className="pl-8 h-8 text-xs"
            />
          </div>
        )}
        <div className="max-h-56 overflow-y-auto space-y-1 py-1">
          {controller.filteredOptions.length === 0 ? (
            <div className="text-[11px] text-muted-foreground p-2 text-center">No options found</div>
          ) : (
            controller.filteredOptions.map((opt) => {
              const isChecked = controller.selectedOptions.includes(opt);
              return (
                <label
                  key={opt}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/60 cursor-pointer text-xs font-medium transition-colors"
                >
                  <Checkbox checked={isChecked} onCheckedChange={() => controller.handleSelectOption(opt)} />
                  <span className="truncate">{opt}</span>
                </label>
              );
            })
          )}
        </div>
      </div>
    );
  }

  if (config.type === "range") {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[10px]">Min {config.currencySymbol || ""}</Label>
            <Input
              type="number"
              min="0"
              step="1"
              placeholder="Min"
              value={controller.minInput}
              onChange={(e) => {
                const val = e.target.value;
                if (val === "" || Number(val) >= 0) controller.setMinInput(val);
              }}
              onBlur={controller.handleBlur}
              onKeyDown={controller.handleKeyDown}
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
              value={controller.maxInput}
              onChange={(e) => {
                const val = e.target.value;
                if (val === "" || Number(val) >= 0) controller.setMaxInput(val);
              }}
              onBlur={controller.handleBlur}
              onKeyDown={controller.handleKeyDown}
              className="h-8 text-xs font-mono"
            />
          </div>
        </div>
        {controller.rangeError && (
          <p className="text-[10px] font-semibold text-destructive animate-pulse">{controller.rangeError}</p>
        )}
      </div>
    );
  }

  if (config.type === "date-range") {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-2">
          <div className="space-y-1">
            <Label className="text-[10px]">From Date</Label>
            <Input
              type="date"
              value={controller.minInput}
              onChange={(e) => controller.setMinInput(e.target.value)}
              onBlur={controller.handleBlur}
              className="h-8 text-xs font-mono"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">To Date</Label>
            <Input
              type="date"
              value={controller.maxInput}
              onChange={(e) => controller.setMaxInput(e.target.value)}
              onBlur={controller.handleBlur}
              className="h-8 text-xs font-mono"
            />
          </div>
        </div>
        {controller.rangeError && (
          <p className="text-[10px] font-semibold text-destructive animate-pulse">{controller.rangeError}</p>
        )}
      </div>
    );
  }

  return null;
}

interface FilterFieldProps {
  config: TableFilterConfig;
  data: any[];
  value: any;
  onChange: (val: any) => void;
}

// Desktop: one small Popover per filter, opened from its own button — pick a value (or
// several) for just that filter and it applies immediately.
export function DropdownFilter({ config, data, value, onChange }: FilterFieldProps) {
  const [open, setOpen] = useState(false);
  const controller = useFilterFieldController(config, data, value, onChange);

  const showsHeader = config.type === "range" || config.type === "date-range";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={controller.isActive ? "secondary" : "outline"}
          size="sm"
          className={cn(
            "h-9 px-3 text-xs font-semibold gap-1.5 border transition-all",
            controller.isActive && "bg-primary/5 border-primary/30 text-primary shadow-xs"
          )}
        >
          <span>{config.label}</span>
          {controller.badge && (
            <span className="bg-primary/10 text-primary px-1.5 py-0.5 rounded-full text-[10px] font-bold">
              {controller.badge}
            </span>
          )}
          <span className="text-[10px] opacity-60">▾</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn(config.type === "select" ? "w-56 p-2" : "w-64 p-4 space-y-3")}
        align="start"
      >
        {showsHeader && (
          <div className="space-y-1">
            <h4 className="text-xs font-bold text-foreground">{config.label} Range</h4>
            <p className="text-[10px] text-muted-foreground">
              {config.type === "range" ? "Press Enter or click outside to apply" : "Select date bounds to filter"}
            </p>
          </div>
        )}
        <FilterFieldBody controller={controller} />
      </PopoverContent>
    </Popover>
  );
}

// Mobile: one chip per filter (mirrors the desktop row) — tapping a chip opens a bottom
// sheet scoped to just that filter's options, instead of one combined form covering
// every filter at once.
export function MobileFilterChip({ config, data, value, onChange }: FilterFieldProps) {
  const [open, setOpen] = useState(false);
  const controller = useFilterFieldController(config, data, value, onChange);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant={controller.isActive ? "secondary" : "outline"}
          size="sm"
          className={cn(
            "h-9 px-3 text-xs font-semibold gap-1.5 border transition-all flex-shrink-0 whitespace-nowrap",
            controller.isActive && "bg-primary/5 border-primary/30 text-primary shadow-xs"
          )}
        >
          <span>{config.label}</span>
          {controller.badge && (
            <span className="bg-primary/10 text-primary px-1.5 py-0.5 rounded-full text-[10px] font-bold">
              {controller.badge}
            </span>
          )}
          <span className="text-[10px] opacity-60">▾</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="rounded-t-xl max-h-[85vh] overflow-y-auto p-5 gap-4">
        <SheetHeader className="text-left">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Filter className="h-4 w-4 text-primary" />
            {config.label}
          </SheetTitle>
        </SheetHeader>
        <div className="py-1">
          <FilterFieldBody controller={controller} />
        </div>
        <SheetFooter className="flex-row justify-end gap-2 pt-3 border-t">
          {controller.isActive && (
            <Button variant="outline" size="sm" onClick={() => onChange(null)} className="text-xs">
              Clear
            </Button>
          )}
          <SheetClose asChild>
            <Button size="sm" className="text-xs min-w-[100px]">
              Done
            </Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
