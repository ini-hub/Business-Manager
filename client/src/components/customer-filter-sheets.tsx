import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  type CustomerFilterState,
  type CustomerSortState,
  type CustomerSortKey,
  type CustomerSortDirection,
  EMPTY_CUSTOMER_FILTERS,
  customerSortLabel,
} from "@/lib/customer-filters";

function PresetChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-9 px-3.5 rounded-full border text-sm font-medium transition-colors whitespace-nowrap",
        active ? "bg-primary/10 border-primary text-primary" : "border-input text-foreground hover:bg-muted/50"
      )}
    >
      {children}
    </button>
  );
}

interface FiltersSheetProps {
  filters: CustomerFilterState;
  onApply: (next: CustomerFilterState) => void;
  resultCountFor: (draft: CustomerFilterState) => number;
  currencySymbol: string;
  trigger: React.ReactNode;
}

export function FiltersSheet({ filters, onApply, resultCountFor, currencySymbol, trigger }: FiltersSheetProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(filters);
  const [showLastVisitedCustom, setShowLastVisitedCustom] = useState(!!filters.lastVisitedCustom);
  const [showDateAddedCustom, setShowDateAddedCustom] = useState(!!filters.dateAddedCustom);

  // Re-seed the draft from the last applied filters each time the sheet opens, so a
  // cancelled edit (closing without tapping "Show N customers") doesn't stick.
  useEffect(() => {
    if (open) {
      setDraft(filters);
      setShowLastVisitedCustom(!!filters.lastVisitedCustom);
      setShowDateAddedCustom(!!filters.dateAddedCustom);
    }
  }, [open, filters]);

  const liveCount = resultCountFor(draft);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="bottom" className="rounded-t-xl max-h-[85vh] overflow-y-auto p-5 gap-5">
        <SheetHeader className="flex-row items-center justify-between text-left p-0 space-y-0">
          <SheetTitle className="text-lg">Filters</SheetTitle>
          <button
            type="button"
            className="text-sm font-medium text-primary hover:underline"
            onClick={() => {
              setDraft(EMPTY_CUSTOMER_FILTERS);
              setShowLastVisitedCustom(false);
              setShowDateAddedCustom(false);
            }}
            data-testid="button-filters-reset"
          >
            Reset
          </button>
        </SheetHeader>

        <div className="space-y-2">
          <p className="text-sm font-semibold text-muted-foreground">Last visited</p>
          <div className="flex flex-wrap gap-2">
            {([
              ["7d", "7 days"],
              ["30d", "30 days"],
              ["30d+", "30+ days ago"],
              ["never", "Never"],
            ] as const).map(([value, label]) => (
              <PresetChip
                key={value}
                active={draft.lastVisited === value}
                onClick={() => setDraft((d) => ({ ...d, lastVisited: d.lastVisited === value ? null : value }))}
              >
                {label}
              </PresetChip>
            ))}
            <PresetChip
              active={showLastVisitedCustom}
              onClick={() => {
                setShowLastVisitedCustom((s) => !s);
                if (showLastVisitedCustom) setDraft((d) => ({ ...d, lastVisitedCustom: null }));
              }}
            >
              Custom
            </PresetChip>
          </div>
          {showLastVisitedCustom && (
            <div className="flex items-center gap-2 pt-1">
              <Input
                type="date"
                value={draft.lastVisitedCustom?.from ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, lastVisitedCustom: { ...d.lastVisitedCustom, from: e.target.value } }))}
              />
              <span className="text-sm text-muted-foreground shrink-0">to</span>
              <Input
                type="date"
                value={draft.lastVisitedCustom?.to ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, lastVisitedCustom: { ...d.lastVisitedCustom, to: e.target.value } }))}
              />
            </div>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-sm font-semibold text-muted-foreground">Total spend ({currencySymbol})</p>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              placeholder="Min"
              value={draft.spendMin ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, spendMin: e.target.value ? Number(e.target.value) : null }))}
            />
            <span className="text-sm text-muted-foreground shrink-0">to</span>
            <Input
              type="number"
              placeholder="Max"
              value={draft.spendMax ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, spendMax: e.target.value ? Number(e.target.value) : null }))}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <PresetChip
              active={draft.spendPreset === "top10"}
              onClick={() => setDraft((d) => ({ ...d, spendPreset: d.spendPreset === "top10" ? null : "top10" }))}
            >
              Top 10%
            </PresetChip>
            <PresetChip
              active={draft.spendPreset === "none"}
              onClick={() => setDraft((d) => ({ ...d, spendPreset: d.spendPreset === "none" ? null : "none" }))}
            >
              No purchases
            </PresetChip>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-semibold text-muted-foreground">Date added</p>
          <div className="flex flex-wrap gap-2">
            {([
              ["month", "This month"],
              ["3months", "Last 3 months"],
            ] as const).map(([value, label]) => (
              <PresetChip
                key={value}
                active={draft.dateAdded === value}
                onClick={() => setDraft((d) => ({ ...d, dateAdded: d.dateAdded === value ? null : value }))}
              >
                {label}
              </PresetChip>
            ))}
            <PresetChip
              active={showDateAddedCustom}
              onClick={() => {
                setShowDateAddedCustom((s) => !s);
                if (showDateAddedCustom) setDraft((d) => ({ ...d, dateAddedCustom: null }));
              }}
            >
              Custom
            </PresetChip>
          </div>
          {showDateAddedCustom && (
            <div className="flex items-center gap-2 pt-1">
              <Input
                type="date"
                value={draft.dateAddedCustom?.from ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, dateAddedCustom: { ...d.dateAddedCustom, from: e.target.value } }))}
              />
              <span className="text-sm text-muted-foreground shrink-0">to</span>
              <Input
                type="date"
                value={draft.dateAddedCustom?.to ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, dateAddedCustom: { ...d.dateAddedCustom, to: e.target.value } }))}
              />
            </div>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-sm font-semibold text-muted-foreground">Profile</p>
          <div className="flex flex-wrap gap-2">
            <PresetChip active={draft.missingAddress} onClick={() => setDraft((d) => ({ ...d, missingAddress: !d.missingAddress }))}>
              Missing address
            </PresetChip>
            <PresetChip active={draft.missingPhone} onClick={() => setDraft((d) => ({ ...d, missingPhone: !d.missingPhone }))}>
              Missing phone
            </PresetChip>
          </div>
        </div>

        <Button
          className="w-full h-11"
          onClick={() => {
            onApply(draft);
            setOpen(false);
          }}
          data-testid="button-filters-apply"
        >
          Show {liveCount} customer{liveCount === 1 ? "" : "s"}
        </Button>
      </SheetContent>
    </Sheet>
  );
}

