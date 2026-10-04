import {
  FilterSheet, FilterSection, MoneyRange, SortSheet as SortRadioSheet, SwitchRows, WindowRows,
} from "@/components/filter-sheet";
import {
  type CustomerFilterState,
  type CustomerSortState,
  type CustomerSortKey,
  type CustomerSortDirection,
  EMPTY_CUSTOMER_FILTERS,
  countActiveCustomerFilters,
} from "@/lib/customer-filters";

interface FiltersSheetProps {
  filters: CustomerFilterState;
  onApply: (next: CustomerFilterState) => void;
  resultCountFor: (draft: CustomerFilterState) => number;
  currencySymbol: string;
  trigger: React.ReactNode;
}

const hasRange = (r: { from?: string; to?: string } | null) => !!(r?.from || r?.to);
const money = (n: number, s: string) => `${s}${n.toLocaleString()}`;

const LAST_VISIT = [
  { value: "7d", label: "In the last 7 days" },
  { value: "30d", label: "In the last 30 days" },
  { value: "30d+", label: "More than 30 days ago" },
  { value: "never", label: "Never visited" },
] as const;

const DATE_ADDED = [
  { value: "month", label: "This month" },
  { value: "3months", label: "In the last 3 months" },
] as const;

export function FiltersSheet({ filters, onApply, resultCountFor, currencySymbol, trigger }: FiltersSheetProps) {
  return (
    <FilterSheet
      applied={filters}
      empty={EMPTY_CUSTOMER_FILTERS}
      onApply={onApply}
      resultCountFor={resultCountFor}
      noun="customer"
      trigger={trigger}
      activeCount={countActiveCustomerFilters}
    >
      {({ draft, patch }) => {
        // Option counts: what the list would show if this option were chosen on top of the rest of the draft.
        const visitCount = (v: CustomerFilterState["lastVisited"]) =>
          resultCountFor({ ...draft, lastVisited: v, lastVisitedCustom: null });
        const addedCount = (v: CustomerFilterState["dateAdded"]) =>
          resultCountFor({ ...draft, dateAdded: v, dateAddedCustom: null });
        const spendPresets = [
          { label: `${money(10000, currencySymbol)} or more`, min: 10000, max: null },
          { label: "No purchases", min: null, max: 0 },
        ];
        const spendSummary =
          draft.spendMin != null && draft.spendMax != null
            ? draft.spendMax === 0 && draft.spendMin === 0 ? "No purchases" : `${money(draft.spendMin, currencySymbol)} to ${money(draft.spendMax, currencySymbol)}`
            : draft.spendMax === 0 ? "No purchases"
            : draft.spendMin != null ? `${money(draft.spendMin, currencySymbol)} or more`
            : draft.spendMax != null ? `Up to ${money(draft.spendMax, currencySymbol)}`
            : null;
        const missing = [draft.missingAddress && "No address", draft.missingPhone && "No phone number"].filter(Boolean) as string[];

        return (
          <>
            <FilterSection
              label="Last visit"
              defaultOpen
              summary={
                hasRange(draft.lastVisitedCustom)
                  ? `${draft.lastVisitedCustom?.from ?? "…"} to ${draft.lastVisitedCustom?.to ?? "…"}`
                  : LAST_VISIT.find((o) => o.value === draft.lastVisited)?.label
              }
              onClear={() => patch({ lastVisited: null, lastVisitedCustom: null })}
            >
              <WindowRows
                options={LAST_VISIT.map((o) => ({ ...o, count: visitCount(o.value) }))}
                value={draft.lastVisited}
                onChange={(v) => patch({ lastVisited: v })}
                custom={draft.lastVisitedCustom}
                onCustomChange={(r) => patch({ lastVisitedCustom: r, ...(r ? { lastVisited: null } : {}) })}
              />
            </FilterSection>

            <FilterSection
              label="Total spend"
              summary={spendSummary}
              onClear={() => patch({ spendMin: null, spendMax: null, spendPreset: null })}
            >
              <MoneyRange
                label="Total spend"
                symbol={currencySymbol}
                min={draft.spendMin}
                max={draft.spendMax}
                presets={spendPresets}
                onChange={(min, max) => patch({ spendMin: min, spendMax: max, spendPreset: null })}
              />
            </FilterSection>

            <FilterSection
              label="Date added"
              summary={
                hasRange(draft.dateAddedCustom)
                  ? `${draft.dateAddedCustom?.from ?? "…"} to ${draft.dateAddedCustom?.to ?? "…"}`
                  : DATE_ADDED.find((o) => o.value === draft.dateAdded)?.label
              }
              onClear={() => patch({ dateAdded: null, dateAddedCustom: null })}
            >
              <WindowRows
                options={DATE_ADDED.map((o) => ({ ...o, count: addedCount(o.value) }))}
                value={draft.dateAdded}
                onChange={(v) => patch({ dateAdded: v })}
                custom={draft.dateAddedCustom}
                onCustomChange={(r) => patch({ dateAddedCustom: r, ...(r ? { dateAdded: null } : {}) })}
              />
            </FilterSection>

            <FilterSection
              label="Missing details"
              summary={missing.join(", ")}
              onClear={() => patch({ missingAddress: false, missingPhone: false })}
            >
              <SwitchRows
                rows={[
                  { label: "No address", checked: draft.missingAddress, onChange: (v) => patch({ missingAddress: v }), count: resultCountFor({ ...draft, missingAddress: true }) },
                  { label: "No phone number", checked: draft.missingPhone, onChange: (v) => patch({ missingPhone: v }), count: resultCountFor({ ...draft, missingPhone: true }) },
                ]}
              />
            </FilterSection>
          </>
        );
      }}
    </FilterSheet>
  );
}

interface SortSheetProps {
  sort: CustomerSortState | null;
  onChange: (next: CustomerSortState) => void;
  trigger: React.ReactNode;
}

const SORT_OPTIONS: { value: string; label: string; key: CustomerSortKey; direction: CustomerSortDirection }[] = [
  { value: "name:asc", label: "Name", key: "name", direction: "asc" },
  { value: "lastVisited:desc", label: "Most recent visit", key: "lastVisited", direction: "desc" },
  { value: "totalSpend:desc", label: "Highest spend", key: "totalSpend", direction: "desc" },
  { value: "dateAdded:desc", label: "Newest", key: "dateAdded", direction: "desc" },
];

export function SortSheet({ sort, onChange, trigger }: SortSheetProps) {
  return (
    <SortRadioSheet
      options={SORT_OPTIONS.map(({ value, label }) => ({ value, label }))}
      value={sort ? `${sort.key}:${sort.direction}` : null}
      onChange={(v) => {
        const o = SORT_OPTIONS.find((s) => s.value === v)!;
        onChange({ key: o.key, direction: o.direction });
      }}
      trigger={trigger}
    />
  );
}
