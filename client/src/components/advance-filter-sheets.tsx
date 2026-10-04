import {
  FilterSheet, FilterSection, ChipOptions, MoneyRange, SearchableOptions, SortSheet as SortRadioSheet,
} from "@/components/filter-sheet";
import { DateRangeSection } from "@/components/filter-date-range-section";
import {
  advanceDateRangeLabel,
  advanceAmountSummary,
  countActiveAdvanceFilters,
  EMPTY_ADVANCE_FILTERS,
  STATUS_LABELS,
  type AdvanceFilterState,
  type AdvanceSortState,
  type AdvanceSortKey,
  type AdvanceStatusFilter,
} from "@/lib/advance-filters";

export function AdvanceFiltersSheet({ filters, onApply, resultCountFor, currencySymbol, staffNames, trigger }: {
  filters: AdvanceFilterState;
  onApply: (next: AdvanceFilterState) => void;
  resultCountFor: (draft: AdvanceFilterState) => number;
  currencySymbol: string;
  /** Staff names present in the loaded advances. */
  staffNames: string[];
  trigger: React.ReactNode;
}) {
  return (
    <FilterSheet
      applied={filters}
      empty={EMPTY_ADVANCE_FILTERS}
      onApply={onApply}
      resultCountFor={resultCountFor}
      noun="advance"
      trigger={trigger}
      activeCount={countActiveAdvanceFilters}
    >
      {({ draft, patch }) => (
        <>
          <FilterSection
            label="Status"
            defaultOpen
            summary={draft.statuses.map((s) => STATUS_LABELS[s]).join(", ")}
            onClear={() => patch({ statuses: [] })}
          >
            <ChipOptions
              options={(Object.keys(STATUS_LABELS) as AdvanceStatusFilter[]).map((v) => ({
                value: v, label: STATUS_LABELS[v], count: resultCountFor({ ...draft, statuses: [v] }),
              }))}
              value={draft.statuses}
              onChange={(statuses) => patch({ statuses: statuses as AdvanceStatusFilter[] })}
            />
          </FilterSection>

          {staffNames.length > 0 && (
            <FilterSection label="Staff" summary={draft.staff.join(", ")} onClear={() => patch({ staff: [] })}>
              {(() => {
                const options = staffNames.map((n) => ({ value: n, label: n, count: resultCountFor({ ...draft, staff: [n] }) }));
                return staffNames.length > 6 ? (
                  <SearchableOptions placeholder="Search staff" options={options} value={draft.staff} onChange={(staff) => patch({ staff })} />
                ) : (
                  <ChipOptions options={options} value={draft.staff} onChange={(staff) => patch({ staff })} />
                );
              })()}
            </FilterSection>
          )}

          <DateRangeSection
            from={draft.dateFrom}
            to={draft.dateTo}
            summary={advanceDateRangeLabel(draft.dateFrom, draft.dateTo)}
            onChange={(dateFrom, dateTo) => patch({ dateFrom, dateTo })}
          />

          <FilterSection
            label="Amount"
            summary={advanceAmountSummary(draft, currencySymbol)}
            onClear={() => patch({ amountMin: null, amountMax: null })}
          >
            <MoneyRange
              label="Amount"
              symbol={currencySymbol}
              min={draft.amountMin}
              max={draft.amountMax}
              onChange={(amountMin, amountMax) => patch({ amountMin, amountMax })}
            />
          </FilterSection>
        </>
      )}
    </FilterSheet>
  );
}

const SORT_OPTIONS: { value: AdvanceSortKey; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "amountHigh", label: "Highest amount" },
  { value: "amountLow", label: "Lowest amount" },
  { value: "staff", label: "Staff A–Z" },
];

export function AdvanceSortSheet({ sort, onChange, trigger }: {
  sort: AdvanceSortState | null;
  onChange: (next: AdvanceSortState) => void;
  trigger: React.ReactNode;
}) {
  return <SortRadioSheet options={SORT_OPTIONS} value={sort?.key ?? null} onChange={(key) => onChange({ key })} trigger={trigger} />;
}
