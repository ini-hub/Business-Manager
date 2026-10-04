import { useRef, useState } from "react";
import { ArrowUpDown, Search, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ClearableInput } from "@/components/clearable-input";
import { cn } from "@/lib/utils";

// Mobile list toolbar: Search, Filters and Sort on one 44px line.
//  - Default: search is an icon; Filters and Sort split the rest equally.
//  - Filters applied: Filters turns blue and shows the count; the row does not grow.
//  - Search tapped (or holding text): the field fills the row, Filters and Sort shrink to
//    icons (the filter count moves to a badge).
// From lg up the search field is always open and the buttons keep their labels.

interface Props {
  search: string;
  onSearchChange: (value: string) => void;
  placeholder: string;
  /** Wraps the given button in the Filters sheet. Omit when the list has no filters. */
  filters?: (trigger: React.ReactNode) => React.ReactNode;
  filterCount?: number;
  /** Wraps the given button in the Sort sheet. Omit when the list has no sort. */
  sort?: (trigger: React.ReactNode) => React.ReactNode;
  /** Current sort in words, e.g. "Newest". */
  sortLabel?: string;
  className?: string;
  testIdPrefix?: string;
}

const BTN = "h-11 rounded-[10px] bg-card";

export function ListToolbar({
  search, onSearchChange, placeholder, filters, filterCount = 0, sort, sortLabel = "Sort", className, testIdPrefix = "list",
}: Props) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const expanded = open || search !== "";
  const active = filterCount > 0;

  const filterButton = (
    <Button
      variant="outline"
      aria-label={active ? `Filters, ${filterCount} applied` : "Filters"}
      className={cn(
        BTN, "relative gap-2 min-w-0",
        expanded ? "w-11 px-0 shrink-0 lg:w-auto lg:px-4 lg:flex-none" : "flex-1",
        active && "bg-primary/10 border-primary text-primary hover:bg-primary/15",
      )}
      data-testid={`button-${testIdPrefix}-filters`}
    >
      <SlidersHorizontal className="h-4 w-4 shrink-0" />
      <span className={cn("truncate", expanded && "hidden lg:inline")}>
        {active ? `Filters · ${filterCount}` : "Filters"}
      </span>
      {active && expanded && (
        <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[11px] font-semibold flex items-center justify-center lg:hidden">
          {filterCount}
        </span>
      )}
    </Button>
  );

  const sortButton = (
    <Button
      variant="outline"
      aria-label={`Sort: ${sortLabel}`}
      className={cn(BTN, "gap-2 min-w-0", expanded ? "w-11 px-0 shrink-0 lg:w-auto lg:px-4 lg:flex-none" : "flex-1")}
      data-testid={`button-${testIdPrefix}-sort`}
    >
      <ArrowUpDown className="h-4 w-4 shrink-0" />
      <span className={cn("truncate", expanded && "hidden lg:inline")}>{sortLabel}</span>
    </Button>
  );

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {!expanded && (
        <Button
          variant="outline"
          aria-label="Search"
          className={cn(BTN, "w-11 px-0 shrink-0 lg:hidden")}
          onClick={() => { setOpen(true); requestAnimationFrame(() => inputRef.current?.focus()); }}
          data-testid={`button-${testIdPrefix}-search`}
        >
          <Search className="h-4 w-4" />
        </Button>
      )}
      <div className={cn("relative min-w-0", expanded ? "flex-1" : "hidden lg:block lg:flex-1 lg:max-w-md")}>
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none z-10" />
        <ClearableInput
          ref={inputRef}
          placeholder={placeholder}
          aria-label={placeholder}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          onClear={() => onSearchChange("")}
          onBlur={() => { if (search === "") setOpen(false); }}
          className="pl-9 h-11 rounded-[10px] bg-card border-primary lg:border-input"
        />
      </div>
      {filters ? filters(filterButton) : null}
      {sort ? sort(sortButton) : null}
    </div>
  );
}
