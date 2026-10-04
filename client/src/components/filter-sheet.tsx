import { useEffect, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

// The one mobile "Filters" bottom sheet used by every list screen. Filters are drafted
// inside the sheet and applied in one step by the footer button (see the "Mobile filters
// and sort" pattern): sections are collapsible, the first opens by default, and the footer
// names the result ("Show 2 customers") and disables at zero.

export interface FilterSheetProps<D> {
  /** What is applied right now; the sheet copies it into a draft each time it opens. */
  applied: D;
  empty: D;
  onApply: (next: D) => void;
  /** How many rows the draft would show. Drives the footer button. */
  resultCountFor: (draft: D) => number;
  /** Singular noun for the footer: "customer" -> "Show 2 customers". */
  noun: string;
  /** Plural override for irregular nouns. */
  plural?: string;
  trigger: React.ReactNode;
  /** Number of sections set in the draft; shown as a badge by the title. */
  activeCount?: (draft: D) => number;
  /** Renders the sections. Receives the live draft and a patch function. */
  children: (ctx: { draft: D; patch: (p: Partial<D>) => void; setDraft: (next: D) => void }) => React.ReactNode;
}

export function FilterSheet<D>({
  applied, empty, onApply, resultCountFor, noun, plural, trigger, activeCount, children,
}: FilterSheetProps<D>) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<D>(applied);

  // Opening copies the applied state, so closing without the footer button discards edits.
  useEffect(() => {
    if (open) setDraft(applied);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const count = resultCountFor(draft);
  const active = activeCount ? activeCount(draft) : 0;
  const pluralNoun = plural ?? `${noun}s`;
  const nothingSet = JSON.stringify(draft) === JSON.stringify(empty);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent
        side="bottom"
        // Hide the stock top-right X: the header carries its own 44px Close.
        className="rounded-t-2xl max-h-[88vh] p-0 gap-0 flex flex-col sm:max-w-xl sm:mx-auto [&>button:last-child]:hidden"
      >
        <SheetHeader className="flex-row items-center gap-2 space-y-0 px-5 pt-4 pb-3 text-left border-b">
          <SheetTitle className="text-lg flex items-center gap-2 mr-auto">
            Filters
            {active > 0 && (
              <span className="min-w-5 h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-xs font-semibold inline-flex items-center justify-center">
                {active}
              </span>
            )}
          </SheetTitle>
          <SheetDescription className="sr-only">Choose filters, then show the results.</SheetDescription>
          <Button
            type="button"
            variant="ghost"
            className="h-11 px-3 text-sm font-medium text-muted-foreground disabled:opacity-50"
            disabled={nothingSet}
            onClick={() => setDraft(empty)}
            data-testid="button-filters-reset"
          >
            Reset
          </Button>
          <SheetClose asChild>
            <Button type="button" variant="secondary" size="icon" className="h-11 w-11 rounded-full" aria-label="Close filters">
              <X className="h-5 w-5" />
            </Button>
          </SheetClose>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto divide-y">
          {children({ draft, patch: (p) => setDraft((d) => ({ ...d, ...p })), setDraft })}
        </div>

        <div className="border-t p-4 bg-background">
          <Button
            className="w-full h-12 text-base"
            disabled={count === 0}
            onClick={() => { onApply(draft); setOpen(false); }}
            data-testid="button-filters-apply"
          >
            {count === 0 ? `No ${pluralNoun} match` : `Show ${count} ${count === 1 ? noun : pluralNoun}`}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** One collapsible row: label on top, current value beneath ("Any" in grey, the choice in accent). */
export function FilterSection({
  label, summary, defaultOpen, onClear, children,
}: {
  label: string;
  /** Human text of the current choice; empty/undefined shows "Any". */
  summary?: string | null;
  defaultOpen?: boolean;
  /** Shown as a Clear link once something is set. */
  onClear?: () => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="w-full flex items-center justify-between gap-3 px-5 py-3 min-h-[56px] text-left">
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{label}</span>
          <span className={cn("block text-sm truncate", summary ? "text-primary" : "text-muted-foreground")}>
            {summary || "Any"}
          </span>
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-5 pb-3">
        {children}
        {summary && onClear && (
          <button type="button" className="mt-2 text-sm font-medium text-primary hover:underline" onClick={onClear}>
            Clear {label.toLowerCase()}
          </button>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function Count({ n }: { n?: number }) {
  if (n === undefined) return null;
  return <span className={cn("text-sm tabular-nums shrink-0", n === 0 ? "text-muted-foreground/50" : "text-muted-foreground")}>{n}</span>;
}

/** Radio rows with a live count beside each; tap the selected row again to clear. Zero counts are greyed, never hidden. */
export function OptionRows<V extends string>({
  options, value, onChange,
}: {
  options: { value: V; label: string; count?: number }[];
  value: V | null;
  onChange: (next: V | null) => void;
}) {
  return (
    <div role="radiogroup" className="divide-y">
      {options.map((o) => {
        const selected = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(selected ? null : o.value)}
            className={cn("w-full flex items-center gap-3 min-h-[44px] py-2 text-left", o.count === 0 && !selected && "text-muted-foreground")}
          >
            <span className={cn("h-5 w-5 rounded-full border-2 shrink-0 flex items-center justify-center", selected ? "border-primary" : "border-input")}>
              {selected && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
            </span>
            <span className="flex-1 text-sm">{o.label}</span>
            <Count n={o.count} />
          </button>
        );
      })}
    </div>
  );
}

/** Multi-select for short lists (6 or fewer): chips with a count. Matches any selected. */
export function ChipOptions({
  options, value, onChange,
}: {
  options: { value: string; label: string; count?: number }[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
            className={cn(
              "h-9 px-3.5 rounded-full border text-sm font-medium whitespace-nowrap transition-colors",
              on ? "bg-primary/10 border-primary text-primary" : "border-input",
              !on && o.count === 0 && "text-muted-foreground/60",
            )}
          >
            {o.label}
            {o.count !== undefined && <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Multi-select for long lists (more than 6): search box above checkbox rows, selected pinned to the top. */
export function SearchableOptions({
  options, value, onChange, placeholder,
}: {
  options: { value: string; label: string; count?: number }[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const term = q.trim().toLowerCase();
  const shown = options
    .filter((o) => !term || o.label.toLowerCase().includes(term))
    .sort((a, b) => Number(value.includes(b.value)) - Number(value.includes(a.value)));
  return (
    <div className="space-y-2">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder ?? "Search"} aria-label={placeholder ?? "Search"} className="h-10" />
      <div className="max-h-56 overflow-y-auto divide-y">
        {shown.length === 0 && <p className="py-3 text-sm text-muted-foreground text-center">No matches</p>}
        {shown.map((o) => {
          const on = value.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
              className="w-full flex items-center gap-3 min-h-[44px] py-2 text-left"
            >
              <span className={cn("h-5 w-5 rounded border-2 shrink-0 flex items-center justify-center text-[11px] leading-none", on ? "bg-primary border-primary text-primary-foreground" : "border-input")}>
                {on && "✓"}
              </span>
              <span className="flex-1 text-sm truncate">{o.label}</span>
              <Count n={o.count} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Min / Max fields with the currency prefix inside each, plus optional preset chips above. */
export function MoneyRange({
  min, max, onChange, symbol, presets, label,
}: {
  min: number | null;
  max: number | null;
  onChange: (min: number | null, max: number | null) => void;
  symbol: string;
  presets?: { label: string; min: number | null; max: number | null }[];
  /** Used for accessible names, e.g. "Order total". */
  label: string;
}) {
  const num = (v: string) => (v === "" || !Number.isFinite(Number(v)) ? null : Math.max(0, Number(v)));
  const field = (aria: string, value: number | null, set: (v: number | null) => void, ph: string) => (
    <div className="relative flex-1 min-w-0">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">{symbol}</span>
      <Input type="number" inputMode="decimal" min={0} placeholder={ph} aria-label={aria} value={value ?? ""} onChange={(e) => set(num(e.target.value))} className="h-11 pl-8" />
    </div>
  );
  return (
    <div className="space-y-3">
      {presets && presets.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => {
            const on = min === p.min && max === p.max;
            return (
              <button
                key={p.label}
                type="button"
                aria-pressed={on}
                onClick={() => (on ? onChange(null, null) : onChange(p.min, p.max))}
                className={cn("h-9 px-3.5 rounded-full border text-sm font-medium whitespace-nowrap", on ? "bg-primary/10 border-primary text-primary" : "border-input")}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      )}
      <div className="flex items-center gap-2">
        {field(`${label} minimum`, min, (v) => onChange(v, max), "Min")}
        <span className="text-sm text-muted-foreground shrink-0">to</span>
        {field(`${label} maximum`, max, (v) => onChange(min, v), "Max")}
      </div>
    </div>
  );
}

/** Time-window rows with counts, plus a "Custom range" row that reveals From / To fields. */
export function WindowRows<V extends string>({
  options, value, onChange, custom, onCustomChange,
}: {
  options: { value: V; label: string; count?: number }[];
  value: V | null;
  onChange: (next: V | null) => void;
  custom: { from?: string; to?: string } | null;
  onCustomChange: (next: { from?: string; to?: string } | null) => void;
}) {
  const [customOpen, setCustomOpen] = useState(!!custom);
  useEffect(() => { if (custom) setCustomOpen(true); }, [custom]);
  const customActive = customOpen || !!custom;
  return (
    <div>
      <OptionRows
        options={options}
        value={customActive ? null : value}
        onChange={(v) => { setCustomOpen(false); onCustomChange(null); onChange(v); }}
      />
      <div className="border-t">
        <button
          type="button"
          role="radio"
          aria-checked={customActive}
          onClick={() => {
            if (customActive) { setCustomOpen(false); onCustomChange(null); return; }
            onChange(null);
            setCustomOpen(true);
          }}
          className="w-full flex items-center gap-3 min-h-[44px] py-2 text-left"
        >
          <span className={cn("h-5 w-5 rounded-full border-2 shrink-0 flex items-center justify-center", customActive ? "border-primary" : "border-input")}>
            {customActive && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
          </span>
          <span className="flex-1 text-sm">Custom range</span>
        </button>
        {customActive && (
          <div className="flex items-center gap-2 pb-1">
            <Input type="date" aria-label="From" value={custom?.from ?? ""} onChange={(e) => onCustomChange({ ...custom, from: e.target.value || undefined })} className="h-11" />
            <span className="text-sm text-muted-foreground shrink-0">to</span>
            <Input type="date" aria-label="To" value={custom?.to ?? ""} onChange={(e) => onCustomChange({ ...custom, to: e.target.value || undefined })} className="h-11" />
          </div>
        )}
      </div>
    </div>
  );
}

/** Yes/no conditions as switch rows; each switch narrows further. */
export function SwitchRows({
  rows,
}: {
  rows: { label: string; checked: boolean; onChange: (next: boolean) => void; count?: number }[];
}) {
  return (
    <div className="divide-y">
      {rows.map((r) => (
        <label key={r.label} className="flex items-center gap-3 min-h-[44px] py-2 cursor-pointer">
          <span className="flex-1 text-sm">{r.label}</span>
          <Count n={r.count} />
          <Switch checked={r.checked} onCheckedChange={r.onChange} aria-label={r.label} />
        </label>
      ))}
    </div>
  );
}

/** Sort sheet: radio rows that apply instantly. Never part of Filters. */
export function SortSheet<K extends string>({
  options, value, onChange, trigger,
}: {
  options: { value: K; label: string }[];
  value: K | null;
  onChange: (next: K) => void;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="bottom" className="rounded-t-2xl p-0 gap-0 sm:max-w-xl sm:mx-auto [&>button:last-child]:hidden">
        <SheetHeader className="flex-row items-center gap-2 space-y-0 px-5 pt-4 pb-3 text-left border-b">
          <SheetTitle className="text-lg mr-auto">Sort by</SheetTitle>
          <SheetDescription className="sr-only">Choose how the list is ordered.</SheetDescription>
          <SheetClose asChild>
            <Button type="button" variant="secondary" size="icon" className="h-11 w-11 rounded-full" aria-label="Close sort">
              <X className="h-5 w-5" />
            </Button>
          </SheetClose>
        </SheetHeader>
        <div className="px-5 py-2 pb-6" role="radiogroup">
          {options.map((o) => {
            const selected = value === o.value;
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => { onChange(o.value); setOpen(false); }}
                className="w-full flex items-center gap-3 min-h-[48px] py-2 text-left border-b last:border-b-0"
              >
                <span className={cn("h-5 w-5 rounded-full border-2 shrink-0 flex items-center justify-center", selected ? "border-primary" : "border-input")}>
                  {selected && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
                </span>
                <span className="text-sm">{o.label}</span>
              </button>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