interface SortSheetProps {
  sort: CustomerSortState | null;
  onChange: (next: CustomerSortState) => void;
  trigger: React.ReactNode;
}

const SORT_ROWS: { key: CustomerSortKey; label: string; directions: CustomerSortDirection[] }[] = [
  { key: "lastVisited", label: "Last visited", directions: ["desc", "asc"] },
  { key: "totalSpend", label: "Total spend", directions: ["desc", "asc"] },
  { key: "dateAdded", label: "Date added", directions: ["desc", "asc"] },
  { key: "name", label: "Name", directions: ["asc", "desc"] },
];

export function SortSheet({ sort, onChange, trigger }: SortSheetProps) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="bottom" className="rounded-t-xl p-5 gap-4">
        <SheetHeader className="text-left p-0 space-y-0">
          <SheetTitle className="text-lg">Sort by</SheetTitle>
        </SheetHeader>
        <div className="divide-y">
          {SORT_ROWS.map((row) => (
            <div key={row.key} className="flex items-center justify-between py-3 gap-3">
              <span className="text-sm font-medium">{row.label}</span>
              <div className="flex items-center gap-2 shrink-0">
                {row.directions.map((direction) => (
                  <PresetChip
                    key={direction}
                    active={sort?.key === row.key && sort.direction === direction}
                    onClick={() => {
                      onChange({ key: row.key, direction });
                      setOpen(false);
                    }}
                  >
                    {customerSortLabel({ key: row.key, direction })}
                  </PresetChip>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Applies instantly</p>
      </SheetContent>
    </Sheet>
  );
}
