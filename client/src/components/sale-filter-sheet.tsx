import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  type SaleFilterState,
  type SaleItemType,
  type SaleSortState,
  type SaleSortKey,
  type SaleSortDirection,
  EMPTY_SALE_FILTERS,
  saleSortLabel,
} from "@/lib/sale-filters";

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
        "h-9 px-3.5 rounded-full border text-sm font-medium transition-colors whitespace-nowrap capitalize",
        active ? "bg-primary/10 border-primary text-primary" : "border-input text-foreground hover:bg-muted/50"
      )}
    >
      {children}
    </button>
  );
}

interface SaleFiltersSheetProps {
  filters: SaleFilterState;
  onApply: (next: SaleFilterState) => void;
  resultCountFor: (draft: SaleFilterState) => number;
  currencySymbol: string;
  paymentMethods: string[];
  staffOptions: { id: string; name: string }[];
  trigger: React.ReactNode;
  /** Consolidated here rather than a separate Sort button/sheet (unlike the Customers
   * list) — the sales toolbar only has room for one control beside search. */
  sort: SaleSortState | null;
  onSortChange: (next: SaleSortState | null) => void;
}

const SALE_SORT_ROWS: { key: SaleSortKey; label: string; directions: SaleSortDirection[] }[] = [
  { key: "date", label: "Date", directions: ["desc", "asc"] },
  { key: "amount", label: "Amount", directions: ["desc", "asc"] },
  { key: "customer", label: "Customer", directions: ["asc", "desc"] },
];

export function SaleFiltersSheet({
  filters,
  onApply,
  resultCountFor,
  currencySymbol,
  paymentMethods,
  staffOptions,
  trigger,
  sort,
  onSortChange,
}: SaleFiltersSheetProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(filters);
  const [sortDraft, setSortDraft] = useState(sort);

  // Re-seed the draft from the last applied filters each time the sheet opens, so a
  // cancelled edit (closing without tapping "Show N sales") doesn't stick.
  useEffect(() => {
    if (open) {
      setDraft(filters);
      setSortDraft(sort);
    }
  }, [open, filters, sort]);

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
              setDraft(EMPTY_SALE_FILTERS);
              setSortDraft(null);
            }}
            data-testid="button-sale-filters-reset"
          >
            Reset
          </button>
        </SheetHeader>

        <div className="space-y-2">
          <p className="text-sm font-semibold text-muted-foreground">Sort by</p>
          <div className="divide-y">
            {SALE_SORT_ROWS.map((row) => (
              <div key={row.key} className="flex items-center justify-between py-2.5 gap-3">
                <span className="text-sm font-medium">{row.label}</span>
                <div className="flex items-center gap-2 shrink-0">
                  {row.directions.map((direction) => (
                    <PresetChip
                      key={direction}
                      active={sortDraft?.key === row.key && sortDraft.direction === direction}
                      onClick={() => setSortDraft({ key: row.key, direction })}
                    >
                      {saleSortLabel({ key: row.key, direction }).replace("Sort: ", "")}
                    </PresetChip>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-semibold text-muted-foreground">Payment method</p>
          <div className="flex flex-wrap gap-2">
            {paymentMethods.map((method) => (
              <PresetChip
                key={method}
                active={draft.paymentMethod === method}
                onClick={() => setDraft((d) => ({ ...d, paymentMethod: d.paymentMethod === method ? null : method }))}
              >
                {method}
              </PresetChip>
            ))}
          </div>
        </div>

        {staffOptions.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-muted-foreground">Staff</p>
            <div className="flex flex-wrap gap-2">
              {staffOptions.map((staff) => (
                <PresetChip
                  key={staff.id}
                  active={draft.staffId === staff.id}
                  onClick={() => setDraft((d) => ({ ...d, staffId: d.staffId === staff.id ? null : staff.id }))}
                >
                  {staff.name}
                </PresetChip>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-sm font-semibold text-muted-foreground">Item type</p>
          <div className="flex flex-wrap gap-2">
            {(["service", "product", "mixed"] as SaleItemType[]).map((type) => (
              <PresetChip
                key={type}
                active={draft.itemType === type}
                onClick={() => setDraft((d) => ({ ...d, itemType: d.itemType === type ? null : type }))}
              >
                {type}
              </PresetChip>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-semibold text-muted-foreground">Amount ({currencySymbol})</p>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              placeholder="Min"
              value={draft.amountMin ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, amountMin: e.target.value ? Number(e.target.value) : null }))}
            />
            <span className="text-sm text-muted-foreground shrink-0">to</span>
            <Input
              type="number"
              placeholder="Max"
              value={draft.amountMax ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, amountMax: e.target.value ? Number(e.target.value) : null }))}
            />
          </div>
        </div>

        <Button
          className="w-full h-11"
          onClick={() => {
            onApply(draft);
            onSortChange(sortDraft);
            setOpen(false);
          }}
          data-testid="button-sale-filters-apply"
        >
          Show {liveCount} sale{liveCount === 1 ? "" : "s"}
        </Button>
      </SheetContent>
    </Sheet>
  );
}
