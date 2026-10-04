import { FilterSheet, FilterSection, OptionRows, SortSheet as SortRadioSheet } from "@/components/filter-sheet";
import { DateRangeSection } from "@/components/filter-date-range-section";
import {
  profitabilityDateRangeLabel,
  type ProfitabilityFilterState,
  type ProfitabilitySortState,
  type ProfitabilitySortKey,
  type ProfitabilityTypeFilter,
  type ProfitabilityStatusFilter,
  TYPE_LABELS,
  STATUS_LABELS,
  EMPTY_PROFITABILITY_FILTERS,
  countActiveProfitabilityFilters,
} from "@/lib/profitability-filters";

export function ProfitabilityFiltersSheet({ filters, onApply, resultCountFor, trigger }: {
  filters: ProfitabilityFilterState;
  onApply: (next: ProfitabilityFilterState) => void;
  resultCountFor: (draft: ProfitabilityFilterState) => number;
  trigger: React.ReactNode;
}) {
  return (
    <FilterSheet
      applied={filters}
      empty={EMPTY_PROFITABILITY_FILTERS}
      onApply={onApply}
      resultCountFor={resultCountFor}
      noun="item"
      trigger={trigger}
      activeCount={countActiveProfitabilityFilters}
    >
      {({ draft, patch }) => (
        <>
          <DateRangeSection
            from={draft.dateFrom}
            to={draft.dateTo}
            summary={profitabilityDateRangeLabel(draft.dateFrom, draft.dateTo)}
            onChange={(dateFrom, dateTo) => patch({ dateFrom, dateTo })}
          />
          <FilterSection
            label="Type"
            summary={draft.type ? TYPE_LABELS[draft.type] : null}
            onClear={() => patch({ type: null })}
          >
            <OptionRows<ProfitabilityTypeFilter>
              options={(Object.keys(TYPE_LABELS) as ProfitabilityTypeFilter[]).map((v) => ({
                value: v, label: TYPE_LABELS[v], count: resultCountFor({ ...draft, type: v }),
              }))}
              value={draft.type}
              onChange={(type) => patch({ type })}
            />
          </FilterSection>
          <FilterSection
            label="Status"
            summary={draft.status ? STATUS_LABELS[draft.status] : null}
            onClear={() => patch({ status: null })}
          >
            <OptionRows<ProfitabilityStatusFilter>
              options={(Object.keys(STATUS_LABELS) as ProfitabilityStatusFilter[]).map((v) => ({
                value: v, label: STATUS_LABELS[v], count: resultCountFor({ ...draft, status: v }),
              }))}
              value={draft.status}
              onChange={(status) => patch({ status })}
            />
          </FilterSection>
        </>
      )}
    </FilterSheet>
  );
}

const SORT_OPTIONS: { value: string; label: string; key: ProfitabilitySortKey; direction: "asc" | "desc" }[] = [
  { value: "name:asc", label: "Name", key: "name", direction: "asc" },
  { value: "revenue:desc", label: "Highest revenue", key: "revenue", direction: "desc" },
  { value: "netProfit:desc", label: "Highest profit", key: "netProfit", direction: "desc" },
  { value: "netProfit:asc", label: "Biggest loss", key: "netProfit", direction: "asc" },
  { value: "margin:desc", label: "Best margin", key: "margin", direction: "desc" },
];

export function ProfitabilitySortSheet({ sort, onChange, trigger }: {
  sort: ProfitabilitySortState | null;
  onChange: (next: ProfitabilitySortState) => void;
  trigger: React.ReactNode;
}) {
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
