import { useState } from "react";
import { Input } from "@/components/ui/input";
import { ChipOptions, FilterSection } from "@/components/filter-sheet";

/** Date-range section shared by the list Filters sheets (Sales, Expenses). Dates are local yyyy-MM-dd. */
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const DATE_PRESETS: { value: string; label: string; range: () => [string, string] }[] = [
  { value: "today", label: "Today", range: () => { const t = new Date(); return [ymd(t), ymd(t)]; } },
  { value: "yesterday", label: "Yesterday", range: () => { const d = new Date(); d.setDate(d.getDate() - 1); return [ymd(d), ymd(d)]; } },
  { value: "7d", label: "Last 7 days", range: () => { const t = new Date(); const f = new Date(); f.setDate(f.getDate() - 6); return [ymd(f), ymd(t)]; } },
  { value: "30d", label: "Last 30 days", range: () => { const t = new Date(); const f = new Date(); f.setDate(f.getDate() - 29); return [ymd(f), ymd(t)]; } },
  { value: "month", label: "This month", range: () => { const t = new Date(); return [ymd(new Date(t.getFullYear(), t.getMonth(), 1)), ymd(t)]; } },
  { value: "lastMonth", label: "Last month", range: () => { const t = new Date(); return [ymd(new Date(t.getFullYear(), t.getMonth() - 1, 1)), ymd(new Date(t.getFullYear(), t.getMonth(), 0))]; } },
];

export function DateRangeSection({ from, to, summary, onChange }: { from: string | null; to: string | null; summary: string; onChange: (from: string | null, to: string | null) => void }) {
  const presetFor = (f: string | null, t: string | null) =>
    f && t ? DATE_PRESETS.find((p) => { const [pf, pt] = p.range(); return pf === f && pt === t; })?.value ?? null : null;
  const matched = presetFor(from, to);
  const [customOpen, setCustomOpen] = useState(!!(from || to) && !matched);
  const showCustom = customOpen || (!!(from || to) && !matched);
  const selected = showCustom ? "custom" : matched;

  return (
    <FilterSection
      label="Date range"
      defaultOpen
      summary={summary || null}
      onClear={() => { setCustomOpen(false); onChange(null, null); }}
    >
      <div className="space-y-3">
        <ChipOptions
          options={[...DATE_PRESETS.map(({ value, label }) => ({ value, label })), { value: "custom", label: "Custom" }]}
          value={selected ? [selected] : []}
          onChange={(v) => {
            const next = v[v.length - 1];
            if (!next) { setCustomOpen(false); onChange(null, null); return; }
            if (next === "custom") { setCustomOpen(true); return; }
            setCustomOpen(false);
            const [f, t] = DATE_PRESETS.find((p) => p.value === next)!.range();
            onChange(f, t);
          }}
        />
        {showCustom && (
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-xs text-muted-foreground">
              From
              <Input type="date" value={from ?? ""} max={to ?? undefined} onChange={(e) => onChange(e.target.value || null, to)} />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              To
              <Input type="date" value={to ?? ""} min={from ?? undefined} onChange={(e) => onChange(from, e.target.value || null)} />
            </label>
          </div>
        )}
      </div>
    </FilterSection>
  );
}
